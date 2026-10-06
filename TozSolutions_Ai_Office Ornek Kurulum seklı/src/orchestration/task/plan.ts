/**
 * Execution plan and task decomposition.
 *
 * A plan is the STRUCTURED result of decomposition: a parent objective broken
 * into subtasks, each with its own capability requirement, contract, budget and
 * verification requirement, plus the dependencies between them.
 *
 * WHY A DECLARATIVE PLAN. PHASE 04 must prevent uncontrolled recursive spawning.
 * That is only enforceable if the shape of the work is a value that can be
 * inspected and bounded BEFORE anything runs. A plan is that value. A
 * `TeamRuntime` executes a plan; it does not invent one.
 *
 * The planner is an interface, not an implementation. Nothing in the core
 * decomposes a task on its own â€” a caller supplies a plan, or supplies a
 * planner that produces one. PHASE 04 does not include a heuristic decomposer,
 * because a plausible-looking automatic decomposition would be a guess.
 */

import { type Capability } from "../../capabilities/capability.js";
import { ValidationError } from "../../core/errors.js";
import { err, ok, type Result } from "../../core/result.js";
import { type Topology } from "../team/topology.js";
import { type VerificationKind } from "../verification/verifier.js";

/** A subtask's own execution budget. Independent of the parent's. */
export interface SubTaskLimits {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Subtasks this subtask may itself create. Zero for a leaf. */
  readonly maxChildren: number;
}

export interface SubTask {
  readonly taskId: string;
  readonly parentTaskId: string;
  readonly objective: string;
  readonly requiredCapabilities: readonly Capability[];
  readonly input: string;
  /** What the subtask is expected to produce. */
  readonly expectedOutput: string;
  /** Subtask ids that must complete first. */
  readonly dependsOn: readonly string[];
  readonly limits: SubTaskLimits;
  /** Verifiers that must pass. Empty means no verification is required. */
  readonly verificationKinds: readonly VerificationKind[];
  /** Agent role expected to take this subtask. A hint, not a binding. */
  readonly suggestedRole?: string;
}

export interface ExecutionPlan {
  readonly planId: string;
  readonly rootTaskId: string;
  /** The mission statement. Subagents may not redefine it. */
  readonly objective: string;
  readonly topology: Topology;
  readonly subtasks: readonly SubTask[];
  readonly limits: SubTaskLimits;
  /** Verifiers that apply to the plan as a whole. */
  readonly verificationKinds: readonly VerificationKind[];
  /**
   * The subtask whose output is the plan's result.
   * null when every subtask contributes to a synthesis step.
   */
  readonly terminalTaskId: string | null;
}

const TASK_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Structural validation. Does not judge whether the plan is a good plan. */
export function validatePlan(plan: ExecutionPlan): Result<ExecutionPlan, ValidationError> {
  const issues: string[] = [];

  if (typeof plan.planId !== "string" || !TASK_ID_PATTERN.test(plan.planId)) {
    issues.push("planId must be 1-128 characters of letters, digits, dot, underscore or dash");
  }
  if (typeof plan.rootTaskId !== "string" || !TASK_ID_PATTERN.test(plan.rootTaskId)) {
    issues.push("rootTaskId must be a valid task id");
  }
  if (typeof plan.objective !== "string" || plan.objective.trim() === "") {
    issues.push("objective must be a non-empty mission statement");
  }
  if (plan.subtasks.length === 0) {
    issues.push("a plan must contain at least one subtask");
  }

  const ids = new Set<string>();
  for (const subtask of plan.subtasks) {
    if (!TASK_ID_PATTERN.test(subtask.taskId)) {
      issues.push(`subtask id is invalid: ${subtask.taskId}`);
      continue;
    }
    if (ids.has(subtask.taskId)) {
      issues.push(`duplicate subtask id: ${subtask.taskId}`);
    }
    ids.add(subtask.taskId);
    if (subtask.parentTaskId !== plan.rootTaskId) {
      issues.push(`subtask ${subtask.taskId} must name the root task as its parent`);
    }
    if (subtask.objective.trim() === "") {
      issues.push(`subtask ${subtask.taskId} needs a non-empty objective`);
    }
    if (subtask.expectedOutput.trim() === "") {
      issues.push(`subtask ${subtask.taskId} needs a non-empty expectedOutput`);
    }
    issues.push(...validateLimits(`subtask ${subtask.taskId}`, subtask.limits));
  }

  for (const subtask of plan.subtasks) {
    for (const dependency of subtask.dependsOn) {
      if (!ids.has(dependency)) {
        issues.push(`subtask ${subtask.taskId} depends on unknown subtask ${dependency}`);
      }
      if (dependency === subtask.taskId) {
        issues.push(`subtask ${subtask.taskId} depends on itself`);
      }
    }
  }

  if (plan.terminalTaskId !== null && !ids.has(plan.terminalTaskId)) {
    issues.push(`terminalTaskId ${plan.terminalTaskId} is not a subtask of this plan`);
  }

  issues.push(...validateLimits("plan", plan.limits));

  // A cycle would deadlock the runtime, and is only detectable before running.
  const cycle = findDependencyCycle(plan.subtasks);
  if (cycle !== null) {
    issues.push(`subtask dependencies contain a cycle: ${cycle.join(" -> ")}`);
  }

  if (issues.length > 0) {
    return err(new ValidationError("Execution plan validation failed", issues));
  }
  return ok(plan);
}

function validateLimits(label: string, limits: SubTaskLimits): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(limits.timeoutMs) || limits.timeoutMs <= 0) {
    issues.push(`${label}.timeoutMs must be a positive integer`);
  }
  if (!Number.isInteger(limits.maxRetries) || limits.maxRetries < 0) {
    issues.push(`${label}.maxRetries must be a non-negative integer`);
  }
  if (!Number.isInteger(limits.maxChildren) || limits.maxChildren < 0) {
    issues.push(`${label}.maxChildren must be a non-negative integer`);
  }
  return issues;
}

/** Returns the cycle path, or null when the graph is acyclic. */
export function findDependencyCycle(subtasks: readonly SubTask[]): readonly string[] | null {
  const byId = new Map<string, SubTask>();
  for (const subtask of subtasks) {
    byId.set(subtask.taskId, subtask);
  }
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  const visit = (id: string): readonly string[] | null => {
    const current = state.get(id);
    if (current === "done") return null;
    if (current === "visiting") {
      const start = path.indexOf(id);
      return [...path.slice(start === -1 ? 0 : start), id];
    }
    state.set(id, "visiting");
    path.push(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dependency)) {
        const found = visit(dependency);
        if (found !== null) return found;
      }
    }
    path.pop();
    state.set(id, "done");
    return null;
  };

  for (const subtask of subtasks) {
    const found = visit(subtask.taskId);
    if (found !== null) return found;
  }
  return null;
}

/** Subtasks with no unmet dependency, in declaration order. */
export function readySubtasks(plan: ExecutionPlan, completed: ReadonlySet<string>): readonly SubTask[] {
  return plan.subtasks.filter(
    (subtask) => !completed.has(subtask.taskId) && subtask.dependsOn.every((id) => completed.has(id)),
  );
}

/** Transitive dependents of a subtask. Used to compute a total impact set. */
export function dependentsOf(plan: ExecutionPlan, taskId: string): readonly string[] {
  const dependents: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const subtask of plan.subtasks) {
      if (dependents.includes(subtask.taskId)) continue;
      if (subtask.dependsOn.includes(taskId) || subtask.dependsOn.some((d) => dependents.includes(d))) {
        dependents.push(subtask.taskId);
        changed = true;
      }
    }
  }
  return dependents;
}

/**
 * A planner produces a plan.
 *
 * The core does not implement one. A caller supplies a planner (a future phase,
 * a test, or an external system) and the orchestrator executes the result.
 */
export interface TaskPlanner {
  readonly name: string;
  plan(input: {
    readonly rootTaskId: string;
    readonly objective: string;
    readonly requiredCapabilities: readonly Capability[];
    readonly maxSubtasks: number;
  }): Promise<Result<ExecutionPlan, Error>>;
}
