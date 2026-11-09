import { eq } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { freelanceClientReviews } from "../../../db/owned";

/** Reviews of clients by freelancers (D568, migration 0072). */

export type ClientReviewRow = typeof freelanceClientReviews.$inferSelect;

export async function findClientReviewByOrder(
  orderId: string,
): Promise<ClientReviewRow | null> {
  const [row] = await getDb()
    .select()
    .from(freelanceClientReviews)
    .where(eq(freelanceClientReviews.orderId, orderId));
  return row ?? null;
}

export async function insertClientReview(
  values: typeof freelanceClientReviews.$inferInsert,
): Promise<ClientReviewRow> {
  const [row] = await getDb()
    .insert(freelanceClientReviews)
    .values(values)
    .returning();
  if (!row) throw new Error("freelance_client_reviews insert returned nothing");
  return row;
}

/** Ratings given to one client; texts never leave this module. */
export async function listClientRatings(buyerId: string): Promise<number[]> {
  const rows = await getDb()
    .select({ rating: freelanceClientReviews.rating })
    .from(freelanceClientReviews)
    .where(eq(freelanceClientReviews.buyerId, buyerId));
  return rows.map((row) => row.rating);
}
