/**
 * Freelance services (D446, D447, docs/tz/28-freelance.md).
 * A ready piece of work by one person with a fixed price and term.
 */

/** Same groups as the directions on /services. */
export const FREELANCE_CATEGORIES = [
  "operations",
  "community",
  "growth",
  "product",
  "development",
  "web3",
  "people",
  "research",
  "design",
  "communications",
] as const;
export type FreelanceCategory = (typeof FREELANCE_CATEGORIES)[number];

export const FREELANCE_SERVICE_STATUSES = [
  "draft",
  "pending",
  "published",
  "paused",
  "rejected",
  "removed",
] as const;
export type FreelanceServiceStatus =
  (typeof FREELANCE_SERVICE_STATUSES)[number];

/** Statuses that count towards the active limit (D447). */
export const FREELANCE_ACTIVE_STATUSES = [
  "pending",
  "published",
  "paused",
] as const satisfies readonly FreelanceServiceStatus[];

export const FREELANCE_TIERS = ["basic", "standard", "pro"] as const;
export type FreelanceTier = (typeof FREELANCE_TIERS)[number];

export const FREELANCE_ORDER_STATUSES = [
  "sent",
  "accepted",
  "in_progress",
  "delivered",
  "completed",
  "declined",
  "cancelled",
  "expired",
] as const;
export type FreelanceOrderStatus = (typeof FREELANCE_ORDER_STATUSES)[number];

/** Statuses after which the order never moves again. */
export const FREELANCE_TERMINAL_STATUSES = [
  "completed",
  "declined",
  "cancelled",
  "expired",
] as const satisfies readonly FreelanceOrderStatus[];

/** Statuses in which both sides see each other's contacts (28.7). */
export const FREELANCE_CONTACT_STATUSES = [
  "accepted",
  "in_progress",
  "delivered",
  "completed",
] as const satisfies readonly FreelanceOrderStatus[];

export type FreelanceReviewAuthorKind = "person" | "company";

/** Limits from 28.3–28.5 and D447. Money is USD cents (D19). */
export const FREELANCE_LIMITS = {
  titleMin: 10,
  titleMax: 80,
  descriptionMin: 80,
  descriptionMax: 1500,
  buyerNeedsMax: 800,
  languagesMax: 5,
  skillsMax: 6,
  linksMax: 5,
  includesMin: 1,
  includesMax: 8,
  includeItemMax: 120,
  priceMinMinor: BigInt(1000),
  priceMaxMinor: BigInt(2_000_000),
  daysMin: 1,
  daysMax: 90,
  revisionsMax: 10,
  activeServicesMax: 3,
  taskMin: 20,
  taskMax: 2000,
  wantedByMax: 80,
  reviewMax: 1000,
  requestsPerHour: 5,
} as const;

/**
 * Thresholds of the seller's badge (A5, TZ 49, D576). A new seller has no
 * badge; the numbers are conservative defaults that the founder may change.
 */
export const FREELANCE_SCORE = {
  reliableMinCompleted: 3,
  reliableMinOnTime: 0.8,
  topMinCompleted: 10,
  topMinOnTime: 0.9,
  topMinReviews: 5,
  topMinRating: 4.5,
} as const;

/** Timers from D447, in hours. */
export const FREELANCE_TIMERS = {
  answerHours: 72,
  acceptHours: 7 * 24,
  reviewHours: 14 * 24,
} as const;

/** Tasks posted by clients (TZ 47, D569). */
export const FREELANCE_TASK_STATUSES = [
  "pending",
  "open",
  "hired",
  "closed",
  "expired",
  "rejected",
] as const;
export type FreelanceTaskStatus = (typeof FREELANCE_TASK_STATUSES)[number];

/** Proposals of freelancers to a task (TZ 47, D569). */
export const FREELANCE_PROPOSAL_STATUSES = [
  "sent",
  "accepted",
  "declined",
  "withdrawn",
] as const;
export type FreelanceProposalStatus =
  (typeof FREELANCE_PROPOSAL_STATUSES)[number];

export const FREELANCE_TASK_LIMITS = {
  titleMin: 10,
  titleMax: 120,
  descriptionMin: 80,
  /** Same as an order's task, so it fits the order made from it. */
  descriptionMax: 2000,
  wantedByMax: 80,
  coverMin: 40,
  coverMax: 2000,
  openDays: 30,
  /** A4 (TZ 49): invitations one task may send. */
  invitesPerTask: 5,
  /** How many suggested freelancers the client sees. */
  suggestions: 12,
  /** D569: a hire from a proposal carries one revision. */
  hireRevisions: 1,
} as const;
