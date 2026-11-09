import { randomUUID } from "node:crypto";
import {
  FREELANCE_LIMITS,
  type FreelanceCategory,
  type FreelanceServiceStatus,
} from "../../../config/freelance";
import { errorCodes, HttpError, notFound, validationError } from "@intgetion/kit";
import { hasCandidateProfile } from "../../../platform";
import { safeNotify } from "../../../platform";
import { listActiveSkills, matchSkillSlug } from "../../../platform";
import * as repo from "../repo/freelance-repo";
import { absolutePriceFlags, serviceFlags } from "./flags";
import { serviceInput, type ServiceInput } from "../schemas";
import {
  assertServiceRules,
  FREELANCE_ERRORS,
  priceRange,
  serviceSlug,
  sortPackages,
  usdToMinor,
  type PriceRange,
} from "./rules";

export type ServiceWithPackages = repo.ServiceRow & {
  packages: repo.PackageRow[];
};

/**
 * The form sends skills by name ("React"); the stored value is the taxonomy
 * slug. A name the catalog does not know is a field error, not a new skill.
 */
async function resolveSkillNames(raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const body = { ...(raw as Record<string, unknown>) };
  if (!Array.isArray(body.skills)) return body;
  const names = body.skills
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, FREELANCE_LIMITS.skillsMax + 1);
  delete body.skills;
  const slugs: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const slug = await matchSkillSlug(name);
    if (slug) slugs.push(slug);
    else unknown.push(name);
  }
  if (unknown.length > 0) {
    throw validationError([{ path: "skills", problem: "unknown", unknown }]);
  }
  body.skillSlugs = [...new Set(slugs)];
  return body;
}

async function parseService(raw: unknown): Promise<ServiceInput> {
  const parsed = serviceInput.safeParse(await resolveSkillNames(raw));
  if (!parsed.success) {
    throw validationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    );
  }
  assertServiceRules(parsed.data);
  return parsed.data;
}

async function assertKnownSkills(slugs: readonly string[]): Promise<void> {
  if (slugs.length === 0) return;
  const known = new Set((await listActiveSkills()).map((skill) => skill.slug));
  const unknown = slugs.filter((slug) => !known.has(slug));
  if (unknown.length > 0) {
    throw validationError([
      { path: "skillSlugs", problem: "unknown", unknown },
    ]);
  }
}

function packageValues(input: ServiceInput): repo.PackageValues[] {
  return sortPackages(input.packages).map((pkg) => ({
    tier: pkg.tier,
    priceMinor: usdToMinor(pkg.price),
    deliveryDays: pkg.deliveryDays,
    revisions: pkg.revisions,
    includes: pkg.includes,
  }));
}

function serviceValues(input: ServiceInput): repo.ServiceValues {
  return {
    title: input.title,
    category: input.category,
    description: input.description,
    buyerNeeds: input.buyerNeeds,
    languages: [...new Set(input.languages)],
    skillSlugs: [...new Set(input.skillSlugs)],
    links: [...new Set(input.links)],
  };
}

/** Turn "Беру заказы" on or off. Only a person with a candidate profile (28.2). */
export async function setAcceptingOrders(
  userId: string,
  accepting: boolean,
  now = new Date(),
): Promise<repo.SellerRow> {
  if (!(await hasCandidateProfile(userId))) {
    throw new HttpError(
      409,
      FREELANCE_ERRORS.candidateProfileRequired,
      "Fill in the candidate profile first",
    );
  }
  return repo.upsertSeller(userId, accepting, now);
}

export async function getSeller(
  userId: string,
): Promise<repo.SellerRow | null> {
  return repo.findSeller(userId);
}

async function requireSeller(userId: string): Promise<repo.SellerRow> {
  const seller = await repo.findSeller(userId);
  if (!seller || !(await hasCandidateProfile(userId))) {
    throw new HttpError(
      409,
      FREELANCE_ERRORS.candidateProfileRequired,
      "Turn on taking orders in the profile first",
    );
  }
  return seller;
}

/** Own service or 404; a removed one is gone for its owner too. */
async function ownService(
  userId: string,
  serviceId: string,
): Promise<repo.ServiceRow> {
  const row = await repo.findServiceById(serviceId);
  if (!row || row.sellerId !== userId || row.status === "removed")
    throw notFound();
  return row;
}

/** A new service starts as a draft (28.3). */
export async function createService(
  userId: string,
  raw: unknown,
  now = new Date(),
): Promise<repo.ServiceRow> {
  const input = await parseService(raw);
  await requireSeller(userId);
  await assertKnownSkills(input.skillSlugs);
  const id = randomUUID();
  return repo.runInTransaction((tx) =>
    repo.insertService(
      tx,
      {
        ...serviceValues(input),
        id,
        slug: serviceSlug(id, input.title),
        sellerId: userId,
        now,
      },
      packageValues(input),
    ),
  );
}

/** Status after the owner edits the text (28.3, D447). */
export function statusAfterEdit(
  status: FreelanceServiceStatus,
): FreelanceServiceStatus {
  if (status === "published" || status === "paused") return "pending";
  if (status === "rejected") return "draft";
  return status;
}

/** Edit text and packages. A published or paused one goes back to moderation. */
export async function updateService(
  userId: string,
  serviceId: string,
  raw: unknown,
  now = new Date(),
): Promise<repo.ServiceRow> {
  const input = await parseService(raw);
  const row = await ownService(userId, serviceId);
  await assertKnownSkills(input.skillSlugs);
  const status = statusAfterEdit(row.status);
  const values = serviceValues(input);
  const packages = packageValues(input);
  const flags =
    status === "pending" && row.status !== "pending"
      ? await serviceFlags({ ...values, packages, sellerId: row.sellerId })
      : [];
  return repo.runInTransaction(async (tx) => {
    const updated = await repo.replaceService(
      tx,
      row.id,
      { ...values, status, now },
      packages,
    );
    // A live service that changed goes back to the queue (D447).
    if (status === "pending" && row.status !== "pending") {
      await repo.queueForModeration(
        tx,
        row.id,
        "freelance_service_edit",
        flags,
      );
    }
    return updated;
  });
}

async function assertBelowLimit(
  userId: string,
  exceptId: string,
): Promise<void> {
  const active = await repo.countActiveServices(userId, exceptId);
  if (active >= FREELANCE_LIMITS.activeServicesMax) {
    throw new HttpError(
      409,
      FREELANCE_ERRORS.serviceLimit,
      `At most ${FREELANCE_LIMITS.activeServicesMax} active services`,
    );
  }
}

/** Send a draft to moderation. Every service is checked before it shows (D447). */
export async function submitService(
  userId: string,
  serviceId: string,
  now = new Date(),
): Promise<repo.ServiceRow> {
  const row = await ownService(userId, serviceId);
  await requireSeller(userId);
  if (row.status !== "draft") throw invalidServiceStep();
  await assertBelowLimit(userId, row.id);
  const packages = await repo.listPackages([row.id]);
  const flags = await serviceFlags({ ...row, packages });
  const updated = await repo.runInTransaction(async (tx) => {
    const pending = await repo.setPendingInTx(tx, row.id, now);
    if (pending) {
      await repo.queueForModeration(
        tx,
        row.id,
        "freelance_service_review",
        flags,
      );
    }
    return pending;
  });
  if (!updated) throw notFound();
  return updated;
}

/** Absolute price flags; the full set is `serviceFlags` (28.9, D462). */
export function riskFlags(
  packages: readonly { priceMinor: bigint }[],
): string[] {
  return absolutePriceFlags(packages);
}

export type ServiceForModeration = {
  id: string;
  title: string;
  status: FreelanceServiceStatus;
  sellerId: string;
  slug: string;
};

/** Services behind queue items, for the admin queue (28.9). */
export async function getServicesForModeration(
  ids: readonly string[],
): Promise<ServiceForModeration[]> {
  return repo.findServicesForModeration(ids);
}

/** Orders behind complaints, for the admin list (28.9). */
export async function getOrdersForModeration(ids: readonly string[]) {
  return repo.findOrdersForModeration(ids);
}

/** Pause a published service or show a paused one again. */
export async function setServicePaused(
  userId: string,
  serviceId: string,
  paused: boolean,
  now = new Date(),
): Promise<repo.ServiceRow> {
  const row = await ownService(userId, serviceId);
  const from: FreelanceServiceStatus = paused ? "published" : "paused";
  if (row.status !== from) throw invalidServiceStep();
  const updated = await repo.setServiceStatus(
    row.id,
    paused ? "paused" : "published",
    {
      now,
    },
  );
  if (!updated) throw notFound();
  return updated;
}

/**
 * The moderator's decision on a pending service (phase H calls this).
 * Publish sets `published_at` once; reject keeps the note for the owner.
 */
export async function decideServiceModeration(
  serviceId: string,
  decision: "publish" | "reject" | "remove",
  note: string | null,
  now = new Date(),
): Promise<repo.ServiceRow> {
  const row = await repo.findServiceById(serviceId);
  if (!row) throw notFound();
  if (decision !== "remove" && row.status !== "pending")
    throw invalidServiceStep();
  const status: FreelanceServiceStatus =
    decision === "publish"
      ? "published"
      : decision === "reject"
        ? "rejected"
        : "removed";
  const updated = await repo.setServiceStatus(row.id, status, {
    now,
    moderationNote: note,
    ...(decision === "publish" && !row.publishedAt ? { publishedAt: now } : {}),
  });
  if (!updated) throw notFound();
  if (row.status !== status) {
    await safeNotify("freelance.service_decided", [updated.sellerId], {
      serviceId: updated.id,
      serviceTitle: updated.title,
      decision: status,
    });
  }
  return updated;
}

function invalidServiceStep(): HttpError {
  return new HttpError(
    409,
    errorCodes.invalidTransition,
    "This status change is not allowed",
  );
}

async function withPackages(
  rows: readonly repo.ServiceRow[],
): Promise<ServiceWithPackages[]> {
  const packages = await repo.listPackages(rows.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    packages: sortPackages(packages.filter((pkg) => pkg.serviceId === row.id)),
  }));
}

/** The owner's services, any status but removed. */
export async function listOwnServices(
  userId: string,
): Promise<ServiceWithPackages[]> {
  return withPackages(await repo.listSellerServices(userId));
}

export async function getOwnService(
  userId: string,
  serviceId: string,
): Promise<ServiceWithPackages> {
  const [row] = await withPackages([await ownService(userId, serviceId)]);
  if (!row) throw notFound();
  return row;
}

export type PublicService = ServiceWithPackages & repo.ServiceStats;

/** A published service of a seller who takes orders, or null. */
export async function getPublishedService(
  slug: string,
): Promise<PublicService | null> {
  return publicOf(await repo.findServiceBySlug(slug));
}

/** The same check by id, for Spoki and `/chat?service=` (28.8). */
export async function getPublishedServiceById(
  id: string,
): Promise<PublicService | null> {
  return publicOf(await repo.findServiceById(id));
}

async function publicOf(
  row: repo.ServiceRow | null,
): Promise<PublicService | null> {
  if (!row || row.status !== "published") return null;
  const seller = await repo.findSeller(row.sellerId);
  if (!seller?.accepting) return null;
  const [full] = await withPackages([row]);
  const stats = (await repo.serviceStats([row.id])).get(row.id);
  if (!full || !stats) return null;
  return { ...full, ...stats };
}

export const CATALOG_PAGE_SIZE = 24;

export type CatalogQuery = Omit<repo.CatalogFilter, "limit" | "offset"> & {
  page: number;
};

export async function searchServices(
  query: CatalogQuery,
): Promise<{ services: PublicService[]; total: number; page: number }> {
  const page = Math.max(1, query.page);
  const { rows, total } = await repo.searchPublished({
    ...query,
    limit: CATALOG_PAGE_SIZE,
    offset: (page - 1) * CATALOG_PAGE_SIZE,
  });
  const full = await withPackages(rows);
  const stats = await repo.serviceStats(rows.map((row) => row.id));
  return {
    services: full.map((service) => ({
      ...service,
      ...(stats.get(service.id) ?? { completed: 0, rating: null, reviews: 0 }),
    })),
    total,
    page,
  };
}

/** Min, median and max basic price in one direction; null when none (28.8). */
export async function freelancePriceRange(
  category: FreelanceCategory,
): Promise<PriceRange | null> {
  return priceRange(await repo.publishedBasicPrices(category));
}

/** Any service with its packages, for the moderator's preview (28.9). */
export async function getServiceForReview(
  serviceId: string,
): Promise<ServiceWithPackages | null> {
  const row = await repo.findServiceById(serviceId);
  if (!row) return null;
  const [full] = await withPackages([row]);
  return full ?? null;
}
