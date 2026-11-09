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
  FREELANCE_ERRORS,
  freelancePriceRange,
  getOrderForParty,
  getPublishedService,
  leaveReview,
  listPublicReviews,
  orderHistory,
  runOrderTimers,
  searchServices,
  sendRequest,
  setAcceptingOrders,
  submitService,
  transitionOrder,
  updateService,
} from "./service";

const world = fakeWorld();

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const appUrl = process.env.DATABASE_URL;
if (!migrationUrl || !appUrl) {
  throw new Error(
    "Integration tests need DATABASE_MIGRATION_URL and DATABASE_URL.",
  );
}

const sellerId = randomUUID();
const buyerId = randomUUID();
const strangerId = randomUUID();
const companyId = randomUUID();
const userIds = [sellerId, buyerId, strangerId];
const token = sellerId.slice(0, 8);
const now = new Date("2026-10-15T12:00:00.000Z");

const draft = {
  title: `Сделаю лендинг ${token}`,
  category: "development",
  description:
    "Свёрстанный и выложенный лендинг по вашему макету: адаптив, форма заявки, базовая аналитика и выкладка на Vercel.",
  buyerNeeds: "Макет и тексты",
  languages: ["ru", "en"],
  skillSlugs: ["react"],
  links: ["https://example.com/case"],
  packages: [
    {
      tier: "basic",
      price: "450",
      deliveryDays: 7,
      revisions: 1,
      includes: ["До 5 блоков"],
    },
    {
      tier: "standard",
      price: "800",
      deliveryDays: 10,
      revisions: 3,
      includes: ["До 10 блоков"],
    },
  ],
};

async function expectCode(
  promise: Promise<unknown>,
  status: number,
  code?: string,
) {
  try {
    await promise;
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
    if (code) expect((error as HttpError).code).toBe(code);
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
  await db.execute(sql`delete from public.companies where id = ${companyId}`);
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("freelance services end to end (28.3–28.5)", () => {
  it("goes from a draft to a review, and refuses the wrong steps", async () => {
    for (const id of userIds) {
      await getDb().insert(users).values({ id });
    }
    await getDb().execute(sql`
      insert into public.companies (id, name, slug, status, created_by)
      values (${companyId}, 'Freelance Integration Co', ${`freelance-${token}`}, 'verified', ${buyerId})
    `);
    world.addCompany(companyId, "Freelance Integration Co", buyerId);

    // No candidate profile: cannot take orders (28.2).
    await expectCode(
      setAcceptingOrders(sellerId, true, now),
      409,
      FREELANCE_ERRORS.candidateProfileRequired,
    );
    world.addCandidate(sellerId);
    await setAcceptingOrders(sellerId, true, now);

    // Contacts in the text are refused (28.3).
    await expectCode(
      createService(sellerId, { ...draft, buyerNeeds: "Пишите @ada_dev" }, now),
      422,
      FREELANCE_ERRORS.contactsInText,
    );

    const created = await createService(sellerId, draft, now);
    expect(created.status).toBe("draft");
    expect(await getPublishedService(created.slug)).toBeNull();

    const pending = await submitService(sellerId, created.id, now);
    expect(pending.status).toBe("pending");
    await expectCode(
      submitService(sellerId, created.id, now),
      409,
      "INVALID_TRANSITION",
    );
    await expectCode(submitService(strangerId, created.id, now), 404);

    const published = await decideServiceModeration(
      created.id,
      "publish",
      null,
      now,
    );
    expect(published.status).toBe("published");
    expect(published.publishedAt?.toISOString()).toBe(now.toISOString());

    const page = await getPublishedService(created.slug);
    expect(page?.packages.map((pkg) => [pkg.tier, pkg.priceMinor])).toEqual([
      ["basic", BigInt(45000)],
      ["standard", BigInt(80000)],
    ]);
    const found = await searchServices({ q: token, sort: "cheap", page: 1 });
    expect(found.services.map((service) => service.id)).toEqual([created.id]);
    const cheap = await searchServices({
      q: token,
      maxPriceMinor: BigInt(40000),
      sort: "fit",
      page: 1,
    });
    expect(cheap.total).toBe(0);
    const range = await freelancePriceRange("development");
    expect(range?.count).toBeGreaterThan(0);

    // Requests (28.4).
    await expectCode(
      sendRequest(
        sellerId,
        {
          serviceId: created.id,
          tier: "basic",
          task: "Нужен лендинг для SaaS, 5 блоков",
        },
        now,
      ),
      409,
      FREELANCE_ERRORS.ownService,
    );
    await expectCode(
      sendRequest(
        strangerId,
        {
          serviceId: created.id,
          tier: "basic",
          task: "Нужен лендинг для SaaS, 5 блоков",
          companyId,
        },
        now,
      ),
      404,
    );
    const order = await sendRequest(
      buyerId,
      {
        serviceId: created.id,
        tier: "standard",
        task: "Нужен лендинг для B2B SaaS, EN и RU",
        wantedBy: "до 15 ноября",
        companyId,
      },
      now,
    );
    expect(order.status).toBe("sent");
    expect(order.priceMinor).toBe(BigInt(80000));
    expect(order.revisionsLeft).toBe(3);
    expect(order.expiresAt.toISOString()).toBe("2026-10-18T12:00:00.000Z");
    // The seller hears about the review and the request (D456).
    expect(world.noticesOf(sellerId)).toEqual([
      "freelance.service_decided:published",
      "freelance.request_created",
    ]);
    await expectCode(
      sendRequest(
        buyerId,
        {
          serviceId: created.id,
          tier: "basic",
          task: "Ещё один запрос на лендинг",
        },
        now,
      ),
      409,
      FREELANCE_ERRORS.openRequestExists,
    );

    // The snapshot does not follow later edits; the edit goes back to moderation.
    const edited = await updateService(
      sellerId,
      created.id,
      { ...draft, packages: [{ ...draft.packages[0], price: "500" }] },
      now,
    );
    expect(edited.status).toBe("pending");
    await decideServiceModeration(created.id, "publish", null, now);

    // Only the parties see the order; contacts open from accepted on (28.7).
    await expectCode(getOrderForParty(strangerId, order.id), 404);
    expect((await getOrderForParty(buyerId, order.id)).contactsOpen).toBe(
      false,
    );
    await expectCode(
      transitionOrder(
        { orderId: order.id, to: "accepted", actor: "buyer", actorId: buyerId },
        now,
      ),
      409,
      "INVALID_TRANSITION",
    );
    await expectCode(
      transitionOrder(
        {
          orderId: order.id,
          to: "accepted",
          actor: "seller",
          actorId: strangerId,
        },
        now,
      ),
      404,
    );
    await transitionOrder(
      { orderId: order.id, to: "accepted", actor: "seller", actorId: sellerId },
      now,
    );
    const seen = await getOrderForParty(buyerId, order.id);
    expect(seen.contactsOpen).toBe(true);
    expect(seen.priceMinor).toBe(BigInt(80000));

    await transitionOrder(
      {
        orderId: order.id,
        to: "in_progress",
        actor: "seller",
        actorId: sellerId,
      },
      now,
    );
    await expectCode(
      transitionOrder(
        {
          orderId: order.id,
          to: "delivered",
          actor: "seller",
          actorId: sellerId,
          deliveryUrl: "http://x.example",
        },
        now,
      ),
      400,
    );
    const delivered = await transitionOrder(
      {
        orderId: order.id,
        to: "delivered",
        actor: "seller",
        actorId: sellerId,
        deliveryUrl: "https://acme-landing.example",
      },
      now,
    );
    expect(delivered.autoCompleteAt?.toISOString()).toBe(
      "2026-10-22T12:00:00.000Z",
    );

    const revised = await transitionOrder(
      {
        orderId: order.id,
        to: "in_progress",
        actor: "buyer",
        actorId: buyerId,
      },
      now,
    );
    expect(revised.revisionsLeft).toBe(2);
    await transitionOrder(
      {
        orderId: order.id,
        to: "delivered",
        actor: "seller",
        actorId: sellerId,
        deliveryUrl: "https://acme-landing.example/v2",
      },
      now,
    );

    // Nothing is due yet; seven days later the system accepts the work.
    expect(await runOrderTimers(now)).toEqual({ expired: 0, completed: 0 });
    const later = new Date("2026-10-22T12:00:00.000Z");
    const timers = await runOrderTimers(later);
    expect(timers.completed).toBeGreaterThanOrEqual(1);
    expect((await getOrderForParty(sellerId, order.id)).status).toBe(
      "completed",
    );

    const history = await orderHistory(buyerId, order.id);
    expect(history.map((row) => row.toStatus)).toEqual([
      "sent",
      "accepted",
      "in_progress",
      "delivered",
      "in_progress",
      "delivered",
      "completed",
    ]);
    expect(history.at(-1)?.actorId).toBeNull();

    // Each side hears the other's steps and the timer, never its own (D456).
    expect(world.noticesOf(buyerId)).toEqual([
      "freelance.order_updated:accepted",
      "freelance.order_updated:started",
      "freelance.order_updated:delivered",
      "freelance.order_updated:delivered",
      "freelance.order_updated:completed",
    ]);
    expect(world.noticesOf(sellerId).slice(2)).toEqual([
      "freelance.service_decided:published",
      "freelance.order_updated:revision",
      "freelance.order_updated:completed",
    ]);

    // Review: once, by the buyer, without contacts, as a company (28.5).
    await expectCode(
      leaveReview(sellerId, { orderId: order.id, rating: 5 }, later),
      404,
    );
    await expectCode(
      leaveReview(
        buyerId,
        { orderId: order.id, rating: 5, body: "Пишите ada@example.com" },
        later,
      ),
      422,
      FREELANCE_ERRORS.contactsInText,
    );
    const review = await leaveReview(
      buyerId,
      { orderId: order.id, rating: 5, body: "Сдали на день раньше" },
      later,
    );
    expect(review.authorKind).toBe("company");
    await expectCode(
      leaveReview(buyerId, { orderId: order.id, rating: 4 }, later),
      409,
      FREELANCE_ERRORS.reviewClosed,
    );
    const reviews = await listPublicReviews(created.id);
    expect(reviews).toEqual([
      {
        rating: 5,
        body: "Сдали на день раньше",
        authorKind: "company",
        createdAt: later,
      },
    ]);
    expect(Object.keys(reviews[0] ?? {})).not.toContain("authorId");

    const stats = await getPublishedService(created.slug);
    expect(stats?.completed).toBe(1);
    expect(stats?.rating).toBe(5);

    // A request nobody answers expires after 72 hours.
    const second = await sendRequest(
      strangerId,
      {
        serviceId: created.id,
        tier: "basic",
        task: "Нужен простой лендинг на одну страницу",
      },
      later,
    );
    await runOrderTimers(new Date("2026-10-25T12:00:00.000Z"));
    expect((await getOrderForParty(strangerId, second.id)).status).toBe(
      "expired",
    );
    expect((await getOrderForParty(strangerId, second.id)).contactsOpen).toBe(
      false,
    );

    // Taking orders off hides the service.
    await setAcceptingOrders(sellerId, false, later);
    expect(await getPublishedService(created.slug)).toBeNull();
  });
});
