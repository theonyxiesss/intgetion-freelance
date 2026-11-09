import { recordAudit } from "../../../platform";
import { notFound, validationError } from "@intgetion/kit";
import {
  getSellerStorefronts,
  hasCandidateProfile,
} from "../../../platform";
import { getCompaniesForUser } from "../../../platform";
import { getOwnContacts } from "../../../platform";
import { lookupLoginEmail } from "../../../platform";
import * as repo from "../repo/freelance-repo";
import { transitionInput } from "../schemas";
import {
  getOrderForParty,
  orderHistory,
  transitionOrder,
  type PartyOrder,
} from "./order-service";

/**
 * Moves an order on behalf of whoever is signed in. The side comes from the
 * session, never from the body; a stranger gets 404 (28.4).
 */
export async function moveOrder(
  userId: string,
  orderId: string,
  raw: unknown,
  now = new Date(),
): Promise<repo.OrderRow> {
  const parsed = transitionInput.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const order = await getOrderForParty(userId, orderId);
  return transitionOrder(
    {
      orderId: order.id,
      to: parsed.data.to,
      actor: order.side,
      actorId: userId,
      deliveryUrl: parsed.data.deliveryUrl,
    },
    now,
  );
}

export type ContactCard = {
  name: string | null;
  company: string | null;
  email: string | null;
  telegram: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
};

async function contactCard(
  userId: string,
  company: string | null,
): Promise<ContactCard> {
  const profile = (await hasCandidateProfile(userId))
    ? await getOwnContacts(userId)
    : null;
  const name =
    (await getSellerStorefronts([userId])).get(userId)?.displayName ?? null;
  return {
    name,
    company,
    email: profile?.email ?? (await lookupLoginEmail(userId)),
    telegram: profile?.telegram ?? null,
    phone: profile?.phone ?? null,
    linkedinUrl: profile?.linkedinUrl ?? null,
    websiteUrl: profile?.websiteUrl ?? null,
  };
}

async function companyName(
  userId: string | null,
  companyId: string | null,
): Promise<string | null> {
  if (!userId || !companyId) return null;
  const companies = await getCompaniesForUser(userId);
  return companies.find((company) => company.id === companyId)?.name ?? null;
}

export type OrderView = PartyOrder & {
  serviceSlug: string | null;
  buyerCompany: string | null;
  history: Awaited<ReturnType<typeof orderHistory>>;
  reviewed: boolean;
  /** The other side's contacts, only from `accepted` on (28.7). */
  counterpart: ContactCard | null;
};

/**
 * What the order page shows to one side. Reading the other side's contacts
 * is written to the audit log, as with candidate contacts (D16).
 */
export async function getOrderView(
  userId: string,
  orderId: string,
  ip?: string | null,
): Promise<OrderView> {
  const order = await getOrderForParty(userId, orderId);
  const service = order.serviceId
    ? await repo.findServiceById(order.serviceId)
    : null;
  const buyerCompany = await companyName(order.buyerId, order.buyerCompanyId);
  const history = await orderHistory(userId, order.id);
  let counterpart: ContactCard | null = null;
  const otherId = order.side === "seller" ? order.buyerId : order.sellerId;
  if (order.contactsOpen && otherId) {
    counterpart = await contactCard(
      otherId,
      order.side === "seller" ? buyerCompany : null,
    );
    await recordAudit({
      actorId: userId,
      action: "contacts.read",
      entityType: "freelance_order",
      entityId: order.id,
      diff: { status: order.status, side: order.side },
      ip,
    });
  }
  return {
    ...order,
    serviceSlug: service?.status === "published" ? service.slug : null,
    buyerCompany,
    history,
    counterpart,
    reviewed: Boolean(await repo.findReviewByOrder(order.id)),
  };
}

/** Companies the signed-in person may send a request from (28.2). */
export async function companiesToOrderFrom(
  userId: string,
): Promise<{ id: string; name: string }[]> {
  return (await getCompaniesForUser(userId)).map((company) => ({
    id: company.id,
    name: company.name,
  }));
}

/** Throws 404 unless the id is a uuid; route params are untrusted. */
export function assertOrderId(id: string): void {
  if (!repo.isUuid(id)) throw notFound();
}
