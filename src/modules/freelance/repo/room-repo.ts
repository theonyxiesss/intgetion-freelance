import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { freelanceMessages, freelanceThreads } from "../../../db/owned";

/** Order room storage (D566, migration 0071). */

export type MessageRow = typeof freelanceMessages.$inferSelect;

const UNDEFINED_TABLE = "42P01";

/**
 * True when 0071 is not applied yet. Localhost and production share the cloud
 * database, so code must not break the order page before the migration.
 */
export function isRoomTableMissing(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current && depth < 4;
    depth += 1
  ) {
    if ((current as { code?: unknown }).code === UNDEFINED_TABLE) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function findOrderThreadId(
  orderId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: freelanceThreads.id })
    .from(freelanceThreads)
    .where(
      and(
        eq(freelanceThreads.subjectType, "order"),
        eq(freelanceThreads.subjectId, orderId),
      ),
    );
  return row?.id ?? null;
}

/** The thread of an order, created on the first message. */
export async function ensureOrderThreadId(orderId: string): Promise<string> {
  await getDb()
    .insert(freelanceThreads)
    .values({ subjectType: "order", subjectId: orderId })
    .onConflictDoNothing();
  const id = await findOrderThreadId(orderId);
  if (!id) throw new Error("order thread was not created");
  return id;
}

export async function listThreadMessages(
  threadId: string,
): Promise<MessageRow[]> {
  return getDb()
    .select()
    .from(freelanceMessages)
    .where(eq(freelanceMessages.threadId, threadId))
    .orderBy(asc(freelanceMessages.createdAt));
}

export async function insertMessage(values: {
  threadId: string;
  authorId: string;
  body: string;
  links: string[];
}): Promise<MessageRow> {
  const [row] = await getDb()
    .insert(freelanceMessages)
    .values(values)
    .returning();
  return row;
}

/**
 * Retention (D567): message text of an order is kept while the order is open
 * and 365 days after it reached a final status (D581); then the messages go.
 */
export async function deleteClosedRoomMessages(cutoff: Date): Promise<number> {
  const rows = await getDb().execute<{ id: string }>(sql`
    delete from public.freelance_messages m
    using public.freelance_threads t, public.freelance_orders o
    where m.thread_id = t.id
      and t.subject_type = 'order'
      and o.id = t.subject_id
      and o.status in ('completed', 'declined', 'cancelled', 'expired')
      and coalesce(o.completed_at, o.closed_at, o.updated_at) < ${cutoff.toISOString()}::timestamptz
    returning m.id
  `);
  return rows.length;
}
