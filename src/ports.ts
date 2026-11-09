/**
 * What freelance needs from other modules and the platform. In-process the
 * platform wires the real services; over HTTP see `server/remote-ports.ts`.
 */

export type SellerStorefront = {
  userId: string;
  /** "Ada L.": first name and the initial of the last word, or null. */
  displayName: string | null;
  headline: string | null;
  timezone: string | null;
};

export type OwnContacts = {
  email: string;
  phone: string | null;
  telegram: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  extra: Record<string, string>;
};

export type AccountWallet = { address: string; chainId: number | null; verifiedAt: string };

export type ActiveSkill = {
  id: string;
  slug: string;
  nameEn: string;
  nameRu: string;
  category: string;
};

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: unknown;
  ip?: string | null;
};

export type FreelancePorts = {
  /** candidates */
  hasCandidateProfile: (userId: string) => Promise<boolean>;
  sellerStorefronts: (userIds: readonly string[]) => Promise<Map<string, SellerStorefront>>;
  /** contacts: the person's own contacts (read only after the order allows it). */
  ownContacts: (userId: string) => Promise<OwnContacts | null>;
  /** companies */
  findMemberRole: (companyId: string, userId: string) => Promise<string | null>;
  companiesForUser: (userId: string) => Promise<{ id: string; name: string }[]>;
  /** taxonomy */
  activeSkills: () => Promise<ActiveSkill[]>;
  matchSkillSlug: (raw: string) => Promise<string | null>;
  /** users: the account's proven payout wallet. */
  accountWallet: (userId: string) => Promise<AccountWallet | null>;
  /** billing */
  isSanctionedAddress: (address: string) => Promise<boolean>;
  cryptoCheckoutOn: () => boolean;
  verifiedPayerWallet: (userId: string, now: Date) => Promise<{ address: string; chainId: number } | null>;
  /** notifications: failures are logged, never thrown. */
  notify: (type: string, recipientIds: readonly string[], payload: unknown) => Promise<void>;
  loginEmail: (userId: string) => Promise<string | null>;
  /** moderation: queue inside the freelance transaction; file and count reports. */
  enqueueModeration: (
    input: { entityType: string; entityId: string; reason: string; riskFlags: unknown },
    tx?: unknown,
  ) => Promise<void>;
  fileReport: (
    reporterId: string,
    entityType: "freelance_service" | "freelance_order",
    entityId: string,
    input: { reason: string; details?: string | null },
  ) => Promise<{ reportId: string }>;
  /** Open reports about the service and about the given orders of it. */
  countOpenReports: (about: { serviceId: string; orderIds: string[] }) => Promise<number>;
  /** platform */
  audit: (entry: AuditEntry) => Promise<void>;
  /** Throws a 429 HttpError when over the limit. */
  rateLimit: (bucket: string, subject: string) => Promise<void>;
  notifyPlatformOwners: (subject: string, text: string) => Promise<void>;
  /** Telegram bot (platform auth module holds the token and the linked accounts). */
  telegram: {
    userIdForTelegramId: (telegramId: number) => Promise<string | null>;
    sendMessage: (
      token: string,
      chatId: number,
      text: string,
      button?: { label: string; data: string },
    ) => Promise<void>;
    sendLinks: (token: string, chatId: number, text: string, links: { label: string; url: string }[]) => Promise<void>;
    answerCallback: (token: string, callbackId: string) => Promise<void>;
  };
};

let ports: FreelancePorts | null = null;

export function setFreelancePorts(next: FreelancePorts): void {
  ports = next;
}

export function freelancePorts(): FreelancePorts {
  if (!ports) throw new Error("freelance ports are not configured");
  return ports;
}
