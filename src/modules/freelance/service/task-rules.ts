import { z } from "zod";
import {
  FREELANCE_CATEGORIES,
  FREELANCE_LIMITS as L,
  FREELANCE_TASK_LIMITS as T,
  type FreelanceProposalStatus,
  type FreelanceTaskStatus,
} from "../../../config/freelance";
import { HttpError, validationError } from "@intgetion/kit";
import { FREELANCE_ERRORS, hasContacts, usdToMinor } from "./rules";

/**
 * Tasks posted by clients and freelancers' proposals (TZ 47, A3, D569).
 * Pure: input shape, contact and price checks, and which moves are allowed.
 */

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const usdAmount = z
  .string()
  .trim()
  .regex(/^\d{1,7}(?:\.\d{1,2})?$/);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const taskInput = z
  .object({
    title: text(T.titleMin, T.titleMax),
    description: text(T.descriptionMin, T.descriptionMax),
    category: z.enum(FREELANCE_CATEGORIES),
    /** Dollars as typed; both empty means "negotiable". */
    budgetMin: usdAmount.optional(),
    budgetMax: usdAmount.optional(),
    wantedBy: optionalText(T.wantedByMax),
    /** Post as this company; the poster must be its member. */
    companyId: z.uuid().optional(),
  })
  .strict();
export type TaskInput = z.infer<typeof taskInput>;

export const proposalInput = z
  .object({
    taskId: z.uuid(),
    price: usdAmount,
    deliveryDays: z.number().int().min(L.daysMin).max(L.daysMax),
    cover: text(T.coverMin, T.coverMax),
  })
  .strict();
export type ProposalInput = z.infer<typeof proposalInput>;

export type CheckedTask = Omit<TaskInput, "budgetMin" | "budgetMax"> & {
  budgetMinMinor: bigint | null;
  budgetMaxMinor: bigint | null;
};

function inPriceRange(minor: bigint): boolean {
  return minor >= L.priceMinMinor && minor <= L.priceMaxMinor;
}

function contactsError(fields: string[]): HttpError {
  return new HttpError(
    422,
    FREELANCE_ERRORS.contactsInText,
    "Remove contacts from the text",
    { fields },
  );
}

/** A task as stored; throws the error to show. */
export function checkTask(raw: unknown): CheckedTask {
  const parsed = taskInput.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const { budgetMin, budgetMax, ...rest } = parsed.data;
  const min = budgetMin ? usdToMinor(budgetMin) : null;
  const max = budgetMax ? usdToMinor(budgetMax) : null;
  if (
    (min !== null && !inPriceRange(min)) ||
    (max !== null && !inPriceRange(max)) ||
    (min !== null && max !== null && min > max)
  ) {
    throw validationError({ fields: ["budget"] });
  }
  const found = [
    hasContacts(rest.title) ? "title" : null,
    hasContacts(rest.description) ? "description" : null,
    rest.wantedBy && hasContacts(rest.wantedBy) ? "wantedBy" : null,
  ].filter((field): field is string => field !== null);
  if (found.length > 0) throw contactsError(found);
  return { ...rest, budgetMinMinor: min, budgetMaxMinor: max };
}

export type CheckedProposal = Omit<ProposalInput, "price"> & {
  priceMinor: bigint;
};

export function checkProposal(raw: unknown): CheckedProposal {
  const parsed = proposalInput.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const { price, ...rest } = parsed.data;
  const priceMinor = usdToMinor(price);
  if (!inPriceRange(priceMinor)) throw validationError({ fields: ["price"] });
  if (hasContacts(rest.cover)) throw contactsError(["cover"]);
  return { ...rest, priceMinor };
}

/** An open task takes proposals until it expires. */
export function taskTakesProposals(
  task: { status: FreelanceTaskStatus; expiresAt: Date | null },
  now: Date,
): boolean {
  return (
    task.status === "open" &&
    task.expiresAt !== null &&
    task.expiresAt.getTime() > now.getTime()
  );
}

/** Proposal moves (D569): who may do what from `sent`. */
export type ProposalMove = "accept" | "decline" | "withdraw";

export function proposalMoveAllowed(input: {
  move: ProposalMove;
  status: FreelanceProposalStatus;
  actor: "buyer" | "seller";
}): boolean {
  if (input.status !== "sent") return false;
  if (input.move === "withdraw") return input.actor === "seller";
  return input.actor === "buyer";
}

export function taskExpiresAt(publishedAt: Date): Date {
  return new Date(publishedAt.getTime() + T.openDays * 24 * 60 * 60 * 1000);
}
