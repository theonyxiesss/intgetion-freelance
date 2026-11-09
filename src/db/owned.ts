import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  FreelanceCategory,
  FreelanceOrderStatus,
  FreelanceProposalStatus,
  FreelanceReviewAuthorKind,
  FreelanceServiceStatus,
  FreelanceTaskStatus,
  FreelanceTier,
} from "../config/freelance";
import { companies, users } from "./external";

/** Partial listing shared by the seller chat and the listing form (D493). */
export const freelanceServiceDrafts = pgTable(
  "freelance_service_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    draft: jsonb("draft")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("freelance_service_drafts_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
);

/** A person who takes orders (D446). The storefront is the candidate profile. */
export const freelanceSellers = pgTable("freelance_sellers", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accepting: boolean("accepting").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** A ready piece of work with a fixed price (28.3). */
export const freelanceServices = pgTable(
  "freelance_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").$type<FreelanceCategory>().notNull(),
    description: text("description").notNull(),
    buyerNeeds: text("buyer_needs").notNull().default(""),
    languages: text("languages").array().notNull(),
    skillSlugs: text("skill_slugs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    links: text("links")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status")
      .$type<FreelanceServiceStatus>()
      .notNull()
      .default("draft"),
    moderationNote: text("moderation_note"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("freelance_services_slug_key").on(table.slug),
    index("freelance_services_status_category_idx").on(
      table.status,
      table.category,
    ),
    index("freelance_services_seller_idx").on(table.sellerId),
    index("freelance_services_skills_idx").using("gin", table.skillSlugs),
    check(
      "freelance_services_title_len",
      sql`char_length(${table.title}) between 10 and 80`,
    ),
    check(
      "freelance_services_description_len",
      sql`char_length(${table.description}) between 80 and 1500`,
    ),
    check(
      "freelance_services_needs_len",
      sql`char_length(${table.buyerNeeds}) <= 800`,
    ),
    check(
      "freelance_services_category_check",
      sql`${table.category} in ('operations', 'community', 'growth', 'product', 'development', 'web3', 'people', 'research', 'design', 'communications')`,
    ),
    check(
      "freelance_services_languages_check",
      sql`cardinality(${table.languages}) between 1 and 5 and array_to_string(${table.languages}, ',') ~ '^[a-z]{2}(,[a-z]{2})*$'`,
    ),
    check(
      "freelance_services_skills_count",
      sql`cardinality(${table.skillSlugs}) <= 6`,
    ),
    check(
      "freelance_services_links_count",
      sql`cardinality(${table.links}) <= 5`,
    ),
    check(
      "freelance_services_status_check",
      sql`${table.status} in ('draft', 'pending', 'published', 'paused', 'rejected', 'removed')`,
    ),
  ],
);

/** Price in USD cents (D19). */
export const freelancePackages = pgTable(
  "freelance_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => freelanceServices.id, { onDelete: "cascade" }),
    tier: text("tier").$type<FreelanceTier>().notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    deliveryDays: integer("delivery_days").notNull(),
    revisions: integer("revisions").notNull(),
    includes: text("includes").array().notNull(),
  },
  (table) => [
    unique("freelance_packages_service_tier_key").on(
      table.serviceId,
      table.tier,
    ),
    check(
      "freelance_packages_tier_check",
      sql`${table.tier} in ('basic', 'standard', 'pro')`,
    ),
    check(
      "freelance_packages_price_check",
      sql`${table.priceMinor} between 1000 and 2000000`,
    ),
    check(
      "freelance_packages_days_check",
      sql`${table.deliveryDays} between 1 and 90`,
    ),
    check(
      "freelance_packages_revisions_check",
      sql`${table.revisions} between 0 and 10`,
    ),
    check(
      "freelance_packages_includes_count",
      sql`cardinality(${table.includes}) between 1 and 8`,
    ),
  ],
);

/** Request and order in one row, with the package snapshot (28.4). */
export const freelanceOrders = pgTable(
  "freelance_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id").references(() => freelanceServices.id, {
      onDelete: "set null",
    }),
    sellerId: uuid("seller_id").references(() => users.id, {
      onDelete: "set null",
    }),
    buyerId: uuid("buyer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    buyerCompanyId: uuid("buyer_company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    serviceTitle: text("service_title").notNull(),
    packageTier: text("package_tier").$type<FreelanceTier>().notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    deliveryDays: integer("delivery_days").notNull(),
    revisionsLeft: integer("revisions_left").notNull(),
    task: text("task").notNull(),
    wantedBy: text("wanted_by"),
    status: text("status")
      .$type<FreelanceOrderStatus>()
      .notNull()
      .default("sent"),
    deliveryUrl: text("delivery_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    autoCompleteAt: timestamp("auto_complete_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("freelance_orders_open_pair_idx")
      .on(table.serviceId, table.buyerId)
      .where(
        sql`${table.status} in ('sent', 'accepted', 'in_progress', 'delivered')`,
      ),
    index("freelance_orders_seller_idx").on(table.sellerId, table.status),
    index("freelance_orders_buyer_idx").on(table.buyerId, table.status),
    index("freelance_orders_expires_idx").on(table.status, table.expiresAt),
    index("freelance_orders_auto_complete_idx").on(
      table.status,
      table.autoCompleteAt,
    ),
    check(
      "freelance_orders_tier_check",
      sql`${table.packageTier} in ('basic', 'standard', 'pro')`,
    ),
    check(
      "freelance_orders_price_check",
      sql`${table.priceMinor} between 1000 and 2000000`,
    ),
    check(
      "freelance_orders_days_check",
      sql`${table.deliveryDays} between 1 and 90`,
    ),
    check(
      "freelance_orders_revisions_check",
      sql`${table.revisionsLeft} between 0 and 10`,
    ),
    check(
      "freelance_orders_task_len",
      sql`char_length(${table.task}) between 20 and 2000`,
    ),
    check(
      "freelance_orders_wanted_len",
      sql`${table.wantedBy} is null or char_length(${table.wantedBy}) between 1 and 80`,
    ),
    check(
      "freelance_orders_status_check",
      sql`${table.status} in ('sent', 'accepted', 'in_progress', 'delivered', 'completed', 'declined', 'cancelled', 'expired')`,
    ),
    check(
      "freelance_orders_delivery_url_check",
      sql`${table.deliveryUrl} is null or ${table.deliveryUrl} ~ '^https://'`,
    ),
    check(
      "freelance_orders_not_self",
      sql`${table.sellerId} is null or ${table.buyerId} is null or ${table.sellerId} <> ${table.buyerId}`,
    ),
  ],
);

export const freelanceOrderHistory = pgTable(
  "freelance_order_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => freelanceOrders.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<FreelanceOrderStatus>(),
    toStatus: text("to_status").$type<FreelanceOrderStatus>().notNull(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("freelance_order_history_order_idx").on(
      table.orderId,
      table.createdAt,
    ),
  ],
);

/** One thread per subject: an order now, a proposal or dispute later (D566). */
export const freelanceThreads = pgTable(
  "freelance_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectType: text("subject_type").$type<"order">().notNull(),
    subjectId: uuid("subject_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "freelance_threads_subject_type_check",
      sql`${table.subjectType} IN ('order')`,
    ),
    unique("freelance_threads_subject_unique").on(
      table.subjectType,
      table.subjectId,
    ),
  ],
);

/** A party's message in the order room; never edited, hidden by a moderator. */
export const freelanceMessages = pgTable(
  "freelance_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => freelanceThreads.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    links: text("links")
      .array()
      .notNull()
      .default(sql`'{}'`),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: uuid("hidden_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("freelance_messages_thread_idx").on(table.threadId, table.createdAt),
    check(
      "freelance_messages_body_check",
      sql`char_length(${table.body}) BETWEEN 1 AND 2000`,
    ),
    check(
      "freelance_messages_links_check",
      sql`cardinality(${table.links}) <= 5`,
    ),
  ],
);

/** One public review per completed order, without the buyer's name (28.5). */
export const freelanceReviews = pgTable(
  "freelance_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => freelanceOrders.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => freelanceServices.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authorKind: text("author_kind")
      .$type<FreelanceReviewAuthorKind>()
      .notNull(),
    rating: smallint("rating").notNull(),
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("freelance_reviews_order_key").on(table.orderId),
    index("freelance_reviews_service_idx").on(table.serviceId, table.createdAt),
    check(
      "freelance_reviews_kind_check",
      sql`${table.authorKind} in ('person', 'company')`,
    ),
    check(
      "freelance_reviews_rating_check",
      sql`${table.rating} between 1 and 5`,
    ),
    check(
      "freelance_reviews_body_len",
      sql`char_length(${table.body}) <= 1000`,
    ),
  ],
);

/** The freelancer's rating of the client; only average and count are shown (D568). */
export const freelanceClientReviews = pgTable(
  "freelance_client_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => freelanceOrders.id, { onDelete: "cascade" }),
    sellerId: uuid("seller_id").references(() => users.id, {
      onDelete: "set null",
    }),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: smallint("rating").notNull(),
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("freelance_client_reviews_order_key").on(table.orderId),
    index("freelance_client_reviews_buyer_idx").on(table.buyerId),
    check(
      "freelance_client_reviews_rating_check",
      sql`${table.rating} BETWEEN 1 AND 5`,
    ),
    check(
      "freelance_client_reviews_body_check",
      sql`char_length(${table.body}) <= 1000`,
    ),
  ],
);

/** A task posted by a client; public after a moderator (TZ 47, D569). */
export const freelanceTasks = pgTable(
  "freelance_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    buyerCompanyId: uuid("buyer_company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category").$type<FreelanceCategory>().notNull(),
    budgetMinMinor: bigint("budget_min_minor", { mode: "bigint" }),
    budgetMaxMinor: bigint("budget_max_minor", { mode: "bigint" }),
    wantedBy: text("wanted_by"),
    status: text("status")
      .$type<FreelanceTaskStatus>()
      .notNull()
      .default("pending"),
    moderationNote: text("moderation_note"),
    hiredOrderId: uuid("hired_order_id").references(() => freelanceOrders.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("freelance_tasks_open_idx").on(table.status, table.createdAt),
    index("freelance_tasks_buyer_idx").on(table.buyerId, table.createdAt),
    check(
      "freelance_tasks_status_check",
      sql`${table.status} IN ('pending', 'open', 'hired', 'closed', 'expired', 'rejected')`,
    ),
    check(
      "freelance_tasks_title_check",
      sql`char_length(${table.title}) BETWEEN 10 AND 120`,
    ),
    check(
      "freelance_tasks_description_check",
      sql`char_length(${table.description}) BETWEEN 80 AND 2000`,
    ),
  ],
);

/** A freelancer's offer to a task: price, days and a cover note (D569). */
export const freelanceProposals = pgTable(
  "freelance_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => freelanceTasks.id, { onDelete: "cascade" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    deliveryDays: integer("delivery_days").notNull(),
    cover: text("cover").notNull(),
    status: text("status")
      .$type<FreelanceProposalStatus>()
      .notNull()
      .default("sent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("freelance_proposals_task_seller_key").on(
      table.taskId,
      table.sellerId,
    ),
    index("freelance_proposals_seller_idx").on(table.sellerId, table.createdAt),
    check(
      "freelance_proposals_status_check",
      sql`${table.status} IN ('sent', 'accepted', 'declined', 'withdrawn')`,
    ),
    check(
      "freelance_proposals_price_check",
      sql`${table.priceMinor} BETWEEN 1000 AND 2000000`,
    ),
    check(
      "freelance_proposals_days_check",
      sql`${table.deliveryDays} BETWEEN 1 AND 90`,
    ),
    check(
      "freelance_proposals_cover_check",
      sql`char_length(${table.cover}) BETWEEN 40 AND 2000`,
    ),
  ],
);

/** A client's invitation of a freelancer to a task (TZ 49, A4, 0084). */
export const freelanceTaskInvites = pgTable(
  "freelance_task_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => freelanceTasks.id, { onDelete: "cascade" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("freelance_task_invites_task_seller_key").on(
      table.taskId,
      table.sellerId,
    ),
    index("freelance_task_invites_seller_idx").on(
      table.sellerId,
      table.createdAt,
    ),
  ],
);
