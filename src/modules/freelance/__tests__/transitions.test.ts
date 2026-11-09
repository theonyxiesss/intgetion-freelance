import { describe, expect, it } from "vitest";
import {
  FREELANCE_ORDER_STATUSES,
  FREELANCE_TERMINAL_STATUSES,
  type FreelanceOrderStatus,
} from "../../../config/freelance";
import { HttpError } from "@intgetion/kit";
import {
  checkOrderTransition,
  ORDER_TRANSITIONS,
  orderTargets,
  type OrderActor,
} from "../service/transitions";

const actors: OrderActor[] = ["seller", "buyer", "system"];

function allowed(
  from: FreelanceOrderStatus,
  to: FreelanceOrderStatus,
  actor: OrderActor,
) {
  try {
    checkOrderTransition({ from, to, actor });
    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(409);
    expect((error as HttpError).code).toBe("INVALID_TRANSITION");
    return false;
  }
}

describe("order transitions (28.4)", () => {
  it("allows exactly the edges of the table", () => {
    const expected = new Set([
      "sent>accepted>seller",
      "sent>declined>seller",
      "sent>cancelled>buyer",
      "sent>expired>system",
      "accepted>in_progress>seller",
      "accepted>in_progress>system",
      "accepted>cancelled>seller",
      "accepted>cancelled>buyer",
      "in_progress>delivered>seller",
      "delivered>in_progress>buyer",
      "delivered>completed>buyer",
      "delivered>completed>system",
    ]);
    const found = new Set<string>();
    for (const from of FREELANCE_ORDER_STATUSES) {
      for (const to of FREELANCE_ORDER_STATUSES) {
        for (const actor of actors) {
          if (allowed(from, to, actor)) found.add(`${from}>${to}>${actor}`);
        }
      }
    }
    expect(found).toEqual(expected);
  });

  it("has no edge out of a terminal status", () => {
    for (const from of FREELANCE_TERMINAL_STATUSES) {
      expect(ORDER_TRANSITIONS.some((edge) => edge.from === from)).toBe(false);
    }
  });

  it("lets only the seller accept and only the buyer approve by hand", () => {
    expect(allowed("sent", "accepted", "buyer")).toBe(false);
    expect(allowed("delivered", "completed", "seller")).toBe(false);
    expect(allowed("sent", "accepted", "system")).toBe(false);
  });

  it("gives each side its own buttons", () => {
    expect(orderTargets("sent", "seller")).toEqual(["accepted", "declined"]);
    expect(orderTargets("sent", "buyer")).toEqual(["cancelled"]);
    expect(orderTargets("accepted", "seller")).toEqual([
      "in_progress",
      "cancelled",
    ]);
    expect(orderTargets("accepted", "buyer")).toEqual(["cancelled"]);
    expect(orderTargets("in_progress", "buyer")).toEqual([]);
    expect(orderTargets("delivered", "buyer")).toEqual([
      "in_progress",
      "completed",
    ]);
    expect(orderTargets("completed", "buyer")).toEqual([]);
  });
});
