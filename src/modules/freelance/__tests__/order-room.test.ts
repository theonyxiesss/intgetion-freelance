import { describe, expect, it } from "vitest";
import { HttpError } from "@intgetion/kit";
import {
  buildRoomFeed,
  checkRoomMessage,
  ROOM_LIMITS,
  type RoomFeedSources,
} from "../service/order-room";

function errorOf(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error("expected an error");
}

describe("room message rules (TZ 45 §3)", () => {
  it("cleans the text and keeps unique https links", () => {
    expect(
      checkRoomMessage({
        status: "in_progress",
        body: "  Draft is ready, please look.  ",
        links: [
          "https://example.com/draft",
          "https://example.com/draft",
          " https://example.org/b ",
        ],
      }),
    ).toEqual({
      body: "Draft is ready, please look.",
      links: ["https://example.com/draft", "https://example.org/b"],
    });
  });

  it.each(["sent", "accepted", "in_progress", "delivered"] as const)(
    "takes messages in %s",
    (status) => {
      expect(checkRoomMessage({ status, body: "ok" }).body).toBe("ok");
    },
  );

  it.each(["completed", "declined", "cancelled", "expired"] as const)(
    "refuses a message in the final status %s with 409",
    (status) => {
      const error = errorOf(() => checkRoomMessage({ status, body: "hi" }));
      expect(error.status).toBe(409);
      expect(error.code).toBe("ROOM_CLOSED");
    },
  );

  it.each([
    ["empty", { body: "   " }, "body"],
    ["too long", { body: "x".repeat(ROOM_LIMITS.bodyMax + 1) }, "body"],
    ["http link", { body: "see", links: ["http://example.com"] }, "links"],
    ["not a link", { body: "see", links: ["example.com"] }, "links"],
    [
      "too many links",
      {
        body: "see",
        links: Array.from(
          { length: ROOM_LIMITS.linksMax + 1 },
          (_, i) => `https://example.com/${i}`,
        ),
      },
      "links",
    ],
  ] as const)("refuses %s", (_name, patch, field) => {
    const error = errorOf(() =>
      checkRoomMessage({ status: "in_progress", ...patch }),
    );
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ fields: [field] });
  });

  it("refuses contacts before the request is accepted (D447)", () => {
    const error = errorOf(() =>
      checkRoomMessage({ status: "sent", body: "write me at me@example.com" }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe("CONTACTS_IN_TEXT");
  });

  it("lets contacts through once contacts are open (28.7)", () => {
    expect(
      checkRoomMessage({
        status: "accepted",
        body: "write me at me@example.com",
      }).body,
    ).toBe("write me at me@example.com");
  });
});

const BUYER = "buyer-id";
const SELLER = "seller-id";

function sources(overrides: Partial<RoomFeedSources> = {}): RoomFeedSources {
  return {
    viewerId: BUYER,
    buyerId: BUYER,
    sellerId: SELLER,
    messages: [],
    history: [],
    payment: null,
    delivery: null,
    ...overrides,
  };
}

describe("room feed (TZ 45 §2)", () => {
  it("merges messages and events in time order", () => {
    const feed = buildRoomFeed(
      sources({
        history: [
          {
            id: "h1",
            fromStatus: null,
            toStatus: "sent",
            actorId: BUYER,
            createdAt: "2026-10-27T10:00:00.000Z",
          },
          {
            id: "h2",
            fromStatus: "sent",
            toStatus: "accepted",
            actorId: SELLER,
            createdAt: "2026-10-27T11:00:00.000Z",
          },
          {
            id: "h3",
            fromStatus: "accepted",
            toStatus: "in_progress",
            actorId: null,
            createdAt: "2026-10-27T12:00:00.000Z",
          },
        ],
        payment: { id: "p1", paidAt: "2026-10-27T12:00:00.000Z" },
        messages: [
          {
            id: "m1",
            authorId: SELLER,
            body: "Hi, I can start today.",
            links: [],
            createdAt: "2026-10-27T10:30:00.000Z",
            hiddenAt: null,
          },
          {
            id: "m2",
            authorId: BUYER,
            body: "Great.",
            links: [],
            createdAt: "2026-10-27T12:00:00.000Z",
            hiddenAt: null,
          },
        ],
      }),
    );
    expect(feed.map((item) => item.id)).toEqual([
      "status:h1",
      "message:m1",
      "status:h2",
      "status:h3",
      "payment:p1",
      "message:m2",
    ]);
    expect(feed[2]).toMatchObject({ kind: "status", by: "seller" });
    expect(feed[3]).toMatchObject({ kind: "status", by: "system" });
  });

  it("marks the viewer's own messages", () => {
    const feed = buildRoomFeed(
      sources({
        viewerId: SELLER,
        messages: [
          {
            id: "m1",
            authorId: SELLER,
            body: "mine",
            links: [],
            createdAt: "2026-10-27T10:00:00.000Z",
            hiddenAt: null,
          },
          {
            id: "m2",
            authorId: BUYER,
            body: "theirs",
            links: [],
            createdAt: "2026-10-27T10:01:00.000Z",
            hiddenAt: null,
          },
        ],
      }),
    );
    expect(feed.map((item) => item.kind === "message" && item.mine)).toEqual([
      true,
      false,
    ]);
    expect(feed[0]).toMatchObject({ side: "seller" });
  });

  it("keeps the place of a hidden message but not its text or links", () => {
    const [item] = buildRoomFeed(
      sources({
        messages: [
          {
            id: "m1",
            authorId: BUYER,
            body: "hidden by a moderator",
            links: ["https://example.com"],
            createdAt: "2026-10-27T10:00:00.000Z",
            hiddenAt: "2026-10-27T11:00:00.000Z",
          },
        ],
      }),
    );
    expect(item).toMatchObject({
      kind: "message",
      hidden: true,
      body: null,
      links: [],
    });
  });

  it("shows a deleted author's message as from a deleted account (28.10)", () => {
    const [item] = buildRoomFeed(
      sources({
        messages: [
          {
            id: "m1",
            authorId: null,
            body: "old message",
            links: [],
            createdAt: "2026-10-27T10:00:00.000Z",
            hiddenAt: null,
          },
        ],
      }),
    );
    expect(item).toMatchObject({ side: "deleted", mine: false });
  });

  it("shows the delivered result as its own line", () => {
    const feed = buildRoomFeed(
      sources({
        delivery: {
          id: "d1",
          deliveredAt: "2026-10-28T09:00:00.000Z",
          url: "https://example.com/result",
        },
      }),
    );
    expect(feed).toEqual([
      {
        kind: "delivery",
        id: "delivery:d1",
        at: "2026-10-28T09:00:00.000Z",
        url: "https://example.com/result",
      },
    ]);
  });
});
