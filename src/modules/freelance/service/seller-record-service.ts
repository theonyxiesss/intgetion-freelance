import * as repo from "../repo/freelance-repo";
import { isMissingFreelanceTable } from "./catalog";
import { buildSellerRecord, type SellerRecord } from "./seller-score";

/**
 * The public record of one seller (A5, TZ 49): counts and shares only, no
 * names and no texts. A database without the freelance tables gives an empty
 * record, so a page never fails because of it.
 */
export async function getSellerRecord(sellerId: string): Promise<SellerRecord> {
  try {
    const [orders, ratings] = await Promise.all([
      repo.listCompletedOrdersOf(sellerId),
      repo.listRatingsOfSeller(sellerId),
    ]);
    return buildSellerRecord({ orders, ratings });
  } catch (error) {
    if (!isMissingFreelanceTable(error)) throw error;
    return buildSellerRecord({ orders: [], ratings: [] });
  }
}
