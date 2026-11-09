import { z } from "zod";
import { chainByChainId, chainById, tokenContract } from "@intgetion/billing/engine";
import { readChain, type ChainSnapshot } from "@intgetion/billing/engine";
import {
  clientStatus,
  formatTokenAmount,
  settlement,
  type ClientBillingStatus,
} from "@intgetion/billing/engine";
import { tokenUnits, verifyTransfer } from "@intgetion/billing/engine";
import { errorCodes, HttpError, notFound, validationError } from "@intgetion/kit";
import { logger } from "@intgetion/kit";
import { notifyPlatformOwners } from "../../../platform";
import {
  cryptoCheckoutOn,
  isSanctionedAddress,
  verifiedPayerWallet,
} from "../../../platform";
import { readAccountWallet } from "../../../platform";
import * as pay from "../repo/payment-repo";
import { getOrderForParty, transitionOrder } from "./order-service";

/**
 * Payment of a freelance order to the freelancer's own address (28.6, D463).
 * The platform holds no money and takes no fee. The server reads the receipt
 * itself; the order moves to `in_progress` from the system, with history and
 * notices, only after every check of PAYMENTS §4.3 passes.
 */

const PAYMENT_MS = 30 * 60 * 1000;
const UNIQUE_VIOLATION = "23505";

type ChainReader = (
  chain: string,
  hash: `0x${string}`,
) => Promise<ChainSnapshot>;
let chainReader: ChainReader = readChain;

/** Test seam: a fake network. Undefined puts the real RPC back. */
export function setChainReaderForTests(reader: ChainReader | undefined) {
  chainReader = reader ?? readChain;
}

function payError(code: string, message: string, status = 409): HttpError {
  return new HttpError(status, code, message);
}

/**
 * What a wallet change touches on the freelance side (D518): payments a
 * buyer opened to the current address keep it and still settle; accepted
 * orders without payment will be paid to the new address.
 */
export async function walletPaymentsInFlight(
  sellerId: string,
  address: string,
): Promise<{ openPayments: number; unpaidOrders: number }> {
  const row = await pay.paymentsInFlightTo(sellerId, address);
  return { openPayments: row.open_payments, unpaidOrders: row.unpaid_orders };
}

export type OrderPaymentView = {
  id: string;
  orderId: string;
  status: ClientBillingStatus;
  chainId: number;
  token: string;
  tokenContract: string;
  recipient: string;
  tokenAmount: string;
  expiresAt: string;
};

function view(row: pay.OrderPaymentRow, now = new Date()): OrderPaymentView {
  return {
    id: row.id,
    orderId: row.order_id,
    status: clientStatus({
      status: row.status,
      reason: row.reason,
      expiresAt: new Date(row.expires_at),
      now,
    }),
    chainId: chainById(row.chain)?.chainId ?? 0,
    token: row.token,
    tokenContract: row.token_contract,
    recipient: row.recipient,
    tokenAmount: formatTokenAmount(row.token_amount),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export type OrderPayState = {
  /** The buyer may start a payment now. */
  payable: boolean;
  /** The seller has a confirmed payout address. */
  payoutReady: boolean;
  payment: OrderPaymentView | null;
};

/** What the order page needs to show the pay button and the payment line. */
export async function orderPayState(
  userId: string,
  orderId: string,
): Promise<OrderPayState> {
  const order = await getOrderForParty(userId, orderId);
  const latest = await pay.latestPayment(order.id);
  const payout = order.sellerId
    ? await readAccountWallet(order.sellerId)
    : null;
  const payoutReady = Boolean(payout?.address);
  return {
    payable:
      order.side === "buyer" &&
      order.status === "accepted" &&
      payoutReady &&
      cryptoCheckoutOn() &&
      latest?.status !== "confirmed",
    payoutReady,
    payment: latest ? view(latest) : null,
  };
}

/**
 * The buyer opens a payment of an accepted order: the price snapshot of the
 * order, to the seller's proven address, from the wallet the buyer just
 * signed with at the checkout. A paid order returns its payment.
 */
export async function createOrderPayment(
  buyerId: string,
  orderId: string,
  raw: unknown,
  now = new Date(),
): Promise<OrderPaymentView> {
  const parsed = z
    .object({ token: z.enum(["USDC", "USDT"]) })
    .strict()
    .safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const order = await getOrderForParty(buyerId, orderId);
  if (order.side !== "buyer") throw notFound();
  const latest = await pay.latestPayment(order.id);
  if (latest?.status === "confirmed") return view(latest, now);
  if (order.status !== "accepted") {
    throw payError(errorCodes.invalidTransition, "This order is not payable");
  }
  if (!cryptoCheckoutOn()) {
    throw payError("BILLING_UNAVAILABLE", "Crypto payments are not on");
  }
  const payout = order.sellerId
    ? await readAccountWallet(order.sellerId)
    : null;
  if (!payout?.address) {
    throw payError("PAYOUT_WALLET_REQUIRED", "The freelancer has no address");
  }
  if (await isSanctionedAddress(payout.address)) {
    throw payError("PAYOUT_UNDER_REVIEW", "This payment is under review");
  }
  const payer = await verifiedPayerWallet(buyerId, now);
  if (!payer)
    throw payError("WALLET_REQUIRED", "Sign in with the wallet first");
  const chain = chainByChainId(payer.chainId);
  if (!chain) throw payError("CHAIN_UNSUPPORTED", "Use a supported network");
  const contract = tokenContract(chain.id, parsed.data.token);
  if (!contract) {
    throw payError("TOKEN_UNSUPPORTED", "This token is not on this network");
  }
  if (
    latest &&
    latest.status === "open" &&
    new Date(latest.expires_at) > now &&
    latest.chain === chain.id &&
    latest.token === parsed.data.token &&
    latest.payer_address === payer.address &&
    latest.recipient === payout.address
  ) {
    return view(latest, now);
  }
  const row = await pay.insertPayment({
    orderId: order.id,
    buyerId,
    chain: chain.id,
    token: parsed.data.token,
    tokenContract: contract,
    recipient: payout.address,
    payerAddress: payer.address,
    amountMinor: order.priceMinor,
    tokenAmount: tokenUnits(order.priceMinor),
    expiresAt: new Date(now.getTime() + PAYMENT_MS),
  });
  return view(row, now);
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if ((current as { code?: string }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The buyer hands in the transaction hash. Every check runs on the server:
 * receipt, token contract, recipient, sender, amount, age, confirmations and
 * the sanctions list for both addresses. Only then the order starts.
 */
export async function confirmOrderPayment(
  buyerId: string,
  paymentId: string,
  rawHash: unknown,
  now = new Date(),
): Promise<OrderPaymentView> {
  const payment = await pay.findPayment(paymentId);
  if (!payment || payment.buyer_id !== buyerId) throw notFound();
  if (typeof rawHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(rawHash)) {
    throw validationError("Missing transaction");
  }
  const hash = rawHash.toLowerCase();
  if (payment.status === "confirmed") {
    await startPaidOrder(payment.order_id, now);
    return view(payment, now);
  }
  const chain = chainById(payment.chain);
  if (!chain) throw notFound();
  const snapshot = await chainReader(payment.chain, hash as `0x${string}`);
  const sanctioned =
    (await isSanctionedAddress(payment.payer_address)) ||
    (await isSanctionedAddress(payment.recipient));
  const next = settlement(
    verifyTransfer({
      receipt: snapshot.receipt,
      blockTimestamp: snapshot.blockTimestamp,
      confirmations: snapshot.confirmations,
      requiredConfirmations: chain.confirmations,
      tokenContract: payment.token_contract,
      recipient: payment.recipient,
      payer: payment.payer_address,
      amount: BigInt(payment.token_amount),
      orderCreatedAt: Math.floor(new Date(payment.created_at).getTime() / 1000),
      sanctioned,
    }),
  );
  if (!next.grant) {
    const status = next.status === "expired" ? "failed" : next.status;
    if (status !== "open" && status !== "confirmed") {
      await pay.markPayment(payment.id, status, next.reason, hash);
    }
    if (status === "frozen" && payment.status !== "frozen") {
      await alertOwners("Freelance payment frozen for review", [
        "A freelance payment was frozen: an address is on the OFAC SDN list.",
        `Payment: ${payment.id}`,
        `Network: ${payment.chain}`,
        `Transaction: ${hash}`,
        "The order did not start. The platform holds no money.",
      ]);
    }
    return view((await pay.findPayment(payment.id)) ?? payment, now);
  }
  try {
    await pay.confirmPayment(payment.id, hash);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw payError("HASH_USED", "This transaction is already counted");
    }
    throw error;
  }
  await startPaidOrder(payment.order_id, now);
  return view((await pay.findPayment(payment.id)) ?? payment, now);
}

/** A paid order moves to work from the system; a moved order is left alone. */
async function startPaidOrder(orderId: string, now: Date): Promise<void> {
  try {
    await transitionOrder(
      { orderId, to: "in_progress", actor: "system", actorId: null },
      now,
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) {
      logger.info({ orderId }, "freelance: paid order was not in accepted");
      return;
    }
    throw error;
  }
}

/** The buyer's poll of one payment; a submitted one is checked again. */
export async function refreshOrderPayment(
  buyerId: string,
  paymentId: string,
  now = new Date(),
): Promise<OrderPaymentView> {
  const payment = await pay.findPayment(paymentId);
  if (!payment || payment.buyer_id !== buyerId) throw notFound();
  if (payment.status === "submitted" && payment.tx_hash) {
    return confirmOrderPayment(buyerId, payment.id, payment.tx_hash, now);
  }
  return view(payment, now);
}

/**
 * Cron (`/api/cron/freelance`): payments still waiting on confirmations, and
 * paid orders whose move to work was missed.
 */
export async function recheckOrderPayments(
  now = new Date(),
  limit = 20,
): Promise<{ checked: number; started: number }> {
  let checked = 0;
  for (const row of await pay.submittedPayments(limit)) {
    if (!row.buyer_id || !row.tx_hash) continue;
    try {
      await confirmOrderPayment(row.buyer_id, row.id, row.tx_hash, now);
      checked += 1;
    } catch (error) {
      logger.warn(
        { err: error, paymentId: row.id },
        "freelance: recheck failed",
      );
    }
  }
  let started = 0;
  for (const row of await pay.paidButAccepted(limit)) {
    await startPaidOrder(row.order_id, now);
    started += 1;
  }
  return { checked, started };
}

async function alertOwners(subject: string, lines: string[]) {
  logger.warn({ alert: "freelance_payment_review" }, subject);
  try {
    await notifyPlatformOwners(subject, lines.join("\n"));
  } catch (error) {
    logger.error({ err: error }, "freelance: owner alert failed");
  }
}
