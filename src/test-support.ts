import { HttpError } from "@intgetion/kit";
import { setFreelancePorts, type AuditEntry, type FreelancePorts, type SellerStorefront } from "./ports";

type QueueItem = { entityType: string; entityId: string; reason: string; riskFlags: unknown };
type Report = {
  id: string;
  reporterId: string;
  entityType: string;
  entityId: string;
  reason: string;
  status: "open" | "confirmed" | "dismissed";
};

const SKILLS = ["react", "typescript", "nextjs", "figma", "solidity", "python"].map((slug, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  slug,
  nameEn: slug,
  nameRu: slug,
  category: "engineering",
}));

/**
 * An in-memory world for integration tests: the other modules freelance
 * talks to, and what freelance asked of them. Freelance's own tables stay in
 * the real database.
 */
export function fakeWorld() {
  const candidates = new Map<string, SellerStorefront>();
  const companies = new Map<string, { id: string; name: string; members: Map<string, string> }>();
  const payoutWallets = new Map<string, string>();
  const payerWallets = new Map<string, { address: string; chainId: number }>();
  const sanctioned = new Set<string>();
  const notices: { type: string; to: string; payload: Record<string, unknown> }[] = [];
  const queue: QueueItem[] = [];
  const reports: Report[] = [];
  const audit: AuditEntry[] = [];
  const ownerMail: { subject: string; text: string }[] = [];

  const ports: FreelancePorts = {
    hasCandidateProfile: async (userId) => candidates.has(userId),
    sellerStorefronts: async (ids) =>
      new Map(ids.flatMap((id) => (candidates.has(id) ? [[id, candidates.get(id)!] as const] : []))),
    ownContacts: async (userId) =>
      candidates.has(userId)
        ? { email: `${userId.slice(0, 8)}@example.test`, phone: null, telegram: null, linkedinUrl: null, websiteUrl: null, extra: {} }
        : null,
    findMemberRole: async (companyId, userId) => companies.get(companyId)?.members.get(userId) ?? null,
    companiesForUser: async (userId) =>
      [...companies.values()].filter((c) => c.members.has(userId)).map((c) => ({ id: c.id, name: c.name })),
    activeSkills: async () => SKILLS,
    matchSkillSlug: async (raw) => SKILLS.find((s) => s.slug === raw.trim().toLowerCase())?.slug ?? null,
    accountWallet: async (userId) => {
      const address = payoutWallets.get(userId);
      return address ? { address, chainId: 8453, verifiedAt: "2030-01-01T00:00:00Z" } : null;
    },
    isSanctionedAddress: async (address) => sanctioned.has(address.toLowerCase()),
    cryptoCheckoutOn: () =>
      process.env.BILLING_ENABLED === "true" && process.env.BILLING_CRYPTO_PROVIDER === "walletconnect",
    verifiedPayerWallet: async (userId) => payerWallets.get(userId) ?? null,
    notify: async (type, to, payload) => {
      for (const id of to) notices.push({ type, to: id, payload: payload as Record<string, unknown> });
    },
    loginEmail: async (userId) => `${userId.slice(0, 8)}@login.test`,
    enqueueModeration: async (input) => {
      queue.push(input);
    },
    fileReport: async (reporterId, entityType, entityId, input) => {
      if (reports.some((r) => r.reporterId === reporterId && r.entityType === entityType && r.entityId === entityId)) {
        throw new HttpError(409, "ALREADY_REPORTED", "You have already reported this");
      }
      const id = crypto.randomUUID();
      reports.push({ id, reporterId, entityType, entityId, reason: input.reason, status: "open" });
      return { reportId: id };
    },
    countOpenReports: async ({ serviceId, orderIds }) =>
      reports.filter(
        (r) =>
          r.status === "open" &&
          ((r.entityType === "freelance_service" && r.entityId === serviceId) ||
            (r.entityType === "freelance_order" && orderIds.includes(r.entityId))),
      ).length,
    audit: async (entry) => {
      audit.push(entry);
    },
    rateLimit: async () => {},
    notifyPlatformOwners: async (subject, text) => {
      ownerMail.push({ subject, text });
    },
    telegram: {
      userIdForTelegramId: async () => null,
      sendMessage: async () => {},
      sendLinks: async () => {},
      answerCallback: async () => {},
    },
  };
  setFreelancePorts(ports);

  return {
    notices,
    queue,
    reports,
    audit,
    ownerMail,
    addCandidate(userId: string, fullName = "Ada Lovelace", headline = "Frontend developer") {
      const [first, ...rest] = fullName.split(" ");
      const last = rest.at(-1);
      candidates.set(userId, {
        userId,
        displayName: last ? `${first} ${last[0]}.` : (first ?? null),
        headline,
        timezone: "Europe/Berlin",
      });
    },
    addCompany(id: string, name: string, owner: string) {
      companies.set(id, { id, name, members: new Map([[owner, "owner"]]) });
    },
    linkPayoutWallet(userId: string, address: string) {
      payoutWallets.set(userId, address.toLowerCase());
    },
    linkPayerWallet(userId: string, address: string, chainId: number) {
      payerWallets.set(userId, { address: address.toLowerCase(), chainId });
    },
    sanction(address: string) {
      sanctioned.add(address.toLowerCase());
    },
    /** Notice types a user got, oldest first, with the status or decision. */
    noticesOf(userId: string) {
      return notices
        .filter((n) => n.to === userId && n.type.startsWith("freelance."))
        .map((n) => {
          const step = (n.payload.status ?? n.payload.decision) as string | undefined;
          return step ? `${n.type}:${step}` : n.type;
        });
    },
  };
}
