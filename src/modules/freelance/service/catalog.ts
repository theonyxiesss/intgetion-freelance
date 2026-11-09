import type { FreelanceCategory, FreelanceTier } from "../../../config/freelance";
import {
  getSellerStorefronts,
  type SellerStorefront,
} from "../../../platform";
import { listActiveSkills } from "../../../platform";
import * as repo from "../repo/freelance-repo";
import type { FreelanceSearchQuery } from "../schemas/search";
import {
  CATALOG_PAGE_SIZE,
  getPublishedService,
  searchServices,
  type PublicService,
} from "./listing-service";
import { listPublicReviews, type PublicReview } from "./order-service";

export type CatalogCard = {
  id: string;
  slug: string;
  title: string;
  category: FreelanceCategory;
  seller: SellerStorefront;
  skills: string[];
  languages: string[];
  fromMinor: bigint;
  fromDays: number;
  completed: number;
  rating: number | null;
};

export type ServicePackageView = {
  tier: FreelanceTier;
  priceMinor: bigint;
  deliveryDays: number;
  revisions: number;
  includes: string[];
};

export type ServicePage = CatalogCard & {
  description: string;
  buyerNeeds: string;
  links: string[];
  packages: ServicePackageView[];
  reviews: PublicReview[];
  reviewCount: number;
  updatedAt: Date;
};

/** A table that is not on this database yet reads as an empty catalog. */
export function isMissingFreelanceTable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code =
      typeof current === "object" && current !== null && "code" in current
        ? String((current as { code: unknown }).code)
        : "";
    const message = current instanceof Error ? current.message : "";
    if (
      code === "42P01" ||
      /relation "?(public\.)?freelance_\w+"? does not exist/i.test(message)
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

async function skillNames(locale: string): Promise<Map<string, string>> {
  const skills = await listActiveSkills();
  return new Map(
    skills.map((skill) => [
      skill.slug,
      locale === "ru" ? skill.nameRu : skill.nameEn,
    ]),
  );
}

function toCard(
  service: PublicService,
  seller: SellerStorefront,
  names: Map<string, string>,
): CatalogCard {
  const basic = service.packages[0];
  return {
    id: service.id,
    slug: service.slug,
    title: service.title,
    category: service.category,
    seller,
    skills: service.skillSlugs.map((slug) => names.get(slug) ?? slug),
    languages: service.languages,
    fromMinor: basic?.priceMinor ?? BigInt(0),
    fromDays: basic?.deliveryDays ?? 0,
    completed: service.completed,
    rating: service.rating,
  };
}

/** One catalog page. Services whose seller has no profile are left out. */
export async function listCatalog(
  query: FreelanceSearchQuery,
  locale: string,
): Promise<{ cards: CatalogCard[]; total: number; hasMore: boolean }> {
  try {
    const result = await searchServices({
      q: query.q,
      category: query.category,
      maxPriceMinor:
        query.budget === undefined
          ? undefined
          : BigInt(query.budget) * BigInt(100),
      maxDays: query.days,
      language: query.lang,
      sort: query.sort,
      page: query.page,
    });
    // One after the other: parallel queries on one pooled connection hang (D247).
    const sellers = await getSellerStorefronts(
      result.services.map((service) => service.sellerId),
    );
    const names = await skillNames(locale);
    const cards = result.services.flatMap((service) => {
      const seller = sellers.get(service.sellerId);
      return seller ? [toCard(service, seller, names)] : [];
    });
    return {
      cards,
      total: result.total,
      hasMore: query.page * CATALOG_PAGE_SIZE < result.total,
    };
  } catch (error) {
    if (isMissingFreelanceTable(error))
      return { cards: [], total: 0, hasMore: false };
    throw error;
  }
}

/** The public page of one service, or null when it is not shown (28.3). */
export async function getServicePage(
  slug: string,
  locale: string,
): Promise<ServicePage | null> {
  try {
    const service = await getPublishedService(slug);
    if (!service) return null;
    const seller = (await getSellerStorefronts([service.sellerId])).get(
      service.sellerId,
    );
    if (!seller) return null;
    const names = await skillNames(locale);
    const reviews = await listPublicReviews(service.id);
    return {
      ...toCard(service, seller, names),
      description: service.description,
      buyerNeeds: service.buyerNeeds,
      links: service.links,
      packages: service.packages.map((pkg) => ({
        tier: pkg.tier,
        priceMinor: pkg.priceMinor,
        deliveryDays: pkg.deliveryDays,
        revisions: pkg.revisions,
        includes: pkg.includes,
      })),
      reviews,
      reviewCount: service.reviews,
      updatedAt: service.updatedAt,
    };
  } catch (error) {
    if (isMissingFreelanceTable(error)) return null;
    throw error;
  }
}

export async function listFreelanceSitemapEntries(): Promise<
  { slug: string; updatedAt: Date }[]
> {
  try {
    return await repo.listSitemapRows();
  } catch (error) {
    if (isMissingFreelanceTable(error)) return [];
    throw error;
  }
}
