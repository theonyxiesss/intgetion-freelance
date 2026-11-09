import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canLeaveClientReview,
  clientRatingSummary,
} from "../service/client-reviews";

const mocks = vi.hoisted(() => ({
  findOrder: vi.fn(),
  party: vi.fn(),
  findReview: vi.fn(),
  insertReview: vi.fn(),
  ratings: vi.fn(),
}));

vi.mock("../repo/freelance-repo", () => ({ findOrder: mocks.findOrder }));
vi.mock("../service/order-service", () => ({
  getOrderForParty: mocks.party,
}));
vi.mock("../repo/client-review-repo", () => ({
  findClientReviewByOrder: mocks.findReview,
  insertClientReview: mocks.insertReview,
  listClientRatings: mocks.ratings,
}));

import {
  getClientReviewView,
  leaveClientReview,
} from "../service/client-review-service";

const SELLER = "11111111-1111-4111-8111-111111111111";
const BUYER = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-29T12:00:00.000Z");
const DONE = new Date("2026-10-25T12:00:00.000Z");
const missingTable = Object.assign(new Error("relation does not exist"), {
  code: "42P01",
});

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER,
    sellerId: SELLER,
    buyerId: BUYER,
    status: "completed",
    completedAt: DONE,
    side: "seller",
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.findOrder.mockResolvedValue(order());
  mocks.party.mockResolvedValue(order());
  mocks.findReview.mockResolvedValue(null);
  mocks.insertReview.mockImplementation(async (values) => ({
    id: "r1",
    ...values,
  }));
  mocks.ratings.mockResolvedValue([]);
});

describe("client review rules (D568)", () => {
  it("lets only the seller rate, in 14 days after completion, once", () => {
    const base = {
      side: "seller",
      status: "completed",
      clientReviewed: false,
      completedAt: DONE,
      now: NOW,
    };
    expect(canLeaveClientReview(base)).toBe(true);
    expect(canLeaveClientReview({ ...base, side: "buyer" })).toBe(false);
    expect(canLeaveClientReview({ ...base, status: "delivered" })).toBe(false);
    expect(canLeaveClientReview({ ...base, clientReviewed: true })).toBe(false);
    expect(
      canLeaveClientReview({
        ...base,
        now: new Date("2026-11-09T12:00:01.000Z"),
      }),
    ).toBe(false);
  });

  it("summarises ratings with one decimal", () => {
    expect(clientRatingSummary([])).toBeNull();
    expect(clientRatingSummary([5, 4, 4])).toEqual({ average: 4.3, count: 3 });
  });
});

describe("leaving a client review (D568)", () => {
  it("stores the seller's rating about the order's buyer", async () => {
    await leaveClientReview(
      SELLER,
      { orderId: ORDER, rating: 4, body: " Clear brief. " },
      NOW,
    );
    expect(mocks.insertReview).toHaveBeenCalledWith({
      orderId: ORDER,
      sellerId: SELLER,
      buyerId: BUYER,
      rating: 4,
      body: "Clear brief.",
      createdAt: NOW,
    });
  });

  it("hides the order from anyone but its seller (404)", async () => {
    await expect(
      leaveClientReview(BUYER, { orderId: ORDER, rating: 5 }, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses before completion and after 14 days (409)", async () => {
    mocks.findOrder.mockResolvedValue(order({ status: "delivered" }));
    await expect(
      leaveClientReview(SELLER, { orderId: ORDER, rating: 5 }, NOW),
    ).rejects.toMatchObject({ status: 409 });
    mocks.findOrder.mockResolvedValue(order());
    await expect(
      leaveClientReview(
        SELLER,
        { orderId: ORDER, rating: 5 },
        new Date("2026-11-20T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses contacts (422) and a second review (409)", async () => {
    await expect(
      leaveClientReview(
        SELLER,
        { orderId: ORDER, rating: 5, body: "mail me@example.com" },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 422 });
    mocks.findReview.mockResolvedValue({ id: "old" });
    await expect(
      leaveClientReview(SELLER, { orderId: ORDER, rating: 5 }, NOW),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("answers 503 before migration 0072", async () => {
    mocks.findReview.mockRejectedValue(missingTable);
    await expect(
      leaveClientReview(SELLER, { orderId: ORDER, rating: 5 }, NOW),
    ).rejects.toMatchObject({ status: 503, code: "CLIENT_REVIEWS_NOT_READY" });
  });
});

describe("client review view on the order page (D568)", () => {
  it("shows the seller the client's summary and the form", async () => {
    mocks.ratings.mockResolvedValue([5, 4]);
    expect(await getClientReviewView(SELLER, ORDER, NOW)).toEqual({
      ready: true,
      canReview: true,
      reviewed: false,
      summary: { average: 4.5, count: 2 },
    });
  });

  it("shows the buyer nothing about themselves", async () => {
    mocks.party.mockResolvedValue(order({ side: "buyer" }));
    expect(await getClientReviewView(BUYER, ORDER, NOW)).toEqual({
      ready: true,
      canReview: false,
      reviewed: false,
      summary: null,
    });
    expect(mocks.ratings).not.toHaveBeenCalled();
  });

  it("keeps the page working before migration 0072", async () => {
    mocks.findReview.mockRejectedValue(missingTable);
    expect(await getClientReviewView(SELLER, ORDER, NOW)).toMatchObject({
      ready: false,
      canReview: false,
    });
  });
});
