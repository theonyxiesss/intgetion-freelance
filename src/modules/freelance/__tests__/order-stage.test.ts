import { describe, expect, it } from "vitest";
import { FREELANCE_ORDER_STATUSES } from "../../../config/freelance";
import { orderStage } from "../service/order-stage";

describe("freelance orderStage (D605)", () => {
  it("puts the live statuses on the four steps in order", () => {
    expect(orderStage("accepted")).toEqual({ step: 0, tone: "work" });
    expect(orderStage("in_progress")).toEqual({ step: 1, tone: "work" });
    expect(orderStage("delivered")).toEqual({ step: 2, tone: "review" });
    expect(orderStage("completed")).toEqual({ step: 3, tone: "done" });
  });

  it("keeps an unanswered request before the line", () => {
    expect(orderStage("sent")).toEqual({ step: null, tone: "waiting" });
  });

  it("takes refused, cancelled and expired orders off the line", () => {
    for (const status of ["declined", "cancelled", "expired"] as const) {
      expect(orderStage(status)).toEqual({ step: null, tone: "closed" });
    }
  });

  it("covers every order status", () => {
    for (const status of FREELANCE_ORDER_STATUSES) {
      expect(orderStage(status)).toBeDefined();
    }
  });
});
