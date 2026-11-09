import { describe, expect, it } from "vitest";
import {
  buildSellerRecord,
  deliveredInTime,
  sellerBadge,
  type CompletedOrderFact,
} from "../service/seller-score";

const start = new Date("2026-10-01T10:00:00.000Z");
const days = (n: number) => new Date(start.getTime() + n * 24 * 60 * 60 * 1000);

function order(
  buyerId: string | null,
  deliveredAfterDays: number | null,
  promised = 5,
): CompletedOrderFact {
  return {
    buyerId,
    startedAt: start,
    deliveredAt: deliveredAfterDays === null ? null : days(deliveredAfterDays),
    deliveryDays: promised,
  };
}

describe("seller record (A5, TZ 49)", () => {
  it("has nothing invented for a new seller", () => {
    expect(buildSellerRecord({ orders: [], ratings: [] })).toEqual({
      completed: 0,
      onTimeShare: null,
      clients: 0,
      repeatClients: 0,
      rating: null,
      ratingCount: 0,
      badge: null,
    });
  });

  it("tells in time from late, to the minute", () => {
    expect(deliveredInTime(order("a", 5))).toBe(true);
    expect(deliveredInTime(order("a", 5.01))).toBe(false);
    expect(deliveredInTime(order("a", null))).toBeNull();
  });

  it("counts the share only over orders that have both dates", () => {
    const record = buildSellerRecord({
      orders: [order("a", 4), order("b", 9), order("c", null)],
      ratings: [],
    });
    expect(record.completed).toBe(3);
    expect(record.onTimeShare).toBe(0.5);
  });

  it("counts clients that came back", () => {
    const record = buildSellerRecord({
      orders: [order("a", 1), order("a", 2), order("b", 1), order(null, 1)],
      ratings: [],
    });
    expect(record.clients).toBe(2);
    expect(record.repeatClients).toBe(1);
  });

  it("averages the ratings", () => {
    const record = buildSellerRecord({ orders: [], ratings: [5, 4, 4] });
    expect(record.ratingCount).toBe(3);
    expect(record.rating).toBeCloseTo(4.333, 2);
  });

  describe("badge by thresholds", () => {
    const base = {
      completed: 0,
      onTimeShare: null,
      rating: null,
      ratingCount: 0,
    };
    it("none before three completed orders", () => {
      expect(sellerBadge({ ...base, completed: 2, onTimeShare: 1 })).toBeNull();
    });
    it("reliable at three completed and 80% in time", () => {
      expect(sellerBadge({ ...base, completed: 3, onTimeShare: 0.8 })).toBe(
        "reliable",
      );
      expect(
        sellerBadge({ ...base, completed: 3, onTimeShare: 0.79 }),
      ).toBeNull();
    });
    it("none when nothing can be told about time", () => {
      expect(sellerBadge({ ...base, completed: 20 })).toBeNull();
    });
    it("top needs ten orders, 90% in time, five reviews and 4.5 stars", () => {
      const top = {
        completed: 10,
        onTimeShare: 0.9,
        rating: 4.5,
        ratingCount: 5,
      };
      expect(sellerBadge(top)).toBe("top");
      expect(sellerBadge({ ...top, ratingCount: 4 })).toBe("reliable");
      expect(sellerBadge({ ...top, rating: 4.4 })).toBe("reliable");
      expect(sellerBadge({ ...top, onTimeShare: 0.85 })).toBe("reliable");
      expect(sellerBadge({ ...top, completed: 9 })).toBe("reliable");
    });
  });
});
