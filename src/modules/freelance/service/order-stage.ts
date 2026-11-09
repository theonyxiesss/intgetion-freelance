import type { FreelanceOrderStatus } from "../../../config/freelance";
import type { OrderStage } from "../../../lib/order-stage";

/**
 * A freelance order on the card's four steps (D605). A request not yet
 * answered waits before the line; a refused, cancelled or expired one is
 * off it. Delivered work is "on review": the buyer accepts or asks again.
 */
const STAGES: Record<FreelanceOrderStatus, OrderStage> = {
  sent: { step: null, tone: "waiting" },
  accepted: { step: 0, tone: "work" },
  in_progress: { step: 1, tone: "work" },
  delivered: { step: 2, tone: "review" },
  completed: { step: 3, tone: "done" },
  declined: { step: null, tone: "closed" },
  cancelled: { step: null, tone: "closed" },
  expired: { step: null, tone: "closed" },
};

export function orderStage(status: FreelanceOrderStatus): OrderStage {
  return STAGES[status];
}
