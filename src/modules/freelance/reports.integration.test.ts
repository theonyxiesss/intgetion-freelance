import { randomUUID } from "node:crypto";
import { inArray, or, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { freelanceOrders } from "../../db/owned";
import { users } from "../../db/external";
import { fakeWorld } from "../../test-support";
import { HttpError } from "@intgetion/kit";
import {
  createService,
  decideServiceModeration,
  getPublishedService,
  reportFreelance,
  sendRequest,
  setAcceptingOrders,
  submitService,
} from "./service";

const world = fakeWorld();

/** Complaints, the three-in-a-row hold and the moderator's flags (28.9, D462). */

const sellerId = randomUUID();
const reporters = [randomUUID(), randomUUID(), randomUUID()];
const strangerId = randomUUID();
const userIds = [sellerId, ...reporters, strangerId];
const token = sellerId.slice(0, 8);

async function rowsOf<T>(query: ReturnType<typeof sql>) {
  return (await getDb().execute(query)) as unknown as T[];
}

async function expectStatus(promise: Promise<unknown>, status: number) {
  try {
    await promise;
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
  }
}

afterAll(async () => {
  const db = getDb();
  await db
    .delete(freelanceOrders)
    .where(
      or(
        inArray(freelanceOrders.sellerId, userIds),
        inArray(freelanceOrders.buyerId, userIds),
      ),
    );
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("freelance complaints (28.9)", () => {
  it("holds a service after three open complaints until a moderator decides", async () => {
    for (const id of userIds) {
      await getDb().insert(users).values({ id });
    }
    world.addCandidate(sellerId);
    await setAcceptingOrders(sellerId, true);
    const service = await createService(sellerId, {
      title: `Logo and brand kit ${token}`,
      category: "design",
      description:
        "A logo, colours and a short brand guide for a Web3 product. Write me on WhatsApp for the details before we start.",
      languages: ["en"],
      links: ["https://t.me/ada_design"],
      packages: [
        {
          tier: "basic",
          price: "15",
          deliveryDays: 5,
          revisions: 1,
          includes: ["One logo"],
        },
      ],
    });
    await submitService(sellerId, service.id);

    // The flags reach the shared queue with the service (28.9).
    const item = world.queue.find((row) => row.entityId === service.id);
    expect(item?.riskFlags).toEqual(
      expect.arrayContaining([
        "price_very_low",
        "contacts_in_text",
        "contact_link",
      ]),
    );

    // Pending is not public, so it cannot be reported yet.
    await expectStatus(
      reportFreelance(
        reporters[0]!,
        { kind: "service", id: service.id },
        {
          reason: "spam",
        },
      ),
      404,
    );
    await decideServiceModeration(service.id, "publish", null);
    expect(await getPublishedService(service.slug)).not.toBeNull();

    // The owner cannot report their own service; bad reasons are refused.
    await expectStatus(
      reportFreelance(
        sellerId,
        { kind: "service", id: service.id },
        {
          reason: "spam",
        },
      ),
      409,
    );
    await expectStatus(
      reportFreelance(
        reporters[0]!,
        { kind: "service", id: service.id },
        {
          reason: "fake_company",
        },
      ),
      400,
    );

    // A stranger's order reads as not found; a buyer may report theirs.
    const order = await sendRequest(reporters[2]!, {
      serviceId: service.id,
      tier: "basic",
      task: "A logo for my wallet app, round and simple.",
    });
    await expectStatus(
      reportFreelance(
        strangerId,
        { kind: "order", id: order.id },
        {
          reason: "scam",
        },
      ),
      404,
    );

    const first = await reportFreelance(
      reporters[0]!,
      { kind: "service", id: service.id },
      { reason: "scam", details: "Asked to pay outside" },
    );
    expect(first.held).toBe(false);
    await expectStatus(
      reportFreelance(
        reporters[0]!,
        { kind: "service", id: service.id },
        {
          reason: "spam",
        },
      ),
      409,
    );
    const second = await reportFreelance(
      reporters[1]!,
      { kind: "service", id: service.id },
      { reason: "spam" },
    );
    expect(second.held).toBe(false);
    const third = await reportFreelance(
      reporters[2]!,
      { kind: "order", id: order.id },
      { reason: "scam" },
    );
    expect(third.held).toBe(true);

    // Out of the catalog, back in the queue, and the move is audited.
    expect(await getPublishedService(service.slug)).toBeNull();
    expect(
      world.queue.find(
        (row) =>
          row.entityId === service.id &&
          row.reason === "freelance_service_reports",
      )?.riskFlags,
    ).toEqual(["reports_threshold"]);
    const audit = world.audit.filter(
      (row) => row.entityType === "freelance_service" && row.entityId === service.id,
    );
    expect(audit.map((row) => row.action)).toContain("freelance.service_held");

    // The admin list names the service for both kinds of complaint.
    const ours = world.reports.filter((row) => row.status === "open");
    expect(ours).toHaveLength(3);
    expect(ours.map((row) => row.entityType).sort()).toEqual([
      "freelance_order",
      "freelance_service",
      "freelance_service",
    ]);
  });
});
