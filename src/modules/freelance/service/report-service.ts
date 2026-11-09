import { z } from "zod";
import { recordAudit } from "../../../platform";
import { HttpError, notFound, validationError } from "@intgetion/kit";
import { fileReport } from "../../../platform";
import * as repo from "../repo/freelance-repo";
import { getOrderForParty } from "./order-service";
import { FREELANCE_ERRORS } from "./rules";

/** Reasons a person may give about a service or an order (28.9). */
export const FREELANCE_REPORT_REASONS = [
  "scam",
  "spam",
  "wrong_info",
  "inappropriate",
  "other",
] as const;

export const freelanceReportInput = z
  .object({
    reason: z.enum(FREELANCE_REPORT_REASONS),
    details: z.string().trim().max(1000).optional(),
  })
  .strict();

/** This many open complaints take the service out of the catalog (28.9). */
export const REPORT_HOLD_THRESHOLD = 3;

export type FreelanceReportResult = {
  reportId: string;
  /** True when this complaint took the service out of the catalog. */
  held: boolean;
};

/**
 * A complaint about a published service (anyone signed in but its owner) or
 * about an order (only its two sides; a stranger gets 404). Rate limit is
 * the route's job (`report`). Three open complaints hold the service in
 * `pending` until a moderator decides; that move is in `audit_logs`.
 */
export async function reportFreelance(
  userId: string,
  target: { kind: "service" | "order"; id: string },
  raw: unknown,
  ip: string | null = null,
  now = new Date(),
): Promise<FreelanceReportResult> {
  const parsed = freelanceReportInput.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues);
  let serviceId: string | null;
  if (target.kind === "service") {
    const service = await repo.findServiceById(target.id);
    if (!service || !["published", "paused"].includes(service.status)) {
      throw notFound();
    }
    if (service.sellerId === userId) {
      throw new HttpError(
        409,
        FREELANCE_ERRORS.ownService,
        "This is your own service",
      );
    }
    serviceId = service.id;
  } else {
    const order = await getOrderForParty(userId, target.id);
    serviceId = order.serviceId;
  }
  const { reportId } = await fileReport(
    userId,
    target.kind === "service" ? "freelance_service" : "freelance_order",
    target.id,
    { reason: parsed.data.reason, details: parsed.data.details ?? null },
  );
  if (!serviceId) return { reportId, held: false };
  const open = await repo.countOpenServiceReports(serviceId);
  if (open < REPORT_HOLD_THRESHOLD) return { reportId, held: false };
  const held = await repo.holdForReports(serviceId, ["reports_threshold"], now);
  if (held) {
    await recordAudit({
      actorId: null,
      action: "freelance.service_held",
      entityType: "freelance_service",
      entityId: serviceId,
      diff: { openReports: open, to: "pending" },
      ip,
    });
  }
  return { reportId, held: held !== null };
}
