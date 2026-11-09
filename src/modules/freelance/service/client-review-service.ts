import { HttpError, notFound, validationError } from "@intgetion/kit";
import * as reviews from "../repo/client-review-repo";
import * as repo from "../repo/freelance-repo";
import { isRoomTableMissing } from "../repo/room-repo";
import { reviewInput } from "../schemas";
import {
  canLeaveClientReview,
  clientRatingSummary,
  type ClientRatingSummary,
} from "./client-reviews";
import { getOrderForParty } from "./order-service";
import { FREELANCE_ERRORS, hasContacts, reviewOpen } from "./rules";

/**
 * The freelancer rates the client (TZ 46, D568). Until migration 0072 is on
 * the database the page shows no form and no summary, and posting answers
 * 503, so localhost and production keep working.
 */

export const CLIENT_REVIEWS_NOT_READY = "CLIENT_REVIEWS_NOT_READY";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string } | null)?.code ??
    (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === UNIQUE_VIOLATION;
}

function closed(message: string): HttpError {
  return new HttpError(409, FREELANCE_ERRORS.reviewClosed, message);
}

/** One rating of the client by the seller, within 14 days of completion. */
export async function leaveClientReview(
  sellerId: string,
  raw: unknown,
  now = new Date(),
): Promise<reviews.ClientReviewRow> {
  const parsed = reviewInput.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const input = parsed.data;
  const order = await repo.findOrder(input.orderId);
  if (!order || order.sellerId !== sellerId || !order.buyerId) {
    throw notFound();
  }
  if (order.status !== "completed" || !reviewOpen(order.completedAt, now)) {
    throw closed("A review is not possible now");
  }
  if (hasContacts(input.body)) {
    throw new HttpError(
      422,
      FREELANCE_ERRORS.contactsInText,
      "Remove contacts from the review",
      { fields: ["body"] },
    );
  }
  try {
    if (await reviews.findClientReviewByOrder(order.id)) {
      throw closed("The review is already there");
    }
    return await reviews.insertClientReview({
      orderId: order.id,
      sellerId,
      buyerId: order.buyerId,
      rating: input.rating,
      body: input.body,
      createdAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw closed("The review is already there");
    if (isRoomTableMissing(error)) {
      throw new HttpError(
        503,
        CLIENT_REVIEWS_NOT_READY,
        "Client reviews are not switched on yet",
      );
    }
    throw error;
  }
}

export type ClientReviewView = {
  /** False until migration 0072 is applied. */
  ready: boolean;
  canReview: boolean;
  /** The seller already rated the client of this order. */
  reviewed: boolean;
  /** Only the seller of the order sees how other freelancers rated the client. */
  summary: ClientRatingSummary | null;
};

const NONE: ClientReviewView = {
  ready: true,
  canReview: false,
  reviewed: false,
  summary: null,
};

export async function getClientReviewView(
  userId: string,
  orderId: string,
  now = new Date(),
): Promise<ClientReviewView> {
  const order = await getOrderForParty(userId, orderId);
  if (order.side !== "seller" || !order.buyerId) return NONE;
  try {
    const own = await reviews.findClientReviewByOrder(order.id);
    const summary = clientRatingSummary(
      await reviews.listClientRatings(order.buyerId),
    );
    return {
      ready: true,
      canReview: canLeaveClientReview({
        side: order.side,
        status: order.status,
        clientReviewed: own !== null,
        completedAt: order.completedAt,
        now,
      }),
      reviewed: own !== null,
      summary,
    };
  } catch (error) {
    if (isRoomTableMissing(error)) {
      return { ...NONE, ready: false };
    }
    throw error;
  }
}
