import { FREELANCE_TASK_LIMITS as T } from "../../../config/freelance";
import { HttpError, notFound } from "@intgetion/kit";
import { getSellerStorefronts } from "../../../platform";
import { safeNotify } from "../../../platform";
import * as repo from "../repo/freelance-repo";
import { isRoomTableMissing } from "../repo/room-repo";
import * as invites from "../repo/task-invite-repo";
import * as tasks from "../repo/task-repo";
import { FREELANCE_ERRORS } from "./rules";
import { getSellerRecord } from "./seller-record-service";
import type { SellerRecord } from "./seller-score";
import { taskTakesProposals } from "./task-rules";

/**
 * Finding freelancers for a task and inviting them (A4 of TZ 44, TZ 49).
 * An invitation promises nothing: the freelancer still sends a proposal and
 * the client still chooses. Until migration 0084 is on the database the
 * suggestions come without the invited marks and inviting answers 503.
 */

export type SuggestedSeller = {
  sellerId: string;
  name: string | null;
  headline: string | null;
  record: SellerRecord;
  invited: boolean;
  proposed: boolean;
};

function conflict(code: string, message: string): HttpError {
  return new HttpError(409, code, message);
}

/** Better badge first, then rating, then completed orders. */
export function rankSuggestions<
  Item extends { record: Pick<SellerRecord, "badge" | "rating" | "completed"> },
>(items: readonly Item[]): Item[] {
  const rank = (badge: SellerRecord["badge"]) =>
    badge === "top" ? 2 : badge === "reliable" ? 1 : 0;
  return [...items].sort(
    (a, b) =>
      rank(b.record.badge) - rank(a.record.badge) ||
      (b.record.rating ?? 0) - (a.record.rating ?? 0) ||
      b.record.completed - a.record.completed,
  );
}

async function ownTask(buyerId: string, taskId: string) {
  const task = await tasks.findTask(taskId);
  if (!task || task.buyerId !== buyerId) throw notFound();
  return task;
}

/** Freelancers with a published service in the task's category. */
export async function suggestSellers(
  buyerId: string,
  taskId: string,
): Promise<SuggestedSeller[]> {
  const task = await ownTask(buyerId, taskId);
  const ids = (
    await invites.listSellerIdsWithService(task.category, 60)
  ).filter((id) => id !== buyerId);
  if (ids.length === 0) return [];
  let invited = new Set<string>();
  try {
    invited = new Set(await invites.listInvitedSellerIds(task.id));
  } catch (error) {
    if (!isRoomTableMissing(error)) throw error;
  }
  const proposed = new Set(
    (await tasks.listProposalsForTask(task.id)).map((row) => row.sellerId),
  );
  const names = await getSellerStorefronts(ids);
  const records = await Promise.all(ids.map((id) => getSellerRecord(id)));
  const items = ids.flatMap((id, index): SuggestedSeller[] => {
    const storefront = names.get(id);
    // A freelancer without a public profile is not offered.
    if (!storefront) return [];
    return [
      {
        sellerId: id,
        name: storefront.displayName,
        headline: storefront.headline,
        record: records[index]!,
        invited: invited.has(id),
        proposed: proposed.has(id),
      },
    ];
  });
  return rankSuggestions(items).slice(0, T.suggestions);
}

/** The client invites one freelancer to an open task. */
export async function inviteSeller(
  buyerId: string,
  taskId: string,
  sellerId: string,
  now = new Date(),
): Promise<void> {
  const task = await ownTask(buyerId, taskId);
  if (!taskTakesProposals(task, now)) {
    throw conflict(FREELANCE_ERRORS.taskClosed, "The task is closed");
  }
  if (sellerId === buyerId) {
    throw conflict(FREELANCE_ERRORS.ownTask, "This is your own task");
  }
  const seller = await repo.findSeller(sellerId);
  if (!seller || !seller.accepting) {
    throw conflict(
      FREELANCE_ERRORS.sellerNotAccepting,
      "This freelancer is not taking orders",
    );
  }
  if (await tasks.findProposalOf(task.id, sellerId)) {
    throw conflict(
      FREELANCE_ERRORS.proposalExists,
      "This freelancer already sent a proposal",
    );
  }
  try {
    if ((await invites.countInvitesOfTask(task.id)) >= T.invitesPerTask) {
      throw conflict(FREELANCE_ERRORS.inviteLimit, "Too many invitations");
    }
    await invites.insertInvite({
      taskId: task.id,
      sellerId,
      invitedBy: buyerId,
      createdAt: now,
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const code =
      (error as { code?: string } | null)?.code ??
      (error as { cause?: { code?: string } } | null)?.cause?.code;
    if (code === "23505") {
      throw conflict(FREELANCE_ERRORS.alreadyInvited, "Already invited");
    }
    if (isRoomTableMissing(error)) {
      throw new HttpError(
        503,
        FREELANCE_ERRORS.tasksNotReady,
        "Invitations are not switched on yet",
      );
    }
    throw error;
  }
  await safeNotify("freelance.task_proposal", [sellerId], {
    taskId: task.id,
    taskTitle: task.title,
    decision: "invited",
  });
}

/** Whether this freelancer was invited to the task; false before 0084. */
export async function wasInvited(
  sellerId: string,
  taskId: string,
): Promise<boolean> {
  try {
    return await invites.hasInvite(taskId, sellerId);
  } catch (error) {
    if (isRoomTableMissing(error)) return false;
    throw error;
  }
}
