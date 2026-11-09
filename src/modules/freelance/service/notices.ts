import type { FreelanceOrderStatus } from "../../../config/freelance";
import type { FreelanceOrderNotice } from "../../../platform";
import type { OrderActor } from "./transitions";

export type OrderNotice = {
  status: FreelanceOrderNotice;
  recipients: string[];
};

/**
 * Who hears about a move of a freelance order, and as what (D456). The side
 * that acted is never told about its own step; the system's steps reach
 * whoever has to act or wait.
 */
export function orderNotice(input: {
  from: FreelanceOrderStatus;
  to: FreelanceOrderStatus;
  actor: OrderActor;
  actorId: string | null;
  /** Null once that account is deleted; nobody to tell then. */
  buyerId: string | null;
  sellerId: string | null;
}): OrderNotice | null {
  const { buyerId, sellerId } = input;
  const both = [buyerId, sellerId];
  const other =
    input.actor === "buyer"
      ? [sellerId]
      : input.actor === "seller"
        ? [buyerId]
        : both;
  const pick = (): {
    status: FreelanceOrderNotice;
    recipients: (string | null)[];
  } | null => {
    switch (input.to) {
      case "accepted":
        return { status: "accepted", recipients: [buyerId] };
      case "declined":
        return { status: "declined", recipients: [buyerId] };
      case "cancelled":
        return { status: "cancelled", recipients: other };
      case "expired":
        return { status: "expired", recipients: both };
      case "in_progress":
        return input.from === "delivered"
          ? { status: "revision", recipients: [sellerId] }
          : { status: "started", recipients: other };
      case "delivered":
        return { status: "delivered", recipients: [buyerId] };
      case "completed":
        return { status: "completed", recipients: other };
      default:
        return null;
    }
  };
  const notice = pick();
  if (!notice) return null;
  const recipients = notice.recipients.filter(
    (id): id is string => id !== null && id !== input.actorId,
  );
  return recipients.length ? { status: notice.status, recipients } : null;
}
