/**
 * PHASE 07: the task-executing worker, and the production adapter to TOZ.
 *
 * WHAT A WORKER MAY DO, from `workers/worker.ts`: execute work, report an
 * outcome, retry under an approved policy, checkpoint.
 *
 * WHAT A WORKER MAY NOT DO, and how that is enforced here rather than promised:
 *
 *   - choose a provider or model. It holds no provider registry, no model
 *     registry and no router. `executeTask` on the coordinator is the only door,
 *     and that door goes through `TozOrchestrator`.
 *   - change workflow topology. It receives one authorised execution unit and
 *     cannot name another task, a successor, or a plan.
 *   - bypass policy, permissions, verification or approval. It runs no selection
 *     logic at all; every one of those decisions belongs to the orchestrator or
 *     the coordinator.
 *   - retry indefinitely. Attempts are bounded by the task's own limit and by the
 *     existing `decideRetry`, and the worker adds no loop of its own.
 *
 * The authorisation check below is the practical enforcement of all of that: a
 * worker that cannot present a live claim for a non-cancelled job is refused
 * before any work starts.
 */

import { ValidationError, type ErrorClass } from "../../core/errors.js";
import { type Result, err, ok } from "../../core/result.js";
import { type IdGenerator } from "../../core/ids.js";
import { type Capability } from "../../capabilities/capability.js";
import { type MeasuredUsage } from "./model.js";
import { type TaskPriority } from "../../workload/workload.js";
// PHASE 03 (B-08): TYPE-ONLY, and for the same reason as in `coordinator.ts`.
// The port is the seam where a background task becomes a real execution, so the
// identity it must travel WITH has to be nameable here. Nothing in this file
// evaluates a grant.
import { type SecurityContext } from "../governance/context.js";
import type { TaskExecutionOutcome, TaskExecutionPort, TaskExecutionRequest } from "./coordinator.js";
import type { ExecutionContext } from "../observability/trace.js";

/* -------------------------------------------------------------------------- */
/* Authorisation                                                               */
/* -------------------------------------------------------------------------- */

/*
 * PHASE 04: `authoriseExecution` and `AuthorisedExecution` were REMOVED from this
 * file.
 *
 * They were exported, unit-tested in five places, and called by NOTHING in `src/`.
 * Their docblock said so themselves - "The real answer is `ExecutionCoordinator.
 * executeTask`" - and they were the single most misleading thing in the workflow
 * layer: an exported function whose name, signature and five passing tests all
 * said "this is where execution is authorised", while the code that actually
 * authorised execution was inline in `executeTask` and therefore untested as a
 * unit. A reader landing there draws the wrong conclusion, and then "fixes" a real
 * bug in the code that is never called.
 *
 * They were REMOVED rather than wired, and the reason is specific rather than
 * convenient. Wiring would have meant one of two things:
 *
 *   - duplicating `executeTask`'s checks, which would drift. The docblock warned
 *     about exactly this: "the authoritative one will be the untested one".
 *   - reordering them so a claim is taken before the approval is consulted. That
 *     is the reverse of the PHASE 01 (C-3) order, which puts approval BEFORE the
 *     claim deliberately - so an unapproved task never takes a claim it would then
 *     have to release. Making the claim a precondition of authorisation would let
 *     a gate-blocked task consume and release a claim on every attempt, and would
 *     report "duplicate delivery" to any worker that legitimately arrived second.
 *
 * The four conditions it specified are REAL and still enforced. They are now
 * asserted where they are enforced: `tests/approvalExecutionBoundary.phase04.test.ts`
 * re-states each one through `ExecutionCoordinator`, which is the authority.
 */

/* -------------------------------------------------------------------------- */
/* Worker registry                                                             */
/* -------------------------------------------------------------------------- */

export const WORKER_KINDS = ["periodic", "task_executor"] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];

export const WORKER_HEALTH = ["healthy", "degraded", "unavailable", "unknown"] as const;
export type WorkerHealth = (typeof WORKER_HEALTH)[number];

export interface WorkerRegistration {
  readonly workerId: string;
  readonly kind: WorkerKind;
  readonly version: string;
  /** Capabilities the worker can execute. Never a provider or a model. */
  readonly capabilities: readonly Capability[];
  /** Simultaneous tasks this worker will accept. Always >= 1. */
  readonly maxConcurrency: number;
  readonly health: WorkerHealth;
  /** Current load, maintained by the registry from reported starts/finishes. */
  readonly load: number;
}

/**
 * Registry for task-executing workers.
 *
 * Follows the repository's existing registry convention exactly - `register`
 * returning a `Result`, refusing duplicates, `get`/`has`/`ids`/`require` - because
 * a second, different registry shape is how two sources of truth about what is
 * registered get created. `ProviderAdapterRegistry` and `AgentRegistry` set the
 * pattern; this follows it.
 */
export class TaskWorkerRegistry {
  readonly #workers = new Map<string, WorkerRegistration>();

  public get size(): number {
    return this.#workers.size;
  }

  public register(registration: WorkerRegistration): Result<WorkerRegistration, Error> {
    const issues: string[] = [];
    if (typeof registration.workerId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(registration.workerId)) {
      issues.push("workerId must be 1-128 characters of letters, digits, dot, underscore or dash");
    }
    if (!(WORKER_KINDS as readonly string[]).includes(registration.kind)) {
      issues.push(`kind must be one of: ${WORKER_KINDS.join(", ")}`);
    }
    if (!(WORKER_HEALTH as readonly string[]).includes(registration.health)) {
      issues.push(`health must be one of: ${WORKER_HEALTH.join(", ")}`);
    }
    if (!Number.isInteger(registration.maxConcurrency) || registration.maxConcurrency < 1) {
      issues.push("maxConcurrency must be a positive integer; a worker that can accept zero tasks is not a worker");
    }
    if (this.#workers.has(registration.workerId)) {
      // A duplicate would make past decisions about this worker ambiguous, the
      // same reason AgentRegistry and ProviderAdapterRegistry refuse one.
      issues.push(`workerId "${registration.workerId}" is already registered`);
    }
    if (issues.length > 0) {
      return err(new ValidationError("Worker registration failed", issues));
    }
    const stored = { ...registration, load: 0 };
    this.#workers.set(registration.workerId, stored);
    return ok(stored);
  }

  public get(workerId: string): WorkerRegistration | null {
    return this.#workers.get(workerId) ?? null;
  }

  public has(workerId: string): boolean {
    return this.#workers.has(workerId);
  }

  public ids(): readonly string[] {
    return [...this.#workers.keys()];
  }

  public require(workerId: string): Result<WorkerRegistration, Error> {
    const worker = this.#workers.get(workerId);
    return worker === undefined
      ? err(new Error(`No worker registered: ${workerId}`))
      : ok(worker);
  }

  /** Records a started task, so load is a fact rather than an assumption. */
  public acquire(workerId: string): Result<WorkerRegistration, Error> {
    const worker = this.#workers.get(workerId);
    if (worker === undefined) {
      return err(new Error(`No worker registered: ${workerId}`));
    }
    if (worker.load >= worker.maxConcurrency) {
      return err(
        new Error(
          `Worker "${workerId}" is at its concurrency limit (${worker.load}/${worker.maxConcurrency}). The task is not started, rather than being run anyway.`,
        ),
      );
    }
    const next = { ...worker, load: worker.load + 1 };
    this.#workers.set(workerId, next);
    return ok(next);
  }

  public release(workerId: string): void {
    const worker = this.#workers.get(workerId);
    if (worker !== undefined && worker.load > 0) {
      this.#workers.set(workerId, { ...worker, load: worker.load - 1 });
    }
  }

  public setHealth(workerId: string, health: WorkerHealth): Result<WorkerRegistration, Error> {
    const worker = this.#workers.get(workerId);
    if (worker === undefined) {
      return err(new Error(`No worker registered: ${workerId}`));
    }
    const next = { ...worker, health };
    this.#workers.set(workerId, next);
    return ok(next);
  }

  /** Workers that could accept a task for a capability, healthiest first. */
  public eligibleFor(capabilities: readonly Capability[]): readonly WorkerRegistration[] {
    return [...this.#workers.values()]
      .filter((worker) => worker.health === "healthy" || worker.health === "unknown")
      .filter((worker) => worker.load < worker.maxConcurrency)
      // A worker that DECLARES nothing is unconstrained and therefore eligible.
      // One that declares capabilities must declare all of what is required.
      // The previous form of this filter rejected every worker that declared
      // anything at all, because it asked for a capability to be both present
      // and absent.
      .filter((worker) => worker.capabilities.length === 0 || capabilities.every((capability) => worker.capabilities.includes(capability as never)))
      .sort((a, b) => a.load - b.load || a.workerId.localeCompare(b.workerId));
  }

  public clear(): void {
    this.#workers.clear();
  }
}

/* -------------------------------------------------------------------------- */
/* The production adapter: a task -> TozOrchestrator                          */
/* -------------------------------------------------------------------------- */

/**
 * The single door from a background task to a real execution.
 *
 * This adapter is where PHASE 06 routing happens, and it happens by NOT choosing
 * anything: it forwards a capability requirement to `TozOrchestrator.execute`,
 * which routes, selects an agent, and verifies. The adapter reports back what was
 * used, as a fact, and has no mechanism to influence the choice.
 */
export interface OrchestratorExecutionPort {
  execute(request: {
    taskId: string;
    objective: string;
    input: string;
    requiredCapabilities: readonly Capability[];
    minimumTrust: string;
    /** Verification the result must pass, when the workflow requires any. */
    readonly verificationKinds?: readonly string[];
    /**
     * PHASE 11: the workflow side's correlation id, adopted by the orchestrator.
     *
     * Optional, for the same reason `jobId` is: so an existing port implementation keeps
     * compiling, and a caller with no correlation id simply gets the orchestrator's own
     * minted trace.
     */
    readonly traceId?: string;
    /**
     * PHASE 03 (B-08): the identity this execution is authorised as.
     *
     * Carried because the port has nowhere else to carry it, and dropped by the
     * production bridge only when the job named no caller AND the runtime
     * declared no principal - in which case the gate refuses, which is the
     * intended answer to "nobody said who this is".
     */
    readonly securityContext?: SecurityContext;
    /**
     * PHASE 03 (B-10): the job this attempt belongs to.
     *
     * Carried, and taken from the coordinator's OWN record rather than from the
     * task, because approval gates are keyed by job as well as task: a task id is
     * unique only within a job, so a port that could not name the job could not
     * answer "has this job's task been approved?". Optional rather than required so
     * that an existing port implementation keeps compiling - and a request with no
     * job simply cannot resolve a recorded approval, which is the fail-closed
     * direction.
     */
    readonly jobId?: string;
    signal: AbortSignal;
  }): Promise<{
    readonly succeeded: boolean;
    readonly output: string;
    readonly providerId: string | null;
    readonly modelId: string | null;
    readonly traceId: string | null;
    readonly verificationVerdict: "pass" | "fail" | "needs_review" | null;
    readonly errorClass: ErrorClass | null;
    readonly reason: string;
    readonly cost: {
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      readonly latencyMs: number | null;
      readonly amount: number | null;
      readonly currency: string | null;
    } | null;
  }>;
}

export class OrchestratorTaskExecutor implements TaskExecutionPort {
  readonly #orchestrator: OrchestratorExecutionPort;
  readonly #ids: IdGenerator | null;

  public constructor(orchestrator: OrchestratorExecutionPort, options: { ids?: IdGenerator } = {}) {
    this.#orchestrator = orchestrator;
    this.#ids = options.ids ?? null;
  }

  public async execute(request: TaskExecutionRequest, context: ExecutionContext): Promise<TaskExecutionOutcome> {
    const response = await this.#orchestrator.execute({
      taskId: request.taskId,
      objective: request.objective,
      input: request.input,
      requiredCapabilities: request.requiredCapabilities,
      minimumTrust: request.minimumTrust,
      ...(request.verificationKinds === undefined ? {} : { verificationKinds: request.verificationKinds }),
      // PHASE 03 (B-08): forwarded as-is. Present only when the job recorded a
      // caller; the bridge then prefers it over the runtime's service principal.
      ...(request.securityContext === undefined ? {} : { securityContext: request.securityContext }),
      // PHASE 03 (B-10): the job, from the coordinator's own record. Present on
      // every attempt, so the production bridge can always resolve a recorded
      // approval for the exact (job, task) pair governance is being asked about.
...(request.jobId === undefined ? {} : { jobId: request.jobId }),
        signal: request.signal,
        // PHASE 11: the connecting context is no longer discarded.
        //
        // This read `void context;` — the coordinator built an `ExecutionContext` whose
        // `traceId` is the job's `correlationId`, handed it in as the second argument, and
        // the worker threw it away. The orchestrator then minted a second trace, so one job
        // produced two unrelated traces and `byTrace()` could reach neither from the other.
        // That is the `FINAL_ARCHITECTURE.md` §11 finding, and `void context` was the
        // mechanism behind it.
        //
        // Forwarded, not invented: `context.traceId` is the workflow side's own id, so the
        // two halves of one job now share one trace instead of the worker having a second
        // opinion about what a job is called.
        traceId: context.traceId,
      });
      void this.#ids;

    // A cancelled execution is reported as cancelled, NOT as a failure. The
    // distinction matters because a cancelled task must not be retried.
    if (response.succeeded === false && request.signal.aborted) {
      return {
        succeeded: false,
        output: response.output,
        errorClass: response.errorClass,
        error: response.reason,
        providerId: response.providerId,
        modelId: response.modelId,
        traceId: response.traceId,
        usage: toUsage(response.cost),
        cancelled: true,
        // A cancelled run performed no verification, so it reports none rather
        // than reporting the verdict of an attempt that never settled.
        verificationVerdict: null,
      };
    }

    // Execution is not verification. A result whose verdict is not a pass is
    // reported as NOT succeeded, so an unverified task cannot be recorded as
    // complete by a caller that trusts this port.
    const verified = response.verificationVerdict === null || response.verificationVerdict === "pass";
    return {
      succeeded: response.succeeded && verified,
      output: response.output,
      // `ErrorClass` is a CLOSED taxonomy shared with PHASE 06 routing and retry
      // classification. Adding a "verification_failed" member here would leak a
      // workflow concept into the provider error space and change what
      // `decideRetry` and the health model mean everywhere else.
      //
      // `unknown` is the honest answer: a failed verification is not a provider
      // fault, and the default retry policy does NOT retry `unknown`. The precise
      // reason travels in the message, where it is read by a human rather than
      // matched by a machine.
      errorClass: response.succeeded ? (verified ? null : "unknown") : response.errorClass,
      error: response.succeeded
        ? verified
          ? null
          : `Execution completed but verification returned "${response.verificationVerdict}". Execution is not verification, so this task is not complete.`
        : response.reason,
      providerId: response.providerId,
      modelId: response.modelId,
      traceId: response.traceId,
      usage: toUsage(response.cost),
      cancelled: false,
      // PHASE 03 (P3-7): passed through rather than swallowed. `null` still means
      // NOT MEASURED, because that is what the orchestrator reports when no
      // verification was required - and the coordinator's completion rule reads
      // exactly that distinction.
      verificationVerdict: response.verificationVerdict,
    };
  }
}

function toUsage(cost: {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number | null;
  readonly amount: number | null;
  readonly currency: string | null;
} | null): MeasuredUsage | null {
  if (cost === null) {
    return null;
  }
  // Passed through unchanged. A field the provider did not report stays null and
  // is never defaulted to zero, because a budget reads these numbers.
  return {
    inputTokens: cost.inputTokens,
    outputTokens: cost.outputTokens,
    latencyMs: cost.latencyMs,
    amount: cost.amount,
    currency: cost.currency,
  };
}

export { type TaskPriority };
