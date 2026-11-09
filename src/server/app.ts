import { z, ZodError } from "zod";
import { HttpError, httpErrorResponse, notFound, reportError, validationError } from "@intgetion/kit";
import { FREELANCE_CATEGORIES, type FreelanceCategory } from "../config/freelance";
import { freelancePorts } from "../ports";
import * as freelance from "../modules/freelance/service";
import { isUuid, requireCaller, requireServiceToken } from "./auth";

export type AppConfig = { serviceToken: string };

const MAX_JSON = 64 * 1024;

const draftPatch = z
  .object({
    draftId: z.uuid().optional(),
    patch: z.record(z.string(), z.unknown()),
    replacePackages: z.boolean().optional(),
  })
  .strict();
const draftAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), draftId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal("reset"), draftId: z.uuid().optional() }).strict(),
]);
const proposalAction = z.object({ action: z.enum(["accept", "decline", "withdraw"]) }).strict();
const inviteBody = z.object({ sellerId: z.uuid() }).strict();
const confirmBody = z.object({ txHash: z.string().max(100).optional() });

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_JSON) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Body too large");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw validationError([{ path: [], message: "invalid_json" }]);
  }
}
const parsed = async <T>(request: Request, schema: z.ZodType<T>) => schema.parse(await readBody(request));

function id(value: string | undefined): string {
  if (!value || !isUuid(value)) throw notFound();
  return value;
}

/** bigint money values travel as strings, as on the platform. */
function json(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
    { status, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}

const rate = (bucket: string, userId: string) => freelancePorts().rateLimit(bucket, userId);
const ip = (request: Request) => request.headers.get("x-client-ip") ?? "";
const user = (request: Request) => requireCaller(request).userId;

type Route = {
  method: string;
  pattern: RegExp;
  run: (request: Request, params: string[], url: URL) => Promise<Response>;
};

const routes: Route[] = [
  // Cron: order timers, payment rechecks, expired tasks.
  {
    method: "POST",
    pattern: /^\/v1\/tasks\/run-timers$/,
    run: async () =>
      json({
        orders: await freelance.runOrderTimers(),
        payments: await freelance.recheckOrderPayments(),
        tasksExpired: await freelance.expireOldTasks(),
      }),
  },
  // Public reads.
  {
    method: "GET",
    pattern: /^\/v1\/services\/by-slug\/([^/]+)$/,
    run: async (_r, [slug]) => {
      const service = await freelance.getPublishedService(decodeURIComponent(slug ?? ""));
      if (!service) throw notFound();
      return json({ service });
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/services\/([^/]+)\/reviews$/,
    run: async (_r, [serviceId]) => json({ reviews: await freelance.listPublicReviews(id(serviceId)) }),
  },
  {
    method: "GET",
    pattern: /^\/v1\/open-tasks$/,
    run: async (_r, _p, url) => {
      const value = url.searchParams.get("category") ?? "";
      const category = (FREELANCE_CATEGORIES as readonly string[]).includes(value)
        ? (value as FreelanceCategory)
        : undefined;
      return json({ items: await freelance.listOpenTasks({ category }) });
    },
  },
  // Seller.
  {
    method: "POST",
    pattern: /^\/v1\/seller$/,
    run: async (request) => {
      const me = user(request);
      const input = await parsed(request, freelance.sellerInput);
      const seller = await freelance.setAcceptingOrders(me, input.accepting);
      return json({ seller: { accepting: seller.accepting } });
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/service-draft$/,
    run: async (request, _p, url) =>
      json(await freelance.readServiceBriefDraft(user(request), url.searchParams.get("id") ?? undefined)),
  },
  {
    method: "PATCH",
    pattern: /^\/v1\/service-draft$/,
    run: async (request) => {
      const me = user(request);
      return json(await freelance.patchServiceBriefDraft(me, await parsed(request, draftPatch)));
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/service-draft$/,
    run: async (request) => {
      const me = user(request);
      const input = await parsed(request, draftAction);
      return input.action === "reset"
        ? json(await freelance.resetServiceBriefDraft(me, input.draftId))
        : json(await freelance.confirmServiceBriefDraft(me, input.draftId), 201);
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/services$/,
    run: async (request) => {
      const me = user(request);
      const service = await freelance.createService(me, await readBody(request));
      return json({ service: { id: service.id, slug: service.slug, status: service.status } }, 201);
    },
  },
  {
    method: "PUT",
    pattern: /^\/v1\/services\/([^/]+)$/,
    run: async (request, [serviceId]) => {
      const me = user(request);
      const service = await freelance.updateService(me, id(serviceId), await readBody(request));
      return json({ service: { id: service.id, slug: service.slug, status: service.status } });
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/services\/([^/]+)\/submit$/,
    run: async (request, [serviceId]) => {
      const service = await freelance.submitService(user(request), id(serviceId));
      return json({ service: { id: service.id, status: service.status } });
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/services\/([^/]+)\/pause$/,
    run: async (request, [serviceId]) => {
      const me = user(request);
      const input = await parsed(request, freelance.pauseInput);
      const service = await freelance.setServicePaused(me, id(serviceId), input.paused);
      return json({ service: { id: service.id, status: service.status } });
    },
  },
  // Reports (rate limit after input validation, before the write).
  {
    method: "POST",
    pattern: /^\/v1\/(services|orders)\/([^/]+)\/report$/,
    run: async (request, [kind, targetId]) => {
      const me = user(request);
      const input = await parsed(request, freelance.freelanceReportInput);
      await rate("report", me);
      const result = await freelance.reportFreelance(
        me,
        { kind: kind === "services" ? "service" : "order", id: id(targetId) },
        input,
        ip(request),
      );
      return json({ reportId: result.reportId }, 201);
    },
  },
  // Orders.
  {
    method: "POST",
    pattern: /^\/v1\/requests$/,
    run: async (request) => {
      const me = user(request);
      await rate("freelanceRequest", me);
      const order = await freelance.sendRequest(me, await readBody(request));
      return json({ order: { id: order.id, status: order.status } }, 201);
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/orders\/([^/]+)$/,
    run: async (request, [orderId]) => json({ order: await freelance.getOrderForParty(user(request), id(orderId)) }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/orders\/([^/]+)\/transition$/,
    run: async (request, [orderId]) => {
      const me = user(request);
      const order = await freelance.moveOrder(me, id(orderId), await readBody(request));
      return json({ order: { id: order.id, status: order.status } });
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/orders\/([^/]+)\/messages$/,
    run: async (request, [orderId]) => json(await freelance.getRoomFeed(user(request), id(orderId))),
  },
  {
    method: "POST",
    pattern: /^\/v1\/orders\/([^/]+)\/messages$/,
    run: async (request, [orderId]) => {
      const me = user(request);
      return json(await freelance.postRoomMessage(me, id(orderId), await readBody(request)), 201);
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/orders\/([^/]+)\/payment$/,
    run: async (request, [orderId]) => {
      const me = user(request);
      await rate("billingOrder", me);
      return json(await freelance.createOrderPayment(me, id(orderId), await readBody(request)));
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/payments\/([^/]+)$/,
    run: async (request, [paymentId]) => json(await freelance.refreshOrderPayment(user(request), id(paymentId))),
  },
  {
    method: "POST",
    pattern: /^\/v1\/payments\/([^/]+)\/confirm$/,
    run: async (request, [paymentId]) => {
      const me = user(request);
      const body = await parsed(request, confirmBody);
      await rate("billingConfirm", me);
      return json(await freelance.confirmOrderPayment(me, id(paymentId), body.txHash));
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/reviews$/,
    run: async (request) => {
      const review = await freelance.leaveReview(user(request), await readBody(request));
      return json({ review: { id: review.id, rating: review.rating } }, 201);
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/client-reviews$/,
    run: async (request) => {
      const review = await freelance.leaveClientReview(user(request), await readBody(request));
      return json({ review: { id: review.id, rating: review.rating } }, 201);
    },
  },
  // Client tasks.
  {
    method: "POST",
    pattern: /^\/v1\/client-tasks$/,
    run: async (request) => {
      const me = user(request);
      await rate("freelanceTask", me);
      const task = await freelance.createTask(me, await readBody(request));
      return json({ task: { id: task.id, status: task.status } }, 201);
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/client-tasks\/([^/]+)\/proposals$/,
    run: async (request, [taskId]) =>
      json({ proposals: await freelance.listTaskProposals(user(request), id(taskId)) }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/client-tasks\/([^/]+)\/close$/,
    run: async (request, [taskId]) => {
      const task = await freelance.closeTask(user(request), id(taskId));
      return json({ task: { id: task.id, status: task.status } });
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/client-tasks\/([^/]+)\/invite$/,
    run: async (request, [taskId]) => {
      const me = user(request);
      const body = await parsed(request, inviteBody);
      await rate("freelanceInvite", me);
      await freelance.inviteSeller(me, id(taskId), body.sellerId);
      return json({ invited: true }, 201);
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/proposals$/,
    run: async (request) => {
      const me = user(request);
      await rate("freelanceProposal", me);
      const proposal = await freelance.sendProposal(me, await readBody(request));
      return json({ proposal: { id: proposal.id, status: proposal.status } }, 201);
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/proposals\/([^/]+)$/,
    run: async (request, [proposalId]) => {
      const me = user(request);
      const target = id(proposalId);
      const { action } = await parsed(request, proposalAction);
      if (action === "accept") {
        const order = await freelance.acceptProposal(me, target);
        return json({ order: { id: order.id, status: order.status } });
      }
      const row = action === "decline" ? await freelance.declineProposal(me, target) : await freelance.withdrawProposal(me, target);
      return json({ proposal: { id: row.id, status: row.status } });
    },
  },
  // Moderation decides a service or a task (moderation's applyEffect).
  {
    method: "POST",
    pattern: /^\/v1\/moderation\/(services|client-tasks)\/([^/]+)$/,
    run: async (request, [kind, targetId]) => {
      const body = await parsed(
        request,
        z.object({ decision: z.enum(["publish", "reject"]), note: z.string().max(1000).nullish() }).strict(),
      );
      if (kind === "services") {
        await freelance.decideServiceModeration(id(targetId), body.decision, body.note ?? null);
      } else {
        await freelance.decideTaskModeration(id(targetId), body.decision, body.note ?? null);
      }
      return json({ ok: true });
    },
  },
];

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return httpErrorResponse(error);
  if (error instanceof ZodError) return httpErrorResponse(validationError(error.issues));
  reportError(error, "freelance-service");
  return Response.json({ error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
}

export function createApp(config: AppConfig) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true });
      requireServiceToken(request, config.serviceToken);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        return await route.run(request, match.slice(1), url);
      }
      throw notFound();
    } catch (error) {
      return toResponse(error);
    }
  };
}
