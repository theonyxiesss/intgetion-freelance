import { describe, expect, it } from "vitest";
import {
  isExplicitServiceDraftConfirmation,
  mergeServiceDraft,
  missingServiceDraftFields,
  normalizeServiceLanguages,
  unconfirmedServiceRanges,
  withoutUnconfirmedServiceRanges,
} from "../service/drafts";

describe("shared freelance service draft", () => {
  it("normalizes written language names to ISO-639-1 codes", () => {
    expect(
      normalizeServiceLanguages(["English", "Italian", "русский"]),
    ).toEqual(["en", "it", "ru"]);
  });
  it("merges only supplied fields and ignores null", () => {
    expect(
      mergeServiceDraft(
        { title: "Web app" },
        { title: null, category: "development" },
      ),
    ).toEqual({ title: "Web app", category: "development" });
  });

  it("merges one package edit by tier and keeps the rest of the package draft", () => {
    expect(
      mergeServiceDraft(
        {
          packages: [
            {
              tier: "basic",
              price: "450",
              deliveryDays: 7,
              revisions: 1,
              includes: ["Build"],
            },
            { tier: "standard", price: "900" },
          ],
        },
        { packages: [{ tier: "basic", price: "500" }] },
      ),
    ).toEqual({
      packages: [
        {
          tier: "basic",
          price: "500",
          deliveryDays: 7,
          revisions: 1,
          includes: ["Build"],
        },
        { tier: "standard", price: "900" },
      ],
    });
  });

  it("requires a complete basic package before confirmation", () => {
    const base = {
      title: "Build a web application",
      category: "development",
      description:
        "A complete web application built to your requirements with a tested responsive interface and deployment guidance.",
      languages: ["en"],
    };
    expect(missingServiceDraftFields(base)).toContain("packages");
    expect(
      missingServiceDraftFields({
        ...base,
        packages: [
          {
            tier: "basic",
            price: "450",
            deliveryDays: 7,
            revisions: 1,
            includes: ["Responsive implementation"],
          },
        ],
      }),
    ).toEqual([]);
    expect(
      missingServiceDraftFields({
        ...base,
        packages: [
          {
            tier: "basic",
            price: "450",
            deliveryDays: 7,
            revisions: 1,
            includes: [],
          },
        ],
      }),
    ).toContain("packages");
  });

  it("requires an explicit affirmative and rejects negative confirmation", () => {
    expect(isExplicitServiceDraftConfirmation("Да, отправляй")).toBe(true);
    expect(isExplicitServiceDraftConfirmation("Нет, не публикуй")).toBe(false);
    expect(isExplicitServiceDraftConfirmation("Хорошо, но позже")).toBe(false);
  });

  it("suggests but does not save the midpoint of an unapproved package price or duration range", () => {
    const patch = {
      packages: [{ tier: "basic", price: "75", deliveryDays: 6 }],
    };
    const ranges = unconfirmedServiceRanges(
      "Basic: $50–$100 and 5–7 days",
      patch,
    );
    expect(ranges).toEqual([
      { field: "price", low: 50, high: 100, proposal: 75, tier: "basic" },
      { field: "deliveryDays", low: 5, high: 7, proposal: 6, tier: "basic" },
    ]);
    expect(withoutUnconfirmedServiceRanges(patch, ranges)).toEqual({
      packages: [{ tier: "basic" }],
    });
    expect(unconfirmedServiceRanges("$50–$100, use $75", patch)).toEqual([]);
  });
});
