/**
 * Anti-drift.
 *
 * WHY. In a multi-agent run, the failure mode is rarely a crash. It is a run
 * that succeeds at something other than the objective: a subtask quietly widens
 * its own scope, agents spawn agents until the run is unaffordable, or a retry
 * loop turns one task into fifty.
 *
 * Drift is prevented structurally, not by asking agents to behave. A plan
 * declares its limits BEFORE execution, and `DriftGuard` refuses to run a plan
 * that exceeds them. An agent cannot widen its own budget, because the budget is
 * not something the agent holds.
 *
 * Every check is recorded, including the ones that pass, so "the plan was
 * checked" is an observable fact rather than an assumption.
 */

import { type ExecutionPlan, type SubTask, findDependencyCycle } from "../task/plan.js";

/** Bounds a run may not exceed. */
export interface DriftLimits {
  /** Deepest subtask nesting permitted. */
  readonly maxDepth: number;
  /** Total subtasks across the plan. */
  readonly maxSubtasks: number;
  /** Wall-clock budget for the whole plan. */
  readonly deadlineMs: number;
  /** Retries permitted for any single subtask. */
  readonly maxRetries: number;
  /** Total agents that may be selected at one time. */
  readonly maxConcurrentAgents: number;
  /** True when the plan must produce verifiable evidence. */
  readonly verificationRequired: boolean;
}

export const DEFAULT_DRIFT_LIMITS: DriftLimits = {
  maxDepth: 3,
  maxSubtasks: 24,
  deadlineMs: 300_000,
  maxRetries: 3,
  maxConcurrentAgents: 4,
  verificationRequired: false,
};

export interface DriftViolation {
  readonly kind:
    | "too_many_subtasks"
    | "depth_exceeded"
    | "deadline_exceeded"
    | "retries_exceeded"
    | "dependency_cycle"
    | "missing_verification";
  readonly detail: string;
  readonly subject: string | null;
}

export interface DriftAssessment {
  readonly allowed: boolean;
  readonly violations: readonly DriftViolation[];
  readonly assessedAt: number;
  /** Facts observed, recorded whether or not they passed. */
  readonly observed: Readonly<Record<string, number | boolean>>;
}

const INVALID_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Validates a plan against drift limits.
 *
 * Pure and total. Returns every violation rather than the first, so a plan
 * author can fix them in one pass.
 */
export function assessPlanDrift(
  plan: ExecutionPlan,
  limits: DriftLimits,
  assessedAt: number,
): DriftAssessment {
  const violations: DriftViolation[] = [];

  if (plan.subtasks.length > limits.maxSubtasks) {
    violations.push({
      kind: "too_many_subtasks",
      detail: `Plan declares ${plan.subtasks.length} subtasks, exceeding the limit of ${limits.maxSubtasks}`,
      subject: plan.planId,
    });
  }

  const depth = computeDepth(plan);
  if (depth > limits.maxDepth) {
    violations.push({
      kind: "depth_exceeded",
      detail: `Plan nesting reaches depth ${depth}, exceeding the limit of ${limits.maxDepth}`,
      subject: plan.planId,
    });
  }

  if (plan.limits.timeoutMs > limits.deadlineMs) {
    violations.push({
      kind: "deadline_exceeded",
      detail: `Plan budget of ${plan.limits.timeoutMs}ms exceeds the deadline of ${limits.deadlineMs}ms`,
      subject: plan.planId,
    });
  }

  for (const subtask of plan.subtasks) {
    if (subtask.limits.maxRetries > limits.maxRetries) {
      violations.push({
        kind: "retries_exceeded",
        detail: `Subtask ${subtask.taskId} allows ${subtask.limits.maxRetries} retries, exceeding the limit of ${limits.maxRetries}`,
        subject: subtask.taskId,
      });
    }
    if (subtask.limits.maxChildren > limits.maxSubtasks) {
      violations.push({
        kind: "depth_exceeded",
        detail: `Subtask ${subtask.taskId} may create ${subtask.limits.maxChildren} children, more than the plan total of ${limits.maxSubtasks}`,
        subject: subtask.taskId,
      });
    }
  }

  const cycle = findDependencyCycle(plan.subtasks);
  if (cycle !== null) {
    violations.push({
      kind: "dependency_cycle",
      detail: `Dependency cycle: ${cycle.join(" -> ")}`,
      subject: plan.planId,
    });
  }

  if (limits.verificationRequired && plan.verificationKinds.length === 0) {
    violations.push({
      kind: "missing_verification",
      detail: "Verification is required for this task, but the plan declares no verification kinds",
      subject: plan.planId,
    });
  }

  for (const subtask of plan.subtasks) {
    if (INVALID_ID.test(subtask.taskId) && subtask.parentTaskId === "") {
      violations.push({
        kind: "depth_exceeded",
        detail: `Subtask ${subtask.taskId} has no parent`,
        subject: subtask.taskId,
      });
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    assessedAt,
    observed: {
      subtaskCount: plan.subtasks.length,
      depth,
      planTimeoutMs: plan.limits.timeoutMs,
      planMaxChildren: plan.limits.maxChildren,
      verificationKinds: plan.verificationKinds.length,
      hasTerminal: plan.terminalTaskId !== null,
    },
  };
}

/** Depth is derived from the dependency graph, since parents are all the root. */
function computeDepth(plan: ExecutionPlan): number {
  const byId = new Map<string, SubTask>();
  for (const subtask of plan.subtasks) {
    byId.set(subtask.taskId, subtask);
  }
  const depthOf = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const subtask = byId.get(id);
    if (!subtask || subtask.dependsOn.length === 0) return 1;
    return 1 + Math.max(...subtask.dependsOn.map((dependency) => depthOf(dependency, seen)));
  };
  return plan.subtasks.reduce((deepest, subtask) => Math.max(deepest, depthOf(subtask.taskId, new Set())), 0);
}

/**
 * Stateful guard.
 *
 * Holds the limits and accumulates assessments, so the audit can show what was
 * checked. It does not execute: it only decides whether execution may proceed.
 */
export class DriftGuard {
  readonly #limits: DriftLimits;
  readonly #assessments: DriftAssessment[] = [];

  public constructor(limits: Partial<DriftLimits> = {}) {
    this.#limits = { ...DEFAULT_DRIFT_LIMITS, ...limits };
  }

  public get limits(): DriftLimits {
    return this.#limits;
  }

  public assess(plan: ExecutionPlan, assessedAt: number): DriftAssessment {
    const assessment = assessPlanDrift(plan, this.#limits, assessedAt);
    this.#assessments.push(assessment);
    return assessment;
  }

  public get assessments(): readonly DriftAssessment[] {
    return [...this.#assessments];
  }

  public get assessmentCount(): number {
    return this.#assessments.length;
  }
}
