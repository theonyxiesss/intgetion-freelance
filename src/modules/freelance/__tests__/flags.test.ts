import { describe, expect, it } from "vitest";
import {
  absolutePriceFlags,
  contactHint,
  contactLink,
  rangePriceFlags,
} from "../service/flags";
import { freelanceTools } from "../service/bot-tools";

const cents = (usd: number) => BigInt(usd * 100);

describe("moderation flags of a service (28.9, D462)", () => {
  it("marks prices at the edges of the $10–$20 000 window", () => {
    expect(absolutePriceFlags([{ priceMinor: cents(15) }])).toEqual([
      "price_very_low",
    ]);
    expect(absolutePriceFlags([{ priceMinor: cents(12000) }])).toEqual([
      "price_very_high",
    ]);
    expect(absolutePriceFlags([{ priceMinor: cents(450) }])).toEqual([]);
  });

  it("compares the basic price with the direction's range only from three services", () => {
    const published = [cents(300), cents(450), cents(900)];
    expect(rangePriceFlags(cents(100), published)).toEqual([
      "price_below_range",
    ]);
    expect(rangePriceFlags(cents(2000), published)).toEqual([
      "price_above_range",
    ]);
    expect(rangePriceFlags(cents(450), published)).toEqual([]);
    expect(rangePriceFlags(cents(1), [cents(300), cents(900)])).toEqual([]);
    expect(rangePriceFlags(undefined, published)).toEqual([]);
  });

  it("catches soft contacts the save check lets through", () => {
    for (const text of [
      "Пишите в телеграм, ник тот же",
      "write me on WhatsApp",
      "ada at mail dot com",
      "звоните 8 999 123 45 67",
      "мой тг ada_dev",
    ]) {
      expect(contactHint(text)).toBe(true);
    }
    for (const text of [
      "Landing page with a form and analytics in 7 days",
      "До 5 блоков, 2 правки",
    ]) {
      expect(contactHint(text)).toBe(false);
    }
  });

  it("marks messenger and invite links among the works", () => {
    expect(contactLink("https://t.me/ada_dev")).toBe(true);
    expect(contactLink("https://www.wa.me/123")).toBe(true);
    expect(contactLink("https://dribbble.com/ada")).toBe(false);
    expect(contactLink("not a url")).toBe(false);
  });

  it("report_freelance is a card", () => {
    const tool = freelanceTools.find(
      (item) => item.name === "report_freelance",
    );
    expect(tool?.confirm()).toBe(true);
  });
});
