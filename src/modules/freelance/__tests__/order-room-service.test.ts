import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@intgetion/kit";

const mocks = vi.hoisted(() => ({
  order: vi.fn(),
  history: vi.fn(),
  findThread: vi.fn(),
  ensureThread: vi.fn(),
  listMessages: vi.fn(),
  insertMessage: vi.fn(),
  deleteClosed: vi.fn(),
  rate: vi.fn(),
}));

vi.mock("../service/order-service", () => ({
  getOrderForParty: mocks.order,
}));
vi.mock("../repo/freelance-repo", () => ({
  listOrderHistory: mocks.history,
}));
vi.mock("../repo/room-repo", async (importOriginal) => {
  const real = await importOriginal<typeof import("../repo/room-repo")>();
  return {
    isRoomTableMissing: real.isRoomTableMissing,
    findOrderThreadId: mocks.findThread,
    ensureOrderThreadId: mocks.ensureThread,
    listThreadMessages: mocks.listMessages,
    insertMessage: mocks.insertMessage,
    deleteClosedRoomMessages: mocks.deleteClosed,
  };
});
vi.mock("../../../platform", () => ({ enforceRateLimit: mocks.rate }));

import {
  getRoomFeed,
  postRoomMessage,
  sweepClosedRoomMessages,
} from "../service/order-room-service";

const BUYER = "11111111-1111-4111-8111-111111111111";
const SELLER = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const THREAD = "44444444-4444-4444-8444-444444444444";

function order(status = "in_progress") {
  return {
    id: ORDER,
    buyerId: BUYER,
    sellerId: SELLER,
    status,
    deliveryUrl: null,
    deliveredAt: null,
    side: "buyer",
  };
}

const missingTable = Object.assign(new Error("relation does not exist"), {
  code: "42P01",
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.order.mockResolvedValue(order());
  mocks.history.mockResolvedValue([
    {
      id: "h1",
      fromStatus: null,
      toStatus: "sent",
      actorId: BUYER,
      createdAt: new Date("2026-10-27T10:00:00.000Z"),
    },
  ]);
  mocks.findThread.mockResolvedValue(THREAD);
  mocks.ensureThread.mockResolvedValue(THREAD);
  mocks.listMessages.mockResolvedValue([
    {
      id: "m1",
      threadId: THREAD,
      authorId: SELLER,
      body: "Hello",
      links: [],
      hiddenAt: null,
      hiddenBy: null,
      createdAt: new Date("2026-10-27T11:00:00.000Z"),
    },
  ]);
  mocks.insertMessage.mockResolvedValue({});
  mocks.rate.mockResolvedValue(undefined);
});

describe("order room feed (D566)", () => {
  it("returns history and messages for a party", async () => {
    const feed = await getRoomFeed(BUYER, ORDER);
    expect(feed.ready).toBe(true);
    expect(feed.writable).toBe(true);
    expect(feed.items.map((item) => item.id)).toEqual([
      "status:h1",
      "message:m1",
    ]);
    expect(mocks.order).toHaveBeenCalledWith(BUYER, ORDER);
  });

  it("is read-only in a final status", async () => {
    mocks.order.mockResolvedValue(order("completed"));
    expect((await getRoomFeed(BUYER, ORDER)).writable).toBe(false);
  });

  it("works before migration 0071: no messages, not writable", async () => {
    mocks.findThread.mockRejectedValue(missingTable);
    const feed = await getRoomFeed(BUYER, ORDER);
    expect(feed).toMatchObject({ ready: false, writable: false });
    expect(feed.items.map((item) => item.kind)).toEqual(["status"]);
  });

  it("passes other database errors on", async () => {
    mocks.findThread.mockRejectedValue(new Error("connection lost"));
    await expect(getRoomFeed(BUYER, ORDER)).rejects.toThrow("connection lost");
  });

  it("gives a stranger nothing (404 from the party check)", async () => {
    mocks.order.mockRejectedValue(new HttpError(404, "NOT_FOUND", "nope"));
    await expect(getRoomFeed("someone-else", ORDER)).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.findThread).not.toHaveBeenCalled();
  });
});

describe("posting to the order room (D567)", () => {
  it("stores a clean message in the order thread under the rate limit", async () => {
    await postRoomMessage(BUYER, ORDER, {
      body: "  Here is the brief.  ",
      links: ["https://example.com/brief"],
    });
    expect(mocks.rate).toHaveBeenCalledWith("freelanceMessage", BUYER);
    expect(mocks.insertMessage).toHaveBeenCalledWith({
      threadId: THREAD,
      authorId: BUYER,
      body: "Here is the brief.",
      links: ["https://example.com/brief"],
    });
  });

  it("checks the message before spending the limit", async () => {
    await expect(
      postRoomMessage(BUYER, ORDER, { body: "   " }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.insertMessage).not.toHaveBeenCalled();
  });

  it("refuses unknown fields", async () => {
    await expect(
      postRoomMessage(BUYER, ORDER, { body: "hi", authorId: SELLER }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("stops when the limit is spent", async () => {
    mocks.rate.mockRejectedValue(new HttpError(429, "RATE_LIMITED", "slow"));
    await expect(
      postRoomMessage(BUYER, ORDER, { body: "hi" }),
    ).rejects.toMatchObject({ status: 429 });
    expect(mocks.insertMessage).not.toHaveBeenCalled();
  });

  it("answers 503 before migration 0071", async () => {
    mocks.ensureThread.mockRejectedValue(missingTable);
    await expect(
      postRoomMessage(BUYER, ORDER, { body: "hi" }),
    ).rejects.toMatchObject({ status: 503, code: "ROOM_NOT_READY" });
  });

  it("refuses a message in a closed order", async () => {
    mocks.order.mockResolvedValue(order("cancelled"));
    await expect(
      postRoomMessage(BUYER, ORDER, { body: "hi" }),
    ).rejects.toMatchObject({ status: 409, code: "ROOM_CLOSED" });
  });
});

describe("retention of room messages (D567)", () => {
  it("deletes messages of orders closed more than 365 days ago", async () => {
    mocks.deleteClosed.mockResolvedValue(3);
    const now = new Date("2026-10-27T00:00:00.000Z");
    await expect(sweepClosedRoomMessages(now)).resolves.toEqual({
      deleted: 3,
    });
    const [cutoff] = mocks.deleteClosed.mock.calls[0];
    expect(cutoff.toISOString()).toBe("2025-10-27T00:00:00.000Z");
  });

  it("does nothing before migration 0071", async () => {
    mocks.deleteClosed.mockRejectedValue(missingTable);
    await expect(sweepClosedRoomMessages()).resolves.toEqual({ deleted: 0 });
  });
});
