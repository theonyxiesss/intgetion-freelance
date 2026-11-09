import { beforeEach, describe, expect, it, vi } from "vitest";

const searchServicesMock = vi.hoisted(() => vi.fn());
const taskToolsMock = vi.hoisted(() => ({
  getTaskView: vi.fn(),
  listOpenTasks: vi.fn(),
  sendProposal: vi.fn(),
}));
vi.mock("../service/task-service", () => taskToolsMock);

vi.mock("../service/listing-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../service/listing-service")>();
  return { ...actual, searchServices: searchServicesMock };
});

import {
  cardLinks,
  cleanForModel,
  FREELANCE_EMPTY_CATALOG,
  freelanceTools,
  orderForModel,
  priceRangeForModel,
  serviceCardForModel,
} from "../service/bot-tools";
import { hasContacts } from "../service/rules";

const SERVICE = "00000000-0000-4000-8000-0000000000f1";

const publishedVideoService = {
  id: SERVICE,
  title: "Video editing for short-form social ads",
  category: "marketing",
  languages: ["en"],
  completed: 0,
  rating: null,
  reviews: 0,
  packages: [
    {
      tier: "basic",
      priceMinor: BigInt(3000),
      deliveryDays: 2,
      revisions: 1,
    },
  ],
};

describe("freelance Spoki tools (28.8, D460)", () => {
  beforeEach(() => {
    searchServicesMock.mockReset();
  });

  it("names every read and card tool of 28.8", () => {
    const names = freelanceTools.map((tool) => tool.name);
    for (const name of [
      "find_services",
      "find_freelance_tasks",
      "send_task_proposal",
      "get_service",
      "freelance_price_range",
      "get_my_services",
      "get_my_orders",
      "get_order",
      "propose_freelancer_mode",
      "propose_service",
      "propose_service_update",
      "send_service_request",
      "cancel_request",
      "respond_to_request",
      "mark_delivered",
      "review_delivery",
      "propose_review",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("reads run by themselves and writes are cards", () => {
    // D493: the seller's own draft is edited without a card; the server
    // checks the person's explicit words before reset. Sending it to
    // moderation is a card after a clear yes (D520).
    const draftTools = ["patch_service_draft", "reset_service_draft"];
    expect(
      freelanceTools
        .find((tool) => tool.name === "confirm_service_draft")!
        .confirm(),
    ).toBe(true);
    const names = freelanceTools.map((tool) => tool.name);
    for (const name of draftTools) expect(names).toContain(name);
    for (const tool of freelanceTools) {
      const writes =
        !draftTools.includes(tool.name) &&
        (tool.name.startsWith("propose_") ||
          !/^(find_|get_|freelance_price_range)/.test(tool.name));
      expect(tool.confirm()).toBe(writes);
    }
  });

  it("shows task cards to guests and requires confirmation for proposals", async () => {
    taskToolsMock.listOpenTasks.mockResolvedValue([
      {
        id: SERVICE,
        title: "Landing page",
        category: "design",
        description: "A landing page brief without contact details.",
        budgetMinMinor: BigInt(25000),
        budgetMaxMinor: BigInt(50000),
        wantedBy: null,
      },
    ]);
    const findTasks = freelanceTools.find(
      (tool) => tool.name === "find_freelance_tasks",
    )!;
    const runFindTasks = findTasks.run as unknown as (
      context: { userId: string | null },
      input: { q?: string; category?: string },
    ) => Promise<{ llm: string; client: { kind: string } }>;
    const result = await runFindTasks({ userId: null }, {});
    expect(result.client.kind).toBe("freelance_tasks");
    expect(result.llm).toContain('"budgetMinUsd":"250"');
    const proposal = freelanceTools.find(
      (tool) => tool.name === "send_task_proposal",
    )!;
    expect(proposal.confirm()).toBe(true);
    taskToolsMock.getTaskView.mockResolvedValue({ title: "Landing page" });
    await expect(
      (
        proposal.preview as unknown as (
          context: { userId: string | null },
          input: { taskId: string },
        ) => Promise<string>
      )({ userId: "user-1" }, { taskId: SERVICE }),
    ).resolves.toBe("Landing page");
    expect(
      proposal.input.safeParse({
        taskId: SERVICE,
        price: "450",
        deliveryDays: 7,
        cover:
          "A sufficiently detailed response that meets the minimum required length.",
      }).success,
    ).toBe(true);
  });

  it("takes links and the result URL from the card, not the model", () => {
    const byName = Object.fromEntries(
      freelanceTools.map((tool) => [tool.name, tool]),
    );
    expect(byName.propose_service).toHaveProperty("cardFields", ["links"]);
    expect(byName.mark_delivered).toHaveProperty("cardFields", ["deliveryUrl"]);
    expect(
      byName.propose_service!.input.safeParse({ links: ["https://a.dev"] })
        .success,
    ).toBe(false);
    expect(
      byName.mark_delivered!.input.safeParse({
        orderId: SERVICE,
        deliveryUrl: "https://a.dev",
      }).success,
    ).toBe(false);
  });

  it("parses card links one per line and refuses http", () => {
    expect(
      cardLinks({ links: "https://a.dev/x\nhttps://b.dev  https://a.dev/x" }),
    ).toEqual(["https://a.dev/x", "https://b.dev"]);
    expect(cardLinks({ links: "" })).toBeUndefined();
    expect(cardLinks(undefined)).toBeUndefined();
    expect(() => cardLinks({ links: "http://a.dev" })).toThrow();
  });

  it("strips contacts from text before the model reads it", () => {
    const text = cleanForModel(
      "Write to me@mail.dev, +7 999 123-45-67, @handle_me or https://x.dev",
    );
    expect(hasContacts(text)).toBe(false);
  });

  it("gives the model package prices and no seller id or links", () => {
    const line = serviceCardForModel({
      id: SERVICE,
      title: "Landing page on Next.js",
      category: "development",
      languages: ["en"],
      completed: 2,
      rating: 4.5,
      packages: [
        {
          tier: "pro",
          priceMinor: BigInt(90000),
          deliveryDays: 9,
          revisions: 3,
        },
        {
          tier: "basic",
          priceMinor: BigInt(45000),
          deliveryDays: 7,
          revisions: 2,
        },
      ],
    });
    expect(line).toContain('"price":"$450"');
    expect(line.indexOf("$450")).toBeLessThan(line.indexOf("$900"));
    expect(line).not.toContain("sellerId");
    expect(line).not.toContain("https://");
  });

  it.each([
    ["guest", null],
    ["signed-in user", "user-1"],
  ] as const)(
    "find_services returns only stubbed published service facts for a %s",
    async (_role, userId) => {
      searchServicesMock.mockResolvedValue({
        services: [publishedVideoService],
        total: 1,
        page: 1,
      });
      const findServices = freelanceTools.find(
        (tool) => tool.name === "find_services",
      )!;
      const runFindServices = findServices.run as unknown as (
        context: { userId: string | null; locale: string },
        input: { q: string },
      ) => Promise<{ llm: string; client?: unknown }>;

      const outcome = await runFindServices(
        { userId, locale: "en" },
        { q: "video editing" },
      );

      expect(searchServicesMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: "video editing", page: 1 }),
      );
      expect(outcome.llm).toContain(publishedVideoService.title);
      expect(outcome.llm).toContain("$30");
      expect(outcome.llm).not.toContain("sellerId");
      expect(outcome.llm).not.toContain("https://");
    },
  );

  it.each([
    ["guest", null],
    ["signed-in user", "user-1"],
  ] as const)(
    "returns the honest empty-catalog result for a %s",
    async (_role, userId) => {
      searchServicesMock.mockResolvedValue({ services: [], total: 0, page: 1 });
      const findServices = freelanceTools.find(
        (tool) => tool.name === "find_services",
      )!;
      const runFindServices = findServices.run as unknown as (
        context: { userId: string | null; locale: string },
        input: { q: string },
      ) => Promise<{ llm: string; client?: unknown }>;

      const outcome = await runFindServices(
        { userId, locale: "en" },
        { q: "video editing" },
      );

      expect(outcome.llm).toBe(FREELANCE_EMPTY_CATALOG);
      expect(outcome.client).toBeUndefined();
    },
  );

  it("says plainly when a direction has no prices", () => {
    expect(priceRangeForModel("design", null)).toMatch(/No published prices/);
    expect(
      priceRangeForModel("design", {
        count: 3,
        minMinor: BigInt(20000),
        medianMinor: BigInt(35000),
        maxMinor: BigInt(60000),
      }),
    ).toContain("median $350");
  });

  it("hides the delivery link and contacts in the task of an order", () => {
    const line = orderForModel(
      {
        id: SERVICE,
        serviceTitle: "Landing",
        side: "seller",
        status: "delivered",
        packageTier: "basic",
        priceMinor: BigInt(45000),
        deliveryDays: 7,
        revisionsLeft: 1,
        deliveryUrl: "https://result.dev/file",
        next: [],
        task: "Call me at +7 999 123-45-67 or buyer@example.com",
        wantedBy: null,
      } as never,
      true,
    );
    expect(line).not.toContain("result.dev");
    expect(line).not.toContain("buyer@example.com");
    expect(line).toContain('"delivered":true');
  });
});
