import type { FreelanceOrderStatus } from "../../../config/freelance";
import { HttpError, notFound, validationError } from "@intgetion/kit";
import { findMemberRole } from "../../../platform";
import { safeNotify } from "../../../platform";
import * as repo from "../repo/freelance-repo";
import { orderNotice } from "./notices";
import { deliveryUrl, requestInput, reviewInput } from "../schemas";
import {
  autoCompleteAt,
  contactsOpen,
  FREELANCE_ERRORS,
  hasContacts,
  requestExpiresAt,
  reviewOpen,
} from "./rules";
import {
  checkOrderTransition,
  orderTargets,
  type OrderActor,
} from "./transitions";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string } | null)?.code ??
    (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === UNIQUE_VIOLATION;
}

function openRequestExists(): HttpError {
  return new HttpError(
    409,
    FREELANCE_ERRORS.openRequestExists,
    "You already have an open request for this service",
  );
}

/**
 * A buyer sends a request; it is also the order (28.4). The row keeps a
 * snapshot of the package. Rate limit is the caller's job (`rateRules`).
 */
export async function sendRequest(
  buyerId: string,
  raw: unknown,
  now = new Date(),
): Promise<repo.OrderRow> {
  const parsed = requestInput.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const input = parsed.data;

  const service = await repo.findServiceById(input.serviceId);
  if (!service || service.status !== "published") throw notFound();
  if (service.sellerId === buyerId) {
    throw new HttpError(
      409,
      FREELANCE_ERRORS.ownService,
      "This is your own service",
    );
  }
  const seller = await repo.findSeller(service.sellerId);
  if (!seller?.accepting) {
    throw new HttpError(
      409,
      FREELANCE_ERRORS.sellerNotAccepting,
      "The seller does not take orders now",
    );
  }
  const pkg = (await repo.listPackages([service.id])).find(
    (item) => item.tier === input.tier,
  );
  if (!pkg) throw notFound();
  if (input.companyId && !(await findMemberRole(input.companyId, buyerId))) {
    throw notFound();
  }
  if (await repo.findOpenOrder(service.id, buyerId)) throw openRequestExists();

  let order: repo.OrderRow;
  try {
    order = await repo.runInTransaction(async (tx) => {
      const created = await repo.insertOrder(tx, {
        serviceId: service.id,
        sellerId: service.sellerId,
        buyerId,
        buyerCompanyId: input.companyId ?? null,
        serviceTitle: service.title,
        packageTier: pkg.tier,
        priceMinor: pkg.priceMinor,
        deliveryDays: pkg.deliveryDays,
        revisionsLeft: pkg.revisions,
        task: input.task,
        wantedBy: input.wantedBy ?? null,
        status: "sent",
        expiresAt: requestExpiresAt(now),
        createdAt: now,
        updatedAt: now,
      });
      await repo.insertHistory(tx, {
        orderId: created.id,
        fromStatus: null,
        toStatus: "sent",
        actorId: buyerId,
        createdAt: now,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw openRequestExists();
    throw error;
  }
  if (order.sellerId) {
    await safeNotify("freelance.request_created", [order.sellerId], {
      orderId: order.id,
      serviceTitle: order.serviceTitle,
    });
  }
  return order;
}

export type OrderCommand = {
  orderId: string;
  to: FreelanceOrderStatus;
  actor: OrderActor;
  /** The person acting; null for the system. */
  actorId: string | null;
  /** Required when the seller delivers. */
  deliveryUrl?: string;
};

function sideOf(
  row: repo.OrderRow,
  actor: OrderActor,
  actorId: string | null,
): boolean {
  if (actor === "system") return actorId === null;
  if (!actorId) return false;
  return actor === "seller"
    ? row.sellerId === actorId
    : row.buyerId === actorId;
}

/**
 * The only writer of `freelance_orders.status` (28.4). Not a party → 404.
 * Callers must not write that column themselves. The other side hears of
 * the move after commit (D456).
 */
export async function transitionOrder(
  command: OrderCommand,
  now = new Date(),
): Promise<repo.OrderRow> {
  const { from, updated } = await writeTransition(command, now);
  const notice = orderNotice({
    from,
    to: updated.status,
    actor: command.actor,
    actorId: command.actorId,
    buyerId: updated.buyerId,
    sellerId: updated.sellerId,
  });
  if (notice) {
    await safeNotify("freelance.order_updated", notice.recipients, {
      orderId: updated.id,
      serviceTitle: updated.serviceTitle,
      status: notice.status,
    });
  }
  return updated;
}

async function writeTransition(
  command: OrderCommand,
  now: Date,
): Promise<{ from: FreelanceOrderStatus; updated: repo.OrderRow }> {
  return repo.runInTransaction(async (tx) => {
    const row = await repo.lockOrder(tx, command.orderId);
    if (!row || !sideOf(row, command.actor, command.actorId)) throw notFound();
    checkOrderTransition({
      from: row.status,
      to: command.to,
      actor: command.actor,
    });

    const set: Partial<typeof row> = { status: command.to, updatedAt: now };
    if (command.to === "accepted") set.acceptedAt = now;
    if (command.to === "in_progress" && row.status === "accepted")
      set.startedAt = now;
    if (command.to === "in_progress" && row.status === "delivered") {
      if (row.revisionsLeft <= 0) {
        throw new HttpError(
          409,
          FREELANCE_ERRORS.noRevisionsLeft,
          "No revisions left",
        );
      }
      set.revisionsLeft = row.revisionsLeft - 1;
      set.autoCompleteAt = null;
    }
    if (command.to === "delivered") {
      const url = deliveryUrl.safeParse(command.deliveryUrl ?? "");
      if (!url.success) {
        throw validationError([
          { path: "deliveryUrl", problem: "https_required" },
        ]);
      }
      set.deliveryUrl = url.data;
      set.deliveredAt = now;
      set.autoCompleteAt = autoCompleteAt(now);
    }
    if (command.to === "completed") set.completedAt = now;
    if (["declined", "cancelled", "expired"].includes(command.to))
      set.closedAt = now;

    const updated = await repo.updateOrder(tx, row.id, set);
    await repo.insertHistory(tx, {
      orderId: row.id,
      fromStatus: row.status,
      toStatus: command.to,
      actorId: command.actorId,
      createdAt: now,
    });
    return { from: row.status, updated };
  });
}

export type PartyOrder = repo.OrderRow & {
  side: "buyer" | "seller";
  contactsOpen: boolean;
  /** Statuses this side may move the order to now. */
  next: FreelanceOrderStatus[];
};

function asParty(row: repo.OrderRow, side: "buyer" | "seller"): PartyOrder {
  const next = orderTargets(row.status, side).filter(
    (to) =>
      !(
        side === "buyer" &&
        row.status === "delivered" &&
        to === "in_progress" &&
        row.revisionsLeft <= 0
      ),
  );
  return { ...row, side, contactsOpen: contactsOpen(row.status), next };
}

/** One order for one of its two sides; anyone else gets 404. */
export async function getOrderForParty(
  userId: string,
  orderId: string,
): Promise<PartyOrder> {
  const row = await repo.findOrder(orderId);
  if (!row) throw notFound();
  if (row.sellerId === userId) return asParty(row, "seller");
  if (row.buyerId === userId) return asParty(row, "buyer");
  throw notFound();
}

export async function listOrders(
  userId: string,
  side: "buyer" | "seller",
): Promise<PartyOrder[]> {
  return (await repo.listOrdersFor(userId, side)).map((row) =>
    asParty(row, side),
  );
}

export async function orderHistory(userId: string, orderId: string) {
  await getOrderForParty(userId, orderId);
  return repo.listOrderHistory(orderId);
}

/**
 * Timers, run by `/api/cron/freelance` (D456): unanswered requests expire
 * after 72 hours, delivered work is accepted after 7 days (D447).
 */
export async function runOrderTimers(
  now = new Date(),
  limit = 200,
): Promise<{ expired: number; completed: number }> {
  let expired = 0;
  let completed = 0;
  for (const id of await repo.listDueOrderIds("sent", now, limit)) {
    if (await moveBySystem(id, "expired", now)) expired += 1;
  }
  for (const id of await repo.listDueOrderIds("delivered", now, limit)) {
    if (await moveBySystem(id, "completed", now)) completed += 1;
  }
  return { expired, completed };
}

/** A row that moved since the list was read is skipped, not an error. */
async function moveBySystem(
  orderId: string,
  to: FreelanceOrderStatus,
  now: Date,
): Promise<boolean> {
  try {
    await transitionOrder({ orderId, to, actor: "system", actorId: null }, now);
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) return false;
    throw error;
  }
}

/** One public review by the buyer, within 14 days of completion (28.5). */
export async function leaveReview(
  buyerId: string,
  raw: unknown,
  now = new Date(),
): Promise<repo.ReviewRow> {
  const parsed = reviewInput.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const input = parsed.data;

  const order = await repo.findOrder(input.orderId);
  if (!order || order.buyerId !== buyerId || !order.serviceId) throw notFound();
  if (order.status !== "completed" || !reviewOpen(order.completedAt, now)) {
    throw new HttpError(
      409,
      FREELANCE_ERRORS.reviewClosed,
      "A review is not possible now",
    );
  }
  if (hasContacts(input.body)) {
    throw new HttpError(
      422,
      FREELANCE_ERRORS.contactsInText,
      "Remove contacts from the review",
      { fields: ["body"] },
    );
  }
  if (await repo.findReviewByOrder(order.id)) {
    throw new HttpError(
      409,
      FREELANCE_ERRORS.reviewClosed,
      "The review is already there",
    );
  }
  try {
    return await repo.insertReview({
      orderId: order.id,
      serviceId: order.serviceId,
      authorId: buyerId,
      authorKind: order.buyerCompanyId ? "company" : "person",
      rating: input.rating,
      body: input.body,
      createdAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(
        409,
        FREELANCE_ERRORS.reviewClosed,
        "The review is already there",
      );
    }
    throw error;
  }
}

export type PublicReview = {
  rating: number;
  body: string;
  authorKind: "person" | "company";
  createdAt: Date;
};

/** Reviews as the service page shows them: no author id or name (28.5). */
export async function listPublicReviews(
  serviceId: string,
  limit = 20,
): Promise<PublicReview[]> {
  return (await repo.listReviews(serviceId, limit)).map((row) => ({
    rating: row.rating,
    body: row.body,
    authorKind: row.authorKind,
    createdAt: row.createdAt,
  }));
}
