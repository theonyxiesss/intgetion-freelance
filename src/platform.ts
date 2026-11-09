/**
 * The names freelance code used from other modules, now answered by ports.
 * Keeping the names keeps the business code as it was on the platform.
 */
import { freelancePorts, type AuditEntry } from "./ports";

export type { SellerStorefront } from "./ports";

export const hasCandidateProfile = (userId: string) => freelancePorts().hasCandidateProfile(userId);
export const getSellerStorefronts = (userIds: readonly string[]) =>
  freelancePorts().sellerStorefronts(userIds);
export const getOwnContacts = (userId: string) => freelancePorts().ownContacts(userId);
export const findMemberRole = (companyId: string, userId: string) =>
  freelancePorts().findMemberRole(companyId, userId);
export const getCompaniesForUser = (userId: string) => freelancePorts().companiesForUser(userId);
export const listActiveSkills = () => freelancePorts().activeSkills();
export const matchSkillSlug = (raw: string) => freelancePorts().matchSkillSlug(raw);
export const readAccountWallet = (userId: string) => freelancePorts().accountWallet(userId);
export const isSanctionedAddress = (address: string) => freelancePorts().isSanctionedAddress(address);
export const cryptoCheckoutOn = () => freelancePorts().cryptoCheckoutOn();
export const verifiedPayerWallet = (userId: string, now = new Date()) =>
  freelancePorts().verifiedPayerWallet(userId, now);
export const safeNotify = (type: string, recipientIds: readonly string[], payload: unknown) =>
  freelancePorts().notify(type, recipientIds, payload);
export const lookupLoginEmail = (userId: string) => freelancePorts().loginEmail(userId);
export const fileReport = (
  reporterId: string,
  entityType: "freelance_service" | "freelance_order",
  entityId: string,
  input: { reason: string; details?: string | null },
) => freelancePorts().fileReport(reporterId, entityType, entityId, input);
export const recordAudit = (entry: AuditEntry) => freelancePorts().audit(entry);
export const enforceRateLimit = (bucket: string, subject: string) =>
  freelancePorts().rateLimit(bucket, subject);
export const notifyPlatformOwners = (subject: string, text: string) =>
  freelancePorts().notifyPlatformOwners(subject, text);
export const userIdForTelegramId = (telegramId: number) =>
  freelancePorts().telegram.userIdForTelegramId(telegramId);
export const sendTelegramMessage = (
  token: string,
  chatId: number,
  text: string,
  button?: { label: string; data: string },
) => freelancePorts().telegram.sendMessage(token, chatId, text, button);
export const sendTelegramLinks = (
  token: string,
  chatId: number,
  text: string,
  links: { label: string; url: string }[],
) => freelancePorts().telegram.sendLinks(token, chatId, text, links);
export const answerTelegramCallback = (token: string, callbackId: string) =>
  freelancePorts().telegram.answerCallback(token, callbackId);

/** Order notices the notifications catalog knows (copy of its list). */
export const FREELANCE_ORDER_NOTICES = [
  "accepted",
  "declined",
  "cancelled",
  "expired",
  "started",
  "revision",
  "delivered",
  "completed",
] as const;
export type FreelanceOrderNotice = (typeof FREELANCE_ORDER_NOTICES)[number];
