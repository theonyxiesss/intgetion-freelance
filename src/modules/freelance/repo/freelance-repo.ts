import { freelancePorts } from "../../../ports";
import {
  and,
  arrayContains,
  arrayOverlaps,
  asc,
  avg,
  count,
  desc,
  eq,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import {
  freelanceOrderHistory,
  freelanceOrders,
  freelancePackages,
  freelanceReviews,
  freelanceSellers,
  freelanceServices,
} from "../../../db/owned";
import {
  FREELANCE_ACTIVE_STATUSES,
  type FreelanceCategory,
  type FreelanceOrderStatus,
  type FreelanceServiceStatus,
  type FreelanceTier,
} from "../../../config/freelance";

/** Queries only; the rules live in service/ (3.2). */

type Database = ReturnType<typeof getDb>;
export type FreelanceTx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Conn = Database | FreelanceTx;

export type SellerRow = typeof freelanceSellers.$inferSelect;
export type ServiceRow = typeof freelanceServices.$inferSelect;
export type PackageRow = typeof freelancePackages.$inferSelect;
export type OrderRow = typeof freelanceOrders.$inferSelect;
export type ReviewRow = typeof freelanceReviews.$inferSelect;

export type PackageValues = {
  tier: FreelanceTier;
  priceMinor: bigint;
  deliveryDays: number;
  revisions: number;
  includes: string[];
};

export type ServiceValues = {
  title: string;
  category: FreelanceCategory;
  description: string;
  buyerNeeds: string;
  languages: string[];
  skillSlugs: string[];
  links: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export async function findSeller(userId: string): Promise<SellerRow | null> {
  const [row] = await getDb()
    .select()
    .from(freelanceSellers)
    .where(eq(freelanceSellers.userId, userId));
  return row ?? null;
}

export async function upsertSeller(
  userId: string,
  accepting: boolean,
  now: Date,
): Promise<SellerRow> {
  const [row] = await getDb()
    .insert(freelanceSellers)
    .values({ userId, accepting, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: freelanceSellers.userId,
      set: { accepting, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error("freelance_sellers upsert returned nothing");
  return row;
}

export async function countActiveServices(
  sellerId: string,
  exceptId?: string,
): Promise<number> {
  const conditions: SQL[] = [
    eq(freelanceServices.sellerId, sellerId),
    inArray(freelanceServices.status, [...FREELANCE_ACTIVE_STATUSES]),
  ];
  if (exceptId) conditions.push(sql`${freelanceServices.id} <> ${exceptId}`);
  const [row] = await getDb()
    .select({ n: count() })
    .from(freelanceServices)
    .where(and(...conditions));
  return Number(row?.n ?? 0);
}

export async function insertService(
  tx: FreelanceTx,
  values: ServiceValues & {
    id: string;
    slug: string;
    sellerId: string;
    now: Date;
  },
  packages: readonly PackageValues[],
): Promise<ServiceRow> {
  const [row] = await tx
    .insert(freelanceServices)
    .values({
      id: values.id,
      slug: values.slug,
      sellerId: values.sellerId,
      title: values.title,
      category: values.category,
      description: values.description,
      buyerNeeds: values.buyerNeeds,
      languages: values.languages,
      skillSlugs: values.skillSlugs,
      links: values.links,
      status: "draft",
      createdAt: values.now,
      updatedAt: values.now,
    })
    .returning();
  if (!row) throw new Error("freelance_services insert returned nothing");
  await tx
    .insert(freelancePackages)
    .values(packages.map((pkg) => ({ ...pkg, serviceId: row.id })));
  return row;
}

/** Replaces text fields and all packages of one service. */
export async function replaceService(
  tx: FreelanceTx,
  id: string,
  values: ServiceValues & { status: FreelanceServiceStatus; now: Date },
  packages: readonly PackageValues[],
): Promise<ServiceRow> {
  const [row] = await tx
    .update(freelanceServices)
    .set({
      title: values.title,
      category: values.category,
      description: values.description,
      buyerNeeds: values.buyerNeeds,
      languages: values.languages,
      skillSlugs: values.skillSlugs,
      links: values.links,
      status: values.status,
      updatedAt: values.now,
    })
    .where(eq(freelanceServices.id, id))
    .returning();
  if (!row) throw new Error("freelance_services update returned nothing");
  await tx.delete(freelancePackages).where(eq(freelancePackages.serviceId, id));
  await tx
    .insert(freelancePackages)
    .values(packages.map((pkg) => ({ ...pkg, serviceId: id })));
  return row;
}

export async function setServiceStatus(
  id: string,
  status: FreelanceServiceStatus,
  extra: {
    now: Date;
    publishedAt?: Date | null;
    moderationNote?: string | null;
  },
): Promise<ServiceRow | null> {
  const [row] = await getDb()
    .update(freelanceServices)
    .set({
      status,
      updatedAt: extra.now,
      ...(extra.publishedAt !== undefined
        ? { publishedAt: extra.publishedAt }
        : {}),
      ...(extra.moderationNote !== undefined
        ? { moderationNote: extra.moderationNote }
        : {}),
    })
    .where(eq(freelanceServices.id, id))
    .returning();
  return row ?? null;
}

export async function findServiceById(
  id: string,
  conn: Conn = getDb(),
): Promise<ServiceRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await conn
    .select()
    .from(freelanceServices)
    .where(eq(freelanceServices.id, id));
  return row ?? null;
}

export async function findServiceBySlug(
  slug: string,
): Promise<ServiceRow | null> {
  const [row] = await getDb()
    .select()
    .from(freelanceServices)
    .where(eq(freelanceServices.slug, slug));
  return row ?? null;
}

export async function listPackages(
  serviceIds: readonly string[],
  conn: Conn = getDb(),
): Promise<PackageRow[]> {
  if (serviceIds.length === 0) return [];
  return conn
    .select()
    .from(freelancePackages)
    .where(inArray(freelancePackages.serviceId, [...serviceIds]));
}

export async function listSellerServices(
  sellerId: string,
): Promise<ServiceRow[]> {
  return getDb()
    .select()
    .from(freelanceServices)
    .where(
      and(
        eq(freelanceServices.sellerId, sellerId),
        sql`${freelanceServices.status} <> 'removed'`,
      ),
    )
    .orderBy(desc(freelanceServices.updatedAt));
}

export type CatalogFilter = {
  q?: string;
  category?: FreelanceCategory;
  maxPriceMinor?: bigint;
  maxDays?: number;
  language?: string;
  skills?: string[];
  sort: "fit" | "cheap" | "fast";
  limit: number;
  offset: number;
};

const BASIC_PRICE = sql<bigint>`(
  select p.price_minor from public.freelance_packages p
  where p.service_id = ${freelanceServices.id} and p.tier = 'basic'
)`;
const BASIC_DAYS = sql<number>`(
  select p.delivery_days from public.freelance_packages p
  where p.service_id = ${freelanceServices.id} and p.tier = 'basic'
)`;

/** Published services of sellers who take orders, filtered on the basic package. */
export async function searchPublished(
  filter: CatalogFilter,
): Promise<{ rows: ServiceRow[]; total: number }> {
  const conditions: SQL[] = [
    eq(freelanceServices.status, "published"),
    sql`exists (
      select 1 from public.freelance_sellers s
      where s.user_id = ${freelanceServices.sellerId} and s.accepting
    )`,
  ];
  if (filter.category)
    conditions.push(eq(freelanceServices.category, filter.category));
  if (filter.q) {
    const pattern = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const match = or(
      ilike(freelanceServices.title, pattern),
      ilike(freelanceServices.description, pattern),
    );
    if (match) conditions.push(match);
  }
  if (filter.maxPriceMinor !== undefined) {
    conditions.push(
      sql`${BASIC_PRICE} <= ${filter.maxPriceMinor.toString()}::bigint`,
    );
  }
  if (filter.maxDays !== undefined) {
    conditions.push(sql`${BASIC_DAYS} <= ${filter.maxDays}`);
  }
  if (filter.language) {
    conditions.push(
      arrayContains(freelanceServices.languages, [filter.language]),
    );
  }
  if (filter.skills && filter.skills.length > 0) {
    conditions.push(arrayOverlaps(freelanceServices.skillSlugs, filter.skills));
  }
  const where = and(...conditions);
  const order =
    filter.sort === "cheap"
      ? [asc(BASIC_PRICE), desc(freelanceServices.publishedAt)]
      : filter.sort === "fast"
        ? [asc(BASIC_DAYS), desc(freelanceServices.publishedAt)]
        : [desc(freelanceServices.publishedAt)];
  const rows = await getDb()
    .select()
    .from(freelanceServices)
    .where(where)
    .orderBy(...order)
    .limit(filter.limit)
    .offset(filter.offset);
  const [total] = await getDb()
    .select({ n: count() })
    .from(freelanceServices)
    .where(where);
  return { rows, total: Number(total?.n ?? 0) };
}

/** Basic prices of published services in one direction (for the price range). */
export async function publishedBasicPrices(
  category: FreelanceCategory,
): Promise<bigint[]> {
  const rows = await getDb()
    .select({ price: freelancePackages.priceMinor })
    .from(freelancePackages)
    .innerJoin(
      freelanceServices,
      eq(freelanceServices.id, freelancePackages.serviceId),
    )
    .where(
      and(
        eq(freelanceServices.status, "published"),
        eq(freelanceServices.category, category),
        eq(freelancePackages.tier, "basic"),
      ),
    );
  return rows.map((row) => row.price);
}

export type ServiceStats = {
  completed: number;
  rating: number | null;
  reviews: number;
};

/** Completed orders and the average rating per service. */
export async function serviceStats(
  serviceIds: readonly string[],
): Promise<Map<string, ServiceStats>> {
  const stats = new Map<string, ServiceStats>();
  if (serviceIds.length === 0) return stats;
  for (const id of serviceIds)
    stats.set(id, { completed: 0, rating: null, reviews: 0 });
  const done = await getDb()
    .select({ serviceId: freelanceOrders.serviceId, n: count() })
    .from(freelanceOrders)
    .where(
      and(
        inArray(freelanceOrders.serviceId, [...serviceIds]),
        eq(freelanceOrders.status, "completed"),
      ),
    )
    .groupBy(freelanceOrders.serviceId);
  for (const row of done) {
    const item = row.serviceId ? stats.get(row.serviceId) : undefined;
    if (item) item.completed = Number(row.n);
  }
  const rated = await getDb()
    .select({
      serviceId: freelanceReviews.serviceId,
      n: count(),
      mean: avg(freelanceReviews.rating),
    })
    .from(freelanceReviews)
    .where(inArray(freelanceReviews.serviceId, [...serviceIds]))
    .groupBy(freelanceReviews.serviceId);
  for (const row of rated) {
    const item = stats.get(row.serviceId);
    if (!item) continue;
    item.reviews = Number(row.n);
    item.rating =
      row.mean === null ? null : Math.round(Number(row.mean) * 10) / 10;
  }
  return stats;
}

export async function findOpenOrder(
  serviceId: string,
  buyerId: string,
): Promise<OrderRow | null> {
  const [row] = await getDb()
    .select()
    .from(freelanceOrders)
    .where(
      and(
        eq(freelanceOrders.serviceId, serviceId),
        eq(freelanceOrders.buyerId, buyerId),
        inArray(freelanceOrders.status, [
          "sent",
          "accepted",
          "in_progress",
          "delivered",
        ]),
      ),
    );
  return row ?? null;
}

export async function insertOrder(
  tx: FreelanceTx,
  values: typeof freelanceOrders.$inferInsert,
): Promise<OrderRow> {
  const [row] = await tx.insert(freelanceOrders).values(values).returning();
  if (!row) throw new Error("freelance_orders insert returned nothing");
  return row;
}

export async function lockOrder(
  tx: FreelanceTx,
  id: string,
): Promise<OrderRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select()
    .from(freelanceOrders)
    .where(eq(freelanceOrders.id, id))
    .for("update");
  return row ?? null;
}

export async function updateOrder(
  tx: FreelanceTx,
  id: string,
  set: Partial<typeof freelanceOrders.$inferInsert>,
): Promise<OrderRow> {
  const [row] = await tx
    .update(freelanceOrders)
    .set(set)
    .where(eq(freelanceOrders.id, id))
    .returning();
  if (!row) throw new Error("freelance_orders update returned nothing");
  return row;
}

export async function insertHistory(
  tx: FreelanceTx,
  values: {
    orderId: string;
    fromStatus: FreelanceOrderStatus | null;
    toStatus: FreelanceOrderStatus;
    actorId: string | null;
    createdAt: Date;
  },
): Promise<void> {
  await tx.insert(freelanceOrderHistory).values(values);
}

export async function listOrderHistory(orderId: string) {
  return getDb()
    .select()
    .from(freelanceOrderHistory)
    .where(eq(freelanceOrderHistory.orderId, orderId))
    .orderBy(asc(freelanceOrderHistory.createdAt));
}

export async function findOrder(id: string): Promise<OrderRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await getDb()
    .select()
    .from(freelanceOrders)
    .where(eq(freelanceOrders.id, id));
  return row ?? null;
}

export async function listOrdersFor(
  userId: string,
  side: "buyer" | "seller",
): Promise<OrderRow[]> {
  const column =
    side === "buyer" ? freelanceOrders.buyerId : freelanceOrders.sellerId;
  return getDb()
    .select()
    .from(freelanceOrders)
    .where(eq(column, userId))
    .orderBy(desc(freelanceOrders.updatedAt));
}

/** Ids whose timer ran out: unanswered requests or unaccepted deliveries. */
export async function listDueOrderIds(
  status: "sent" | "delivered",
  now: Date,
  limit: number,
): Promise<string[]> {
  const column =
    status === "sent"
      ? freelanceOrders.expiresAt
      : freelanceOrders.autoCompleteAt;
  const rows = await getDb()
    .select({ id: freelanceOrders.id })
    .from(freelanceOrders)
    .where(and(eq(freelanceOrders.status, status), lte(column, now)))
    .orderBy(asc(column))
    .limit(limit);
  return rows.map((row) => row.id);
}

export async function insertReview(
  values: typeof freelanceReviews.$inferInsert,
): Promise<ReviewRow> {
  const [row] = await getDb()
    .insert(freelanceReviews)
    .values(values)
    .returning();
  if (!row) throw new Error("freelance_reviews insert returned nothing");
  return row;
}

export async function findReviewByOrder(
  orderId: string,
): Promise<ReviewRow | null> {
  const [row] = await getDb()
    .select()
    .from(freelanceReviews)
    .where(eq(freelanceReviews.orderId, orderId));
  return row ?? null;
}

export async function listReviews(
  serviceId: string,
  limit: number,
): Promise<ReviewRow[]> {
  return getDb()
    .select()
    .from(freelanceReviews)
    .where(eq(freelanceReviews.serviceId, serviceId))
    .orderBy(desc(freelanceReviews.createdAt))
    .limit(limit);
}

export function runInTransaction<T>(
  work: (tx: FreelanceTx) => Promise<T>,
): Promise<T> {
  return getDb().transaction(work);
}

/** Published services of sellers who take orders, for the sitemap. */
export async function listSitemapRows(): Promise<
  { slug: string; updatedAt: Date }[]
> {
  return getDb()
    .select({
      slug: freelanceServices.slug,
      updatedAt: freelanceServices.updatedAt,
    })
    .from(freelanceServices)
    .where(
      and(
        eq(freelanceServices.status, "published"),
        sql`exists (
          select 1 from public.freelance_sellers s
          where s.user_id = ${freelanceServices.sellerId} and s.accepting
        )`,
      ),
    )
    .orderBy(desc(freelanceServices.updatedAt))
    .limit(5000);
}

export const FREELANCE_QUEUE_ENTITY = "freelance_service";

/**
 * Puts a service into the shared moderation queue (28.9, D447). Called in
 * the same transaction that moves the service to `pending`.
 */
export async function queueForModeration(
  tx: FreelanceTx,
  serviceId: string,
  reason:
    | "freelance_service_review"
    | "freelance_service_edit"
    | "freelance_service_reports",
  riskFlags: string[],
): Promise<void> {
  await freelancePorts().enqueueModeration(
    { entityType: FREELANCE_QUEUE_ENTITY, entityId: serviceId, reason, riskFlags },
    tx,
  );
}

/** Moves one service to `pending` inside a transaction. */
export async function setPendingInTx(
  tx: FreelanceTx,
  id: string,
  now: Date,
): Promise<ServiceRow | null> {
  const [row] = await tx
    .update(freelanceServices)
    .set({ status: "pending", moderationNote: null, updatedAt: now })
    .where(eq(freelanceServices.id, id))
    .returning();
  return row ?? null;
}

/** Short view of services for the admin queue. */
export async function findServicesForModeration(
  ids: readonly string[],
): Promise<
  {
    id: string;
    title: string;
    status: FreelanceServiceStatus;
    sellerId: string;
    slug: string;
  }[]
> {
  if (ids.length === 0) return [];
  return getDb()
    .select({
      id: freelanceServices.id,
      title: freelanceServices.title,
      status: freelanceServices.status,
      sellerId: freelanceServices.sellerId,
      slug: freelanceServices.slug,
    })
    .from(freelanceServices)
    .where(inArray(freelanceServices.id, [...ids]));
}

/**
 * Open complaints about a service and about orders of that service (28.9).
 * Decided ones do not count: a moderator's decision starts the count again.
 */
export async function countOpenServiceReports(
  serviceId: string,
): Promise<number> {
  const orders = await getDb()
    .select({ id: freelanceOrders.id })
    .from(freelanceOrders)
    .where(eq(freelanceOrders.serviceId, serviceId));
  return freelancePorts().countOpenReports({
    serviceId,
    orderIds: orders.map((order) => order.id),
  });
}

/**
 * Takes a live service out of the catalog until a moderator decides
 * (28.9). Only `published` or `paused` move; the queue item is added once.
 */
export async function holdForReports(
  serviceId: string,
  flags: string[],
  now: Date,
): Promise<ServiceRow | null> {
  return runInTransaction(async (tx) => {
    const [row] = await tx
      .update(freelanceServices)
      .set({ status: "pending", updatedAt: now })
      .where(
        and(
          eq(freelanceServices.id, serviceId),
          inArray(freelanceServices.status, ["published", "paused"]),
        ),
      )
      .returning();
    if (!row) return null;
    await queueForModeration(tx, serviceId, "freelance_service_reports", flags);
    return row;
  });
}

/** Service titles behind orders, for the admin list of complaints. */
export async function findOrdersForModeration(
  ids: readonly string[],
): Promise<{ id: string; serviceId: string | null; serviceTitle: string }[]> {
  if (ids.length === 0) return [];
  return getDb()
    .select({
      id: freelanceOrders.id,
      serviceId: freelanceOrders.serviceId,
      serviceTitle: freelanceOrders.serviceTitle,
    })
    .from(freelanceOrders)
    .where(inArray(freelanceOrders.id, [...ids]));
}

/** What the seller record needs from one completed order (A5, TZ 49). */
export type CompletedOrderRow = {
  buyerId: string | null;
  startedAt: Date | null;
  deliveredAt: Date | null;
  deliveryDays: number;
};

/** The seller's latest completed orders, newest first. */
export async function listCompletedOrdersOf(
  sellerId: string,
  limit = 500,
): Promise<CompletedOrderRow[]> {
  return getDb()
    .select({
      buyerId: freelanceOrders.buyerId,
      startedAt: freelanceOrders.startedAt,
      deliveredAt: freelanceOrders.deliveredAt,
      deliveryDays: freelanceOrders.deliveryDays,
    })
    .from(freelanceOrders)
    .where(
      and(
        eq(freelanceOrders.sellerId, sellerId),
        eq(freelanceOrders.status, "completed"),
      ),
    )
    .orderBy(desc(freelanceOrders.completedAt))
    .limit(limit);
}

/** The ratings buyers gave to the seller's services. */
export async function listRatingsOfSeller(sellerId: string): Promise<number[]> {
  const rows = await getDb()
    .select({ rating: freelanceReviews.rating })
    .from(freelanceReviews)
    .innerJoin(
      freelanceServices,
      eq(freelanceServices.id, freelanceReviews.serviceId),
    )
    .where(eq(freelanceServices.sellerId, sellerId));
  return rows.map((row) => row.rating);
}
