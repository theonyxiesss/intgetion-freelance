import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { isExplicitYes } from "../../../lib/explicit-yes";
import { freelanceServiceDrafts } from "../../../db/owned";
import {
  HttpError,
  notFound,
  unauthenticated,
  validationError,
} from "@intgetion/kit";
import { FREELANCE_CATEGORIES, FREELANCE_TIERS } from "../../../config/freelance";
import { hasCandidateProfile } from "../../../platform";
import { createService, getSeller, submitService } from "./listing-service";

export type ServiceBriefDraft = Record<string, unknown>;
export type ServiceBriefDraftView = {
  id: string;
  draft: ServiceBriefDraft;
  missingRequired: string[];
};

const REQUIRED = [
  "title",
  "category",
  "description",
  "languages",
  "packages",
] as const;

/** What a service listing needs; Spoki shows progress (D523). */
export const SERVICE_DRAFT_REQUIRED: readonly string[] = REQUIRED;
const isText = (value: unknown, min: number, max: number) =>
  typeof value === "string" &&
  value.trim().length >= min &&
  value.trim().length <= max;

export function mergeServiceDraft(
  current: ServiceBriefDraft,
  patch: ServiceBriefDraft,
  replacePackages = false,
) {
  const merged: ServiceBriefDraft = {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(
        ([, value]) => value !== null && value !== undefined,
      ),
    ),
  };
  if (Array.isArray(patch.packages) && !replacePackages) {
    const existing = Array.isArray(current.packages)
      ? (current.packages as Record<string, unknown>[])
      : [];
    const next = new Map(existing.map((pkg) => [String(pkg.tier), pkg]));
    for (const pkg of patch.packages as Record<string, unknown>[]) {
      const tier = String(pkg.tier);
      next.set(tier, {
        ...(next.get(tier) ?? {}),
        ...Object.fromEntries(
          Object.entries(pkg).filter(
            ([, value]) => value !== null && value !== undefined,
          ),
        ),
      });
    }
    merged.packages = [...next.values()];
  }
  return merged;
}

export function normalizeServiceLanguages(values: readonly string[]): string[] {
  const names: Record<string, string> = {
    english: "en",
    italian: "it",
    italiano: "it",
    spanish: "es",
    español: "es",
    espanol: "es",
    russian: "ru",
    русский: "ru",
    german: "de",
    deutsch: "de",
    french: "fr",
    français: "fr",
    portuguese: "pt",
    português: "pt",
    dutch: "nl",
    japanese: "ja",
    chinese: "zh",
    arabic: "ar",
    hindi: "hi",
  };
  return [
    ...new Set(
      values
        .map(
          (value) =>
            names[value.trim().toLocaleLowerCase()] ??
            value.trim().toLowerCase(),
        )
        .filter((value) => /^[a-z]{2}$/.test(value)),
    ),
  ];
}

export function missingServiceDraftFields(draft: ServiceBriefDraft): string[] {
  return REQUIRED.filter((key) => {
    const value = draft[key];
    if (key === "title") return !isText(value, 10, 80);
    if (key === "category")
      return !FREELANCE_CATEGORIES.includes(value as never);
    if (key === "description") return !isText(value, 80, 1500);
    if (key === "languages")
      return (
        !Array.isArray(value) ||
        value.length < 1 ||
        value.length > 5 ||
        value.some((x) => typeof x !== "string" || !/^[a-z]{2}$/i.test(x))
      );
    if (!Array.isArray(value) || value.length < 1 || value.length > 3)
      return true;
    const basic = value.find(
      (pkg) =>
        pkg &&
        typeof pkg === "object" &&
        (pkg as Record<string, unknown>).tier === "basic",
    ) as Record<string, unknown> | undefined;
    if (!basic) return true;
    return value.some((packageValue) => {
      if (!packageValue || typeof packageValue !== "object") return true;
      const pkg = packageValue as Record<string, unknown>;
      return (
        !FREELANCE_TIERS.includes(pkg.tier as never) ||
        !/^\d{1,7}(?:\.\d{1,2})?$/.test(String(pkg.price ?? "")) ||
        !Number.isInteger(pkg.deliveryDays) ||
        Number(pkg.deliveryDays) < 1 ||
        Number(pkg.deliveryDays) > 90 ||
        !Number.isInteger(pkg.revisions) ||
        Number(pkg.revisions) < 0 ||
        Number(pkg.revisions) > 10 ||
        !Array.isArray(pkg.includes) ||
        pkg.includes.length < 1 ||
        pkg.includes.length > 8 ||
        pkg.includes.some((item) => !isText(item, 1, 120))
      );
    });
  });
}

/** A clear yes to sending the service, before its card (D520). */
export function isExplicitServiceDraftConfirmation(value: string): boolean {
  return isExplicitYes(value, [
    "отправляй",
    "публикуй",
    "запускай",
    "submit",
    "publish",
  ]);
}

export function unconfirmedServiceRanges(
  userText: string,
  patch: ServiceBriefDraft,
) {
  if (!Array.isArray(patch.packages))
    return [] as {
      field: string;
      low: number;
      high: number;
      proposal: number;
      tier: string;
    }[];
  const ranges: {
    field: string;
    low: number;
    high: number;
    proposal: number;
    tier: string;
  }[] = [];
  const price =
    /(?:\$\s*(\d+(?:[.,]\d+)?)\s*[-–—]\s*\$?\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*(?:\$|usd|доллар\w*|бакс\w*))/giu.exec(
      userText,
    );
  const days = /(\d+)\s*[-–—]\s*(\d+)\s*(?:days?|дн(?:ей|я)|день)/iu.exec(
    userText,
  );
  for (const raw of patch.packages as Record<string, unknown>[]) {
    for (const [field, match] of [
      ["price", price],
      ["deliveryDays", days],
    ] as const) {
      if (!match || raw[field] === undefined) continue;
      const low = Number((match[1] ?? match[3]).replace(",", "."));
      const high = Number((match[2] ?? match[4]).replace(",", "."));
      const proposal =
        field === "price"
          ? Math.round(((low + high) / 2) * 100) / 100
          : Math.round((low + high) / 2);
      const printable = String(proposal);
      const agreed = new RegExp(
        `(?:ок|давай|ставь|выбери|бер[её]м|соглас(?:ен|на)|use|choose|set|take)[^.!?]{0,20}\\b${printable.replace(".", "\\.")}\\b|\\b${printable.replace(".", "\\.")}\\b[^.!?]{0,20}(?:ок|подходит|да|works|okay)`,
        "i",
      ).test(userText);
      if (!agreed && Number(String(raw[field]).replace(",", ".")) === proposal)
        ranges.push({ field, low, high, proposal, tier: String(raw.tier) });
    }
  }
  return ranges;
}

export function withoutUnconfirmedServiceRanges(
  patch: ServiceBriefDraft,
  ranges: readonly { field: string; tier: string }[],
) {
  if (!Array.isArray(patch.packages) || ranges.length === 0) return patch;
  return {
    ...patch,
    packages: (patch.packages as Record<string, unknown>[]).map((pkg) => {
      const blocked = ranges
        .filter((range) => range.tier === String(pkg.tier))
        .map((range) => range.field);
      return Object.fromEntries(
        Object.entries(pkg).filter(([key]) => !blocked.includes(key)),
      );
    }),
  };
}

function validatePatch(patch: ServiceBriefDraft) {
  const allowed = new Set([
    "title",
    "category",
    "description",
    "buyerNeeds",
    "languages",
    "skills",
    "links",
    "packages",
  ]);
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key) || value === null || value === undefined) continue;
    const invalid =
      key === "title"
        ? !isText(value, 0, 80)
        : key === "category"
          ? !FREELANCE_CATEGORIES.includes(value as never)
          : key === "description"
            ? !isText(value, 0, 1500)
            : key === "buyerNeeds"
              ? !isText(value, 0, 800)
              : key === "languages"
                ? !Array.isArray(value) ||
                  value.length > 5 ||
                  value.some(
                    (x) => typeof x !== "string" || !/^[a-z]{2}$/i.test(x),
                  )
                : key === "skills"
                  ? !Array.isArray(value) ||
                    value.length > 6 ||
                    value.some((x) => typeof x !== "string" || x.length > 80)
                  : key === "links"
                    ? !Array.isArray(value) ||
                      value.length > 5 ||
                      value.some((x) => typeof x !== "string" || x.length > 500)
                    : !Array.isArray(value) ||
                      value.length > 3 ||
                      value.some(
                        (pkg) =>
                          !pkg ||
                          typeof pkg !== "object" ||
                          !FREELANCE_TIERS.includes(
                            (pkg as Record<string, unknown>).tier as never,
                          ),
                      ) ||
                      new Set(
                        (value as Record<string, unknown>[]).map(
                          (pkg) => (pkg as Record<string, unknown>).tier,
                        ),
                      ).size !== value.length;
    if (invalid) throw validationError([{ path: key, problem: "invalid" }]);
  }
}

export async function readServiceBriefDraft(
  userId: string | null,
  draftId?: string,
): Promise<ServiceBriefDraftView> {
  if (!userId) throw unauthenticated();
  if (!(await getSeller(userId)) || !(await hasCandidateProfile(userId)))
    throw new HttpError(
      409,
      "CANDIDATE_PROFILE_REQUIRED",
      "Only a seller with a candidate profile can create a listing",
    );
  const db = getDb();
  let row;
  if (draftId) {
    [row] = await db
      .select()
      .from(freelanceServiceDrafts)
      .where(
        and(
          eq(freelanceServiceDrafts.id, draftId),
          eq(freelanceServiceDrafts.userId, userId),
        ),
      )
      .limit(1);
  } else {
    [row] = await db
      .select()
      .from(freelanceServiceDrafts)
      .where(eq(freelanceServiceDrafts.userId, userId))
      .orderBy(desc(freelanceServiceDrafts.updatedAt))
      .limit(1);
    if (!row) {
      [row] = await db
        .insert(freelanceServiceDrafts)
        .values({ userId })
        .onConflictDoNothing({ target: freelanceServiceDrafts.userId })
        .returning();
      if (!row)
        [row] = await db
          .select()
          .from(freelanceServiceDrafts)
          .where(eq(freelanceServiceDrafts.userId, userId))
          .limit(1);
    }
  }
  if (!row) throw notFound();
  return {
    id: row.id,
    draft: row.draft ?? {},
    missingRequired: missingServiceDraftFields(row.draft ?? {}),
  };
}

export async function patchServiceBriefDraft(
  userId: string | null,
  input: {
    draftId?: string;
    patch: ServiceBriefDraft;
    replacePackages?: boolean;
  },
) {
  if (!userId) throw unauthenticated();
  const patch = { ...input.patch };
  if (Array.isArray(patch.languages))
    patch.languages = normalizeServiceLanguages(patch.languages as string[]);
  validatePatch(patch);
  const current = await readServiceBriefDraft(userId, input.draftId);
  const draft = mergeServiceDraft(current.draft, patch, input.replacePackages);
  const [row] = await getDb()
    .update(freelanceServiceDrafts)
    .set({ draft, updatedAt: new Date() })
    .where(
      and(
        eq(freelanceServiceDrafts.id, current.id),
        eq(freelanceServiceDrafts.userId, userId),
      ),
    )
    .returning();
  return {
    id: row.id,
    draft: row.draft,
    missingRequired: missingServiceDraftFields(row.draft),
  };
}

export async function resetServiceBriefDraft(
  userId: string | null,
  draftId?: string,
) {
  if (!userId) throw unauthenticated();
  const current = await readServiceBriefDraft(userId, draftId);
  const [row] = await getDb()
    .update(freelanceServiceDrafts)
    .set({ draft: {}, updatedAt: new Date() })
    .where(
      and(
        eq(freelanceServiceDrafts.id, current.id),
        eq(freelanceServiceDrafts.userId, userId),
      ),
    )
    .returning();
  return { id: row.id, draft: {}, missingRequired: [...REQUIRED] };
}

export async function confirmServiceBriefDraft(
  userId: string | null,
  draftId?: string,
) {
  if (!userId) throw unauthenticated();
  const current = await readServiceBriefDraft(userId, draftId);
  if (current.missingRequired.length)
    throw validationError([
      { path: current.missingRequired[0]!, problem: "required" },
    ]);
  // One sender wins (D520): the draft row is taken in one statement; a
  // second call finds nothing and creates nothing. On failure it goes back.
  const [claimed] = await getDb()
    .delete(freelanceServiceDrafts)
    .where(
      and(
        eq(freelanceServiceDrafts.id, current.id),
        eq(freelanceServiceDrafts.userId, userId),
      ),
    )
    .returning();
  if (!claimed)
    throw new HttpError(409, "CONFLICT", "This service is already being sent");
  const d = current.draft;
  let pending: Awaited<ReturnType<typeof submitService>>;
  try {
    const service = await createService(userId, {
      title: d.title,
      category: d.category,
      description: d.description,
      buyerNeeds: d.buyerNeeds ?? "",
      languages: d.languages,
      skills: d.skills ?? [],
      links: d.links ?? [],
      packages: d.packages,
    });
    pending = await submitService(userId, service.id);
  } catch (error) {
    await getDb()
      .insert(freelanceServiceDrafts)
      .values(claimed)
      .onConflictDoNothing();
    throw error;
  }
  return { id: pending.id, title: pending.title, status: pending.status };
}
