import { describe, expect, it } from "vitest";
import { orderNotice } from "../service/notices";

const buyerId = "buyer";
const sellerId = "seller";
const base = { buyerId, sellerId };

describe("who hears about a freelance order move (D456)", () => {
  it("tells the buyer about the seller's answer and work", () => {
    for (const [from, to, status] of [
      ["sent", "accepted", "accepted"],
      ["sent", "declined", "declined"],
      ["accepted", "in_progress", "started"],
      ["in_progress", "delivered", "delivered"],
    ] as const) {
      expect(
        orderNotice({ ...base, from, to, actor: "seller", actorId: sellerId }),
      ).toEqual({ status, recipients: [buyerId] });
    }
  });

  it("tells the seller about a revision and the buyer's acceptance", () => {
    expect(
      orderNotice({
        ...base,
        from: "delivered",
        to: "in_progress",
        actor: "buyer",
        actorId: buyerId,
      }),
    ).toEqual({ status: "revision", recipients: [sellerId] });
    expect(
      orderNotice({
        ...base,
        from: "delivered",
        to: "completed",
        actor: "buyer",
        actorId: buyerId,
      }),
    ).toEqual({ status: "completed", recipients: [sellerId] });
  });

  it("tells the other side about a cancellation", () => {
    expect(
      orderNotice({
        ...base,
        from: "sent",
        to: "cancelled",
        actor: "buyer",
        actorId: buyerId,
      }),
    ).toEqual({ status: "cancelled", recipients: [sellerId] });
    expect(
      orderNotice({
        ...base,
        from: "accepted",
        to: "cancelled",
        actor: "seller",
        actorId: sellerId,
      }),
    ).toEqual({ status: "cancelled", recipients: [buyerId] });
  });

  it("tells both sides about the timers", () => {
    expect(
      orderNotice({
        ...base,
        from: "sent",
        to: "expired",
        actor: "system",
        actorId: null,
      }),
    ).toEqual({ status: "expired", recipients: [buyerId, sellerId] });
    expect(
      orderNotice({
        ...base,
        from: "delivered",
        to: "completed",
        actor: "system",
        actorId: null,
      }),
    ).toEqual({ status: "completed", recipients: [buyerId, sellerId] });
  });

  it("skips a side whose account is gone", () => {
    expect(
      orderNotice({
        buyerId,
        sellerId: null,
        from: "sent",
        to: "expired",
        actor: "system",
        actorId: null,
      }),
    ).toEqual({ status: "expired", recipients: [buyerId] });
  });

  it("never tells the actor about their own step", () => {
    expect(
      orderNotice({
        ...base,
        from: "sent",
        to: "accepted",
        actor: "seller",
        actorId: buyerId,
      }),
    ).toBeNull();
  });
});
