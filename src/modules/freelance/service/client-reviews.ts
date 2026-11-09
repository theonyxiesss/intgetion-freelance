import { reviewOpen } from "./rules";

/**
 * Reviews of the client by the freelancer (TZ 46, A2 of TZ 44, D568). Pure
 * rules: who may write one, and the summary other freelancers see.
 */

/** The seller may still rate the client. Same 14 days as the buyer (28.5). */
export function canLeaveClientReview(input: {
  side: string;
  status: string;
  clientReviewed: boolean;
  completedAt: Date | null;
  now?: Date;
}): boolean {
  return (
    input.side === "seller" &&
    input.status === "completed" &&
    !input.clientReviewed &&
    reviewOpen(input.completedAt, input.now ?? new Date())
  );
}

export type ClientRatingSummary = { average: number; count: number };

/** Average with one decimal and the count; null when there is none. */
export function clientRatingSummary(
  ratings: readonly number[],
): ClientRatingSummary | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((total, value) => total + value, 0);
  return {
    average: Math.round((sum / ratings.length) * 10) / 10,
    count: ratings.length,
  };
}
