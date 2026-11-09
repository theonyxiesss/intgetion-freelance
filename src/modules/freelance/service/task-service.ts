import {
  FREELANCE_TASK_LIMITS as T,
  type FreelanceCategory,
} from "../../../config/freelance";
import { HttpError, notFound } from "@intgetion/kit";
import { findMemberRole } from "../../../platform";
import { safeNotify } from "../../../platform";
import * as repo from "../repo/freelance-repo";
import { isRoomTableMissing } from "../repo/room-repo";
import * as tasks from "../repo/task-repo";
import { FREELANCE_ERRORS } from "./rules";
import {
  checkProposal,
  checkTask,
  proposalMoveAllowed,
  taskExpiresAt,
  taskTakesProposals,
} from "./task-rules";

/**
 * Tasks posted by clients and freelancers' proposals (TZ 47, A3, D569).
 * Until migration 0073 is on the database every call answers 503
 * `TASKS_NOT_READY` and the pages show "coming soon".
 */

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string } | null)?.code ??
    (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === UNIQUE_VIOLATION;
}

function notReady(): HttpError {
  return new HttpError(
    503,
    FREELANCE_ERRORS.tasksNotReady,
    "Tasks are not switched on yet",
  );
}

function conflict(code: string, message: string): HttpError {
  return new HttpError(409, code, message);
}

/** Runs `work`; a missing 0073 table becomes 503 instead of a crash. */
async function ready<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isRoomTableMissing(error)) throw notReady();
    throw error;
  }
}

/** A client posts a task; it waits for a moderator (28.9). */
export async function createTask(
  buyerId: string,
  raw: unknown,
  now = new Date(),
): Promise<tasks.TaskRow> {
  const input = checkTask(raw);
  if (input.companyId && !(await findMemberRole(input.companyId, buyerId))) {
    throw notFound();
  }
  return ready(() =>
    repo.runInTransaction(async (tx) => {
      const task = await tasks.insertTask(tx, {
        buyerId,
        buyerCompanyId: input.companyId ?? null,
        title: input.title,
        description: input.description,
        category: input.category,
        budgetMinMinor: input.budgetMinMinor,
        budgetMaxMinor: input.budgetMaxMinor,
        wantedBy: input.wantedBy ?? null,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      await tasks.queueTaskForModeration(tx, task.id);
      return task;
    }),
  );
}

/** The moderator's decision; published tasks stay open for 30 days. */
export async function decideTaskModeration(
  taskId: string,
  decision: "publish" | "reject",
  note: string | null,
  now = new Date(),
): Promise<tasks.TaskRow | null> {
  return ready(() =>
    tasks.setTaskStatus(
      taskId,
      "pending",
      decision === "publish"
        ? {
            status: "open",
            moderationNote: null,
            expiresAt: taskExpiresAt(now),
            updatedAt: now,
          }
        : { status: "rejected", moderationNote: note, updatedAt: now },
    ),
  );
}

/** Short view for the admin queue. */
export async function getTasksForModeration(ids: readonly string[]) {
  return ready(async () =>
    (await tasks.findTasks(ids)).map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      category: task.category,
      status: task.status,
    })),
  );
}

export type PublicTask = {
  id: string;
  title: string;
  description: string;
  category: FreelanceCategory;
  budgetMinMinor: bigint | null;
  budgetMaxMinor: bigint | null;
  wantedBy: string | null;
  /** Never the client's name (as reviews, 28.5). */
  postedBy: "person" | "company";
  createdAt: Date;
  expiresAt: Date | null;
};

function toPublic(task: tasks.TaskRow): PublicTask {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    category: task.category,
    budgetMinMinor: task.budgetMinMinor,
    budgetMaxMinor: task.budgetMaxMinor,
    wantedBy: task.wantedBy,
    postedBy: task.buyerCompanyId ? "company" : "person",
    createdAt: task.createdAt,
    expiresAt: task.expiresAt,
  };
}

export async function listOpenTasks(
  query: { category?: FreelanceCategory; limit?: number },
  now = new Date(),
): Promise<PublicTask[]> {
  return ready(async () =>
    (
      await tasks.listOpenTasks({
        now,
        category: query.category,
        limit: Math.min(query.limit ?? 50, 100),
      })
    ).map(toPublic),
  );
}

/** The latest public tasks for the sitemap; empty until migration 0073. */
export async function listTaskSitemapEntries(): Promise<
  { id: string; updatedAt: Date }[]
> {
  return ready(() => tasks.listTaskSitemapRows());
}

export type TaskView = PublicTask & {
  status: tasks.TaskRow["status"];
  /** The viewer posted this task. */
  own: boolean;
  /** The viewer may send a proposal now. */
  canPropose: boolean;
  /** The viewer's own proposal, when there is one. */
  myProposal: tasks.ProposalRow | null;
  hiredOrderId: string | null;
};

/** An open task for anyone; any status for its own client; else 404. */
export async function getTaskView(
  viewerId: string | null,
  taskId: string,
  now = new Date(),
): Promise<TaskView> {
  return ready(async () => {
    const task = await tasks.findTask(taskId);
    if (!task) throw notFound();
    const own = viewerId !== null && task.buyerId === viewerId;
    if (!own && task.status !== "open") throw notFound();
    const myProposal =
      viewerId && !own ? await tasks.findProposalOf(task.id, viewerId) : null;
    return {
      ...toPublic(task),
      status: task.status,
      own,
      canPropose:
        viewerId !== null &&
        !own &&
        myProposal === null &&
        taskTakesProposals(task, now),
      myProposal,
      hiredOrderId: own ? task.hiredOrderId : null,
    };
  });
}

export async function listMyTasks(buyerId: string): Promise<tasks.TaskRow[]> {
  return ready(() => tasks.listTasksByBuyer(buyerId));
}

/** A freelancer offers a price, days and a note; one per task. */
export async function sendProposal(
  sellerId: string,
  raw: unknown,
  now = new Date(),
): Promise<tasks.ProposalRow> {
  const input = checkProposal(raw);
  return ready(async () => {
    const task = await tasks.findTask(input.taskId);
    if (!task || task.status === "pending" || task.status === "rejected") {
      throw notFound();
    }
    if (task.buyerId === sellerId) {
      throw conflict(FREELANCE_ERRORS.ownTask, "This is your own task");
    }
    if (!taskTakesProposals(task, now)) {
      throw conflict(FREELANCE_ERRORS.taskClosed, "The task is closed");
    }
    if (!(await repo.findSeller(sellerId))) {
      throw conflict(
        FREELANCE_ERRORS.sellerRequired,
        "Turn on taking orders first",
      );
    }
    try {
      const proposal = await tasks.insertProposal({
        taskId: task.id,
        sellerId,
        priceMinor: input.priceMinor,
        deliveryDays: input.deliveryDays,
        cover: input.cover,
        status: "sent",
        createdAt: now,
        updatedAt: now,
      });
      await safeNotify("freelance.task_proposal", [task.buyerId], {
        taskId: task.id,
        taskTitle: task.title,
        proposalId: proposal.id,
        decision: "received",
      });
      return proposal;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict(
          FREELANCE_ERRORS.proposalExists,
          "You already sent a proposal",
        );
      }
      throw error;
    }
  });
}

/** Proposals of one task, for its client only. */
export async function listTaskProposals(
  buyerId: string,
  taskId: string,
): Promise<tasks.ProposalRow[]> {
  return ready(async () => {
    const task = await tasks.findTask(taskId);
    if (!task || task.buyerId !== buyerId) throw notFound();
    return tasks.listProposalsForTask(task.id);
  });
}

export async function listMyProposals(
  sellerId: string,
): Promise<tasks.ProposalRow[]> {
  return ready(() => tasks.listProposalsBySeller(sellerId));
}

/** The freelancer takes back a proposal that is still waiting. */
export async function withdrawProposal(
  sellerId: string,
  proposalId: string,
  now = new Date(),
): Promise<tasks.ProposalRow> {
  return ready(async () => {
    const proposal = await tasks.findProposal(proposalId);
    if (!proposal || proposal.sellerId !== sellerId) throw notFound();
    if (
      !proposalMoveAllowed({
        move: "withdraw",
        status: proposal.status,
        actor: "seller",
      })
    ) {
      throw conflict(FREELANCE_ERRORS.proposalClosed, "Not possible now");
    }
    const row = await tasks.setProposalStatus(
      proposal.id,
      "sent",
      "withdrawn",
      now,
    );
    if (!row)
      throw conflict(FREELANCE_ERRORS.proposalClosed, "Not possible now");
    return row;
  });
}

/** The client declines one proposal. */
export async function declineProposal(
  buyerId: string,
  proposalId: string,
  now = new Date(),
): Promise<tasks.ProposalRow> {
  return ready(async () => {
    const proposal = await tasks.findProposal(proposalId);
    const task = proposal ? await tasks.findTask(proposal.taskId) : null;
    if (!proposal || !task || task.buyerId !== buyerId) throw notFound();
    if (
      !proposalMoveAllowed({
        move: "decline",
        status: proposal.status,
        actor: "buyer",
      })
    ) {
      throw conflict(FREELANCE_ERRORS.proposalClosed, "Not possible now");
    }
    const row = await tasks.setProposalStatus(
      proposal.id,
      "sent",
      "declined",
      now,
    );
    if (!row)
      throw conflict(FREELANCE_ERRORS.proposalClosed, "Not possible now");
    return row;
  });
}

/**
 * The client hires: in one transaction the order is made in `accepted`
 * (both sides agreed) with the proposal's price and days, the task becomes
 * `hired` and every other waiting proposal is declined (D569).
 */
export async function acceptProposal(
  buyerId: string,
  proposalId: string,
  now = new Date(),
): Promise<repo.OrderRow> {
  return ready(async () => {
    const proposal = await tasks.findProposal(proposalId);
    if (!proposal) throw notFound();
    const hired = await repo.runInTransaction(async (tx) => {
      const task = await tasks.lockTask(tx, proposal.taskId);
      if (!task || task.buyerId !== buyerId) throw notFound();
      if (!taskTakesProposals(task, now)) {
        throw conflict(FREELANCE_ERRORS.taskClosed, "The task is closed");
      }
      const accepted = await tasks.setProposalStatus(
        proposal.id,
        "sent",
        "accepted",
        now,
        tx,
      );
      if (!accepted) {
        throw conflict(FREELANCE_ERRORS.proposalClosed, "Not possible now");
      }
      const order = await repo.insertOrder(tx, {
        serviceId: null,
        sellerId: accepted.sellerId,
        buyerId,
        buyerCompanyId: task.buyerCompanyId,
        serviceTitle: task.title,
        packageTier: "basic",
        priceMinor: accepted.priceMinor,
        deliveryDays: accepted.deliveryDays,
        revisionsLeft: T.hireRevisions,
        task: task.description,
        wantedBy: task.wantedBy,
        status: "accepted",
        expiresAt: now,
        acceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await repo.insertHistory(tx, {
        orderId: order.id,
        fromStatus: null,
        toStatus: "accepted",
        actorId: buyerId,
        createdAt: now,
      });
      await tasks.declineOtherProposals(tx, task.id, accepted.id, now);
      const hired = await tasks.setTaskStatus(
        task.id,
        "open",
        { status: "hired", hiredOrderId: order.id, updatedAt: now },
        tx,
      );
      if (!hired) {
        throw conflict(FREELANCE_ERRORS.taskClosed, "The task is closed");
      }
      return {
        order,
        taskTitle: task.title,
        proposalId: accepted.id,
        sellerId: accepted.sellerId,
        taskId: task.id,
      };
    });
    await safeNotify("freelance.task_proposal", [hired.sellerId], {
      taskId: hired.taskId,
      taskTitle: hired.taskTitle,
      proposalId: hired.proposalId,
      decision: "accepted",
    });
    return hired.order;
  });
}

/** The client closes an open task without hiring. */
export async function closeTask(
  buyerId: string,
  taskId: string,
  now = new Date(),
): Promise<tasks.TaskRow> {
  return ready(async () => {
    const task = await tasks.findTask(taskId);
    if (!task || task.buyerId !== buyerId) throw notFound();
    const row = await tasks.setTaskStatus(task.id, "open", {
      status: "closed",
      updatedAt: now,
    });
    if (!row) throw conflict(FREELANCE_ERRORS.taskClosed, "The task is closed");
    return row;
  });
}

/** Cron: open tasks past 30 days expire. Zero before migration 0073. */
export async function expireOldTasks(now = new Date()): Promise<number> {
  try {
    return await tasks.expireTasks(now);
  } catch (error) {
    if (isRoomTableMissing(error)) return 0;
    throw error;
  }
}
