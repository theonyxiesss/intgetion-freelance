import { z } from "zod";
import { HttpError, validationError } from "@intgetion/kit";
import { enforceRateLimit } from "../../../platform";
import * as repo from "../repo/freelance-repo";
import * as room from "../repo/room-repo";
import { getOrderForParty } from "./order-service";
import {
  buildRoomFeed,
  checkRoomMessage,
  ROOM_LIMITS,
  ROOM_WRITABLE_STATUSES,
  type RoomFeedItem,
} from "./order-room";

/**
 * The order room for one party (TZ 45, D566, D567): the feed and a new
 * message. Only the two parties get anything; anyone else gets 404 from
 * `getOrderForParty`. Until migration 0071 is on the database the feed comes
 * without messages and posting answers 503, so the order page keeps working.
 */

export const ROOM_NOT_READY = "ROOM_NOT_READY";

/** D567, D581: message text stays 365 days after the order closed. */
export const ROOM_RETENTION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export const roomMessageInput = z
  .object({
    body: z.string().max(ROOM_LIMITS.bodyMax * 2),
    links: z.array(z.string().max(ROOM_LIMITS.linkMax)).max(10).optional(),
  })
  .strict();

export type RoomFeed = {
  /** False until migration 0071 is applied. */
  ready: boolean;
  writable: boolean;
  items: RoomFeedItem[];
};

function notReady(): HttpError {
  return new HttpError(
    503,
    ROOM_NOT_READY,
    "Messages in orders are not switched on yet",
  );
}

export async function getRoomFeed(
  userId: string,
  orderId: string,
): Promise<RoomFeed> {
  const order = await getOrderForParty(userId, orderId);
  const history = await repo.listOrderHistory(order.id);
  let ready = true;
  let messages: room.MessageRow[] = [];
  try {
    const threadId = await room.findOrderThreadId(order.id);
    messages = threadId ? await room.listThreadMessages(threadId) : [];
  } catch (error) {
    if (!room.isRoomTableMissing(error)) throw error;
    ready = false;
  }
  const items = buildRoomFeed({
    viewerId: userId,
    buyerId: order.buyerId ?? "",
    sellerId: order.sellerId ?? "",
    history: history.map((row) => ({
      id: row.id,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
    })),
    messages: messages.map((row) => ({
      id: row.id,
      authorId: row.authorId,
      body: row.body,
      links: row.links,
      createdAt: row.createdAt.toISOString(),
      hiddenAt: row.hiddenAt ? row.hiddenAt.toISOString() : null,
    })),
    delivery:
      order.deliveryUrl && order.deliveredAt
        ? {
            id: order.id,
            deliveredAt: order.deliveredAt.toISOString(),
            url: order.deliveryUrl,
          }
        : null,
  });
  return {
    ready,
    writable: ready && ROOM_WRITABLE_STATUSES.includes(order.status),
    items,
  };
}

/** One message from a party; 30 an hour per account (D567). */
export async function postRoomMessage(
  userId: string,
  orderId: string,
  input: unknown,
): Promise<RoomFeed> {
  const parsed = roomMessageInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const order = await getOrderForParty(userId, orderId);
  const message = checkRoomMessage({
    status: order.status,
    body: parsed.data.body,
    links: parsed.data.links,
  });
  await enforceRateLimit("freelanceMessage", userId);
  try {
    const threadId = await room.ensureOrderThreadId(order.id);
    await room.insertMessage({
      threadId,
      authorId: userId,
      body: message.body,
      links: message.links,
    });
  } catch (error) {
    if (room.isRoomTableMissing(error)) throw notReady();
    throw error;
  }
  return getRoomFeed(userId, order.id);
}

/** Retention cron (D567). Zero before migration 0071 is applied. */
export async function sweepClosedRoomMessages(
  now = new Date(),
): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - ROOM_RETENTION_DAYS * DAY_MS);
  try {
    return { deleted: await room.deleteClosedRoomMessages(cutoff) };
  } catch (error) {
    if (room.isRoomTableMissing(error)) return { deleted: 0 };
    throw error;
  }
}
