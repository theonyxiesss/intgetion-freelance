import type { FreelanceOrderStatus } from "../../../config/freelance";
import { HttpError, validationError } from "@intgetion/kit";
import { FREELANCE_ERRORS, hasContacts } from "./rules";

/**
 * The order room (TZ 45, A1 of TZ 44): what a party may write, and one feed
 * of people's messages and the system's events in time order. Pure: no
 * database, no route. Later stages add their own feed kinds (escrow B1,
 * dispute B2, review A2) instead of new screens.
 */

export const ROOM_LIMITS = {
  bodyMax: 2000,
  linksMax: 5,
  linkMax: 500,
} as const;

/** Statuses in which the parties can still write (28.4). */
export const ROOM_WRITABLE_STATUSES: readonly FreelanceOrderStatus[] = [
  "sent",
  "accepted",
  "in_progress",
  "delivered",
];

/** Before the request is accepted contacts stay closed (28.7, D447). */
const CONTACTS_CLOSED_STATUSES: readonly FreelanceOrderStatus[] = ["sent"];

export type RoomMessageInput = {
  status: FreelanceOrderStatus;
  body: string;
  links?: readonly string[];
};

export type RoomMessage = { body: string; links: string[] };

function httpsLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > ROOM_LIMITS.linkMax) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Checks one message and returns it cleaned; throws the error to show. */
export function checkRoomMessage(input: RoomMessageInput): RoomMessage {
  if (!ROOM_WRITABLE_STATUSES.includes(input.status)) {
    throw new HttpError(
      409,
      FREELANCE_ERRORS.roomClosed,
      "This order no longer takes messages",
    );
  }
  const body = input.body.trim();
  if (body.length === 0 || body.length > ROOM_LIMITS.bodyMax) {
    throw validationError({ fields: ["body"] });
  }
  const raw = input.links ?? [];
  if (raw.length > ROOM_LIMITS.linksMax) {
    throw validationError({ fields: ["links"] });
  }
  const links: string[] = [];
  for (const item of raw) {
    const link = httpsLink(item);
    if (!link) throw validationError({ fields: ["links"] });
    if (!links.includes(link)) links.push(link);
  }
  if (CONTACTS_CLOSED_STATUSES.includes(input.status) && hasContacts(body)) {
    throw new HttpError(
      422,
      FREELANCE_ERRORS.contactsInText,
      "Remove contacts from the message",
      { fields: ["body"] },
    );
  }
  return { body, links };
}

export type RoomSide = "buyer" | "seller";

/** One line of the room feed. Each later stage adds a kind here. */
export type RoomFeedItem =
  | {
      kind: "message";
      id: string;
      at: string;
      /** `deleted` when the author's account is gone (28.10). */
      side: RoomSide | "deleted";
      mine: boolean;
      /** Null when a moderator hid it; the line stays, the text does not. */
      body: string | null;
      links: string[];
      hidden: boolean;
    }
  | {
      kind: "status";
      id: string;
      at: string;
      from: FreelanceOrderStatus | null;
      to: FreelanceOrderStatus;
      by: RoomSide | "system";
    }
  | { kind: "payment"; id: string; at: string }
  | { kind: "delivery"; id: string; at: string; url: string };

export type RoomFeedSources = {
  /** Whose room this is: decides `mine` and never leaks the other's ids. */
  viewerId: string;
  buyerId: string;
  sellerId: string;
  messages: readonly {
    id: string;
    authorId: string | null;
    body: string;
    links: readonly string[];
    createdAt: string;
    hiddenAt: string | null;
  }[];
  history: readonly {
    id: string;
    fromStatus: FreelanceOrderStatus | null;
    toStatus: FreelanceOrderStatus;
    actorId: string | null;
    createdAt: string;
  }[];
  payment?: { id: string; paidAt: string } | null;
  delivery?: { id: string; deliveredAt: string; url: string } | null;
};

// Same instant: the status change first, then what it brought, then talk.
const KIND_ORDER: Record<RoomFeedItem["kind"], number> = {
  status: 0,
  payment: 1,
  delivery: 2,
  message: 3,
};

function sideOf(
  actorId: string | null,
  sources: Pick<RoomFeedSources, "buyerId" | "sellerId">,
): RoomSide | "system" {
  if (actorId === sources.buyerId) return "buyer";
  if (actorId === sources.sellerId) return "seller";
  return "system";
}

/** The room feed in time order. Messages of a deleted account stay. */
export function buildRoomFeed(sources: RoomFeedSources): RoomFeedItem[] {
  const items: RoomFeedItem[] = [];
  for (const row of sources.history) {
    items.push({
      kind: "status",
      id: `status:${row.id}`,
      at: row.createdAt,
      from: row.fromStatus,
      to: row.toStatus,
      by: sideOf(row.actorId, sources),
    });
  }
  if (sources.payment) {
    items.push({
      kind: "payment",
      id: `payment:${sources.payment.id}`,
      at: sources.payment.paidAt,
    });
  }
  if (sources.delivery) {
    items.push({
      kind: "delivery",
      id: `delivery:${sources.delivery.id}`,
      at: sources.delivery.deliveredAt,
      url: sources.delivery.url,
    });
  }
  for (const row of sources.messages) {
    const side = sideOf(row.authorId, sources);
    const hidden = row.hiddenAt !== null;
    items.push({
      kind: "message",
      id: `message:${row.id}`,
      at: row.createdAt,
      // A deleted author is no longer a party id; the line keeps its place.
      side: side === "system" ? "deleted" : side,
      mine: row.authorId !== null && row.authorId === sources.viewerId,
      body: hidden ? null : row.body,
      links: hidden ? [] : [...row.links],
      hidden,
    });
  }
  return items.sort((a, b) => {
    const time = Date.parse(a.at) - Date.parse(b.at);
    if (time !== 0) return time;
    const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return kind !== 0 ? kind : a.id.localeCompare(b.id);
  });
}
