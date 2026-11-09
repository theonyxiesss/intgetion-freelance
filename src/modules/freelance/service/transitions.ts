import type { FreelanceOrderStatus } from "../../../config/freelance";
import { errorCodes, HttpError } from "@intgetion/kit";

/** Who moves the order. `system` is a timer or a confirmed payment. */
export type OrderActor = "seller" | "buyer" | "system";

export type OrderEdge = {
  from: FreelanceOrderStatus;
  to: FreelanceOrderStatus;
  actors: readonly OrderActor[];
};

/** The only allowed edges (28.4). Terminal statuses have no outgoing edge. */
export const ORDER_TRANSITIONS: readonly OrderEdge[] = [
  { from: "sent", to: "accepted", actors: ["seller"] },
  { from: "sent", to: "declined", actors: ["seller"] },
  { from: "sent", to: "cancelled", actors: ["buyer"] },
  { from: "sent", to: "expired", actors: ["system"] },
  { from: "accepted", to: "in_progress", actors: ["seller", "system"] },
  { from: "accepted", to: "cancelled", actors: ["seller", "buyer"] },
  { from: "in_progress", to: "delivered", actors: ["seller"] },
  { from: "delivered", to: "in_progress", actors: ["buyer"] },
  { from: "delivered", to: "completed", actors: ["buyer", "system"] },
];

/** Wrong actor or a missing edge is 409, never 403 (as D75). */
export function checkOrderTransition(input: {
  from: FreelanceOrderStatus;
  to: FreelanceOrderStatus;
  actor: OrderActor;
}): void {
  const edge = ORDER_TRANSITIONS.find(
    (item) => item.from === input.from && item.to === input.to,
  );
  if (!edge || !edge.actors.includes(input.actor)) {
    throw new HttpError(
      409,
      errorCodes.invalidTransition,
      "This status change is not allowed",
    );
  }
}

/** Buttons for one side. Reads `ORDER_TRANSITIONS`; it adds no edges. */
export function orderTargets(
  from: FreelanceOrderStatus,
  actor: Exclude<OrderActor, "system">,
): FreelanceOrderStatus[] {
  return ORDER_TRANSITIONS.filter(
    (edge) => edge.from === from && edge.actors.includes(actor),
  ).map((edge) => edge.to);
}
