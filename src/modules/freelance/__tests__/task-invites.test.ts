import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTask: vi.fn(),
  findProposalOf: vi.fn(),
  listProposals: vi.fn(),
  findSeller: vi.fn(),
  insertInvite: vi.fn(),
  countInvites: vi.fn(),
  listInvited: vi.fn(),
  hasInvite: vi.fn(),
  sellersWithService: vi.fn(),
  storefronts: vi.fn(),
  record: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("../repo/task-repo", () => ({
  findTask: mocks.findTask,
  findProposalOf: mocks.findProposalOf,
  listProposalsForTask: mocks.listProposals,
}));
vi.mock("../repo/freelance-repo", () => ({ findSeller: mocks.findSeller }));
vi.mock("../repo/task-invite-repo", () => ({
  insertInvite: mocks.insertInvite,
  countInvitesOfTask: mocks.countInvites,
  listInvitedSellerIds: mocks.listInvited,
  hasInvite: mocks.hasInvite,
  listSellerIdsWithService: mocks.sellersWithService,
}));
vi.mock("../../../platform", () => ({
  getSellerStorefronts: mocks.storefronts,
  safeNotify: mocks.notify,
}));
vi.mock("../service/seller-record-service", () => ({
  getSellerRecord: mocks.record,
}));

import {
  inviteSeller,
  rankSuggestions,
  suggestSellers,
  wasInvited,
} from "../service/task-invite-service";

const BUYER = "00000000-0000-4000-8000-000000000001";
const SELLER = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const TASK = "00000000-0000-4000-8000-0000000000a1";
const NOW = new Date("2026-10-29T10:00:00.000Z");

const openTask = {
  id: TASK,
  buyerId: BUYER,
  title: "Landing page for a launch",
  category: "development",
  status: "open",
  expiresAt: new Date("2026-11-20T00:00:00.000Z"),
};

const record = (over: Record<string, unknown> = {}) => ({
  completed: 0,
  onTimeShare: null,
  clients: 0,
  repeatClients: 0,
  rating: null,
  ratingCount: 0,
  badge: null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findTask.mockResolvedValue(openTask);
  mocks.findSeller.mockResolvedValue({ userId: SELLER, accepting: true });
  mocks.findProposalOf.mockResolvedValue(null);
  mocks.countInvites.mockResolvedValue(0);
  mocks.listProposals.mockResolvedValue([]);
  mocks.listInvited.mockResolvedValue([]);
  mocks.record.mockResolvedValue(record());
});

describe("ranking suggestions (A4, TZ 49)", () => {
  it("puts the better badge first, then rating, then completed orders", () => {
    const list = [
      { id: "none", record: { badge: null, rating: 5, completed: 50 } },
      {
        id: "reliable-low",
        record: { badge: "reliable" as const, rating: 4, completed: 3 },
      },
      {
        id: "top",
        record: { badge: "top" as const, rating: 4.6, completed: 10 },
      },
      {
        id: "reliable-high",
        record: { badge: "reliable" as const, rating: 4.8, completed: 4 },
      },
    ];
    expect(rankSuggestions(list).map((row) => row.id)).toEqual([
      "top",
      "reliable-high",
      "reliable-low",
      "none",
    ]);
  });
});

describe("suggested freelancers", () => {
  it("lists freelancers of the task's category, never the client, with marks", async () => {
    mocks.sellersWithService.mockResolvedValue([SELLER, OTHER, BUYER]);
    mocks.storefronts.mockResolvedValue(
      new Map([
        [SELLER, { userId: SELLER, displayName: "Ada L.", headline: "Dev" }],
        [OTHER, { userId: OTHER, displayName: "Bo", headline: null }],
      ]),
    );
    mocks.listInvited.mockResolvedValue([SELLER]);
    mocks.listProposals.mockResolvedValue([{ sellerId: OTHER }]);
    mocks.record.mockImplementation(async (id: string) =>
      id === SELLER ? record({ completed: 4, badge: "reliable" }) : record(),
    );
    const list = await suggestSellers(BUYER, TASK);
    expect(list.map((row) => row.sellerId)).toEqual([SELLER, OTHER]);
    expect(list[0]).toMatchObject({
      invited: true,
      proposed: false,
      name: "Ada L.",
    });
    expect(list[1]).toMatchObject({ invited: false, proposed: true });
    expect(mocks.sellersWithService).toHaveBeenCalledWith("development", 60);
  });

  it("leaves out a freelancer without a public profile", async () => {
    mocks.sellersWithService.mockResolvedValue([SELLER]);
    mocks.storefronts.mockResolvedValue(new Map());
    expect(await suggestSellers(BUYER, TASK)).toEqual([]);
  });

  it("is for the owner of the task only", async () => {
    await expect(suggestSellers(OTHER, TASK)).rejects.toMatchObject({
      status: 404,
    });
    mocks.findTask.mockResolvedValue(null);
    await expect(suggestSellers(BUYER, TASK)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("inviting a freelancer", () => {
  it("saves the invitation and tells the freelancer", async () => {
    await inviteSeller(BUYER, TASK, SELLER, NOW);
    expect(mocks.insertInvite).toHaveBeenCalledWith({
      taskId: TASK,
      sellerId: SELLER,
      invitedBy: BUYER,
      createdAt: NOW,
    });
    expect(mocks.notify).toHaveBeenCalledWith(
      "freelance.task_proposal",
      [SELLER],
      expect.objectContaining({ taskId: TASK, decision: "invited" }),
    );
  });

  it("is for the owner of an open task only", async () => {
    await expect(inviteSeller(OTHER, TASK, SELLER, NOW)).rejects.toMatchObject({
      status: 404,
    });
    mocks.findTask.mockResolvedValue({ ...openTask, status: "closed" });
    await expect(inviteSeller(BUYER, TASK, SELLER, NOW)).rejects.toMatchObject({
      status: 409,
      code: "TASK_CLOSED",
    });
    mocks.findTask.mockResolvedValue({
      ...openTask,
      expiresAt: new Date("2026-10-01T00:00:00.000Z"),
    });
    await expect(inviteSeller(BUYER, TASK, SELLER, NOW)).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.insertInvite).not.toHaveBeenCalled();
  });

  it("refuses yourself, a freelancer not taking orders, and one who already answered", async () => {
    await expect(inviteSeller(BUYER, TASK, BUYER, NOW)).rejects.toMatchObject({
      status: 409,
      code: "OWN_TASK",
    });
    mocks.findSeller.mockResolvedValue({ userId: SELLER, accepting: false });
    await expect(inviteSeller(BUYER, TASK, SELLER, NOW)).rejects.toMatchObject({
      code: "SELLER_NOT_ACCEPTING",
    });
    mocks.findSeller.mockResolvedValue(null);
    await expect(inviteSeller(BUYER, TASK, SELLER, NOW)).rejects.toMatchObject({
      code: "SELLER_NOT_ACCEPTING",
    });
    mocks.findSeller.mockResolvedValue({ userId: SELLER, accepting: true });
    mocks.findProposalOf.mockResolvedValue({ id: "p" });
    await expect(inviteSeller(BUYER, TASK, SELLER, NOW)).rejects.toMatchObject({
      code: "PROPOSAL_EXISTS",
    });
    expect(mocks.insertInvite).not.toHaveBeenCalled();
  });

  it("allows five invitations per task", async () => {
    mocks.countInvites.mockResolvedValue(5);
    await expect(inviteSeller(BUYER, TASK, SELLER, NOW)).rejects.toMatchObject({
      status: 409,
      code: "INVITE_LIMIT",
    });
    mocks.countInvites.mockResolvedValue(4);
    await expect(
      inviteSeller(BUYER, TASK, SELLER, NOW),
    ).resolves.toBeUndefined();
  });

  it("refuses a second invitation of the same freelancer", async () => {
    mocks.insertInvite.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "23505" }),
    );
    await expect(inviteSeller(BUYER, TASK, SELLER, NOW)).rejects.toMatchObject({
      status: 409,
      code: "ALREADY_INVITED",
    });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("answers 503 before migration 0084", async () => {
    mocks.countInvites.mockRejectedValue(
      Object.assign(new Error("no table"), { code: "42P01" }),
    );
    await expect(inviteSeller(BUYER, TASK, SELLER, NOW)).rejects.toMatchObject({
      status: 503,
      code: "TASKS_NOT_READY",
    });
  });
});

describe("was this freelancer invited", () => {
  it("reads the invitation, and is false before 0084", async () => {
    mocks.hasInvite.mockResolvedValue(true);
    expect(await wasInvited(SELLER, TASK)).toBe(true);
    mocks.hasInvite.mockRejectedValue(
      Object.assign(new Error("no table"), { code: "42P01" }),
    );
    expect(await wasInvited(SELLER, TASK)).toBe(false);
  });
});
