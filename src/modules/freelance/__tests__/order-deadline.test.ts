import { describe, expect, it } from "vitest";
import { orderDeadline } from "../service/order-deadline";

const started = new Date("2026-10-01T10:00:00.000Z");
const order = {
  status: "in_progress" as const,
  startedAt: started,
  deliveryDays: 5,
};

describe("order deadline (B4, TZ 49)", () => {
  it("is the start plus the promised days", () => {
    const result = orderDeadline(order, new Date("2026-10-02T10:00:00.000Z"));
    expect(result?.dueAt.toISOString()).toBe("2026-10-06T10:00:00.000Z");
    expect(result?.state).toBe("on_track");
  });

  it("is due soon in the last day, overdue after it", () => {
    expect(
      orderDeadline(order, new Date("2026-10-05T10:00:00.000Z"))?.state,
    ).toBe("due_soon");
    expect(
      orderDeadline(order, new Date("2026-10-06T10:00:00.000Z"))?.state,
    ).toBe("due_soon");
    expect(
      orderDeadline(order, new Date("2026-10-06T10:00:01.000Z"))?.state,
    ).toBe("overdue");
  });

  it("does not count before the start or after the delivery", () => {
    const now = new Date("2026-10-20T10:00:00.000Z");
    expect(orderDeadline({ ...order, startedAt: null }, now)).toBeNull();
    for (const status of [
      "sent",
      "accepted",
      "delivered",
      "completed",
      "cancelled",
      "declined",
      "expired",
    ] as const) {
      expect(orderDeadline({ ...order, status }, now)).toBeNull();
    }
  });
});
