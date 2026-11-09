import type { FreelanceCategory } from "../../../config/freelance";
import { isSanctionedAddress } from "../../../platform";
import * as repo from "../repo/freelance-repo";
import { readAccountWallet } from "../../../platform";
import { priceRange } from "./rules";

/**
 * Flags the moderator sees next to a service (28.9, D462). They do not
 * block anything: the moderator decides. Hard contacts (email, phone, link,
 * @handle) are already refused on save; these catch the softer ones.
 */

/** Words and shapes that point to a contact outside the platform. */
const CONTACT_HINTS = [
  /\bt\.me\b/i,
  /\b(?:telegram|whats\s?app|viber|skype|discord|wechat|signal\s+me)\b/i,
  /(?:телеграм|телеграмм|ватсап|вотсап|вайбер|скайп|дискорд)/i,
  /(?:^|[^\p{L}])тг(?:[^\p{L}]|$)/iu,
  /\b[\w.-]+\s*(?:\(at\)|\[at\]|\s+at\s+|\s+собака\s+)\s*[\w-]+\s*(?:\(dot\)|\[dot\]|\s+dot\s+|\s+точка\s+)\s*[a-z]{2,}/i,
  /(?:\d[\s().-]*){9,}/,
];

const CONTACT_HOSTS = new Set([
  "t.me",
  "telegram.me",
  "telegram.dog",
  "wa.me",
  "api.whatsapp.com",
  "chat.whatsapp.com",
  "discord.gg",
  "discord.com",
  "linktr.ee",
  "calendly.com",
]);

/** True when the text hints at a contact the save check let through. */
export function contactHint(text: string): boolean {
  return CONTACT_HINTS.some((pattern) => pattern.test(text));
}

/** True when a work link is a messenger, an invite or a contact page. */
export function contactLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return CONTACT_HOSTS.has(host);
  } catch {
    return false;
  }
}

/** Absolute edges of the $10–$20 000 window (28.3). */
export function absolutePriceFlags(
  packages: readonly { priceMinor: bigint }[],
): string[] {
  const flags: string[] = [];
  if (packages.some((pkg) => pkg.priceMinor <= BigInt(2000))) {
    flags.push("price_very_low");
  }
  if (packages.some((pkg) => pkg.priceMinor >= BigInt(1_000_000))) {
    flags.push("price_very_high");
  }
  return flags;
}

/** Minimum published services in a direction before its range is trusted. */
export const RANGE_MIN_COUNT = 3;

/**
 * The basic price outside the range of published basic prices in the same
 * direction. With fewer than three services there is no range to compare.
 */
export function rangePriceFlags(
  basicMinor: bigint | undefined,
  published: readonly bigint[],
): string[] {
  const range = priceRange(published);
  if (basicMinor === undefined || !range || range.count < RANGE_MIN_COUNT) {
    return [];
  }
  if (basicMinor < range.minMinor) return ["price_below_range"];
  if (basicMinor > range.maxMinor) return ["price_above_range"];
  return [];
}

export type FlagInput = {
  /** The seller, for the payout address check (D463). */
  sellerId?: string;
  category: FreelanceCategory;
  title: string;
  description: string;
  buyerNeeds: string;
  links: readonly string[];
  packages: readonly { tier: string; priceMinor: bigint; includes: string[] }[];
};

/** All flags of a service at the moment it goes to the queue. */
export async function serviceFlags(input: FlagInput): Promise<string[]> {
  const flags = absolutePriceFlags(input.packages);
  const basic = input.packages.find((pkg) => pkg.tier === "basic")?.priceMinor;
  flags.push(
    ...rangePriceFlags(basic, await repo.publishedBasicPrices(input.category)),
  );
  const texts = [
    input.title,
    input.description,
    input.buyerNeeds,
    ...input.packages.flatMap((pkg) => pkg.includes),
  ];
  if (texts.some(contactHint)) flags.push("contacts_in_text");
  if (input.links.some(contactLink)) flags.push("contact_link");
  const payout = input.sellerId
    ? await readAccountWallet(input.sellerId)
    : null;
  if (payout?.address && (await isSanctionedAddress(payout.address))) {
    flags.push("wallet_sanctioned");
  }
  return flags;
}
