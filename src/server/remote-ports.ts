import { HttpError, logger } from "@intgetion/kit";
import type { FreelancePorts, SellerStorefront } from "../ports";

export type Endpoint = { url: string; token: string };

export type RemoteConfig = {
  /** The platform answers for the modules freelance talks to. */
  platform: Endpoint;
  /** Crypto checkout switch (billing flag), read once at start. */
  cryptoCheckout: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Every port goes to one platform callback, `POST /api/internal/freelance/:op`,
 * which hands it to the owner (candidates, contacts, companies, taxonomy,
 * users, billing, notifications, moderation, audit, rate limits, Telegram).
 * An owner's 4xx keeps its status and code. The moderation queue item is
 * written over HTTP after the freelance change; the platform wiring passes
 * the transaction in-process.
 */
export function httpFreelancePorts(config: RemoteConfig): FreelancePorts {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;
  const base = config.platform.url.replace(/\/+$/, "");

  async function call<T>(op: string, body: unknown): Promise<T> {
    const response = await doFetch(`${base}/api/internal/freelance/${op}`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.platform.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await response.json().catch(() => null)) as
      | { result?: T; error?: { code: string; message: string } }
      | null;
    if (!response.ok) {
      if (response.status < 500 && json?.error) {
        throw new HttpError(response.status, json.error.code as never, json.error.message, undefined);
      }
      throw new Error(`freelance/${op} answered ${response.status}`);
    }
    return json?.result as T;
  }

  return {
    hasCandidateProfile: (userId) => call("has-candidate-profile", { userId }),
    sellerStorefronts: async (userIds) => {
      if (!userIds.length) return new Map();
      const rows = await call<SellerStorefront[]>("seller-storefronts", { userIds });
      return new Map(rows.map((row) => [row.userId, row]));
    },
    ownContacts: (userId) => call("own-contacts", { userId }),
    findMemberRole: (companyId, userId) => call("member-role", { companyId, userId }),
    companiesForUser: (userId) => call("companies-for-user", { userId }),
    activeSkills: () => call("active-skills", {}),
    matchSkillSlug: (raw) => call("match-skill", { raw }),
    accountWallet: (userId) => call("account-wallet", { userId }),
    isSanctionedAddress: (address) => call("sanctioned", { address }),
    cryptoCheckoutOn: () => config.cryptoCheckout,
    verifiedPayerWallet: (userId, now) => call("payer-wallet", { userId, now: now.toISOString() }),
    notify: async (type, recipientIds, payload) => {
      try {
        await call("notify", { type, recipientIds, payload });
      } catch (error) {
        logger.warn({ err: error, type }, "freelance: notice failed");
      }
    },
    loginEmail: (userId) => call("login-email", { userId }),
    enqueueModeration: (input) => call("enqueue-moderation", input),
    fileReport: (reporterId, entityType, entityId, input) =>
      call("file-report", { reporterId, entityType, entityId, ...input }),
    countOpenReports: (about) => call("count-open-reports", about),
    audit: (entry) => call("audit", entry),
    rateLimit: (bucket, subject) => call("rate-limit", { bucket, subject }),
    notifyPlatformOwners: (subject, text) => call("notify-owners", { subject, text }),
    telegram: {
      userIdForTelegramId: (telegramId) => call("telegram-user", { telegramId }),
      sendMessage: (_token, chatId, text, button) => call("telegram-send", { chatId, text, button }),
      sendLinks: (_token, chatId, text, links) => call("telegram-links", { chatId, text, links }),
      answerCallback: (_token, callbackId) => call("telegram-answer", { callbackId }),
    },
  };
}
