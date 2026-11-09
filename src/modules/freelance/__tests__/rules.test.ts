import { describe, expect, it } from "vitest";
import { HttpError } from "@intgetion/kit";
import {
  requestInput,
  reviewInput,
  serviceInput,
  type ServiceInput,
} from "../schemas";
import {
  assertServiceRules,
  autoCompleteAt,
  contactFields,
  contactsOpen,
  FREELANCE_ERRORS,
  hasContacts,
  minorToUsd,
  packageIssues,
  priceRange,
  requestExpiresAt,
  reviewOpen,
  serviceSlug,
  sortPackages,
  usdToMinor,
} from "../service/rules";
import { statusAfterEdit } from "../service/listing-service";

const description =
  "Свёрстанный и выложенный лендинг по вашему макету: адаптив, форма заявки, базовая аналитика и выкладка на Vercel.";

function service(overrides: Partial<ServiceInput> = {}): ServiceInput {
  return serviceInput.parse({
    title: "Сделаю лендинг на Next.js",
    category: "development",
    description,
    buyerNeeds: "Макет и тексты",
    languages: ["ru", "EN"],
    skillSlugs: ["react"],
    links: ["https://example.com/case"],
    packages: [
      {
        tier: "basic",
        price: "450",
        deliveryDays: 7,
        revisions: 2,
        includes: ["До 5 блоков"],
      },
    ],
    ...overrides,
  });
}

describe("contacts in text (28.3)", () => {
  it("finds emails, links, phones and @handles", () => {
    expect(hasContacts("пишите на ada@example.com")).toBe(true);
    expect(hasContacts("мой сайт https://ada.dev")).toBe(true);
    expect(hasContacts("t.me/ada_dev")).toBe(true);
    expect(hasContacts("звоните +7 999 123-45-67")).toBe(true);
    expect(hasContacts("Telegram: @ada_dev")).toBe(true);
  });

  it("leaves plain work text alone", () => {
    expect(
      hasContacts("Вёрстка на Next.js и Node.js, 5 блоков, 2 правки"),
    ).toBe(false);
    expect(hasContacts("Socket.IO и ASP.NET")).toBe(false);
    expect(hasContacts("Срок 7 дней, цена $450")).toBe(false);
  });

  it("names every field that carries contacts", () => {
    const input = service({
      buyerNeeds: "Доступ, пишите @ada_dev",
      packages: [
        {
          tier: "basic",
          price: "450",
          deliveryDays: 7,
          revisions: 2,
          includes: ["До 5 блоков", "Связь на ada@example.com"],
        },
      ],
    });
    expect(contactFields(input)).toEqual([
      "buyerNeeds",
      "packages.0.includes.1",
    ]);
  });

  it("rejects a service with contacts with 422 and the fields", () => {
    const input = service({
      description: `${description} Пишите ada@example.com`,
    });
    try {
      assertServiceRules(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(422);
      expect((error as HttpError).code).toBe(FREELANCE_ERRORS.contactsInText);
      expect((error as HttpError).details).toEqual({ fields: ["description"] });
    }
  });
});

describe("money in cents (D19)", () => {
  it("parses dollars into cents and back", () => {
    expect(usdToMinor("450")).toBe(BigInt(45000));
    expect(usdToMinor("450.5")).toBe(BigInt(45050));
    expect(usdToMinor("450.05")).toBe(BigInt(45005));
    expect(minorToUsd(BigInt(45000))).toBe("450");
    expect(minorToUsd(BigInt(45050))).toBe("450.50");
    expect(minorToUsd(BigInt(45005))).toBe("450.05");
  });

  it("rejects amounts the schema does not know", () => {
    const bad = ["450,50", "-1", "1e3", "4.555", ""];
    for (const price of bad) {
      const parsed = serviceInput.safeParse({
        ...service(),
        packages: [
          {
            tier: "basic",
            price,
            deliveryDays: 7,
            revisions: 2,
            includes: ["x"],
          },
        ],
      });
      expect(parsed.success, price).toBe(false);
    }
  });
});

describe("packages (28.3)", () => {
  it("needs basic, each tier once, price $10–$20 000", () => {
    expect(packageIssues(service().packages)).toEqual([]);
    expect(
      packageIssues([
        {
          tier: "standard",
          price: "9.99",
          deliveryDays: 7,
          revisions: 1,
          includes: ["x"],
        },
        {
          tier: "standard",
          price: "20000.01",
          deliveryDays: 7,
          revisions: 1,
          includes: ["x"],
        },
      ]),
    ).toEqual([
      { path: "packages.0.price", problem: "price_out_of_range" },
      { path: "packages.1.tier", problem: "duplicate_tier" },
      { path: "packages.1.price", problem: "price_out_of_range" },
      { path: "packages", problem: "basic_required" },
    ]);
    expect(
      packageIssues([
        {
          tier: "basic",
          price: "10",
          deliveryDays: 1,
          revisions: 0,
          includes: ["x"],
        },
        {
          tier: "pro",
          price: "20000",
          deliveryDays: 90,
          revisions: 10,
          includes: ["x"],
        },
      ]),
    ).toEqual([]);
  });

  it("keeps tier order whatever order they came in", () => {
    const sorted = sortPackages([
      { tier: "pro" },
      { tier: "basic" },
      { tier: "standard" },
    ] as const);
    expect(sorted.map((pkg) => pkg.tier)).toEqual(["basic", "standard", "pro"]);
  });

  it("refuses a service without packages or with four", () => {
    expect(serviceInput.safeParse({ ...service(), packages: [] }).success).toBe(
      false,
    );
    const pkg = {
      tier: "basic",
      price: "10",
      deliveryDays: 1,
      revisions: 0,
      includes: ["x"],
    };
    expect(
      serviceInput.safeParse({ ...service(), packages: [pkg, pkg, pkg, pkg] })
        .success,
    ).toBe(false);
  });
});

describe("service shape (28.3)", () => {
  it("lower-cases languages and keeps https links only", () => {
    expect(service().languages).toEqual(["ru", "en"]);
    expect(
      serviceInput.safeParse({ ...service(), links: ["http://example.com"] })
        .success,
    ).toBe(false);
    expect(
      serviceInput.safeParse({ ...service(), links: ["javascript:alert(1)"] })
        .success,
    ).toBe(false);
    expect(
      serviceInput.safeParse({ ...service(), links: ["https://localhost"] })
        .success,
    ).toBe(false);
  });

  it("checks title and description length", () => {
    expect(
      serviceInput.safeParse({ ...service(), title: "Лендинг" }).success,
    ).toBe(false);
    expect(
      serviceInput.safeParse({ ...service(), description: "Коротко" }).success,
    ).toBe(false);
  });

  it("gives a readable slug with a stable hash", () => {
    const id = "6f1c2c1e-6d0a-4f43-9d55-2a1b8b6c0d11";
    const slug = serviceSlug(id, "Сделаю лендинг на Next.js!");
    expect(slug).toMatch(/^сделаю-лендинг-на-next-js-[0-9a-f]{6}$/);
    expect(serviceSlug(id, "Сделаю лендинг на Next.js!")).toBe(slug);
    expect(serviceSlug(id, "!!!")).toMatch(/^service-[0-9a-f]{6}$/);
  });

  it("sends an edited published or paused service back to moderation", () => {
    expect(statusAfterEdit("published")).toBe("pending");
    expect(statusAfterEdit("paused")).toBe("pending");
    expect(statusAfterEdit("rejected")).toBe("draft");
    expect(statusAfterEdit("draft")).toBe("draft");
    expect(statusAfterEdit("pending")).toBe("pending");
  });
});

describe("request and review input (28.4, 28.5)", () => {
  const serviceId = "6f1c2c1e-6d0a-4f43-9d55-2a1b8b6c0d11";

  it("needs a real task and drops an empty wantedBy", () => {
    expect(
      requestInput.safeParse({
        serviceId,
        tier: "basic",
        task: "Короткая задача",
      }).success,
    ).toBe(false);
    const ok = requestInput.parse({
      serviceId,
      tier: "basic",
      task: "Нужен лендинг для B2B SaaS: 5 блоков и форма",
      wantedBy: "  ",
    });
    expect(ok.wantedBy).toBeUndefined();
  });

  it("keeps ratings between 1 and 5", () => {
    expect(
      reviewInput.safeParse({ orderId: serviceId, rating: 0 }).success,
    ).toBe(false);
    expect(
      reviewInput.safeParse({ orderId: serviceId, rating: 6 }).success,
    ).toBe(false);
    expect(reviewInput.parse({ orderId: serviceId, rating: 5 }).body).toBe("");
  });
});

describe("timers (D447)", () => {
  const at = new Date("2026-10-15T12:00:00.000Z");

  it("gives 72 hours to answer and 7 days to accept", () => {
    expect(requestExpiresAt(at).toISOString()).toBe("2026-10-18T12:00:00.000Z");
    expect(autoCompleteAt(at).toISOString()).toBe("2026-10-22T12:00:00.000Z");
  });

  it("keeps the review open for 14 days", () => {
    expect(reviewOpen(at, new Date("2026-10-29T12:00:00.000Z"))).toBe(true);
    expect(reviewOpen(at, new Date("2026-10-29T12:00:00.001Z"))).toBe(false);
    expect(reviewOpen(null, at)).toBe(false);
  });
});

describe("contacts open from accepted on (28.7)", () => {
  it("opens only for accepted and later, never for closed requests", () => {
    expect(contactsOpen("sent")).toBe(false);
    expect(contactsOpen("accepted")).toBe(true);
    expect(contactsOpen("in_progress")).toBe(true);
    expect(contactsOpen("delivered")).toBe(true);
    expect(contactsOpen("completed")).toBe(true);
    expect(contactsOpen("declined")).toBe(false);
    expect(contactsOpen("cancelled")).toBe(false);
    expect(contactsOpen("expired")).toBe(false);
  });
});

describe("price range for Spoki (28.8)", () => {
  it("returns only numbers that exist", () => {
    expect(priceRange([])).toBeNull();
    expect(priceRange([BigInt(45000)])).toEqual({
      count: 1,
      minMinor: BigInt(45000),
      medianMinor: BigInt(45000),
      maxMinor: BigInt(45000),
    });
    expect(priceRange([BigInt(140000), BigInt(30000), BigInt(65000)])).toEqual({
      count: 3,
      minMinor: BigInt(30000),
      medianMinor: BigInt(65000),
      maxMinor: BigInt(140000),
    });
    expect(
      priceRange([BigInt(30000), BigInt(60000), BigInt(70000), BigInt(140000)])
        ?.medianMinor,
    ).toBe(BigInt(65000));
  });
});
