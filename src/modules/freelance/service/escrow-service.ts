import {
  encodeEscrowData,
  ESCROW_NETWORKS,
  ESCROW_TYPE,
  escrowDetails,
  MAX_TERMINATION_SECONDS,
  RESOLVER_INDIVIDUAL,
  type EscrowNetwork,
  type EscrowSnapshot,
} from "@intgetion/billing/engine";
import { tokenUnits } from "@intgetion/billing/engine";

/**
 * Escrow payment of a freelance order (TZ 43, prototype step 2a, D564).
 * Pure: it builds the `create` call and judges a contract read from the
 * chain. It reads no env, no database and no network, and it is wired to no
 * route yet. Direct payment (D463) is unchanged. Transactions are signed by
 * the buyer's wallet; the server never signs.
 */

const DAY_SECONDS = 24 * 60 * 60;

/** D564: the term is the package delivery time plus 14 days. */
export const ESCROW_GRACE_DAYS = 14;

/** D564: the arbiter takes balance / 20 = 5 % when it resolves a dispute. */
export const ESCROW_RESOLUTION_RATE = BigInt(20);

/** Settings the caller reads from config; nothing here is from memory. */
export type EscrowSettings = {
  network: EscrowNetwork;
  /** Stablecoin contract on that network. */
  token: string;
  /** Wrapped native token the contract requires on that network. */
  wrappedNativeToken: string;
  /** Public address of the arbiter (D564: a platform test address). */
  resolver: string;
};

export type EscrowTermsInput = {
  orderId: string;
  priceCents: number;
  deliveryDays: number;
  /** Buyer's proven wallet (D518). */
  buyerAddress: string;
  /** Seller's proven wallet (D518). */
  sellerAddress: string;
  settings: EscrowSettings;
  now: Date;
};

/** The `create` call the buyer's wallet signs, and what we expect after it. */
export type EscrowTerms = {
  chainId: number;
  factory: `0x${string}`;
  recipient: `0x${string}`;
  amounts: bigint[];
  data: `0x${string}`;
  type: `0x${string}`;
  terminationTime: bigint;
  details: `0x${string}`;
  token: `0x${string}`;
  resolver: `0x${string}`;
  client: `0x${string}`;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function address(value: string, field: string): `0x${string}` {
  if (!ADDRESS.test(value)) {
    throw new Error(`escrow: ${field} is not an address`);
  }
  return value.toLowerCase() as `0x${string}`;
}

/** One milestone equal to the package price (D564). */
export function escrowTerms(input: EscrowTermsInput): EscrowTerms {
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) {
    throw new Error("escrow: price must be positive cents");
  }
  if (!Number.isInteger(input.deliveryDays) || input.deliveryDays <= 0) {
    throw new Error("escrow: delivery days must be positive");
  }
  const network = ESCROW_NETWORKS[input.settings.network];
  const client = address(input.buyerAddress, "buyer");
  const recipient = address(input.sellerAddress, "seller");
  if (client === recipient) throw new Error("escrow: buyer is the seller");
  const token = address(input.settings.token, "token");
  const resolver = address(input.settings.resolver, "resolver");
  if (resolver === client || resolver === recipient) {
    throw new Error("escrow: a party cannot be the arbiter");
  }
  const seconds = (input.deliveryDays + ESCROW_GRACE_DAYS) * DAY_SECONDS;
  if (seconds > MAX_TERMINATION_SECONDS) {
    throw new Error("escrow: term is longer than the contract allows");
  }
  const terminationTime = BigInt(
    Math.floor(input.now.getTime() / 1000) + seconds,
  );
  const details = escrowDetails(input.orderId);
  const factory = network.factory as `0x${string}`;
  return {
    chainId: network.chainId,
    factory,
    recipient,
    amounts: [tokenUnits(BigInt(input.priceCents))],
    data: encodeEscrowData({
      client,
      resolverType: RESOLVER_INDIVIDUAL,
      resolver,
      token,
      terminationTime,
      details,
      wrappedNativeToken: address(
        input.settings.wrappedNativeToken,
        "wrapped native token",
      ),
      requireVerification: false,
      factory,
    }),
    type: ESCROW_TYPE,
    terminationTime,
    details,
    token,
    resolver,
    client,
  };
}

export type EscrowMismatch =
  | "wrong_client"
  | "wrong_provider"
  | "wrong_token"
  | "wrong_resolver"
  | "wrong_resolver_type"
  | "wrong_resolution_rate"
  | "wrong_term"
  | "wrong_order"
  | "wrong_amounts";

/**
 * Every field the chain holds must equal what we asked the buyer to sign.
 * Values come from the chain read and our own terms, never from the request.
 */
export function escrowMismatches(
  snapshot: EscrowSnapshot,
  terms: EscrowTerms,
): EscrowMismatch[] {
  const out: EscrowMismatch[] = [];
  if (snapshot.client !== terms.client) out.push("wrong_client");
  if (snapshot.provider !== terms.recipient) out.push("wrong_provider");
  if (snapshot.token !== terms.token) out.push("wrong_token");
  if (snapshot.resolver !== terms.resolver) out.push("wrong_resolver");
  if (snapshot.resolverType !== RESOLVER_INDIVIDUAL) {
    out.push("wrong_resolver_type");
  }
  if (snapshot.resolutionRate !== ESCROW_RESOLUTION_RATE) {
    out.push("wrong_resolution_rate");
  }
  if (snapshot.terminationTime !== terms.terminationTime) {
    out.push("wrong_term");
  }
  if (snapshot.details !== terms.details) out.push("wrong_order");
  if (
    snapshot.amounts.length !== terms.amounts.length ||
    snapshot.amounts.some((value, index) => value !== terms.amounts[index])
  ) {
    out.push("wrong_amounts");
  }
  return out;
}

/**
 * What happened to a matching contract, read from its state:
 * - `unfunded`: created, the full price is not in it yet;
 * - `funded`: the whole price sits in it, work may start;
 * - `disputed`: a party locked it; only the arbiter's `resolve` frees it;
 * - `settled`: the contract is done. `release` (to the seller), `withdraw`
 *   (back to the buyer after the term) and `resolve` (split by the arbiter)
 *   all end here with `milestone = amounts.length`, so state alone cannot
 *   say who got the money: the caller reads the Release, Withdraw or
 *   Resolve event of the transaction (step 2b);
 * - `expired`: the term passed and the price never arrived.
 */
export type EscrowState =
  "unfunded" | "funded" | "disputed" | "settled" | "expired";

export function escrowState(
  snapshot: EscrowSnapshot,
  terms: Pick<EscrowTerms, "amounts">,
  now: Date,
): EscrowState {
  const total = terms.amounts.reduce((sum, value) => sum + value, BigInt(0));
  if (snapshot.locked) return "disputed";
  if (snapshot.milestone >= BigInt(terms.amounts.length)) return "settled";
  if (snapshot.balance >= total) return "funded";
  const ended =
    BigInt(Math.floor(now.getTime() / 1000)) > snapshot.terminationTime;
  return ended ? "expired" : "unfunded";
}
