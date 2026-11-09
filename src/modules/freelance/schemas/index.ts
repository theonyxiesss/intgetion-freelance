import { z } from "zod";
import {
  FREELANCE_ORDER_STATUSES,
  FREELANCE_CATEGORIES,
  FREELANCE_LIMITS as L,
  FREELANCE_TIERS,
} from "../../../config/freelance";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Only https links with a real host; nothing else is stored (28.3, 28.4). */
export const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https:\/\/\S+$/)
  .refine(isHttpsUrl);

/** Whole dollars or dollars with cents, as typed: "450", "450.5", "450.50". */
const usdAmount = z
  .string()
  .trim()
  .regex(/^\d{1,7}(?:\.\d{1,2})?$/);

export const packageInput = z.object({
  tier: z.enum(FREELANCE_TIERS),
  price: usdAmount,
  deliveryDays: z.number().int().min(L.daysMin).max(L.daysMax),
  revisions: z.number().int().min(0).max(L.revisionsMax),
  includes: z
    .array(text(1, L.includeItemMax))
    .min(L.includesMin)
    .max(L.includesMax),
});
export type PackageInput = z.infer<typeof packageInput>;

/** A service as the freelancer writes it (28.3). Rules beyond shape live in service/rules. */
export const serviceInput = z.object({
  title: text(L.titleMin, L.titleMax),
  category: z.enum(FREELANCE_CATEGORIES),
  description: text(L.descriptionMin, L.descriptionMax),
  buyerNeeds: z.string().trim().max(L.buyerNeedsMax).default(""),
  languages: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z]{2}$/),
    )
    .min(1)
    .max(L.languagesMax),
  skillSlugs: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    )
    .max(L.skillsMax)
    .default([]),
  links: z.array(httpsUrl).max(L.linksMax).default([]),
  packages: z.array(packageInput).min(1).max(FREELANCE_TIERS.length),
});
export type ServiceInput = z.infer<typeof serviceInput>;

export const requestInput = z.object({
  serviceId: z.uuid(),
  tier: z.enum(FREELANCE_TIERS),
  task: text(L.taskMin, L.taskMax),
  wantedBy: z
    .string()
    .trim()
    .max(L.wantedByMax)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /** Send as this company; the sender must be its member. */
  companyId: z.uuid().optional(),
});
export type RequestInput = z.infer<typeof requestInput>;

export const reviewInput = z.object({
  orderId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(L.reviewMax).default(""),
});
export type ReviewInput = z.infer<typeof reviewInput>;

export const deliveryUrl = httpsUrl;

/** `POST /api/freelance/orders/:id/transition`; the side comes from the session. */
export const transitionInput = z
  .object({
    to: z.enum(FREELANCE_ORDER_STATUSES),
    deliveryUrl: z.string().trim().max(500).optional(),
  })
  .strict();
export type TransitionInput = z.infer<typeof transitionInput>;

export const sellerInput = z.object({ accepting: z.boolean() }).strict();
export const pauseInput = z.object({ paused: z.boolean() }).strict();
