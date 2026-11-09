import { createHash } from "node:crypto";
import {
  FREELANCE_CONTACT_STATUSES,
  FREELANCE_LIMITS as L,
  FREELANCE_TIERS,
  FREELANCE_TIMERS,
  type FreelanceOrderStatus,
} from "../../../config/freelance";
import { HttpError, validationError } from "@intgetion/kit";
import { redactPii } from "../../../lib/redact";
import type { PackageInput, ServiceInput } from "../schemas";

/**
 * Error codes of this module. Not in the section 6 catalogue; recorded in
 * D446. `src/lib/http` stays unchanged, as with D75.
 */
export const FREELANCE_ERRORS = {
  contactsInText: "CONTACTS_IN_TEXT",
  serviceLimit: "SERVICE_LIMIT",
  candidateProfileRequired: "CANDIDATE_PROFILE_REQUIRED",
  ownService: "OWN_SERVICE",
  openRequestExists: "OPEN_REQUEST_EXISTS",
  serviceNotPublished: "SERVICE_NOT_PUBLISHED",
  sellerNotAccepting: "SELLER_NOT_ACCEPTING",
  noRevisionsLeft: "NO_REVISIONS_LEFT",
  reviewClosed: "REVIEW_CLOSED",
  roomClosed: "ROOM_CLOSED",
  ownTask: "OWN_TASK",
  sellerRequired: "SELLER_REQUIRED",
  taskClosed: "TASK_CLOSED",
  proposalExists: "PROPOSAL_EXISTS",
  proposalClosed: "PROPOSAL_CLOSED",
  tasksNotReady: "TASKS_NOT_READY",
  inviteLimit: "INVITE_LIMIT",
  alreadyInvited: "ALREADY_INVITED",
} as const;

const HOUR_MS = 60 * 60 * 1000;

// A Telegram-style @handle. Emails are caught by redactPii first.
const HANDLE = /(?:^|[^\w@.])@[A-Za-z][A-Za-z0-9_]{3,31}\b/u;

/** True when the text carries an email, phone, link or @handle (28.3). */
export function hasContacts(text: string): boolean {
  return redactPii(text) !== text || HANDLE.test(text);
}

/** Field paths of a service that carry contacts, e.g. `packages.0.includes.1`. */
export function contactFields(input: ServiceInput): string[] {
  const found: string[] = [];
  if (hasContacts(input.title)) found.push("title");
  if (hasContacts(input.description)) found.push("description");
  if (hasContacts(input.buyerNeeds)) found.push("buyerNeeds");
  input.packages.forEach((pkg, index) => {
    pkg.includes.forEach((item, itemIndex) => {
      if (hasContacts(item))
        found.push(`packages.${index}.includes.${itemIndex}`);
    });
  });
  return found;
}

/** "450", "450.5", "450.50" → 45050n. Shape is checked by the schema. */
export function usdToMinor(value: string): bigint {
  const [whole, cents = ""] = value.trim().split(".");
  return (
    BigInt(whole ?? "0") * BigInt(100) + BigInt(cents.padEnd(2, "0") || "0")
  );
}

/** 45000n → "450", 45050n → "450.50". */
export function minorToUsd(minor: bigint): string {
  const hundred = BigInt(100);
  const whole = minor / hundred;
  const cents = minor % hundred;
  if (cents === BigInt(0)) return whole.toString();
  return `${whole}.${cents.toString().padStart(2, "0")}`;
}

export type PackageIssue =
  | { path: string; problem: "basic_required" }
  | { path: string; problem: "duplicate_tier" }
  | { path: string; problem: "price_out_of_range" };

/** basic is required, each tier once, price $10–$20 000 (28.3). */
export function packageIssues(
  packages: readonly PackageInput[],
): PackageIssue[] {
  const issues: PackageIssue[] = [];
  const seen = new Set<string>();
  packages.forEach((pkg, index) => {
    if (seen.has(pkg.tier)) {
      issues.push({
        path: `packages.${index}.tier`,
        problem: "duplicate_tier",
      });
    }
    seen.add(pkg.tier);
    const minor = usdToMinor(pkg.price);
    if (minor < L.priceMinMinor || minor > L.priceMaxMinor) {
      issues.push({
        path: `packages.${index}.price`,
        problem: "price_out_of_range",
      });
    }
  });
  if (!seen.has("basic")) {
    issues.push({ path: "packages", problem: "basic_required" });
  }
  return issues;
}

/** Packages in tier order, as the page shows them. */
export function sortPackages<
  T extends { tier: (typeof FREELANCE_TIERS)[number] },
>(packages: readonly T[]): T[] {
  return [...packages].sort(
    (a, b) => FREELANCE_TIERS.indexOf(a.tier) - FREELANCE_TIERS.indexOf(b.tier),
  );
}

/**
 * Everything a service must pass besides its shape. Contacts are 422 with the
 * fields; package problems are 400 with the issues.
 */
export function assertServiceRules(input: ServiceInput): void {
  const issues = packageIssues(input.packages);
  if (issues.length > 0) throw validationError(issues);
  const fields = contactFields(input);
  if (fields.length > 0) {
    throw new HttpError(
      422,
      FREELANCE_ERRORS.contactsInText,
      "Remove contacts from the text; they open after the request is accepted",
      { fields },
    );
  }
}

/** Stable and readable: title words and a short hash of the id. */
export function serviceSlug(id: string, title: string): string {
  const base = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9а-яё]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 6);
  return `${base || "service"}-${hash}`;
}

/** The seller has 72 hours to answer a request (D447). */
export function requestExpiresAt(sentAt: Date): Date {
  return new Date(sentAt.getTime() + FREELANCE_TIMERS.answerHours * HOUR_MS);
}

/** Delivered work is accepted by itself after 7 days (D447). */
export function autoCompleteAt(deliveredAt: Date): Date {
  return new Date(
    deliveredAt.getTime() + FREELANCE_TIMERS.acceptHours * HOUR_MS,
  );
}

/** A review can be left for 14 days after completion (D447). */
export function reviewOpen(completedAt: Date | null, now: Date): boolean {
  if (!completedAt) return false;
  return (
    now.getTime() <=
    completedAt.getTime() + FREELANCE_TIMERS.reviewHours * HOUR_MS
  );
}

/** The buyer may still leave a review. Clock stays out of the page render. */
export function canLeaveReview(input: {
  side: string;
  status: string;
  reviewed: boolean;
  completedAt: Date | null;
}): boolean {
  return (
    input.side === "buyer" &&
    input.status === "completed" &&
    !input.reviewed &&
    reviewOpen(input.completedAt, new Date())
  );
}

const CONTACT_STATUSES: ReadonlySet<FreelanceOrderStatus> = new Set(
  FREELANCE_CONTACT_STATUSES,
);

/** Both sides see each other's contacts from `accepted` on (28.7). */
export function contactsOpen(status: FreelanceOrderStatus): boolean {
  return CONTACT_STATUSES.has(status);
}

export type PriceRange = {
  count: number;
  minMinor: bigint;
  medianMinor: bigint;
  maxMinor: bigint;
};

/**
 * Min, median and max of published prices, for `freelance_price_range`.
 * Only numbers that exist; null when there are none (28.8).
 */
export function priceRange(prices: readonly bigint[]): PriceRange | null {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / BigInt(2);
  return {
    count: sorted.length,
    minMinor: sorted[0],
    medianMinor: median,
    maxMinor: sorted[sorted.length - 1],
  };
}
