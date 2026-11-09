import { freelancePorts } from "../../../ports";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import {
  freelanceProposals,
  freelanceTasks,
} from "../../../db/owned";
import type {
  FreelanceCategory,
  FreelanceProposalStatus,
  FreelanceTaskStatus,
} from "../../../config/freelance";
import type { FreelanceTx } from "./freelance-repo";

/** Tasks and proposals (TZ 47, D569, migration 0073). */

export type TaskRow = typeof freelanceTasks.$inferSelect;
export type ProposalRow = typeof freelanceProposals.$inferSelect;

export const TASK_QUEUE_ENTITY = "freelance_task";

export async function insertTask(
  tx: FreelanceTx,
  values: typeof freelanceTasks.$inferInsert,
): Promise<TaskRow> {
  const [row] = await tx.insert(freelanceTasks).values(values).returning();
  if (!row) throw new Error("freelance_tasks insert returned nothing");
  return row;
}

export async function queueTaskForModeration(
  tx: FreelanceTx,
  taskId: string,
): Promise<void> {
  await freelancePorts().enqueueModeration(
    {
      entityType: TASK_QUEUE_ENTITY,
      entityId: taskId,
      reason: "freelance_task_review",
      riskFlags: [],
    },
    tx,
  );
}

export async function findTask(id: string): Promise<TaskRow | null> {
  const [row] = await getDb()
    .select()
    .from(freelanceTasks)
    .where(eq(freelanceTasks.id, id));
  return row ?? null;
}

export async function findTasks(ids: readonly string[]): Promise<TaskRow[]> {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(freelanceTasks)
    .where(inArray(freelanceTasks.id, [...ids]));
}

export async function listOpenTasks(input: {
  now: Date;
  category?: FreelanceCategory;
  limit: number;
}): Promise<TaskRow[]> {
  const where = [
    eq(freelanceTasks.status, "open"),
    gt(freelanceTasks.expiresAt, input.now),
  ];
  if (input.category) where.push(eq(freelanceTasks.category, input.category));
  return getDb()
    .select()
    .from(freelanceTasks)
    .where(and(...where))
    .orderBy(desc(freelanceTasks.createdAt))
    .limit(input.limit);
}

/** Published tasks for sitemap discovery. */
export async function listTaskSitemapRows(): Promise<
  { id: string; updatedAt: Date }[]
> {
  return getDb()
    .select({ id: freelanceTasks.id, updatedAt: freelanceTasks.updatedAt })
    .from(freelanceTasks)
    .where(
      and(
        eq(freelanceTasks.status, "open"),
        gt(freelanceTasks.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(freelanceTasks.updatedAt))
    .limit(5000);
}

export async function listTasksByBuyer(buyerId: string): Promise<TaskRow[]> {
  return getDb()
    .select()
    .from(freelanceTasks)
    .where(eq(freelanceTasks.buyerId, buyerId))
    .orderBy(desc(freelanceTasks.createdAt))
    .limit(100);
}

/** Moves a task only from the status the caller saw; null when it moved. */
export async function setTaskStatus(
  id: string,
  from: FreelanceTaskStatus,
  values: Partial<typeof freelanceTasks.$inferInsert> & {
    status: FreelanceTaskStatus;
    updatedAt: Date;
  },
  conn: FreelanceTx | ReturnType<typeof getDb> = getDb(),
): Promise<TaskRow | null> {
  const [row] = await conn
    .update(freelanceTasks)
    .set(values)
    .where(and(eq(freelanceTasks.id, id), eq(freelanceTasks.status, from)))
    .returning();
  return row ?? null;
}

/** Locks the task for an accept, so two accepts cannot both win. */
export async function lockTask(
  tx: FreelanceTx,
  id: string,
): Promise<TaskRow | null> {
  const [row] = await tx
    .select()
    .from(freelanceTasks)
    .where(eq(freelanceTasks.id, id))
    .for("update");
  return row ?? null;
}

/** The daily cron: open tasks past their 30 days. */
export async function expireTasks(now: Date): Promise<number> {
  const rows = await getDb()
    .update(freelanceTasks)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(eq(freelanceTasks.status, "open"), lt(freelanceTasks.expiresAt, now)),
    )
    .returning({ id: freelanceTasks.id });
  return rows.length;
}

export async function insertProposal(
  values: typeof freelanceProposals.$inferInsert,
): Promise<ProposalRow> {
  const [row] = await getDb()
    .insert(freelanceProposals)
    .values(values)
    .returning();
  if (!row) throw new Error("freelance_proposals insert returned nothing");
  return row;
}

export async function findProposal(id: string): Promise<ProposalRow | null> {
  const [row] = await getDb()
    .select()
    .from(freelanceProposals)
    .where(eq(freelanceProposals.id, id));
  return row ?? null;
}

export async function findProposalOf(
  taskId: string,
  sellerId: string,
): Promise<ProposalRow | null> {
  const [row] = await getDb()
    .select()
    .from(freelanceProposals)
    .where(
      and(
        eq(freelanceProposals.taskId, taskId),
        eq(freelanceProposals.sellerId, sellerId),
      ),
    );
  return row ?? null;
}

export async function listProposalsForTask(
  taskId: string,
): Promise<ProposalRow[]> {
  return getDb()
    .select()
    .from(freelanceProposals)
    .where(eq(freelanceProposals.taskId, taskId))
    .orderBy(desc(freelanceProposals.createdAt));
}

export async function listProposalsBySeller(
  sellerId: string,
): Promise<ProposalRow[]> {
  return getDb()
    .select()
    .from(freelanceProposals)
    .where(eq(freelanceProposals.sellerId, sellerId))
    .orderBy(desc(freelanceProposals.createdAt))
    .limit(100);
}

/** Moves a proposal only from `from`; null when it already moved. */
export async function setProposalStatus(
  id: string,
  from: FreelanceProposalStatus,
  to: FreelanceProposalStatus,
  now: Date,
  conn: FreelanceTx | ReturnType<typeof getDb> = getDb(),
): Promise<ProposalRow | null> {
  const [row] = await conn
    .update(freelanceProposals)
    .set({ status: to, updatedAt: now })
    .where(
      and(eq(freelanceProposals.id, id), eq(freelanceProposals.status, from)),
    )
    .returning();
  return row ?? null;
}

/** On a hire, every other open proposal of the task is declined. */
export async function declineOtherProposals(
  tx: FreelanceTx,
  taskId: string,
  keepId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(freelanceProposals)
    .set({ status: "declined", updatedAt: now })
    .where(
      and(
        eq(freelanceProposals.taskId, taskId),
        eq(freelanceProposals.status, "sent"),
        sql`${freelanceProposals.id} <> ${keepId}`,
      ),
    );
}
