import { describe, expect, it } from "vitest";
import {
  decodeEscrowData,
  escrowDetails,
  type EscrowSnapshot,
} from "@intgetion/billing/engine";
import {
  ESCROW_GRACE_DAYS,
  escrowMismatches,
  escrowState,
  escrowTerms,
  type EscrowTermsInput,
} from "../service/escrow-service";

// Synthetic addresses for tests only; none of them is a real wallet or token.
const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const ARBITER = "0x3333333333333333333333333333333333333333";
const TOKEN = "0x4444444444444444444444444444444444444444";
const WRAPPED = "0x5555555555555555555555555555555555555555";
const OTHER = "0x9999999999999999999999999999999999999999";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const DAY = 24 * 60 * 60;

const input: EscrowTermsInput = {
  orderId: "order-1",
  priceCents: 5000,
  deliveryDays: 5,
  buyerAddress: BUYER,
  sellerAddress: SELLER,
  settings: {
    network: "base-sepolia",
    token: TOKEN,
    wrappedNativeToken: WRAPPED,
    resolver: ARBITER,
  },
  now: NOW,
};

function matching(overrides: Partial<EscrowSnapshot> = {}): EscrowSnapshot {
  const terms = escrowTerms(input);
  return {
    client: BUYER,
    provider: SELLER,
    resolverType: 0,
    resolver: ARBITER,
    token: TOKEN,
    terminationTime: terms.terminationTime,
    resolutionRate: BigInt(20),
    details: escrowDetails("order-1"),
    amounts: [BigInt(50_000_000)],
    locked: false,
    milestone: BigInt(0),
    balance: BigInt(0),
    ...overrides,
  };
}

describe("escrow terms (D564)", () => {
  it("asks for one milestone equal to the package price in 6-decimal units", () => {
    const terms = escrowTerms(input);
    expect(terms.amounts).toEqual([BigInt(50_000_000)]);
    expect(terms.recipient).toBe(SELLER);
    expect(terms.client).toBe(BUYER);
    expect(terms.chainId).toBe(84532);
  });

  it("ends the term at delivery days + 14 days", () => {
    const terms = escrowTerms(input);
    expect(ESCROW_GRACE_DAYS).toBe(14);
    expect(terms.terminationTime).toBe(BigInt(NOW_S + (5 + 14) * DAY));
  });

  it("packs the platform arbiter, the order hash and no verification step", () => {
    const data = decodeEscrowData(escrowTerms(input).data);
    expect(data.client.toLowerCase()).toBe(BUYER);
    expect(data.resolverType).toBe(0);
    expect(data.resolver.toLowerCase()).toBe(ARBITER);
    expect(data.token.toLowerCase()).toBe(TOKEN);
    expect(data.details).toBe(escrowDetails("order-1"));
    expect(data.wrappedNativeToken.toLowerCase()).toBe(WRAPPED);
    expect(data.requireVerification).toBe(false);
    expect(data.factory.toLowerCase()).toBe(
      "0x851e59a39571e599954702f0e4996bf838d9c863",
    );
  });

  it.each([
    [{ priceCents: 0 }, "price"],
    [{ priceCents: 10.5 }, "price"],
    [{ deliveryDays: 0 }, "delivery"],
    [{ buyerAddress: "not-an-address" }, "buyer"],
    [{ sellerAddress: BUYER }, "buyer is the seller"],
    [{ deliveryDays: 800 }, "longer than the contract allows"],
  ] as const)("refuses bad input %o", (patch, message) => {
    expect(() => escrowTerms({ ...input, ...patch })).toThrow(message);
  });

  it("refuses an arbiter who is a party", () => {
    expect(() =>
      escrowTerms({
        ...input,
        settings: { ...input.settings, resolver: SELLER },
      }),
    ).toThrow("arbiter");
  });
});

describe("escrow contract check (TZ 43 §8)", () => {
  it("accepts the contract created from our terms", () => {
    expect(escrowMismatches(matching(), escrowTerms(input))).toEqual([]);
  });

  it.each([
    [{ client: OTHER }, "wrong_client"],
    [{ provider: OTHER }, "wrong_provider"],
    [{ token: OTHER }, "wrong_token"],
    [{ resolver: OTHER }, "wrong_resolver"],
    [{ resolverType: 1 }, "wrong_resolver_type"],
    [{ resolutionRate: BigInt(10) }, "wrong_resolution_rate"],
    [{ terminationTime: BigInt(NOW_S + 400 * DAY) }, "wrong_term"],
    [{ details: escrowDetails("order-2") }, "wrong_order"],
    [{ amounts: [BigInt(49_000_000)] }, "wrong_amounts"],
    [{ amounts: [BigInt(25_000_000), BigInt(25_000_000)] }, "wrong_amounts"],
  ] as const)("rejects %o as %s", (patch, mismatch) => {
    expect(
      escrowMismatches(
        matching(patch as Partial<EscrowSnapshot>),
        escrowTerms(input),
      ),
    ).toEqual([mismatch]);
  });
});

describe("escrow state from the chain", () => {
  const terms = escrowTerms(input);
  const later = new Date(NOW.getTime() + 30 * DAY * 1000);

  it("is unfunded until the whole price arrives", () => {
    expect(escrowState(matching(), terms, NOW)).toBe("unfunded");
    expect(
      escrowState(matching({ balance: BigInt(49_999_999) }), terms, NOW),
    ).toBe("unfunded");
  });

  it("is funded with the whole price", () => {
    expect(
      escrowState(matching({ balance: BigInt(50_000_000) }), terms, NOW),
    ).toBe("funded");
  });

  it("is disputed while locked, whatever else is true", () => {
    expect(
      escrowState(
        matching({ locked: true, balance: BigInt(50_000_000) }),
        terms,
        later,
      ),
    ).toBe("disputed");
  });

  it("is settled once the contract moved its milestone to the end", () => {
    expect(escrowState(matching({ milestone: BigInt(1) }), terms, NOW)).toBe(
      "settled",
    );
  });

  it("is expired when the term passed and the price never arrived", () => {
    expect(escrowState(matching(), terms, later)).toBe("expired");
  });
});
