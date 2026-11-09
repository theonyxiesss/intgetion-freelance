/**
 * Where an order stands on the four-step line of the order card (D605):
 * accepted → in work → on review → done. Freelance orders and UGC
 * participations map their own statuses onto it; a status before
 * acceptance or after a refusal has no step.
 */
export const ORDER_STEPS = ["accepted", "work", "review", "done"] as const;

export type OrderStepName = (typeof ORDER_STEPS)[number];

/** Colour of the status dot and the current step. */
export type OrderTone = "waiting" | "work" | "review" | "done" | "closed";

export type OrderStage = {
  /** Index into ORDER_STEPS; null when the order is not on the line. */
  step: 0 | 1 | 2 | 3 | null;
  tone: OrderTone;
};
