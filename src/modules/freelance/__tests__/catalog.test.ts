import { describe, expect, it } from "vitest";
import { formatMinor } from "@intgetion/kit";
import { parseFreelanceSearch } from "../schemas/search";
import { isMissingFreelanceTable } from "../service/catalog";

describe("/freelance query (28.11 C)", () => {
  it("keeps a full valid query", () => {
    expect(
      parseFreelanceSearch({
        q: " лендинг ",
        category: "development",
        budget: "500",
        days: "7",
        lang: "ru",
        sort: "cheap",
        page: "2",
      }),
    ).toEqual({
      q: "лендинг",
      category: "development",
      budget: 500,
      days: 7,
      lang: "ru",
      sort: "cheap",
      page: 2,
    });
  });

  it("drops values it does not offer and keeps the rest", () => {
    expect(
      parseFreelanceSearch({
        category: "dancing",
        budget: "300",
        days: "5",
        lang: "xx",
        sort: "random",
        page: "0",
        q: "seo",
      }),
    ).toEqual({ q: "seo", sort: "fit", page: 1 });
  });

  it("reads the first of repeated parameters and blanks as nothing", () => {
    expect(
      parseFreelanceSearch({ category: ["design", "web3"], q: "" }),
    ).toEqual({
      category: "design",
      sort: "fit",
      page: 1,
    });
  });
});

describe("money in DTOs", () => {
  it("keeps formatMinor exact for money DTOs", () => {
    expect(formatMinor(BigInt(123456), "USD", "en-US")).toBe("$1,234.56");
    expect(formatMinor(BigInt(100000), "USD", "en-US")).toBe("$1,000.00");
    expect(formatMinor(BigInt(5000), "JPY", "en-US")).toBe("¥5,000");
  });
});

describe("missing tables", () => {
  it("treats a freelance table that is not there yet as an empty catalog", () => {
    expect(isMissingFreelanceTable({ code: "42P01" })).toBe(true);
    expect(
      isMissingFreelanceTable(
        new Error("query failed", {
          cause: new Error('relation "freelance_services" does not exist'),
        }),
      ),
    ).toBe(true);
    expect(isMissingFreelanceTable(new Error("timeout"))).toBe(false);
  });
});
