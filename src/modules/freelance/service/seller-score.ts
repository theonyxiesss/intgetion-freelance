import { FREELANCE_SCORE } from "../../../config/freelance";

/**
 * A seller's record on the platform (A5 of TZ 44, TZ 49): how many orders were
 * completed, how many of them were delivered in the promised time, how many
 * clients came back, the average rating, and a badge by thresholds. Pure: the
 * rows come from the orders and reviews; nothing is invented for a new seller.
 */

export type CompletedOrderFact = {
  buyerId: string | null;
  startedAt: Date | null;
  deliveredAt: Date | null;
  deliveryDays: number;
};

export type SellerBadge = "reliable" | "top";

export type SellerRecord = {
  completed: number;
  /** Share 0..1 of completed orders delivered in time; null when none can be told. */
  onTimeShare: number | null;
  clients: number;
  repeatClients: number;
  rating: number | null;
  ratingCount: number;
  badge: SellerBadge | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** On time: delivered no later than the start plus the promised days. */
export function deliveredInTime(order: CompletedOrderFact): boolean | null {
  if (!order.startedAt || !order.deliveredAt) return null;
  return (
    order.deliveredAt.getTime() <=
    order.startedAt.getTime() + order.deliveryDays * DAY_MS
  );
}

export function sellerBadge(
  record: Pick<
    SellerRecord,
    "completed" | "onTimeShare" | "rating" | "ratingCount"
  >,
): SellerBadge | null {
  const t = FREELANCE_SCORE;
  const onTime = record.onTimeShare ?? 0;
  if (
    record.completed >= t.topMinCompleted &&
    onTime >= t.topMinOnTime &&
    record.ratingCount >= t.topMinReviews &&
    (record.rating ?? 0) >= t.topMinRating
  ) {
    return "top";
  }
  if (
    record.completed >= t.reliableMinCompleted &&
    onTime >= t.reliableMinOnTime
  ) {
    return "reliable";
  }
  return null;
}

export function buildSellerRecord(input: {
  orders: readonly CompletedOrderFact[];
  ratings: readonly number[];
}): SellerRecord {
  const completed = input.orders.length;
  const timed = input.orders.flatMap((order) => {
    const verdict = deliveredInTime(order);
    return verdict === null ? [] : [verdict];
  });
  const onTimeShare = timed.length
    ? timed.filter(Boolean).length / timed.length
    : null;
  const perClient = new Map<string, number>();
  for (const order of input.orders) {
    if (!order.buyerId) continue;
    perClient.set(order.buyerId, (perClient.get(order.buyerId) ?? 0) + 1);
  }
  const clients = perClient.size;
  const repeatClients = [...perClient.values()].filter((n) => n >= 2).length;
  const ratingCount = input.ratings.length;
  const rating = ratingCount
    ? input.ratings.reduce((sum, value) => sum + value, 0) / ratingCount
    : null;
  const record = {
    completed,
    onTimeShare,
    clients,
    repeatClients,
    rating,
    ratingCount,
  };
  return { ...record, badge: sellerBadge(record) };
}
