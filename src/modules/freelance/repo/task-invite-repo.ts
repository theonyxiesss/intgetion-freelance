import { and, count, eq } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import {
  freelanceSellers,
  freelanceServices,
  freelanceTaskInvites,
} from "../../../db/owned";
import type { FreelanceCategory } from "../../../config/freelance";

/** Invitations of freelancers to tasks (TZ 49, A4, migration 0084). */

export async function insertInvite(values: {
  taskId: string;
  sellerId: string;
  invitedBy: string;
  createdAt: Date;
}): Promise<void> {
  await getDb().insert(freelanceTaskInvites).values(values);
}

export async function countInvitesOfTask(taskId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(freelanceTaskInvites)
    .where(eq(freelanceTaskInvites.taskId, taskId));
  return Number(row?.n ?? 0);
}

export async function listInvitedSellerIds(taskId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ sellerId: freelanceTaskInvites.sellerId })
    .from(freelanceTaskInvites)
    .where(eq(freelanceTaskInvites.taskId, taskId));
  return rows.map((row) => row.sellerId);
}

export async function hasInvite(
  taskId: string,
  sellerId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: freelanceTaskInvites.id })
    .from(freelanceTaskInvites)
    .where(
      and(
        eq(freelanceTaskInvites.taskId, taskId),
        eq(freelanceTaskInvites.sellerId, sellerId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Freelancers who take orders and have a published service in a category. */
export async function listSellerIdsWithService(
  category: FreelanceCategory,
  limit: number,
): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ sellerId: freelanceServices.sellerId })
    .from(freelanceServices)
    .innerJoin(
      freelanceSellers,
      eq(freelanceSellers.userId, freelanceServices.sellerId),
    )
    .where(
      and(
        eq(freelanceServices.status, "published"),
        eq(freelanceServices.category, category),
        eq(freelanceSellers.accepting, true),
      ),
    )
    .limit(limit);
  return rows.map((row) => row.sellerId);
}
