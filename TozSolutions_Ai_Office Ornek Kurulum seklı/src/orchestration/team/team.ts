/**
 * Team and swarm runtime.
 *
 * A team is a COORDINATION SCOPE with an id, not a process. It records which
 * subtasks belong to one objective and what the collective result was.
 *
 * The runtime executes a validated `ExecutionPlan` under a declared `Topology`.
 * It does not invent plans, does not choose agents, and does not verify — those
 * are the orchestrator's, the pool's, and the verifier's respectively. The
 * runtime's whole job is ordering, concurrency, and failure propagation.
 *
 * The smallest sufficient topology is a requirement, not a preference: a task one
 * capable agent can finish must not be given a swarm. `TeamPlan.choose` enforces
 * that, and records the topology it chose.
 */

import { type Result, err, ok } from "../../core/result.js";
import { type ErrorClass } from "../../core/errors.js";
import { type ExecutionPlan, type SubTask, readySubtasks } from "../task/plan.js";
import {
  type Topology,
  allowsConcurrency,
  smallestSufficientTopology,
  topologyFits,
} from "./topology.js";

/** How long a subtask may run before the runtime abandons it. */
export interface SubtaskOutcome {
  readonly taskId: string;
  readonly status: "succeeded" | "failed" | "skipped" | "escalated";
  readonly output: string;
  readonly errorClass: ErrorClass | null;
  /** Why it failed, in words. A classification alone does not explain a failure. */
  readonly message: string | null;
  readonly durationMs: number | null;
  /** Agent key that executed it, when one was assigned. */
  readonly agentId: string | null;
  /** True when a dependency failed, so this was never attempted. */
  readonly skippedDueToDependency: boolean;
  /** Attempts made, including the first. 1 means it was never retried. */
  readonly attempts: number;
}

/** A team's collective result. */
export interface TeamResult {
  readonly teamId: string;
  readonly planId: string;
  readonly objective: string;
  readonly topology: Topology;
  readonly outcomes: readonly SubtaskOutcome[];
  readonly succeeded: readonly string[];
  readonly failed: readonly string[];
  readonly skipped: readonly string[];
  /** Subtasks whose failure was terminal for them but is a decision for a human. */
  readonly escalated: readonly string[];
  readonly terminalOutput: string | null;
  readonly status: "succeeded" | "failed" | "partial" | "escalated";
  readonly reason: string;
}

export interface Team {
  readonly teamId: string;
  readonly planId: string;
  readonly objective: string;
  readonly topology: Topology;
  readonly memberTaskIds: readonly string[];
}

/**
 * Builds a team from a plan.
 *
 * Topology is CHOSEN, not requested, when the plan is small enough that a swarm
 * would be wasteful. A caller may still ask for a hierarchy explicitly, which is
 * how a genuinely large workflow opts in.
 */
export class TeamPlan {
  static choose(
    plan: ExecutionPlan,
    options: { requestedTopology?: Topology } = {},
  ): Result<Team, Error> {
    const ordered = plan.subtasks.every((subtask, index) =>
      index === 0
        ? subtask.dependsOn.length === 0
        : subtask.dependsOn.includes(plan.subtasks[index - 1]?.taskId ?? ""),
    );
    const smallest = smallestSufficientTopology(plan.subtasks.length, ordered);
    const topology = options.requestedTopology ?? smallest;

    if (!topologyFits(topology, plan.subtasks.length)) {
      return err(
        new Error(
          `Topology "${topology}" does not fit a plan with ${plan.subtasks.length} subtask(s); "${smallest}" would suffice`,
        ),
      );
    }

    return ok({
      teamId: `team-${plan.planId}`,
      planId: plan.planId,
      objective: plan.objective,
      topology,
      memberTaskIds: plan.subtasks.map((subtask) => subtask.taskId),
    });
  }
}

/** Executes one subtask. Supplied by the orchestrator, which owns agents. */
export type SubtaskExecutor = (
  subtask: SubTask,
  context: {
    readonly teamId: string;
    readonly traceId: string;
    readonly signal?: AbortSignal;
    /** Which attempt this is. 1 = first try. Present because a retried subtask
     *  produces several evidence records, and they must be distinguishable. */
    readonly attempt: number;
  },
) => Promise<Result<string, { readonly errorClass: ErrorClass; readonly message: string }>>;

export interface TeamRuntimeOptions {
  readonly executor: SubtaskExecutor;
  /** Maximum subtasks in flight at once. */
  readonly maxConcurrency?: number;
  /** Per-subtask budget. A subtask exceeding it is failed, not retried forever. */
  readonly subtaskTimeoutMs?: number;
  readonly onEvent?: (event: {
    readonly kind:
      | "subtask_started"
      | "subtask_retried"
      | "subtask_completed"
      | "subtask_failed"
      | "subtask_skipped"
      | "subtask_escalated";
    readonly taskId: string;
    readonly teamId: string;
    /** Which attempt this event belongs to. 1-based. */
    readonly attempt: number;
    readonly errorClass?: ErrorClass;
  }) => void;
}

/**
 * Error classes a subtask may be retried for.
 *
 * Narrow on purpose. A permanent failure - bad request, bad credentials, an
 * invalid model - retried three times is three times the cost and the same
 * refusal. A transient failure retried once may well succeed, and not retrying it
 * throws away work that was nearly done.
 */
const RETRYABLE: ReadonlySet<ErrorClass> = new Set<ErrorClass>([
  "timeout",
  "transient_provider_failure",
  "rate_limit",
  "temporary_outage",
]);

export function isRetryableSubtaskFailure(errorClass: ErrorClass): boolean {
  return RETRYABLE.has(errorClass);
}

/**
 * Failure classes that need a person rather than another attempt.
 *
 * Rate limiting is transient and the queue is deep; a bad credential, an
 * exhausted quota or a model that does not exist will fail identically forever,
 * and retrying only delays the moment someone is told. Those are routed to
 * escalation.
 *
 * `configuration_error` is deliberately NOT here. A missing agent, adapter or
 * route is a deployment problem this system reports as a failure, and PHASE 04
 * established that contract: promoting it to escalation would change an
 * already-validated outcome on the strength of a new code path rather than a new
 * requirement.
 */
const ESCALATING: ReadonlySet<ErrorClass> = new Set<ErrorClass>([
  "authentication_failure",
  "quota_exhausted",
  "invalid_model",
]);

export function isEscalatingFailure(errorClass: ErrorClass): boolean {
  return ESCALATING.has(errorClass);
}

/**
 * Executes a plan.
 *
 * Dependency order is respected: a subtask runs only once its dependencies are
 * complete. A failure propagates to everything downstream, which is why skipped
 * subtasks are reported as skipped rather than silently absent.
 */
export class TeamRuntime {
  readonly #options: TeamRuntimeOptions;

  public constructor(options: TeamRuntimeOptions) {
    this.#options = options;
  }

  public async run(
    team: Team,
    plan: ExecutionPlan,
    context: { readonly traceId: string; readonly signal?: AbortSignal },
  ): Promise<Result<TeamResult, Error>> {
    const maxConcurrency = Math.max(1, this.#options.maxConcurrency ?? (allowsConcurrency(team.topology) ? 4 : 1));
    const timeoutMs = this.#options.subtaskTimeoutMs ?? plan.limits.timeoutMs;
    const completed = new Set<string>();
    const failed = new Set<string>();
    const outcomes: SubtaskOutcome[] = [];

    let guard = 0;
    const maxIterations = plan.subtasks.length * plan.subtasks.length + plan.subtasks.length + 1;

    while (outcomes.length < plan.subtasks.length) {
      guard += 1;
      if (guard > maxIterations) {
        return err(
          new Error(
            `Team "${team.teamId}" did not converge after ${guard} scheduling rounds; this indicates a dependency problem`,
          ),
        );
      }

      const ready = readySubtasks(plan, completed).filter(
        (subtask) => !outcomes.some((outcome) => outcome.taskId === subtask.taskId),
      );

      if (ready.length === 0) {
        // Anything left cannot run: its dependencies failed.
        for (const subtask of plan.subtasks) {
          if (outcomes.some((outcome) => outcome.taskId === subtask.taskId)) continue;
          if (subtask.dependsOn.some((id) => failed.has(id))) {
            failed.add(subtask.taskId);
            const outcome: SubtaskOutcome = {
              taskId: subtask.taskId,
              status: "skipped",
              output: "",
              errorClass: null,
              message: `Skipped because a dependency (${subtask.dependsOn.filter((id) => failed.has(id)).join(", ")}) did not complete`,
              durationMs: null,
              agentId: null,
              skippedDueToDependency: true,
              attempts: 0,
            };
            outcomes.push(outcome);
            // 0 attempts: it was never run, so a retry counter of 1 would be a
            // claim that something happened.
            this.#options.onEvent?.({
              kind: "subtask_skipped",
              taskId: subtask.taskId,
              teamId: team.teamId,
              attempt: 0,
            });
          }
        }
        if (ready.length === 0 && outcomes.length >= plan.subtasks.length) {
          break;
        }
        if (ready.length === 0) {
          break;
        }
        continue;
      }

      const batch = ready.slice(0, maxConcurrency);
      const results = await Promise.all(
        batch.map(async (subtask) => {
          // Bounded retry. `SubTaskLimits.maxRetries` was declared, validated and
          // drift-checked, and then never used: a failed subtask used to be final
          // regardless of what the plan allowed. Only transient classes are
          // retried, and the budget comes from the plan, not from here.
          const maxAttempts = Math.max(1, (subtask.limits.maxRetries ?? 0) + 1);
          const started = Date.now();
          let last: { errorClass: ErrorClass; message: string } | null = null;

          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            this.#options.onEvent?.({
              kind: attempt === 1 ? "subtask_started" : "subtask_retried",
              taskId: subtask.taskId,
              teamId: team.teamId,
              attempt,
            });
            const timed = this.#withTimeout(
              subtask,
              { teamId: team.teamId, traceId: context.traceId, signal: context.signal, attempt },
              timeoutMs,
            );
            const result = await timed;

            if (result.ok) {
              this.#options.onEvent?.({
                kind: "subtask_completed",
                taskId: subtask.taskId,
                teamId: team.teamId,
                attempt,
              });
              return {
                taskId: subtask.taskId,
                status: "succeeded" as const,
                output: result.value,
                errorClass: null,
                message: null,
                durationMs: Date.now() - started,
                agentId: null,
                skippedDueToDependency: false,
                attempts: attempt,
              } satisfies SubtaskOutcome;
            }

            last = result.error;
            const retryable = isRetryableSubtaskFailure(result.error.errorClass) && attempt < maxAttempts;
            if (retryable) {
              continue;
            }
            // A failure that will not be retried. One that needs a human is
            // reported as escalated rather than failed, because those are
            // different queues and a caller should not have to re-derive which.
            const needsHuman = isEscalatingFailure(result.error.errorClass);
            this.#options.onEvent?.({
              kind: needsHuman ? "subtask_escalated" : "subtask_failed",
              taskId: subtask.taskId,
              teamId: team.teamId,
              attempt,
              errorClass: result.error.errorClass,
            });
            return {
              taskId: subtask.taskId,
              status: needsHuman ? "escalated" : "failed",
              output: "",
              errorClass: result.error.errorClass,
              message: result.error.message,
              durationMs: Date.now() - started,
              agentId: null,
              skippedDueToDependency: false,
              attempts: attempt,
            } satisfies SubtaskOutcome;
          }

          // Unreachable: the loop either returns or exhausts its budget on the
          // final attempt. Present so a future edit cannot fall through to a
          // success-shaped result.
          return {
            taskId: subtask.taskId,
            status: "failed" as const,
            output: "",
            errorClass: last?.errorClass ?? "unknown",
            message: last?.message ?? "Subtask exhausted its retry budget without a result",
            durationMs: Date.now() - started,
            agentId: null,
            skippedDueToDependency: false,
            attempts: maxAttempts,
          } satisfies SubtaskOutcome;
        }),
      );

      for (const outcome of results) {
        outcomes.push(outcome);
        if (outcome.status === "succeeded") {
          completed.add(outcome.taskId);
        } else if (outcome.status === "escalated") {
          // Escalated is a terminal failure for the plan: its dependents cannot
          // run, and waiting is a decision for a human, not for the scheduler.
          failed.add(outcome.taskId);
        } else {
          failed.add(outcome.taskId);
        }
      }
    }

    const terminal = plan.terminalTaskId
      ? (outcomes.find((outcome) => outcome.taskId === plan.terminalTaskId) ?? null)
      : null;

    const succeeded = [...completed];
    const failedIds = [...failed];
    const firstFailure =
      outcomes.find((outcome) => outcome.status === "failed" || outcome.status === "escalated") ?? null;
    const skipped = outcomes.filter((outcome) => outcome.status === "skipped").map((outcome) => outcome.taskId);
    const escalated = outcomes.filter((outcome) => outcome.status === "escalated").map((outcome) => outcome.taskId);
    // Escalation outranks failure in the summary: a plan that needs a human is a
    // different situation from one that merely broke, and a caller reading only
    // the status should see the more urgent one.
    const status: TeamResult["status"] =
      escalated.length > 0
        ? "escalated"
        : failedIds.length === 0
          ? "succeeded"
          : succeeded.length === 0
            ? "failed"
            : "partial";

    return ok({
      teamId: team.teamId,
      planId: plan.planId,
      objective: plan.objective,
      topology: team.topology,
      outcomes,
      succeeded,
      failed: failedIds,
      skipped,
      escalated,
      terminalOutput: terminal?.output ?? null,
      status,
      reason:
        status === "succeeded"
          ? `All ${succeeded.length} subtask(s) completed under topology "${team.topology}"`
          : // The first failure's own message is included, because "1 subtask
            // failed" tells a caller nothing they can act on.
            `${failedIds.length} subtask(s) did not complete, ${escalated.length} escalated, ${skipped.length} skipped, ${succeeded.length} succeeded` +
            (firstFailure === null
              ? ""
              : `; first failure ${firstFailure.taskId}: ${firstFailure.message ?? firstFailure.errorClass ?? "unknown"}`),
    });
  }

  async #withTimeout(
    subtask: SubTask,
    context: {
      readonly teamId: string;
      readonly traceId: string;
      readonly signal?: AbortSignal;
      readonly attempt: number;
    },
    timeoutMs: number,
  ): Promise<Result<string, { readonly errorClass: ErrorClass; readonly message: string }>> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    context.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.max(1, subtask.limits.timeoutMs || timeoutMs));
    timer.unref?.();
    try {
      return await this.#options.executor(subtask, { ...context, signal: controller.signal, attempt: context.attempt });
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", onAbort);
    }
  }
}
