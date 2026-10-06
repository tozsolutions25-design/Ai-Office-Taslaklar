/**
 * PHASE 07: dependency semantics.
 *
 * The one property this module exists to guarantee:
 *
 *   A TASK NEVER EXECUTES WHILE A PREREQUISITE IS UNSATISFIED.
 *
 * `team.ts` already models the same idea for an in-run plan, including
 * `skippedDueToDependency`. This is the job-level counterpart, with the states
 * the brief asks to be distinguished: satisfied, failed, cancelled, waiting, and
 * unavailable. They are kept separate because they lead to four DIFFERENT
 * decisions, and collapsing them is how a failed prerequisite turns into a
 * silently skipped task that nobody was told about.
 */

import { type JobTaskState, type TaskRecord } from "./model.js";

/** The condition a task is waiting on, or why it is not. */
export const DEPENDENCY_CONDITIONS = [
  "satisfied",
  "failed",
  "cancelled",
  "waiting",
  "unavailable",
] as const;
export type DependencyCondition = (typeof DEPENDENCY_CONDITIONS)[number];

export interface DependencyStatus {
  readonly taskId: string;
  readonly condition: DependencyCondition;
  /** Prerequisite task ids that produced this condition. */
  readonly blockedBy: readonly string[];
  /** Human-readable, non-secret. */
  readonly detail: string;
}

export interface DependencyVerdict {
  /** True only when every dependency is satisfied. */
  readonly mayRun: boolean;
  /**
   * True when this task can never run because a prerequisite reached a terminal
   * state that does not permit it. A coordinator uses this to SKIP rather than
   * to wait, so a blocked workflow terminates instead of hanging.
   */
  readonly permanentlyBlocked: boolean;
  readonly statuses: readonly DependencyStatus[];
  /** One line, safe to put in a run's steps or an audit record. */
  readonly summary: string;
}

const SATISFIED: DependencyStatus["condition"] = "satisfied";

function statusOf(record: TaskRecord | undefined): {
  readonly condition: DependencyCondition;
  readonly isTerminal: boolean;
} {
  if (record === undefined) {
    return { condition: "unavailable", isTerminal: true };
  }
  switch (record.state) {
    case "completed":
      return { condition: SATISFIED, isTerminal: true };
    case "failed":
      return { condition: "failed", isTerminal: true };
    case "cancelled":
      return { condition: "cancelled", isTerminal: true };
    case "skipped":
      // A skipped task satisfied nothing. Treating it as satisfied would let a
      // downstream task run on work that was never done.
      return { condition: "unavailable", isTerminal: true };
case "pending":
      case "ready":
      case "running":
      case "retrying":
      case "waiting_approval":
        return { condition: "waiting", isTerminal: false };
      // PHASE 12. An `indeterminate` dependency is WAITING, and deliberately not terminal.
      //
      // Not `satisfied`: nobody proved the work finished, and treating an unproven task as done
      // is the exact defect this state was added to prevent.
      // Not `failed`: that would report a failure nobody observed and would let a caller treat
      // the branch as permanently blocked - closing a door that evidence may yet open.
      // Not permanently blocked: the task is waiting for an answer, so downstream work waits
      // with it rather than being abandoned.
      case "indeterminate":
        return { condition: "waiting", isTerminal: false };
    }
}

/**
 * Evaluates whether a task may run.
 *
 * A dependency that is not present at all is `unavailable`, not `satisfied`. A
 * workflow naming a task that was never created is a configuration fault, and
 * treating it as met would run the task with a prerequisite silently missing.
 */
export function evaluateDependencies(
  task: { readonly taskId: string; readonly dependsOn: readonly string[] },
  records: ReadonlyMap<string, TaskRecord>,
): DependencyVerdict {
  if (task.dependsOn.length === 0) {
    return {
      mayRun: true,
      permanentlyBlocked: false,
      statuses: [],
      summary: `Task "${task.taskId}" has no dependencies.`,
    };
  }

  const statuses: DependencyStatus[] = task.dependsOn.map((dependencyId) => {
    const record = records.get(dependencyId);
    if (record === undefined) {
      return {
        taskId: dependencyId,
        condition: "unavailable",
        blockedBy: [dependencyId],
        detail: `Dependency "${dependencyId}" is not present in this job. A missing prerequisite is never treated as satisfied.`,
      };
    }
    const condition = statusOf(record).condition;
    return {
      taskId: dependencyId,
      condition,
      blockedBy: [dependencyId],
      detail: `Dependency "${dependencyId}" is ${record.state}.`,
    };
  });

  const unsatisfied = statuses.filter((status) => status.condition !== SATISFIED);
  if (unsatisfied.length === 0) {
    return {
      mayRun: true,
      permanentlyBlocked: false,
      statuses,
      summary: `All ${statuses.length} dependencies of "${task.taskId}" are satisfied.`,
    };
  }

  // `failed`, `cancelled` and `unavailable` are all terminal for the prerequisite,
  // so waiting cannot help. That distinction is what lets a workflow finish as
  // "skipped" rather than waiting forever for something that will never happen.
  const permanent = unsatisfied.filter(
    (status) => status.condition === "failed" || status.condition === "cancelled" || status.condition === "unavailable",
  );

  return {
    mayRun: false,
    permanentlyBlocked: permanent.length > 0,
    statuses,
    summary:
      permanent.length > 0
        ? `Task "${task.taskId}" can never run: ${permanent.map((status) => `${status.taskId} (${status.condition})`).join(", ")}.`
        : `Task "${task.taskId}" is waiting on ${unsatisfied.map((status) => status.taskId).join(", ")}.`,
  };
}

/**
 * Whether a completed workflow may be reported as successful.
 *
 * Verification is NOT completion. A task that finished but did not verify leaves
 * the workflow incomplete, and this is where that rule lives rather than in each
 * caller.
 */
export function canReportWorkflowComplete(
  records: readonly TaskRecord[],
  verificationVerdicts: ReadonlyMap<string, "pass" | "fail" | "needs_review" | null>,
): { complete: boolean; unverified: readonly string[]; failed: readonly string[] } {
  const failed = records.filter((record) => record.state === "failed" || record.state === "skipped").map((record) => record.task.taskId);
  const unverified = records
    .filter((record) => record.task.approvalRequired || record.task.checkpointable)
    .filter((record) => {
      const verdict = verificationVerdicts.get(record.task.taskId);
      return verdict !== "pass";
    })
    .map((record) => record.task.taskId);

  return { complete: failed.length === 0 && unverified.length === 0, unverified, failed };
}

/** Tasks that are ready to be released, in a stable order. */
export function readyTasks(records: readonly TaskRecord[]): readonly TaskRecord[] {
  return records
    .filter((record) => record.state === "pending" || record.state === "ready")
    .filter((record) => evaluateDependencies(record.task, new Map(records.map((r) => [r.task.taskId, r]))).mayRun)
    .sort((a, b) => a.task.taskId.localeCompare(b.task.taskId));
}

/**
 * Every task that a permanently blocked prerequisite has made unreachable.
 *
 * Transitive, so a chain of five tasks where the first failed skips all five
 * rather than only the one immediately downstream.
 */
export function unreachableTasks(records: readonly TaskRecord[]): readonly string[] {
  const byId = new Map(records.map((record) => [record.task.taskId, record]));
  const out = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (out.has(record.task.taskId) || record.state !== "pending") {
        continue;
      }
      // A dependency this function has ALREADY decided is unreachable counts as
      // a blocker. So does a dependency that reached a terminal state WITHOUT
      // succeeding - failed, cancelled or skipped.
      //
      // A COMPLETED dependency is terminal too, and that is the trap: counting
      // mere terminality as blocking would skip the second task of every
      // sequential pair, because the first one always completes. Only an
      // unsatisfied terminal state blocks.
      const blockers = record.task.dependsOn.filter((id) => {
        if (out.has(id)) {
          return true;
        }
        const status = statusOf(byId.get(id));
        return status.isTerminal && status.condition !== SATISFIED;
      });
      if (blockers.length > 0) {
        out.add(record.task.taskId);
        changed = true;
        continue;
      }
      const verdict = evaluateDependencies(record.task, byId);
      if (verdict.permanentlyBlocked) {
        out.add(record.task.taskId);
        changed = true;
      }
    }
  }
  return [...out].sort();
}

export type { JobTaskState };
