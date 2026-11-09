/**
 * PII never reaches the LLM (12.4, D17): user text is redacted, and
 * structured data passes an explicit field allowlist.
 */

// Plain and obfuscated emails: a@b.co, a [at] b [dot] co, a(at)b.co.
const EMAIL =
  /[A-Za-z0-9._%+-]+(?:@|\s?[[(]\s?(?:at|собака)\s?[\])]\s?)[A-Za-z0-9-]+(?:(?:\.|\s?[[(]\s?(?:dot|точка)\s?[\])]\s?)[A-Za-z0-9-]+)*(?:\.|\s?[[(]\s?(?:dot|точка)\s?[\])]\s?)[A-Za-z]{2,}/giu;

// Scheme or www links, and bare host/path links such as t.me/name.
const URL_WITH_SCHEME = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const BARE_TLDS =
  "com|org|net|io|me|dev|app|co|ai|ru|su|рф|by|kz|ua|uk|de|fr|es|it|nl|pl|eu|us|ca|au|in|jp|cn|info|biz|xyz|site|online|tech|page|link|ly|gg|tv|to|sh";
const BARE_URL = new RegExp(
  String.raw`(?<![\w@.])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${BARE_TLDS})(?:\/[^\s<>"')\]]*)?(?![\w@])`,
  "giu",
);
// Technology names that look like hosts: ASP.NET, ADO.NET, VB.NET, Socket.IO.
const TECH_HOSTS = /^(?:(?:asp|ado|vb)\.net|socket\.io)$/i;

// International numbers, and local formats with grouped digits.
const PHONE = new RegExp(
  [
    String.raw`\+\d[\d\s().-]{7,}\d`,
    String.raw`\(\d{3,5}\)\s?\d{2,4}[\s.-]?\d{2}[\s.-]?\d{2,4}`,
    String.raw`\b[78][\s-]?\d{3}[\s-]\d{3}[\s-]?\d{2}[\s-]?\d{2}\b`,
    String.raw`\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b`,
    String.raw`\b\d{10,11}\b`,
  ].join("|"),
  "g",
);

const digitCount = (value: string) => value.replace(/\D/g, "").length;

/** Replaces emails, links and phone numbers with `[email]`, `[link]`, `[phone]`. */
export function redactPii(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(URL_WITH_SCHEME, "[link]")
    .replace(BARE_URL, (match) => (TECH_HOSTS.test(match) ? match : "[link]"))
    .replace(PHONE, (match) => {
      const digits = digitCount(match);
      return digits >= 9 && digits <= 15 ? "[phone]" : match;
    });
}

/** Keys that never go to the LLM, even inside an allowed object (D16, D17). */
const FORBIDDEN_KEYS = new Set([
  "email",
  "phone",
  "telegram",
  "whatsapp",
  "contacts",
  "contact",
  "linkedin",
  "linkedinurl",
  "github",
  "profileurl",
  "website",
  "websiteurl",
  "url",
  "applicationurl",
  "applicationemail",
  "authuid",
  "userid",
  "candidateid",
  "fullname",
  "legalname",
  "registrationnumber",
  "documents",
  "cv",
  "resume",
  "password",
  "token",
]);

const isForbidden = (key: string) =>
  FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ""));

/** `true` keeps a value, a nested spec keeps an object, `[spec]` an array of objects. */
export type FieldSpec = { [key: string]: true | FieldSpec | [FieldSpec] };

function assertSpec(spec: FieldSpec, path = "") {
  for (const [key, rule] of Object.entries(spec)) {
    if (isForbidden(key)) {
      throw new Error(`Field ${path}${key} may never be sent to the LLM`);
    }
    if (rule === true) continue;
    assertSpec(Array.isArray(rule) ? rule[0] : rule, `${path}${key}.`);
  }
}

function clean(value: unknown): unknown {
  if (typeof value === "string") return redactPii(value);
  if (Array.isArray(value)) {
    return value.filter((v) => v === null || typeof v !== "object").map(clean);
  }
  if (value !== null && typeof value === "object") return undefined;
  return value;
}

function pick(input: unknown, spec: FieldSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return out;
  }
  const source = input as Record<string, unknown>;
  for (const [key, rule] of Object.entries(spec)) {
    if (!(key in source) || source[key] === undefined) continue;
    const value = source[key];
    if (rule === true) {
      const cleaned = clean(value);
      if (cleaned !== undefined) out[key] = cleaned;
    } else if (Array.isArray(rule)) {
      if (Array.isArray(value))
        out[key] = value.map((item) => pick(item, rule[0]));
    } else if (value !== null && typeof value === "object") {
      out[key] = pick(value, rule);
    } else if (value === null) {
      out[key] = null;
    }
  }
  return out;
}

/**
 * Keeps only the allowlisted fields (recursively); strings are redacted on
 * the way. A spec that names a contact field is a programming error.
 */
export function pickLlmFields(input: unknown, spec: FieldSpec) {
  assertSpec(spec);
  return pick(input, spec);
}

/** 12.3/12.4: what the bot may know about a candidate profile. */
export const PROFILE_LLM_FIELDS = {
  headline: true,
  desiredTitles: true,
  skills: [{ slug: true, level: true, years: true }],
  experienceYears: true,
  languages: [{ lang: true, level: true }],
  timezone: true,
  workHoursStart: true,
  workHoursEnd: true,
  workDays: true,
  workFormats: true,
  employmentTypes: true,
  salaryMin: { amountMinor: true, currency: true },
  salaryMax: { amountMinor: true, currency: true },
  salaryPeriod: true,
  salaryBasis: true,
  availabilityDate: true,
  country: true,
  city: true,
  categories: true,
  minOverlapHours: true,
} satisfies FieldSpec;

/** Public job fields; the description is wrapped as untrusted separately. */
export const JOB_LLM_FIELDS = {
  id: true,
  title: true,
  category: true,
  employmentType: true,
  workFormat: true,
  location: true,
  timezoneRequired: true,
  minOverlapHours: true,
  salaryMin: { amountMinor: true, currency: true },
  salaryMax: { amountMinor: true, currency: true },
  salaryPeriod: true,
  salaryBasis: true,
  skills: [{ slug: true, weight: true }],
  languages: [{ lang: true, minLevel: true }],
  company: { name: true, status: true, isTrusted: true },
  publishedAt: true,
} satisfies FieldSpec;
