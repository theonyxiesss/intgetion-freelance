import type { FreelanceOrderStatus } from "../../../config/freelance";

/**
 * The delivery deadline of an order in work (B4 of TZ 44, TZ 49): the start
 * plus the promised days. Only a status for now: it moves nothing and refunds
 * nothing. A return of money waits for the escrow stage (B1).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type DeadlineState = "on_track" | "due_soon" | "overdue";

export type OrderDeadline = {
  dueAt: Date;
  state: DeadlineState;
};

/** The deadline counts while the seller works: started, not yet delivered. */
const COUNTING: readonly FreelanceOrderStatus[] = ["in_progress"];

export function orderDeadline(
  order: {
    status: FreelanceOrderStatus;
    startedAt: Date | null;
    deliveryDays: number;
  },
  now: Date,
): OrderDeadline | null {
  if (!COUNTING.includes(order.status) || !order.startedAt) return null;
  const dueAt = new Date(
    order.startedAt.getTime() + order.deliveryDays * DAY_MS,
  );
  const left = dueAt.getTime() - now.getTime();
  const state: DeadlineState =
    left < 0 ? "overdue" : left <= DAY_MS ? "due_soon" : "on_track";
  return { dueAt, state };
}
