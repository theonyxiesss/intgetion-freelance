import { z } from "zod";
import { FREELANCE_CATEGORIES } from "../../../config/freelance";

/** Budget choices on /freelance, in whole dollars of the basic package. */
export const FREELANCE_BUDGETS = [200, 500, 1000, 5000] as const;
/** Term choices on /freelance, in days of the basic package. */
export const FREELANCE_TERMS = [3, 7, 14, 30] as const;
/** Work languages offered as a filter; a service may list others. */
export const FREELANCE_FILTER_LANGUAGES = [
  "en",
  "ru",
  "es",
  "pt",
  "de",
  "fr",
  "it",
] as const;
export const FREELANCE_SORTS = ["fit", "cheap", "fast"] as const;

const blankToUndefined = (value: unknown) =>
  value === "" || value === null ? undefined : value;

const oneOf = <T extends readonly number[]>(values: T) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int()
      .refine((value) => (values as readonly number[]).includes(value))
      .optional(),
  );

/** `/freelance` query string (28.11 C). Unknown or bad values are dropped. */
export const freelanceSearchQuery = z.object({
  q: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
  category: z.preprocess(
    blankToUndefined,
    z.enum(FREELANCE_CATEGORIES).optional(),
  ),
  budget: oneOf(FREELANCE_BUDGETS),
  days: oneOf(FREELANCE_TERMS),
  lang: z.preprocess(
    blankToUndefined,
    z.enum(FREELANCE_FILTER_LANGUAGES).optional(),
  ),
  sort: z.preprocess(blankToUndefined, z.enum(FREELANCE_SORTS).default("fit")),
  page: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(50).default(1),
  ),
});

export type FreelanceSearchQuery = z.infer<typeof freelanceSearchQuery>;

/** Parse what the page got; a bad value falls back to no filter at all. */
export function parseFreelanceSearch(
  raw: Record<string, string | string[] | undefined>,
): FreelanceSearchQuery {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const parsed = freelanceSearchQuery.safeParse(flat);
  if (parsed.success) return parsed.data;
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(freelanceSearchQuery.shape)) {
    const one = freelanceSearchQuery.safeParse({ [key]: flat[key] });
    if (one.success) kept[key] = flat[key];
  }
  return freelanceSearchQuery.parse(kept);
}
