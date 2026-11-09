import { randomUUID } from "node:crypto";
import { inArray, or, sql } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { freelanceOrders } from "../../db/owned";
import { users } from "../../db/external";
import { fakeWorld } from "../../test-support";
import { HttpError } from "@intgetion/kit";
import { TRANSFER_TOPIC } from "@intgetion/billing/engine";
import {
  confirmOrderPayment,
  createOrderPayment,
  createService,
  decideServiceModeration,
  getOrderForParty,
  orderHistory,
  orderPayState,
  recheckOrderPayments,
  sendRequest,
  setAcceptingOrders,
  setChainReaderForTests,
  submitService,
  transitionOrder,
} from "./service";

const world = fakeWorld();

/**
 * Paying an order to the freelancer's own address (28.6, D463). The network
 * is a fake reader; no live transfer happens in tests.
 */

const sellerId = randomUUID();
const buyerId = randomUUID();
const strangerId = randomUUID();
const userIds = [sellerId, buyerId, strangerId];
const token = sellerId.slice(0, 8);
const USDC = "0x1111111111111111111111111111111111111111";
const sellerAccount = privateKeyToAccount(generatePrivateKey());
const buyerAccount = privateKeyToAccount(generatePrivateKey());
const sellerAddress = sellerAccount.address.toLowerCase();
const buyerAddress = buyerAccount.address.toLowerCase();
const saved = {
  enabled: process.env.BILLING_ENABLED,
  provider: process.env.BILLING_CRYPTO_PROVIDER,
  contracts: process.env.BILLING_TOKEN_CONTRACTS,
};

function topic(address: string): string {
  return `0x${address.replace(/^0x/, "").padStart(64, "0")}`;
}

/** A receipt of one USDC transfer, as the network would return it. */
function network(input: { to: string; from: string; units: bigint }) {
  return async () => ({
    receipt: {
      status: "0x1",
      logs: [
        {
          address: USDC,
          topics: [TRANSFER_TOPIC, topic(input.from), topic(input.to)],
          data: `0x${input.units.toString(16).padStart(64, "0")}`,
        },
      ],
    },
    blockTimestamp: Math.floor(Date.now() / 1000),
    confirmations: 50,
  });
}

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

async function expectCode(promise: Promise<unknown>, code: string | number) {
  try {
    await promise;
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    const http = error as HttpError;
    expect(typeof code === "number" ? http.status : http.code).toBe(code);
  }
}

async function serviceFor(title: string) {
  const service = await createService(sellerId, {
    title,
    category: "development",
    description:
      "A fast landing page on Next.js with a sign-up form, analytics and a deploy, made from your layout in a week.",
    languages: ["en"],
    packages: [
      {
        tier: "basic",
        price: "450",
        deliveryDays: 7,
        revisions: 1,
        includes: ["Up to 5 blocks"],
      },
    ],
  });
  await submitService(sellerId, service.id);
  await decideServiceModeration(service.id, "publish", null);
  return service;
}

async function acceptedOrder(serviceId: string) {
  const order = await sendRequest(buyerId, {
    serviceId,
    tier: "basic",
    task: "A landing page for the wallet launch, simple and fast.",
  });
  await transitionOrder({
    orderId: order.id,
    to: "accepted",
    actor: "seller",
    actorId: sellerId,
  });
  return order;
}

beforeAll(() => {
  process.env.BILLING_ENABLED = "true";
  process.env.BILLING_CRYPTO_PROVIDER = "walletconnect";
  process.env.BILLING_TOKEN_CONTRACTS = JSON.stringify({
    base: { USDC },
  });
});

afterAll(async () => {
  setChainReaderForTests(undefined);
  process.env.BILLING_ENABLED = saved.enabled;
  process.env.BILLING_CRYPTO_PROVIDER = saved.provider;
  process.env.BILLING_TOKEN_CONTRACTS = saved.contracts;
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

describe("freelance order payment (28.6)", () => {
  it("pays the freelancer's proven address and starts the order from the system", async () => {
    for (const id of userIds) {
      await getDb().insert(users).values({ id });
    }
    world.addCandidate(sellerId);
    await setAcceptingOrders(sellerId, true);
    const first = await serviceFor(`Landing page in a week ${token}`);
    const order = await acceptedOrder(first.id);

    // Without a payout address the order is not payable here.
    expect((await orderPayState(buyerId, order.id)).payable).toBe(false);
    await expectCode(
      createOrderPayment(buyerId, order.id, { token: "USDC" }),
      "PAYOUT_WALLET_REQUIRED",
    );

    // The freelancer's proven payout address (users module, D518).
    world.linkPayoutWallet(sellerId, sellerAddress);

    expect((await orderPayState(buyerId, order.id)).payable).toBe(true);
    expect((await orderPayState(sellerId, order.id)).payable).toBe(false);
    await expectCode(
      createOrderPayment(strangerId, order.id, { token: "USDC" }),
      404,
    );
    await expectCode(
      createOrderPayment(sellerId, order.id, { token: "USDC" }),
      404,
    );
    // The buyer signs in with the checkout wallet first.
    await expectCode(
      createOrderPayment(buyerId, order.id, { token: "USDC" }),
      "WALLET_REQUIRED",
    );
    world.linkPayerWallet(buyerId, buyerAccount.address, 8453);
    await expectCode(
      createOrderPayment(buyerId, order.id, { token: "USDT" }),
      "TOKEN_UNSUPPORTED",
    );

    const payment = await createOrderPayment(buyerId, order.id, {
      token: "USDC",
    });
    expect(payment).toMatchObject({
      status: "awaiting_payment",
      chainId: 8453,
      recipient: sellerAddress,
      tokenContract: USDC,
      tokenAmount: "450",
    });

    // A transfer to the platform or anyone else is not counted.
    setChainReaderForTests(
      network({
        to: "0x2222222222222222222222222222222222222222",
        from: buyerAddress,
        units: BigInt(450_000_000),
      }),
    );
    const wrong = await confirmOrderPayment(buyerId, payment.id, hash(1));
    expect(wrong.status).toBe("failed");
    expect((await getOrderForParty(buyerId, order.id)).status).toBe("accepted");

    // Not yet enough confirmations: checking, then the cron counts it.
    const retry = await createOrderPayment(buyerId, order.id, {
      token: "USDC",
    });
    setChainReaderForTests(async () => ({
      ...(await network({
        to: sellerAddress,
        from: buyerAddress,
        units: BigInt(450_000_000),
      })()),
      confirmations: 2,
    }));
    const waiting = await confirmOrderPayment(buyerId, retry.id, hash(2));
    expect(waiting.status).toBe("checking");
    setChainReaderForTests(
      network({
        to: sellerAddress,
        from: buyerAddress,
        units: BigInt(450_000_000),
      }),
    );
    expect((await recheckOrderPayments()).checked).toBeGreaterThanOrEqual(1);
    const started = await getOrderForParty(buyerId, order.id);
    expect(started.status).toBe("in_progress");
    const history = await orderHistory(buyerId, order.id);
    expect(history.at(-1)).toMatchObject({
      fromStatus: "accepted",
      toStatus: "in_progress",
      actorId: null,
    });
    expect((await orderPayState(buyerId, order.id)).payment?.status).toBe(
      "paid",
    );

    // The same hash never pays a second order.
    const second = await serviceFor(`Second landing page ${token}`);
    const other = await acceptedOrder(second.id);
    const otherPayment = await createOrderPayment(buyerId, other.id, {
      token: "USDC",
    });
    await expectCode(
      confirmOrderPayment(buyerId, otherPayment.id, hash(2)),
      "HASH_USED",
    );
    expect((await getOrderForParty(buyerId, other.id)).status).toBe("accepted");

    // A payout address on the sanctions list stops new payments.
    world.sanction(sellerAddress);
    const frozen = await confirmOrderPayment(buyerId, otherPayment.id, hash(3));
    expect(frozen.status).toBe("frozen");
    await expectCode(
      createOrderPayment(buyerId, other.id, { token: "USDC" }),
      "PAYOUT_UNDER_REVIEW",
    );
    expect((await getOrderForParty(buyerId, other.id)).status).toBe("accepted");
  });
});
