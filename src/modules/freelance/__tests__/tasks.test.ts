import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkProposal,
  checkTask,
  proposalMoveAllowed,
  taskExpiresAt,
  taskTakesProposals,
} from "../service/task-rules";

const mocks = vi.hoisted(() => ({
  findTask: vi.fn(),
  findTasks: vi.fn(),
  insertTask: vi.fn(),
  queue: vi.fn(),
  setTaskStatus: vi.fn(),
  lockTask: vi.fn(),
  insertProposal: vi.fn(),
  findProposal: vi.fn(),
  findProposalOf: vi.fn(),
  setProposalStatus: vi.fn(),
  declineOthers: vi.fn(),
  listOpen: vi.fn(),
  expire: vi.fn(),
  findSeller: vi.fn(),
  insertOrder: vi.fn(),
  insertHistory: vi.fn(),
  member: vi.fn(),
  safeNotify: vi.fn(),
  sitemap: vi.fn(),
}));

vi.mock("../repo/task-repo", () => ({
  TASK_QUEUE_ENTITY: "freelance_task",
  findTask: mocks.findTask,
  findTasks: mocks.findTasks,
  insertTask: mocks.insertTask,
  queueTaskForModeration: mocks.queue,
  setTaskStatus: mocks.setTaskStatus,
  lockTask: mocks.lockTask,
  insertProposal: mocks.insertProposal,
  findProposal: mocks.findProposal,
  findProposalOf: mocks.findProposalOf,
  setProposalStatus: mocks.setProposalStatus,
  declineOtherProposals: mocks.declineOthers,
  listOpenTasks: mocks.listOpen,
  listTaskSitemapRows: mocks.sitemap,
  listTasksByBuyer: vi.fn(),
  listProposalsForTask: vi.fn(),
  listProposalsBySeller: vi.fn(),
  expireTasks: mocks.expire,
}));
vi.mock("../repo/freelance-repo", () => ({
  findSeller: mocks.findSeller,
  insertOrder: mocks.insertOrder,
  insertHistory: mocks.insertHistory,
  runInTransaction: (work: (tx: unknown) => unknown) => work("tx"),
}));
vi.mock("../../../platform", () => ({
  findMemberRole: mocks.member,
  safeNotify: mocks.safeNotify,
}));

import {
  acceptProposal,
  createTask,
  decideTaskModeration,
  expireOldTasks,
  getTaskView,
  listTaskSitemapEntries,
  sendProposal,
  withdrawProposal,
} from "../service/task-service";

const BUYER = "11111111-1111-4111-8111-111111111111";
const SELLER = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-29T12:00:00.000Z");
const LATER = new Date("2026-11-20T12:00:00.000Z");

const DESCRIPTION =
  "We need a short explainer video for a DeFi wallet onboarding: script, voice and edit, around sixty seconds.";
const COVER =
  "I made twelve similar explainers last year and can send a draft script in two days.";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK,
    buyerId: BUYER,
    buyerCompanyId: null,
    title: "Explainer video for a wallet",
    description: DESCRIPTION,
    category: "design",
    budgetMinMinor: BigInt(30000),
    budgetMaxMinor: BigInt(60000),
    wantedBy: "next week",
    status: "open",
    hiredOrderId: null,
    expiresAt: LATER,
    createdAt: NOW,
    ...overrides,
  };
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL,
    taskId: TASK,
    sellerId: SELLER,
    priceMinor: BigInt(45000),
    deliveryDays: 7,
    cover: COVER,
    status: "sent",
    ...overrides,
  };
}

const missingTable = Object.assign(new Error("relation does not exist"), {
  code: "42P01",
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.findTask.mockResolvedValue(task());
  mocks.lockTask.mockResolvedValue(task());
  mocks.findProposal.mockResolvedValue(proposal());
  mocks.findProposalOf.mockResolvedValue(null);
  mocks.findSeller.mockResolvedValue({ userId: SELLER, accepting: true });
  mocks.insertTask.mockImplementation(async (_tx, values) => ({
    id: TASK,
    ...values,
  }));
  mocks.insertProposal.mockImplementation(async (values) => ({
    id: PROPOSAL,
    ...values,
  }));
  mocks.setProposalStatus.mockImplementation(async (id, from, to) => ({
    ...proposal({ id, status: to }),
  }));
  mocks.setTaskStatus.mockImplementation(async (id, from, values) => ({
    ...task({ id }),
    ...values,
  }));
  mocks.insertOrder.mockImplementation(async (_tx, values) => ({
    id: "order-1",
    ...values,
  }));
});

describe("task and proposal rules (D569)", () => {
  it("parses a task with a budget range in cents", () => {
    expect(
      checkTask({
        title: "Explainer video for a wallet",
        description: DESCRIPTION,
        category: "design",
        budgetMin: "300",
        budgetMax: "600",
      }),
    ).toMatchObject({
      budgetMinMinor: BigInt(30000),
      budgetMaxMinor: BigInt(60000),
    });
  });

  it("refuses contacts, a reversed budget and unknown fields", () => {
    expect(() =>
      checkTask({
        title: "Explainer video for a wallet",
        description: `${DESCRIPTION} Write me: me@example.com`,
        category: "design",
      }),
    ).toThrow(expect.objectContaining({ status: 422 }));
    expect(() =>
      checkTask({
        title: "Explainer video for a wallet",
        description: DESCRIPTION,
        category: "design",
        budgetMin: "600",
        budgetMax: "300",
      }),
    ).toThrow(expect.objectContaining({ status: 400 }));
    expect(() =>
      checkTask({
        title: "Explainer video for a wallet",
        description: DESCRIPTION,
        category: "design",
        buyerId: SELLER,
      }),
    ).toThrow(expect.objectContaining({ status: 400 }));
  });

  it("parses a proposal and refuses a price outside $10–$20,000", () => {
    expect(
      checkProposal({
        taskId: TASK,
        price: "450",
        deliveryDays: 7,
        cover: COVER,
      }),
    ).toMatchObject({ priceMinor: BigInt(45000) });
    expect(() =>
      checkProposal({
        taskId: TASK,
        price: "5",
        deliveryDays: 7,
        cover: COVER,
      }),
    ).toThrow(expect.objectContaining({ status: 400 }));
  });

  it("knows who may move a proposal", () => {
    expect(
      proposalMoveAllowed({ move: "accept", status: "sent", actor: "buyer" }),
    ).toBe(true);
    expect(
      proposalMoveAllowed({ move: "accept", status: "sent", actor: "seller" }),
    ).toBe(false);
    expect(
      proposalMoveAllowed({
        move: "withdraw",
        status: "sent",
        actor: "seller",
      }),
    ).toBe(true);
    expect(
      proposalMoveAllowed({
        move: "decline",
        status: "accepted",
        actor: "buyer",
      }),
    ).toBe(false);
  });

  it("keeps a task open for 30 days", () => {
    expect(taskExpiresAt(NOW).toISOString()).toBe("2026-11-28T12:00:00.000Z");
    expect(taskTakesProposals({ status: "open", expiresAt: LATER }, NOW)).toBe(
      true,
    );
    expect(taskTakesProposals({ status: "open", expiresAt: NOW }, NOW)).toBe(
      false,
    );
    expect(taskTakesProposals({ status: "hired", expiresAt: LATER }, NOW)).toBe(
      false,
    );
  });
});

describe("posting and moderating a task", () => {
  it("stores a task as pending and queues it for a moderator", async () => {
    const created = await createTask(
      BUYER,
      {
        title: "Explainer video for a wallet",
        description: DESCRIPTION,
        category: "design",
      },
      NOW,
    );
    expect(created).toMatchObject({ status: "pending", buyerId: BUYER });
    expect(mocks.queue).toHaveBeenCalledWith("tx", TASK);
  });

  it("refuses to post as a company the client is not a member of", async () => {
    mocks.member.mockResolvedValue(null);
    await expect(
      createTask(BUYER, {
        title: "Explainer video for a wallet",
        description: DESCRIPTION,
        category: "design",
        companyId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("opens a published task for 30 days", async () => {
    await decideTaskModeration(TASK, "publish", null, NOW);
    expect(mocks.setTaskStatus).toHaveBeenCalledWith(TASK, "pending", {
      status: "open",
      moderationNote: null,
      expiresAt: new Date("2026-11-28T12:00:00.000Z"),
      updatedAt: NOW,
    });
  });

  it("answers 503 before migration 0073", async () => {
    mocks.insertTask.mockRejectedValue(missingTable);
    await expect(
      createTask(BUYER, {
        title: "Explainer video for a wallet",
        description: DESCRIPTION,
        category: "design",
      }),
    ).rejects.toMatchObject({ status: 503, code: "TASKS_NOT_READY" });
  });
});

describe("viewing a task", () => {
  it("hides a task under review from everyone but its client", async () => {
    mocks.findTask.mockResolvedValue(task({ status: "pending" }));
    await expect(getTaskView(SELLER, TASK, NOW)).rejects.toMatchObject({
      status: 404,
    });
    await expect(getTaskView(BUYER, TASK, NOW)).resolves.toMatchObject({
      own: true,
      canPropose: false,
    });
  });

  it("never shows the client's name, only person or company", async () => {
    const view = await getTaskView(null, TASK, NOW);
    expect(view.postedBy).toBe("person");
    expect(view).not.toHaveProperty("buyerId");
    expect(view.canPropose).toBe(false);
  });

  it("lets a signed-in freelancer propose once", async () => {
    expect((await getTaskView(SELLER, TASK, NOW)).canPropose).toBe(true);
    mocks.findProposalOf.mockResolvedValue(proposal());
    expect((await getTaskView(SELLER, TASK, NOW)).canPropose).toBe(false);
  });
});

describe("task sitemap", () => {
  it("returns public task ids and safely yields empty before migration 0073", async () => {
    const entries = [{ id: TASK, updatedAt: NOW }];
    mocks.sitemap.mockResolvedValue(entries);
    await expect(listTaskSitemapEntries()).resolves.toEqual(entries);
    mocks.sitemap.mockRejectedValue(missingTable);
    await expect(listTaskSitemapEntries()).rejects.toMatchObject({
      status: 503,
      code: "TASKS_NOT_READY",
    });
  });
});

describe("proposals", () => {
  const input = { taskId: TASK, price: "450", deliveryDays: 7, cover: COVER };

  it("stores a proposal from a freelancer", async () => {
    await sendProposal(SELLER, input, NOW);
    expect(mocks.insertProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK,
        sellerId: SELLER,
        priceMinor: BigInt(45000),
        status: "sent",
      }),
    );
    expect(mocks.safeNotify).toHaveBeenCalledWith(
      "freelance.task_proposal",
      [BUYER],
      expect.objectContaining({ taskId: TASK, decision: "received" }),
    );
  });

  it("refuses the client's own task, a closed task and a non-freelancer", async () => {
    await expect(sendProposal(BUYER, input, NOW)).rejects.toMatchObject({
      status: 409,
      code: "OWN_TASK",
    });
    mocks.findTask.mockResolvedValue(task({ status: "hired" }));
    await expect(sendProposal(SELLER, input, NOW)).rejects.toMatchObject({
      status: 409,
      code: "TASK_CLOSED",
    });
    mocks.findTask.mockResolvedValue(task());
    mocks.findSeller.mockResolvedValue(null);
    await expect(sendProposal(SELLER, input, NOW)).rejects.toMatchObject({
      status: 409,
      code: "SELLER_REQUIRED",
    });
  });

  it("turns a second proposal into 409", async () => {
    mocks.insertProposal.mockRejectedValue(
      Object.assign(new Error("duplicate"), { code: "23505" }),
    );
    await expect(sendProposal(SELLER, input, NOW)).rejects.toMatchObject({
      status: 409,
      code: "PROPOSAL_EXISTS",
    });
  });

  it("lets only the author withdraw", async () => {
    await expect(withdrawProposal(BUYER, PROPOSAL, NOW)).rejects.toMatchObject({
      status: 404,
    });
    await withdrawProposal(SELLER, PROPOSAL, NOW);
    expect(mocks.setProposalStatus).toHaveBeenCalledWith(
      PROPOSAL,
      "sent",
      "withdrawn",
      NOW,
    );
  });
});

describe("hiring from a proposal (D569)", () => {
  it("makes an accepted order with the proposal's price and days", async () => {
    const order = await acceptProposal(BUYER, PROPOSAL, NOW);
    expect(order.id).toBe("order-1");
    expect(mocks.insertOrder).toHaveBeenCalledWith(
      "tx",
      expect.objectContaining({
        serviceId: null,
        sellerId: SELLER,
        buyerId: BUYER,
        serviceTitle: "Explainer video for a wallet",
        packageTier: "basic",
        priceMinor: BigInt(45000),
        deliveryDays: 7,
        revisionsLeft: 1,
        task: DESCRIPTION,
        status: "accepted",
        acceptedAt: NOW,
      }),
    );
    expect(mocks.insertHistory).toHaveBeenCalledWith(
      "tx",
      expect.objectContaining({ fromStatus: null, toStatus: "accepted" }),
    );
    expect(mocks.declineOthers).toHaveBeenCalledWith("tx", TASK, PROPOSAL, NOW);
    expect(mocks.setTaskStatus).toHaveBeenCalledWith(
      TASK,
      "open",
      { status: "hired", hiredOrderId: "order-1", updatedAt: NOW },
      "tx",
    );
    expect(mocks.safeNotify).toHaveBeenCalledWith(
      "freelance.task_proposal",
      [SELLER],
      expect.objectContaining({ taskId: TASK, decision: "accepted" }),
    );
  });

  it("refuses a stranger (404) and a proposal that already moved (409)", async () => {
    await expect(acceptProposal(SELLER, PROPOSAL, NOW)).rejects.toMatchObject({
      status: 404,
    });
    mocks.setProposalStatus.mockResolvedValue(null);
    await expect(acceptProposal(BUYER, PROPOSAL, NOW)).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.insertOrder).not.toHaveBeenCalled();
  });

  it("refuses an expired task", async () => {
    mocks.lockTask.mockResolvedValue(task({ expiresAt: NOW }));
    await expect(acceptProposal(BUYER, PROPOSAL, NOW)).rejects.toMatchObject({
      status: 409,
      code: "TASK_CLOSED",
    });
  });
});

describe("task expiry cron", () => {
  it("counts expired tasks and is quiet before migration 0073", async () => {
    mocks.expire.mockResolvedValue(2);
    await expect(expireOldTasks(NOW)).resolves.toBe(2);
    mocks.expire.mockRejectedValue(missingTable);
    await expect(expireOldTasks(NOW)).resolves.toBe(0);
  });
});
