/**
 * PHASE 07: the execution coordinator.
 *
 * WHAT THIS IS: the single authority for JOB state. It decides which task may be
 * released, whether a failure is retried, whether the workflow continues, and
 * whether the job is complete. Every job transition passes through here and is
 * recorded, including the ones it refuses.
 *
 * WHAT THIS IS NOT: a second orchestrator. It has no agent registry, no provider
 * registry, no model registry, no routing, no memory, and no verification. To
 * execute a task it calls a `TaskExecutionPort` - in production an adapter around
 * `TozOrchestrator.execute`, which is the ONLY place a provider or model is ever
 * chosen. This file cannot name a provider because it has no way to learn one.
 *
 * The delegation is a hard boundary rather than a convention: the coordinator
 * holds no reference to a provider registry, so "a worker picked its own model"
 * is not a rule it could break, it is a capability it does not have.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { type ErrorClass } from "../../core/errors.js";
import { type Capability } from "../../capabilities/capability.js";
import { ConcurrencyManager } from "../../concurrency/limiter.js";
import {
  type BackoffPolicy,
  type RetryPolicy,
  decideRetry,
  DEFAULT_BACKOFF,
} from "../../retry/policy.js";
import type { TraceRecorder, OrchestrationEventKind, ExecutionContext } from "../observability/trace.js";
import { tryWorkspaceOf, workspaceKey, type WorkspaceRef } from "../workspace/workspace.js";
import {
  type ApprovalGate,
  type CancellationRequest,
  type Execution,
  type ExecutionAttempt,
  type ExecutionFailure,
  type ExecutionResult,
  type Job,
  type JobTaskState,
  type MeasuredUsage,
  type ResourceBudget,
  type TaskRecord,
  type Workflow,
  type WorkflowTask,
} from "./model.js";
import {
  type JobState,
  type JobTransitionRecord,
  type WaitingReason,
  JobStateError,
  assertJobTransition,
  isTerminalJobState,
} from "./jobState.js";
import { type TaskPriority } from "../../workload/workload.js";
// PHASE 03 (B-08/B-05). TYPE-ONLY, and the same reason as in `model.ts`: the
// coordinator transports the identity of the party whose work an approval would
// accept, so it must be able to NAME that identity. It never reads a grant and
// never asks permission - `governance.architecture.test.ts` and the
// `\.authorize\(` scan below both hold it to that.
import { type SecurityContext } from "../governance/context.js";
import { evaluateDependencies, readyTasks, unreachableTasks } from "./dependencies.js";
import { ClaimRegistry, IdempotencyLedger, type Claim } from "./claims.js";
import { ApprovalError, ApprovalRegistry, CheckpointStore, taskKey } from "./gates.js";
import { PREDICATE_FORMS, evaluatePredicate, flattenWorkflow } from "./model.js";
import { InMemoryDurableStore } from "../../state/inMemoryStore.js";
import { scopeOf, type DurableStateRepository, type JobRow, type TaskRow } from "../../state/durable.js";

/* -------------------------------------------------------------------------- */
/* The execution port - the only door to running work                          */
/* -------------------------------------------------------------------------- */

export interface TaskExecutionRequest {
  readonly jobId: string;
  readonly taskId: string;
  readonly objective: string;
  readonly input: string;
  readonly requiredCapabilities: readonly Capability[];
  readonly minimumTrust: string;
  /**
   * Verification the result must pass, when the task declares any.
   *
   * Forwarded rather than invented, because under this phase's own rule a task
   * that is never verified can never be reported complete - so the requirement
   * has to come from the workflow, not from a default the coordinator picks.
   */
  readonly verificationKinds?: readonly string[];
  readonly attempt: number;
  readonly signal: AbortSignal;
  /** Resumable data reference when a checkpoint said recovery was safe. */
  readonly resumeFrom: string | null;
  /**
   * PHASE 03 (B-08): the identity this attempt executes AS.
   *
   * Absent only when the job named no caller, in which case the composition
   * layer's bridge falls back to the principal the runtime declared for
   * background work - or refuses, when it declared none. It is never invented
   * here: the coordinator owns job state, not identity.
   */
  readonly securityContext?: SecurityContext;
}

export interface TaskExecutionOutcome {
  readonly succeeded: boolean;
  readonly output: string;
  readonly errorClass: ErrorClass | null;
  readonly error: string | null;
  /** Provider/model, as REPORTED by whoever executed. Never chosen here. */
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly traceId: string | null;
  /** Measured only. A field the provider did not report stays null. */
  readonly usage: MeasuredUsage | null;
  /** True when the execution was stopped because it was cancelled. */
  readonly cancelled: boolean;
  /**
   * PHASE 03 (P3-7): what verification said, when verification ran.
   *
   * `null` means NOT MEASURED, exactly as it does everywhere else in this
   * codebase, and is distinct from a verdict of `needs_review`. Without this
   * field the coordinator had nothing to record, `#verdicts` was written `null`
   * on every success, and `settle` - which asks for `pass` - could never answer
   * in the affirmative for an approval-gated task. The approval path was
   * unusable end to end: approved, executed, and then waiting forever for a
   * verification nobody had performed.
   */
  readonly verificationVerdict?: "pass" | "fail" | "needs_review" | null;
}

/**
 * How a task actually runs.
 *
 * A port, so the coordinator has no compile-time knowledge of agents, providers
 * or routing, and a test can supply a deterministic executor. The production
 * adapter is `orchestratorTaskExecutor`, which delegates to `TozOrchestrator`.
 */
export interface TaskExecutionPort {
  execute(request: TaskExecutionRequest, context: ExecutionContext): Promise<TaskExecutionOutcome>;
}

export type { ExecutionContext };

/* -------------------------------------------------------------------------- */
/* Coordinator                                                                  */
/* -------------------------------------------------------------------------- */

export interface ExecutionCoordinatorOptions {
  readonly executor: TaskExecutionPort;
  readonly clock?: Clock;
  /**
   * PHASE 06. The workspace this coordinator partitions every one of its stores by.
   *
   * Absent means the unattributed partition, never "all workspaces".
   */
  readonly workspace?: WorkspaceRef | null;
  /**
   * PHASE 12: the durable repository the checkpoint and claim stores are built over.
   *
   * OPTIONAL, and the absence is deliberate rather than provisional. Omitting it composes an
   * `InMemoryDurableStore`, which behaves exactly as the maps these two classes used to own - so
   * every existing caller keeps today's process-local semantics unchanged, and the durable path
   * is opted into rather than switched on. A coordinator that silently became durable would
   * change what `runtime:describe` reports and where tests write, and both of those should be
   * decisions.
   *
   * The 8-map migration is NOT done: `#jobs`, `#tasks`, `#executions` and the rest are still
   * maps, and still authoritative for their own facts. This option is only the boundary the
   * checkpoint and claim stores needed in order to stop owning rows themselves.
   */
  readonly durable?: DurableStateRepository;
  readonly traces?: TraceRecorder;
  /** Hard ceiling on simultaneously executing tasks. Never unbounded. */
  readonly maxConcurrency?: number;
  /** Default task attempt ceiling when a task does not state one. */
  readonly defaultMaxAttempts?: number;
  /** Default task timeout when a task states none. */
  readonly defaultTimeoutMs?: number;
  /** Claim lease duration. */
  readonly claimTtlMs?: number;
  /** Backoff base for retries. */
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  /**
   * PHASE 03 (B-05): the principal the runtime declared for background work.
   *
   * Supplied by the composition root from `RuntimeOptions.identity.serviceContext`,
   * so the coordinator's refusal list is the runtime's OWN record of what executes
   * background tasks rather than an argument somebody passed in. Null or absent
   * means the runtime declared no principal, and then the only refused parties are
   * the job's caller and the live claim's worker.
   */
  readonly servicePrincipal?: SecurityContext | null;
}

export interface CreateJobInput {
  readonly jobId: string;
  readonly workflow: Workflow;
  readonly priority?: TaskPriority;
  readonly owner?: string;
  readonly correlationId?: string;
  readonly budget?: Partial<ResourceBudget>;
  /**
   * PHASE 03 (B-08): the identity that submitted this job.
   *
   * Omitted means "nobody said", which is recorded as null rather than quietly
   * replaced with the service principal. See `Job.caller`.
   */
  readonly caller?: SecurityContext | null;
}

export interface ReleaseDecision {
  readonly released: readonly string[];
  readonly waiting: readonly string[];
  readonly skipped: readonly string[];
  readonly detail: string;
}

const EMPTY_USAGE: MeasuredUsage = {
  inputTokens: null,
  outputTokens: null,
  latencyMs: null,
  amount: null,
  currency: null,
};

/**
 * PHASE 06. The workspace a job's submitter was VERIFIED to be in.
 *
 * `tryWorkspaceOf` is the single authority: it refuses an `asserted` or
 * `delegated` context, a context with no workspace, and a hand-rolled workspace
 * object. So a caller cannot put a job in another workspace by supplying a
 * SecurityContext it built itself - it can only end up in the unattributed
 * partition, which no partitioned context can act on.
 *
 * `null` therefore means "this submitter's identity did not resolve a workspace",
 * and is recorded as exactly that. It is not a default and not a fallback.
 */
function workspaceOfCaller(caller: SecurityContext | null | undefined): WorkspaceRef | null {
  const resolved = tryWorkspaceOf(caller ?? null);
  return resolved.ok ? resolved.workspace : null;
}


/**
 * Parses a persisted `ResourceBudget`, failing CLOSED on anything unreadable.
 *
 * A budget that silently became `undefined` is what made `budgetStatus` throw; a budget that
 * silently became "no limits" would be worse, because a job with a cost ceiling would then run
 * unconstrained. Neither an absent field nor unparseable JSON may guess, so both throw and name
 * the job.
 */
function parseBudget(json: string): ResourceBudget {
  const NO_LIMITS: ResourceBudget = { maxDurationMs: null, maxTotalAttempts: null, maxAmount: null, budgetCurrency: null };
  if (json.trim() === "" || json.trim() === "{}") return NO_LIMITS;
  try {
    const parsed = JSON.parse(json) as Partial<ResourceBudget>;
    return {
      maxDurationMs: parsed.maxDurationMs ?? null,
      maxTotalAttempts: parsed.maxTotalAttempts ?? null,
      maxAmount: parsed.maxAmount ?? null,
      budgetCurrency: parsed.budgetCurrency ?? null,
    };
  } catch {
    throw new Error("A persisted job budget could not be read; the durable row is corrupt");
  }
}
export class ExecutionCoordinator {
  readonly #executor: TaskExecutionPort;
  readonly #clock: Clock;
  /**
   * PHASE 06: the workspace this coordinator serves.
   *
   * A runtime declares one workspace and owns one coordinator, so the partition is a
   * property of the instance rather than an argument on forty methods. It is passed
   * DOWN to `ClaimRegistry`, `CheckpointStore` and `ApprovalRegistry`, which is what
   * makes those three partitioned - they used the two-argument `taskKey`, which
   * carries no workspace, so two workspaces running the same job and task ids
   * addressed ONE claim, ONE checkpoint and ONE approval gate.
   */
  readonly #workspace: WorkspaceRef | null;
  readonly #traces: TraceRecorder | null;
  readonly #concurrency: ConcurrencyManager;
  readonly #claims: ClaimRegistry;
  readonly #idempotency: IdempotencyLedger;
  readonly #checkpoints: CheckpointStore;
  readonly #durable: DurableStateRepository;
  readonly #approvals: ApprovalRegistry;

  readonly #jobs = new Map<string, Job>();
  /**
   * PHASE 12 (12.5A): a CACHE of durable task state, not a store of it.
   *
   * `#jobs` and `#tasks` are the two maps this slice migrated. `#transitions`,
   * `#executions`, `#attempts`, `#results`, `#verdicts` and `#measuredAmount` are NOT
   * migrated yet and are still authoritative for their own facts - which is why this comment
   * names them rather than leaving a general claim about the class.
   *
   * The rule for the two that ARE migrated, and the reason it is written on the field:
   * every write goes repository-first through `#writeJob` / `#writeTask`, and every read goes
   * through `#readJob` / `#readTask`, which ask the repository and refresh the cache from the
   * answer. A direct `#jobs.get` left anywhere would be a second authority that a write failure
   * could leave disagreeing with durable state, and nothing else in the class would notice.
   */
  readonly #tasks = new Map<string, Map<string, TaskRecord>>();
  readonly #transitions = new Map<string, JobTransitionRecord[]>();
  readonly #executions = new Map<string, Execution>();
  readonly #attempts = new Map<string, ExecutionAttempt[]>();
  /** PHASE 12 (12.5B): keyed by executionId, because
esults is one row per execution. */
  readonly #results = new Map<string, Map<string, ExecutionResult>>();
  /** PHASE 12 (12.5B): cache only. `#readVerdict` / `#writeVerdict` are the sole accessors. */
  readonly #verdicts = new Map<string, "pass" | "fail" | "needs_review" | null>();
  /** PHASE 12 (12.5B): the running TOTAL, null when nothing has been measured. See #addMeasuredAmount. */
  readonly #measuredAmount = new Map<string, number | null>();
  readonly #cancelled = new Set<string>();
  readonly #stopping = new Set<string>();

  readonly #maxConcurrency: number;
  readonly #defaultMaxAttempts: number;
  readonly #defaultTimeoutMs: number;
  readonly #backoffBaseMs: number;
  readonly #backoffMaxMs: number;
  /** PHASE 03 (B-05): the runtime's declared background principal, or null. */
  readonly #servicePrincipal: SecurityContext | null;

  public constructor(options: ExecutionCoordinatorOptions) {
    this.#executor = options.executor;
    this.#clock = options.clock ?? systemClock;
    this.#workspace = options.workspace ?? null;
    this.#traces = options.traces ?? null;
    this.#servicePrincipal = options.servicePrincipal ?? null;
    this.#defaultMaxAttempts = options.defaultMaxAttempts ?? 3;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
    this.#backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF.baseDelayMs;
    this.#backoffMaxMs = options.backoffMaxMs ?? DEFAULT_BACKOFF.maxDelayMs;
    // Bounded, and never derived from the size of the workflow. A parallel group
    // that can run everything at once is an outage waiting for a slow provider.
    this.#maxConcurrency = Math.max(1, options.maxConcurrency ?? 4);
this.#concurrency = new ConcurrencyManager({
        globalLimit: this.#maxConcurrency,
        // Waiting is bounded too, so a burst of tasks cannot queue without limit
        // and turn a slow provider into unbounded memory.
        globalMaxWaiting: 64,
      });
      // PHASE 12: one repository per coordinator, scoped to this coordinator's workspace. Both
      // the checkpoint store and the claim registry read and write through it, so a partition
      // cannot be expressed one way in one store and another way in the other.
      this.#durable = options.durable ?? new InMemoryDurableStore({ scope: scopeOf(this.#workspace) });
      this.#claims = new ClaimRegistry({ clock: this.#clock, defaultTtlMs: options.claimTtlMs ?? 30_000, workspace: this.#workspace });
    // PHASE 12.8. The coordinator's OWN store, so idempotency is durable on the same footing as
      // checkpoints and lands in the same `idempotency_records` table. Without `repository` the
      // ledger would quietly build a private in-memory one and every "durable" claim below would
      // have been true only until the process ended.
      this.#idempotency = new IdempotencyLedger({ clock: this.#clock, repository: this.#durable });
    this.#checkpoints = new CheckpointStore({ clock: this.#clock, repository: this.#durable });
    this.#approvals = new ApprovalRegistry({ clock: this.#clock, workspace: this.#workspace });
  }

  /* ---------------------------------------------------------------------- */
  /* Observation                                                             */
  /* ---------------------------------------------------------------------- */

  public get concurrencyLimit(): number {
    return this.#maxConcurrency;
  }

  /**
   * PHASE 02: the concurrency ceiling this coordinator is actually running under.
   *
   * Read-only and measured, because a bound nobody can read is a bound nobody can
   * verify was applied - and `maxConcurrency` in configuration is exactly that until
   * something reports what the running object holds. `describe()` on the runtime
   * asserts against this, not against the configuration value.
   */
  public get maxConcurrency(): number {
    return this.#maxConcurrency;
  }

  public inFlight(): number {
    return this.#concurrency.globalInFlight;
  }

  public get claims(): ClaimRegistry {
    return this.#claims;
  }

  public get idempotency(): IdempotencyLedger {
    return this.#idempotency;
  }

  public get checkpoints(): CheckpointStore {
    return this.#checkpoints;
  }

  public get approvals(): ApprovalRegistry {
    return this.#approvals;
  }

  public job(jobId: string): Job | null {
    return this.#readJob(jobId);
  }

  public jobIds(): readonly string[] {
    // PHASE 06: derived from the records, because `#jobs` is keyed by
    // `#jobKey(...)` and a key reaching a caller is both a wrong answer and a
    // disclosure of the partition prefix.
    return this.#durable.listJobs().map((row) => row.jobId);
  }

  public tasksOf(jobId: string): readonly TaskRecord[] {
    return this.#durable.listTasks(jobId).map((row) => this.#readTask(jobId, row.taskId)).filter((r): r is TaskRecord => r !== null);
  }

  public task(jobId: string, taskId: string): TaskRecord | null {
    return this.#readTask(jobId, taskId);
  }

  public transitionsOf(jobId: string): readonly JobTransitionRecord[] {
    return [...this.#readJobTransitions(jobId)];
  }

  /**
   * PHASE 10: `jobId` is part of the identity, not decoration.
   *
   * These stores used to be keyed by `taskId` alone, so two jobs containing a
   * task of the same name merged their attempt histories, results and execution
   * records - and `idempotent_replay` could return ANOTHER job's result. Verified
   * before the fix. See `taskKey` in `gates.ts`.
   */
  public attemptsOf(jobId: string, taskId: string): readonly ExecutionAttempt[] {
    // Keyed by task, which is what a caller holding a taskId can ask about. An
    // attempt is identified by its executionId too, but indexing only by that
    // would make this method silently return nothing for a task it had recorded.
    return [...this.#readAttempts(jobId, taskId)];
  }

  public resultOf(jobId: string, taskId: string): ExecutionResult | null {
    return this.#readResult(jobId, taskId);
  }

public executionOf(jobId: string, taskId: string): Execution | null {
      // PHASE 12 (12.5B-FIX): from the repository, NOT by scanning the cache.
      //
      // This scanned `#executions.values()` for a matching job and task. That made the CACHE the
      // authority for this read, so after a restart it answered `null` for an execution that
      // demonstrably existed on disk - found by `executions.p12-evidence.test.ts`, whose
      // diagnostics confirmed the row was durable and listable while this call still said no.
      //
      // The 12.5B migration had already replaced this body once and the change never landed,
      // because the scripted edit reported success without matching. A cache-authoritative read
      // surviving a "migrated" phase is exactly the failure mode this phase exists to remove, and
      // only a behavioural test surfaces it.
      const rows = this.#durable.listExecutions(jobId);
      const match = rows.find((row) => row.taskId === taskId);
      return match === undefined ? null : this.#readExecution(match.executionId);
    }

  /* ---------------------------------------------------------------------- */
  /* Job creation                                                            */
  /* ---------------------------------------------------------------------- */

  public createJob(input: CreateJobInput): Result_<Job, Error> {
    if (this.#readJob(input.jobId) !== null) {
      return { ok: false, error: new Error(`Job already exists: ${input.jobId}`) };
    }
    const steps = flattenWorkflow(input.workflow.root);
    if (steps.length === 0) {
      return { ok: false, error: new Error(`Workflow "${input.workflow.workflowId}" contains no executable task`) };
    }
    const seen = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.task.taskId)) {
        return { ok: false, error: new Error(`Workflow "${input.workflow.workflowId}" repeats task id "${step.task.taskId}"`) };
      }
      seen.add(step.task.taskId);
    }
    for (const step of steps) {
      for (const dependency of step.task.dependsOn) {
        if (!seen.has(dependency)) {
          return {
            ok: false,
            error: new Error(
              `Task "${step.task.taskId}" depends on "${dependency}", which the workflow does not contain. A missing prerequisite is a configuration fault, not something to discover at run time.`,
            ),
          };
        }
      }
    }

    const now = this.#clock.nowMs();
    const job: Job = {
      jobId: input.jobId,
      workflowId: input.workflow.workflowId,
      label: `${input.workflow.name} (${input.jobId})`,
      createdAt: now,
      updatedAt: now,
      state: "queued",
      priority: input.priority ?? "normal",
      owner: input.owner ?? "system",
      correlationId: input.correlationId ?? input.jobId,
      budget: {
        maxDurationMs: input.budget?.maxDurationMs ?? null,
        maxTotalAttempts: input.budget?.maxTotalAttempts ?? null,
        maxAmount: input.budget?.maxAmount ?? null,
        budgetCurrency: input.budget?.budgetCurrency ?? null,
      },
      finishedAt: null,
      failure: null,
      cancellation: null,
      waitingFor: null,
      // PHASE 03 (B-08): recorded from what the submitter said, and from nothing
      // else. `null` when they said nothing - the service principal is applied
      // later, at the point of execution, and is never written back here.
      caller: input.caller ?? null,
      // PHASE 06. The workspace comes from the VERIFIED caller and from nothing
      // else. `owner` is above, on the same record, and is deliberately not used:
      // it is a caller-supplied string that is read by nothing, and a tenancy
      // field that is read by nothing is worse than no tenancy field at all.
      workspace: workspaceOfCaller(input.caller ?? null),
    };
    this.#writeJob(job);
    // Creation is `null -> queued`, not a transition. Recording it through
    // `#transition` would try `queued -> queued`, which the machine correctly
    // refuses - the job is not transitioning, it is coming into existence.
      // PHASE 12 (12.5B-FIX): through the helper, so the creation transition is DURABLE. This line
      // used to write the cache directly, which is why a restarted job had no history at all.
      this.#writeJobTransition(input.jobId, {
        jobId: input.jobId,
        from: null,
        to: "queued",
        at: now,
        reason: `Job created from workflow "${input.workflow.workflowId}"`,
        waitingFor: null,
      });

    const records = new Map<string, TaskRecord>();
    for (const step of steps) {
      const task: WorkflowTask = {
        ...step.task,
        jobId: input.jobId,
        // The conditional guard is carried onto the TASK, so the coordinator can
        // decide "does this branch apply?" at release time without holding the
        // workflow tree. Without it a conditional would run both branches.
        ...(step.guard === undefined ? {} : { guard: step.guard }),
        limits: {
          timeoutMs: step.task.limits.timeoutMs ?? this.#defaultTimeoutMs,
          maxAttempts: Math.max(1, step.task.limits.maxAttempts || this.#defaultMaxAttempts),
          queueTimeoutMs: step.task.limits.queueTimeoutMs ?? null,
        },
      };
      // PHASE 01 (C-3): a step declared with the `approval()` builder opens its
      // gate HERE, using the question the workflow declared. The declaration is
      // the authoritative statement that approval is needed, so honouring it must
      // not depend on some later caller remembering to open the gate - that
      // coupling is precisely how an approval requirement became inert.
      //
      // Deliberately keyed on `step.approval` rather than on
      // `task.approvalRequired`: a task may set the flag by hand and open its own
      // gate, and must not end up with two. A task that sets the flag and opens
      // no gate is still HELD by `mayRelease`, which now blocks on it.
      const declared = step.approval;
      const gate =
        declared === undefined
          ? null
          : this.#approvals.open({
              jobId: input.jobId,
              taskId: task.taskId,
              question: declared.question,
              // PHASE 04: bound to the very task the workflow declared, before any
              // record exists, so the gate and the task can never disagree about
              // what is being approved. A gate opened later by `openApproval`
              // derives the same digest from the stored record.
              intent: task,
              expiresAtMs: declared.expiresAtMs,
            });
      records.set(task.taskId, {
        task,
        state: gate === null ? (task.dependsOn.length === 0 ? "ready" : "pending") : "waiting_approval",
        attempts: 0,
        executionId: null,
        claimToken: null,
        startedAt: null,
        finishedAt: null,
        resultRef: null,
        failure: null,
        latestCheckpoint: null,
        approval: gate,
      });
    }
    // PHASE 12 (12.5A): each task is persisted through `#writeTask`, not dropped into the
      // cache. The previous line here was `this.#tasks.set(this.#jobKey(input.jobId), records)`,
      // which put every task in the map and nowhere else - so after a restart the JOB survived
      // and its TASKS did not, and every read of one returned null. It is worth naming because
      // the whole migration looked correct while this one line was left behind.
      for (const record of records.values()) {
        this.#writeTask(input.jobId, record, {
          from: null,
          to: record.state,
          reason: "task created with the job",
        });
      }

    this.#event("job_created", { jobId: job.jobId, tasks: records.size, owner: job.owner });
    return { ok: true, value: job };
  }

  /* ---------------------------------------------------------------------- */
  /* State authority                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * Moves a job to a state, unless it is already there.
   *
   * The distinction from `#transition` is deliberate. `#transition` is strict and
   * records a refusal, because an illegal CHANGE must be visible. This is for
   * "the job should BE running", which is not a change when it already is: a
   * second wave of a running job, or a settle that concludes nothing has moved,
   * must not be reported as an invalid transition. Making the machine allow
   * `running -> running` would be the wrong fix, because then a genuine
   * no-progress loop would look legal.
   */
  #ensureState(job: Job, to: JobState, reason: string, waitingFor: WaitingReason | null): Job {
    if (job.state === to && job.waitingFor === waitingFor) {
      return job;
    }
    return this.#transition(job, to, reason, waitingFor);
  }

  /**
   * The only way a job's state changes.
   *
   * An illegal transition is REFUSED and recorded as a refusal, rather than
   * thrown away. A rejected transition is evidence: it is how a stale worker
   * report is noticed rather than silently dropped.
   */
  #transition(job: Job, to: JobState, reason: string, waitingFor: WaitingReason | null): Job {
    const history = [...this.#readJobTransitions(job.jobId)];
    if (!canMove(job, to)) {
      history.push({
        jobId: job.jobId,
        from: job.state,
        to,
        at: this.#clock.nowMs(),
        reason: `REFUSED: ${reason}`,
        waitingFor: null,
      });
      this.#writeJobTransition(job.jobId, { jobId: job.jobId, from: job.state, to, at: this.#clock.nowMs(), reason, waitingFor });
      throw new JobStateError(job.jobId, job.state, to);
    }
    const next: Job = {
      ...job,
      state: to,
      updatedAt: this.#clock.nowMs(),
      waitingFor,
      finishedAt: isTerminalJobState(to) ? this.#clock.nowMs() : job.finishedAt,
    };
    this.#writeJob(next);

    this.#writeJobTransition(job.jobId, { jobId: job.jobId, from: job.state, to, at: this.#clock.nowMs(), reason, waitingFor });
    this.#event("job_state_changed", { jobId: job.jobId, from: job.state, to, reason, waitingFor });
    return next;
  }

  /* ---------------------------------------------------------------------- */
  /* Cancellation                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Requests cooperative cancellation.
   *
   * Records the request and releases the job's claims, so no worker is left
   * holding a task of a job that no longer exists. It does NOT kill anything: the
   * abort signal reaches in-flight attempts, and a job already terminal is
   * reported as such rather than being revived.
   */
  public cancelJob(jobId: string, reason: string): { readonly ok: boolean; readonly detail: string } {
    const job = this.#readJob(jobId);
    if (job === null) {
      return { ok: false, detail: `No such job: ${jobId}` };
    }
    if (isTerminalJobState(job.state)) {
      return {
        ok: false,
        detail: `Job "${jobId}" is already ${job.state}. A terminal job cannot be cancelled, and cannot be revived either.`,
      };
    }
    const request: CancellationRequest = {
      jobId,
      requestedAt: this.#clock.nowMs(),
      reason,
      cooperative: true,
      acknowledged: [],
    };
    const released = this.#claims.releaseJob(jobId);
    this.#cancelled.add(jobId);
    this.#stopping.add(jobId);
    this.#writeJob({ ...job, cancellation: request, updatedAt: this.#clock.nowMs() });
    this.#transition(this.#readJob(jobId) as Job, "cancelled", `Cancellation requested: ${reason}`, null);
    this.#event("job_cancelled", { jobId, reason, releasedClaims: released.length });
    return {
      ok: true,
      detail: `Job "${jobId}" is cancelled. ${released.length} claim(s) released; in-flight attempts are asked to abort cooperatively.`,
    };
  }

  public isCancelled(jobId: string): boolean {
    return this.#cancelled.has(jobId);
  }

  /* ---------------------------------------------------------------------- */
  /* Approval                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Opens an approval gate, bound to the coordinator's OWN record of the task.
   *
   * PHASE 04: there is deliberately NO `intent` parameter. The gate's binding is
   * derived from the task this coordinator holds, so a caller can ask the question
   * but cannot choose what the answer will be taken to mean. A parameter here would
   * let a caller approve content A and run content B, which is precisely the hole
   * B-05 question 3 describes.
   *
   * A task the coordinator does not hold is REFUSED. It used to store a gate for one
   * anyway, and a gate with no record behind it is an approval with nothing to be
   * about - `taskId` would be set and the binding would have to be invented.
   */
  public openApproval(input: {
    jobId: string;
    taskId: string;
    question: string;
    expiresAtMs?: number | null;
  }): ApprovalGate {
    const record = this.#readTask(input.jobId, input.taskId);
    if (record === null) {
      throw new ApprovalError(
        "new",
        `job "${input.jobId}" holds no task "${input.taskId}", so there is nothing to approve. A gate with no task behind it could not be bound to anything.`,
      );
    }
    const gate = this.#approvals.open({
      jobId: input.jobId,
      taskId: input.taskId,
      question: input.question,
      intent: record.task,
      ...(input.expiresAtMs === undefined ? {} : { expiresAtMs: input.expiresAtMs }),
    });
    this.#writeTask(input.jobId, { ...record, approval: gate, state: "waiting_approval" }, { from: record.state, to: "waiting_approval", reason: `approval opened: ${gate.gateId}` });
    this.#event("approval_requested", { jobId: input.jobId, taskId: input.taskId, gateId: gate.gateId, question: gate.question });
    return gate;
  }

  /**
   * Whether an approval decision has left work that its OWNER - not this system -
   * must re-drive.
   *
   * PHASE 04. `MASTER_PLAN.md` §8.6 and `TODO.md` PHASE 04 both ask who re-drives an
   * approved task. The answer is: the caller that owns the job, by calling
   * `runJob`. Nothing here schedules anything, and nothing here runs anything -
   * adding an auto-runner would put an unbounded loop next to a human decision,
   * which is a scheduling decision with real failure modes and not one this phase
   * may take.
   *
   * What this DOES do is make the obligation VISIBLE. Before, a decision that made
   * a task runnable produced no signal at all: the job sat `waiting` with nothing
   * wrong and nothing to do, and a service that forgot to re-drive had no way to
   * notice. A forgotten re-drive is a stall, and a stall nobody can see is a
   * deployment defect that looks exactly like a slow system.
   *
   * A task qualifies only when all of these hold, each of which is necessary:
   *
   *   - it holds a gate that is APPROVED (a waiting gate means the human has not
   *     answered, and telling someone to re-drive would be noise),
   *   - it is `ready` - the decision moved it there and nothing has consumed it,
   *   - and it has not STARTED an attempt since the decision was recorded. A retry
   *     after the decision does not need a new one, and a task that is already
   *     running or finished does not either.
   *
   * A job with no gate can therefore never be reported here, which is what makes
   * the signal worth having rather than a synonym for "the job has work".
   */
  public redriveRequired(jobId: string): {
    readonly required: boolean;
    readonly taskIds: readonly string[];
    readonly detail: string;
  } {
    if (this.#readJob(jobId) === null) {
      return { required: false, taskIds: [], detail: `No such job: ${jobId}` };
    }
    const pending: string[] = [];
    for (const record of this.tasksOf(jobId)) {
      // TWO conditions, and both are load-bearing.
      //
      //   - the task must HOLD A GATE. A fresh job has `ready` tasks and owes
      //     nobody anything, so without this a fresh job would be reported as
      //     needing a re-drive and the signal would be worthless.
      //
      //   - the task must be `ready`. That is where a decision leaves it, and it is
      //     the only state that means "runnable and un-run". A task that has since
      //     run, failed, been cancelled or been given up on is not waiting on anyone.
      //
      // There is deliberately NO third condition reading the gate's state. A gate
      // that is still `waiting`, or that was `rejected` / `expired` / `cancelled`,
      // always leaves the task in a non-runnable state - `openApproval` sets
      // `waiting_approval` and `decideApproval` sets `skipped` - so the state test
      // above already excludes every one of them. A guard no test can distinguish is
      // untested code, and this repository has deleted one such line rather than keep
      // it as decoration (D-35). The `approved` half of the obligation is therefore
      // carried by the state, which is where it is actually enforced.
      if (record.approval === null) {
        continue;
      }
      if (record.state !== "ready") {
        continue;
      }
      pending.push(record.task.taskId);
    }
    return {
      required: pending.length > 0,
      taskIds: pending,
      detail:
        pending.length === 0
          ? `Job "${jobId}" has no approved work waiting for its owner to re-drive it.`
          : `Job "${jobId}" has ${pending.length} task(s) approved and runnable that have not been run since the decision: ${pending.join(", ")}. ` +
            `The caller that owns this job must call runJob; this coordinator does not re-drive its own work.`,
    };
  }

  /**
   * Records an approval decision.
   *
   * The gate is consulted on every release, so an approved task proceeds and
   * anything else does not. There is no path from here to a running task that
   * does not pass through `release`.
   *
   * PHASE 01 (C-2): the executing worker is DERIVED from the live claim, not
   * taken on the caller's word.
   *
   * `decideApproval` used to forward an optional `workerId` and add nothing of its
   * own, so a caller could approve the very work it was executing simply by
   * omitting the argument. The claim registry is the coordinator's own record of
   * who is executing a task, so the identity is read from there. A caller-supplied
   * `workerId` is still honoured, because an honest caller telling the truth must
   * not be made weaker - it is simply no longer the only source.
   */
  /**
   * PHASE 06. The ONE place this coordinator composes a store key.
   *
   * Every partitionable store here - attempts, results, verdicts, claims,
   * checkpoints, approval records - is keyed through this, and the workspace comes
   * from the JOB RECORD, never from an argument a caller supplies. That is the
   * difference between a partition and a filter somebody can forget: the workspace
   * is looked up from the one record that states it, so there is no code path that
   * can build a key without one.
   *
   * A job created without a verified workspace lives in the unattributed
   * partition. A partitioned context cannot act on it, which is the safe direction:
   * "we do not know where this is" is not "this is available to everyone".
   */
  #taskKey(jobId: string, taskId: string): string {
    return taskKey(jobId, taskId, this.#workspace);
  }

  /**
   * The ONLY place this coordinator composes a JOB key.
   *
   * `#jobs` used to be keyed by bare `jobId`, and a `createJob` for an id another
   * workspace already held would silently OVERWRITE that workspace's job - not
   * refuse it, not hide it, replace it, and the first workspace's tasks with it. That
   * is why `jobIds()` is derived from the records rather than from `#jobs.keys()`.
   */
  #jobKey(jobId: string): string {
    return workspaceKey(this.#workspace, jobId);
  }

  /**
   * The ONLY place this coordinator composes an idempotency key.
   *
   * It used to be a bare `${jobId}:${taskId}:${attempts}`. Two workspaces running the
   * same job and task ids collided into one `in_progress` claim, so the second
   * workspace's attempt was refused with `idempotency_conflict` - a cross-workspace
   * denial, reported to a caller who had done nothing wrong. The colon join was also
   * ambiguous: job `a:b` with task `c` and job `a` with task `b:c` produced the same
   * string. `workspaceKey` length-prefixes every part, so that ambiguity is gone.
   */
  #idempotencyKey(jobId: string, taskId: string, attempt: number): string {
    return workspaceKey(this.#workspace, jobId, taskId, String(attempt));
  }

  public decideApproval(input: {
    gateId: string;
    decision: "approved" | "rejected" | "expired" | "cancelled";
    decidedBy: string;
    reason?: string | null;
    workerId?: string | null;
  }): ApprovalGate {
    const known = this.#approvals.get(input.gateId);
    const taskId = known?.taskId ?? null;
    const claim = taskId === null ? null : this.#claims.current(known?.jobId ?? input.gateId, taskId);
    // PHASE 03 (B-05): the parties that may not approve are DERIVED here, from
    // records this coordinator owns - the job's own caller, and the principal the
    // runtime declared for background work - plus the live claim. Nothing below
    // reads them off `input`, so supplying a different `workerId` cannot buy an
    // approval: the identity the job executes as is refused whatever the caller
    // says it is.
    const job =
      known === null || known === undefined ? null : this.#readJob(known.jobId);
    const executedBy: readonly (string | null)[] = [
      job?.caller?.actor ?? null,
      job?.caller?.principal ?? null,
      this.#servicePrincipal?.actor ?? null,
      this.#servicePrincipal?.principal ?? null,
    ];
    const gate = this.#approvals.decide({
      ...input,
      // PHASE 01 (C-2): only the worker is derived here.
      //
      // The TASK deliberately is not passed. `ApprovalRegistry.assertDecidable`
      // compares the deciding party against the gate's OWN recorded `taskId`,
      // which is stronger than anything this method could supply: a
      // caller-supplied task id is a claim about which task is under approval,
      // whereas the gate's is a fact recorded when the gate was opened. A second
      // mechanism for the same guarantee was proved not to be load-bearing - the
      // M2c mutation removed it and every test still passed - so it was deleted
      // rather than kept as decoration.
      //
      // The executing worker comes from the live claim. Null when nobody holds
      // the claim, which is the ordinary pre-execution state for an approval.
      workerId: claim?.workerId ?? input.workerId ?? null,
      executedBy,
    });
    const jobId = gate.jobId;
const record = gate.taskId === null ? null : this.#readTask(jobId, gate.taskId);
      if (record !== null && gate.taskId !== null) {
        const gateState: JobTaskState =
          gate.state === "approved" ? "ready" : gate.state === "waiting" ? "waiting_approval" : "skipped";
        this.#writeTask(
          jobId,
          {
            ...record,
            approval: gate,
            // A rejected or expired gate is terminal for the task; it does not sit in
            // `waiting_approval` waiting for a decision that will never come.
            state: gateState,
            failure:
              gate.state === "approved" || gate.state === "waiting"
                ? null
                : {
                    errorClass: "invalid_request",
                    message: `Approval ${gate.gateId} is ${gate.state}${gate.decisionReason === null ? "" : `: ${gate.decisionReason}`}`,
                    retryable: false,
                    attempt: record.attempts,
                    at: this.#clock.nowMs(),
                  },
          },
          { from: record.state, to: gateState, reason: `approval ${gate.state}: ${gate.gateId}` },
        );
    }
    this.#event("approval_decided", { jobId, taskId: gate.taskId, gateId: gate.gateId, state: gate.state, decidedBy: gate.decidedBy });
    return gate;
  }

  /* ---------------------------------------------------------------------- */
  /* Checkpoints                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Records a checkpoint and reports what a restart would do.
   *
   * `recoverable` comes from the TASK, not from the coordinator. Only the task
   * knows whether replaying its side effects is safe, and a coordinator that
   * guessed would eventually resume something that must not be resumed.
   */
  public checkpoint(input: {
    jobId: string;
    taskId: string;
    progress: string;
    dataRef: string;
    notRecoverableReason?: string | null;
  }): { readonly checkpoint: ReturnType<CheckpointStore["write"]>; readonly recovery: ReturnType<CheckpointStore["recoveryPlan"]> } {
    const record = this.#readTask(input.jobId, input.taskId);
    if (record === null) {
      throw new Error(`No such task: ${input.jobId}/${input.taskId}`);
    }
    const checkpoint = this.#checkpoints.write({
      jobId: input.jobId,
      taskId: input.taskId,
      executionId: record.executionId ?? "unstarted",
      progress: input.progress,
      dataRef: input.dataRef,
      recoverable: record.task.checkpointable,
      notRecoverableReason: record.task.checkpointable
        ? null
        : (input.notRecoverableReason ?? "this task did not declare itself safe to resume"),
    });
    this.#writeTask(input.jobId, { ...record, latestCheckpoint: checkpoint });
    this.#event("checkpoint_recorded", { jobId: input.jobId, taskId: input.taskId, sequence: checkpoint.sequence, recoverable: checkpoint.recoverable });
    return { checkpoint, recovery: this.#checkpoints.recoveryPlan(input.jobId, input.taskId) };
  }

  /** What a restart of a task would do, with the reason. */
  public recoveryPlan(jobId: string, taskId: string): ReturnType<CheckpointStore["recoveryPlan"]> {
    const record = this.#readTask(jobId, taskId);
    if (record === null) {
      return { action: "no_checkpoint", checkpoint: null, detail: `No such task: ${jobId}/${taskId}` };
    }
    return this.#checkpoints.recoveryPlan(jobId, taskId);
  }

  /* ---------------------------------------------------------------------- */
  /* Budget                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Whether the job's budget permits another attempt.
   *
   * Duration and attempt ceilings are exact. The COST ceiling is enforced only
   * against amounts a provider actually reported: if money was spent but no
   * amount was ever quoted, the honest answer is "cannot be evaluated", not
   * "within budget". Silently treating unpriced usage as free would be a budget
   * that cannot fail.
   */
  public budgetStatus(jobId: string): {
    readonly mayProceed: boolean;
    readonly detail: string;
    readonly measuredAmount: number | null;
    readonly attemptsUsed: number;
  } {
    const job = this.#readJob(jobId);
    if (job === null) {
      return { mayProceed: false, detail: `No such job: ${jobId}`, measuredAmount: null, attemptsUsed: 0 };
    }
    const attemptsUsed = this.tasksOf(jobId).reduce((sum, record) => sum + record.attempts, 0);
    const measuredAmount = this.#readMeasuredAmount(jobId);
    // "Unpriced" means: a task completed AND a provider reported TOKENS, but no
    // monetary amount. That is unknown spend, which is different both from
    // "nothing has run yet" and from "the provider told us it cost nothing".
    const unpriced = this.#reportedTokens(jobId) > 0 && measuredAmount === null;

    if (job.budget.maxDurationMs !== null && this.#clock.nowMs() - job.createdAt > job.budget.maxDurationMs) {
      return {
        mayProceed: false,
        detail: `Job "${jobId}" exceeded its ${job.budget.maxDurationMs}ms wall-clock budget.`,
        measuredAmount,
        attemptsUsed,
      };
    }
    if (job.budget.maxTotalAttempts !== null && attemptsUsed >= job.budget.maxTotalAttempts) {
      return {
        mayProceed: false,
        detail: `Job "${jobId}" has spent all ${job.budget.maxTotalAttempts} permitted attempt(s).`,
        measuredAmount,
        attemptsUsed,
      };
    }
    if (job.budget.maxAmount !== null) {
      if (measuredAmount === null) {
        // Two genuinely different situations, which must not be conflated:
        //
        //  - nothing has run yet, so there is nothing to have measured. That is
        //    NOT a refusal. Refusing here would mean a job carrying a cost
        //    budget could never take its first step, which is a budget that can
        //    never pass rather than one that protects anything.
        //  - work has completed and a provider reported TOKENS but no amount.
        //    That is unknown spend, and the honest answer is to stop and say so.
        if (unpriced) {
          return {
            mayProceed: false,
            detail: `Job "${jobId}" has a cost budget of ${job.budget.maxAmount} ${job.budget.budgetCurrency ?? ""} but a provider reported tokens and no amount, so the budget cannot be evaluated. Execution stops rather than assuming it is within limit.`,
            measuredAmount,
            attemptsUsed,
          };
        }
        return {
          mayProceed: true,
          detail: `Job "${jobId}" carries a cost budget and nothing has been measured yet, so the first attempt is allowed.`,
          measuredAmount,
          attemptsUsed,
        };
      }
      if (measuredAmount > job.budget.maxAmount) {
        return {
          mayProceed: false,
          detail: `Job "${jobId}" recorded ${measuredAmount} ${job.budget.budgetCurrency ?? ""} of measured spend, over its ${job.budget.maxAmount} budget.`,
          measuredAmount,
          attemptsUsed,
        };
      }
    }
    return { mayProceed: true, detail: `Job "${jobId}" is within its budget.`, measuredAmount, attemptsUsed };
  }

  /**
   * Decides whether a conditional branch applies.
   *
   * Returns null when the task is not inside a conditional, i.e. it always
   * applies. Otherwise one of three answers, and the third is the important one:
   *
   *   releasable  the branch applies and the task may run
   *   skip        the branch does not apply, so the task is marked skipped
   *   waiting     the predicate CANNOT be evaluated, so nothing is guessed
   */
  #guardOutcome(
    jobId: string,
    record: TaskRecord,
  ): { readonly releasable: true } | { readonly releasable: false; readonly skip: boolean; readonly detail: string } | null {
    const guard = record.task.guard;
    if (guard === undefined) {
      return null;
    }
    const records = this.tasksOf(jobId);
    // The observation is over this branch's OWN branch-mates and prerequisites,
    // not the whole job: a predicate on "did the steps before me succeed" must not
    // be decided by a sibling in the other branch.
    const observed = {
      completed: records.filter((entry) => entry.state === "completed").length,
      failed: records.filter((entry) => entry.state === "failed").length,
      cancelled: records.filter((entry) => entry.state === "cancelled").length,
      pending: records.filter((entry) => entry.state === "pending" || entry.state === "ready").length,
    };
    const verdict = evaluatePredicate(guard.predicate, observed);
    if (verdict === null) {
      return {
        releasable: false,
        skip: false,
        detail: `Task "${record.task.taskId}" sits behind the predicate "${guard.predicate}", which is not one of the supported forms (${PREDICATE_FORMS.join(", ")}). The branch is held rather than guessed.`,
      };
    }
    if (verdict === guard.whenTrue) {
      return { releasable: true };
    }
    return {
      releasable: false,
      skip: true,
      detail: `Task "${record.task.taskId}" is in the ${guard.whenTrue ? "true" : "false"} branch of "${guard.predicate}", which evaluated to ${verdict}. That branch does not apply.`,
    };
  }

  /**
   * Tokens a provider actually reported, summed over attempts.
   *
   * Read from the ATTEMPT records rather than from any running total, so a budget
   * decision is always derived from the same evidence an auditor can see. Null
   * fields contribute nothing, exactly as they contribute nothing to a cost.
   */
  #reportedTokens(jobId: string): number {
    let total = 0;
    for (const record of this.tasksOf(jobId)) {
      for (const attempt of this.attemptsOf(jobId, record.task.taskId)) {
        total += attempt.usage?.inputTokens ?? 0;
        total += attempt.usage?.outputTokens ?? 0;
      }
    }
    return total;
  }

  /* ---------------------------------------------------------------------- */
  /* Release                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Works out what may run now.
   *
   * Order, and it matters: dependencies first, then approval, then budget. A
   * task that fails any of them is not released, and the reason is recorded
   * rather than inferred by the caller.
   */
  public planRelease(jobId: string): ReleaseDecision {
    const job = this.#readJob(jobId);
    if (job === null) {
      return { released: [], waiting: [], skipped: [], detail: `No such job: ${jobId}` };
    }
    if (this.#cancelled.has(jobId) || isTerminalJobState(job.state)) {
      return { released: [], waiting: [], skipped: [], detail: `Job "${jobId}" is ${job.state}; nothing is released.` };
    }

    const records = this.tasksOf(jobId);
    const byId = new Map(records.map((record) => [record.task.taskId, record]));

    // Tasks made unreachable by a permanently blocked prerequisite are skipped,
    // transitively, so a five-task chain behind one failure does not hang.
    const unreachable = new Set(unreachableTasks(records));
    for (const taskId of unreachable) {
      const record = byId.get(taskId);
      if (record !== undefined && (record.state === "pending" || record.state === "ready")) {
        const verdict = evaluateDependencies(record.task, byId);
        this.#setTaskState(jobId, taskId, "skipped", {
          failure: {
            errorClass: "invalid_request",
            message: verdict.summary,
            retryable: false,
            attempt: record.attempts,
            at: this.#clock.nowMs(),
          },
        });
        this.#event("task_skipped", { jobId, taskId, reason: verdict.summary });
      }
    }

    const released: string[] = [];
    const waiting: string[] = [];
    const skipped: string[] = [...unreachable];
    const notes: string[] = [];

    for (const record of this.tasksOf(jobId)) {
      if (record.state === "completed" || record.state === "failed" || record.state === "cancelled" || record.state === "skipped") {
        continue;
      }
      // CONDITIONAL GUARD, consulted before dependencies.
      //
      // A conditional flattens to both branches, so without this exactly one of
      // them would never run and the other would always run. If the predicate
      // cannot be evaluated the task is NOT released: guessing which branch
      // applies would execute work nobody asked for.
      const guard = this.#guardOutcome(jobId, record);
      if (guard !== null && !guard.releasable) {
        if (guard.skip) {
          this.#setTaskState(jobId, record.task.taskId, "skipped", {
            failure: {
              errorClass: "invalid_request",
              message: guard.detail,
              retryable: false,
              attempt: record.attempts,
              at: this.#clock.nowMs(),
            },
          });
          this.#event("task_skipped", { jobId, taskId: record.task.taskId, reason: guard.detail });
          skipped.push(record.task.taskId);
        } else {
          // The predicate is not one the system understands, so the branch is
          // held rather than guessed at.
          waiting.push(record.task.taskId);
          notes.push(guard.detail);
        }
        continue;
      }
      // An applicable guard falls through to the ordinary checks below; it does
      // not by itself release the task.
      const verdict = evaluateDependencies(record.task, byId);
      if (!verdict.mayRun) {
        if (verdict.permanentlyBlocked) {
          skipped.push(record.task.taskId);
          continue;
        }
        waiting.push(record.task.taskId);
        continue;
      }
      // Approval is consulted on EVERY release, which is what stops a retry from
      // slipping past a gate that was rejected.
      const approval = this.#approvals.mayRelease(
        jobId,
        record.task.taskId,
        record.task.approvalRequired,
        // PHASE 04: the intent comes from the coordinator's OWN record. Nothing a
        // caller supplies participates in the comparison, which is what makes the
        // binding a fact rather than a claim.
        record.task,
      );
      if (!approval.allowed) {
        waiting.push(record.task.taskId);
        notes.push(approval.detail);
        continue;
      }
      const budget = this.budgetStatus(jobId);
      if (!budget.mayProceed) {
        notes.push(budget.detail);
        this.#event("job_stopped_on_budget", { jobId, detail: budget.detail });
        break;
      }
      released.push(record.task.taskId);
    }

    return {
      released,
      waiting,
      skipped,
      detail:
        notes.length === 0
          ? `${released.length} task(s) released, ${waiting.length} waiting, ${skipped.length} skipped.`
          : `${released.length} task(s) released, ${waiting.length} waiting, ${skipped.length} skipped. ${notes.join(" ")}`,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Execution                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Executes the tasks a job may currently run, within the concurrency ceiling.
   *
   * The concurrency limit is acquired BEFORE a claim is taken, so the number of
   * simultaneously executing tasks is bounded by configuration rather than by
   * how many the workflow happens to contain.
   */
  public async runJob(jobId: string, options: { onlyTaskIds?: readonly string[] } = {}): Promise<ExecutionResult[]> {
    const job = this.#readJob(jobId);
    if (job === null) {
      return [];
    }
    if (isTerminalJobState(job.state) && job.state !== "running") {
      return [];
    }
    if (job.state !== "running") {
      // Only when it is not already running. A job that is already `running` -
      // because a retry or a second wave called this again - is not transitioning,
      // and forcing `running -> running` would throw on every subsequent wave.
      this.#transition(job, "running", `Job "${jobId}" started`, null);
    }

    const plan = this.planRelease(jobId);
    const wanted = new Set(options.onlyTaskIds ?? plan.released);
    const results: ExecutionResult[] = [];

    // Sequential over the release plan, bounded inside by the concurrency lease.
    // Parallel work happens between the tasks the workflow allows to run
    // together, and nowhere else.
    for (const taskId of plan.released) {
      if (!wanted.has(taskId)) {
        continue;
      }
      const outcome = await this.executeTask(jobId, taskId);
      if (outcome !== null) {
        results.push(outcome);
      }
    }

    // Re-propagate skips AFTER the wave. A task that only became unreachable
    // because its prerequisite failed in this wave is discovered here, and
    // without this it would sit `pending` forever waiting on a task that is
    // never coming back.
    this.planRelease(jobId);
    this.#settle(jobId);
    return results;
  }

  /**
   * Executes one task, applying claim, idempotency, timeout, retry and the
   * stale-result guard.
   */
  public async executeTask(jobId: string, taskId: string): Promise<ExecutionResult | null> {
    const job = this.#readJob(jobId);
    const record = this.#readTask(jobId, taskId);
    if (job === null || record === null) {
      return null;
    }
    if (this.#cancelled.has(jobId) || isTerminalJobState(job.state)) {
      // The guard that makes a late worker harmless. A cancelled job has no legal
      // state to move to, so this is not a check that can be forgotten downstream.
      this.#event("task_result_refused", { jobId, taskId, reason: `job is ${job.state}` });
      return null;
    }

    // PHASE 04: THE INTENT, RESOLVED ONCE.
    //
    // These four values used to be re-read from the record inline, and the
    // approval check read them a SECOND time. That is two chances to compare a gate
    // against something other than what runs, and the whole point of the binding is
    // that they are the same thing. `executed` is resolved here and is both what
    // the approval was compared against and what the executor receives.
    const executed = this.#readTask(jobId, taskId)?.task ?? record.task;
    const approval = this.#approvals.mayRelease(jobId, taskId, record.task.approvalRequired, executed);
    if (!approval.allowed) {
      return null;
    }

    // At-most-once execution: a live claim means this delivery is a duplicate.
    const claimed = this.#claims.claim(jobId, taskId, "coordinator");
    if (!claimed.ok) {
      this.#event("duplicate_delivery_refused", { jobId, taskId, reason: claimed.detail });
      return null;
    }
    const claim: Claim = claimed.claim;

    // PHASE 06 (N-3): the lease was keyed by `modelId: taskId`, so two jobs'
    // identically-named tasks shared one concurrency slot - and because `taskId` is
    // caller-supplied, a caller could also collide with another workspace's work.
    // The job's own identity is used instead of the task's, so the slot is per job
    // and therefore per partition.
    const lease = await this.#concurrency.acquire({
      providerId: "workflow",
      modelId: job.workspace === null ? jobId : `${job.workspace.workspace}/${jobId}`,
    });
    try {
      if (this.#cancelled.has(jobId)) {
        this.#claims.release(jobId, taskId, claim.token);
        return null;
      }

      const idempotencyKey = this.#idempotencyKey(jobId, taskId, record.attempts);
      const begun = this.#idempotency.begin(idempotencyKey, taskId);
      if (!begun.ok) {
        this.#event("idempotency_conflict", { jobId, taskId, detail: begun.detail });
        this.#claims.release(jobId, taskId, claim.token);
        return null;
      }
      if (begun.replayed) {
        // A previous execution already recorded this attempt. Replay its
        // recorded outcome instead of repeating the work.
        const previous = this.#readResult(jobId, taskId);
        this.#claims.release(jobId, taskId, claim.token);
        this.#event("idempotent_replay", { jobId, taskId, key: idempotencyKey });
        return previous ?? null;
      }

      const attemptNumber = record.attempts + 1;
    // PHASE 10: includes `jobId`. Keyed by task alone, two jobs' executions
    // shared one id (`exec-t1-1`) and overwrote each other in `#executions`.
    // PHASE 06 (N-4): the workspace joins it, for the same reason. Two workspaces
    // can both have a `job-1`/`t1` in one process only if they use distinct job
    // ids - which `createJob` enforces - so the collision risk here is the
    // execution-id string, and it is closed by composition rather than by luck.
    // PHASE 06 (N-4). Three things were wrong with the original id.
    //
    //   1. It carried the workspace NAME but not the BRAND, so two brands of one
    //      workspace minted the same id.
    //   2. It joined with a bare "/", so job "b/c" under workspace "a" and job "c" under
    //      workspace "a/b" produced the same string.
    //   3. It read the JOB's workspace, not the coordinator's own partition. `Job.workspace`
    //      is derived from the VERIFIED CALLER, so a job created with no caller identity
    //      has `workspace: null` - and the execution then fell into the UNATTRIBUTED
    //      partition (`0:\0-`) inside a coordinator that had a declared workspace. That
    //      was caught by a PHASE 06 test asserting two brands mint different ids, and it
    //      is the more serious of the three: it would have put two brands' executions in
    //      one partition as soon as identity resolution was not wired.
    //
    // `this.#workspace` is the partition the execution actually runs in, and it is
    // always populated for a coordinator that declares one.
    const executionId = `exec-${workspaceKey(
      this.#workspace,
      "job",
      jobId,
      "task",
      taskId,
      `attempt-${attemptNumber}`,
    )}`;
      const startedAt = this.#clock.nowMs();
      // PHASE 06 (N-4): `taskId` here was the JOB id, while the orchestrator's own
      // context sets it to the TASK id. Two paths, one field, two meanings - so
      // `TraceRecorder.byTask(taskId)` matched jobs on the coordinator path and
      // tasks on the orchestrator path, and a caller could not ask "what happened
      // to this task" reliably.
      //
      // Both are now true and neither is guessed: `taskId` is the task, and
      // `parentTaskId` carries the job, which is what the field means everywhere
      // else. An event is still findable by job through `byTask(jobId)`'s sibling,
      // `byJob`, added below rather than by overloading this one again.
      const context: ExecutionContext = {
        traceId: job.correlationId,
        taskId,
        parentTaskId: jobId,
        teamId: null,
      };

      this.#setTaskState(jobId, taskId, "running", {
        attempts: attemptNumber,
        executionId,
        claimToken: claim.token,
        startedAt,
      });
      this.#writeExecution({
        executionId,
        jobId,
        taskId,
        attempt: attemptNumber,
        workerId: "coordinator",
        claimToken: claim.token,
        state: "running",
        startedAt,
        finishedAt: null,
        traceId: job.correlationId,
      });
      this.#event("task_started", { jobId, taskId, attempt: attemptNumber, executionId, workerId: "coordinator" });

      const controller = new AbortController();
      const timeoutMs = record.task.limits.timeoutMs;
      let timedOut = false;
      const timer =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, timeoutMs);
      timer?.unref?.();

      let outcome: TaskExecutionOutcome;
      try {
        const recovery = this.#checkpoints.recoveryPlan(jobId, taskId);
        outcome = await this.#executor.execute(
          {
            jobId,
            taskId,
            objective: executed.objective,
            input: executed.input,
            requiredCapabilities: executed.requiredCapabilities,
            minimumTrust: executed.minimumTrust,
            // Forwarded from the workflow, never invented here. A task that
            // requires verification has to ask TOZ for it, and a task that does
            // not must not be verified behind its back.
            ...(record.task.verificationKinds === undefined
              ? {}
              : { verificationKinds: record.task.verificationKinds }),
            attempt: attemptNumber,
            signal: controller.signal,
            resumeFrom: recovery.action === "resume" ? recovery.checkpoint?.dataRef ?? null : null,
            // PHASE 03 (B-08): the identity this attempt runs AS. From the job's
            // own record, so a background task reaches the authorization boundary
            // as the party that submitted it rather than as whatever single
            // principal the runtime declared at composition time. Absent when the
            // job named nobody, and then the bridge falls back to the declared
            // service principal - or refuses, if there is none.
            ...(job.caller === null ? {} : { securityContext: job.caller }),
          },
          context,
        );
      } catch (error) {
        // A thrown error is a failure, never a silent success. It is converted
        // into a structured outcome so the retry decision has a class to work
        // with rather than a message to pattern-match.
        outcome = {
          succeeded: false,
          output: "",
          errorClass: "unknown",
          error: error instanceof Error ? error.message : String(error),
          providerId: null,
          modelId: null,
          traceId: null,
          usage: null,
          cancelled: false,
        };
      } finally {
        if (timer !== null) {
          clearTimeout(timer);
        }
      }

      const finishedAt = this.#clock.nowMs();
      const cancelled = outcome.cancelled || this.#cancelled.has(jobId);
      const errorClass: ErrorClass | null = outcome.errorClass;

      this.#recordAttempt({
        jobId,
        attempt: attemptNumber,
        taskId,
        executionId,
        claimToken: claim.token,
        workerId: "coordinator",
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        outcome: cancelled ? "cancelled" : timedOut ? "timed_out" : outcome.succeeded ? "succeeded" : "failed",
        errorClass: errorClass ?? (timedOut ? "timeout" : null),
        error: outcome.error ?? (timedOut ? `Task exceeded its ${timeoutMs}ms budget` : null),
        providerId: outcome.providerId,
        modelId: outcome.modelId,
        idempotencyKey,
        usage: outcome.usage ?? EMPTY_USAGE,
      });

      // Measured spend is accumulated from what the provider REPORTED. An absent
      // amount contributes nothing and is not treated as zero.
      if (outcome.usage?.amount !== null && outcome.usage?.amount !== undefined && outcome.usage.currency !== null) {
        this.#addMeasuredAmount(jobId, outcome.usage.amount, outcome.usage.currency);
      }

      // STALE RESULT GUARD. A worker whose claim is gone, or a job cancelled while
      // the work was in flight, cannot have its result applied. The claim is
      // verified rather than trusted.
      const valid = this.#claims.verify(jobId, taskId, claim.token);
      if (!valid.valid || cancelled) {
        this.#event("task_result_refused", {
          jobId,
          taskId,
          attempt: attemptNumber,
          reason: cancelled ? "job was cancelled while the attempt was in flight" : valid.detail,
        });
        this.#idempotency.abandon(idempotencyKey);
        this.#claims.release(jobId, taskId, claim.token);
        if (cancelled) {
          this.#setTaskState(jobId, taskId, "cancelled", { finishedAt });
        }
        return null;
      }

      if (outcome.succeeded) {
        this.#idempotency.complete(idempotencyKey, "succeeded", executionId);
        // PHASE 03 (P3-7): the reported verdict, or null when none was measured.
        // This used to be a literal `null` on both lines below, so `settle` -
        // which asks for `pass` - had nothing to answer with and every completed
        // approval-gated task left its job waiting for a verification nobody had
        // performed.
        const verdict = outcome.verificationVerdict ?? null;
        this.#writeVerdict(jobId, taskId, verdict);
        this.#setTaskState(jobId, taskId, "completed", {
          finishedAt,
          executionId,
          resultRef: executionId,
          failure: null,
        });
        this.#writeExecution({ ...(this.#readExecution(executionId) as Execution), state: "done", finishedAt });
        const result: ExecutionResult = {
          executionId,
          jobId,
          taskId,
          succeeded: true,
          output: outcome.output,
          verificationVerdict: verdict,
          providerId: outcome.providerId,
          modelId: outcome.modelId,
          traceId: outcome.traceId,
          usage: outcome.usage,
          failure: null,
        };
        this.#writeResult(result);
        this.#claims.release(jobId, taskId, claim.token);
        this.#event("task_completed", {
          jobId,
          taskId,
          attempt: attemptNumber,
          provider: outcome.providerId,
          model: outcome.modelId,
          outputTokens: outcome.usage?.outputTokens ?? null,
          amount: outcome.usage?.amount ?? null,
          currency: outcome.usage?.currency ?? null,
        });
        return result;
      }

      // PHASE 03 (B-10): GOVERNANCE HELD THIS WORK. IT DID NOT FAIL.
      //
      // A `approval_required` outcome is the one failure class that a human can
      // still resolve, and resolving it was recorded as a permanent failure with
      // `retryable: false` - which made a configured approval requirement
      // indistinguishable from a bug, and made the setting permanently fail every
      // job that used it.
      //
      // The question asked here is "is a human currently being asked?", and it is
      // answered from this coordinator's OWN registry rather than from the outcome
      // or from any caller argument: an open, undecided gate for this job and task
      // IS the definition of that state. Only a `waiting` gate holds the task - a
      // rejected, expired or cancelled one is terminal and falls through to the
      // ordinary failure path below, because a refused approval is a real answer
      // and must not be retried into a different one.
      const awaiting =
        errorClass === "approval_required" ? this.#approvals.forTask(jobId, taskId) : null;
      if (awaiting !== null && awaiting.state === "waiting") {
        this.#idempotency.abandon(idempotencyKey);
        this.#claims.release(jobId, taskId, claim.token);
        this.#writeExecution({ ...(this.#readExecution(executionId) as Execution), state: "done", finishedAt });
        this.#setTaskState(jobId, taskId, "waiting_approval", {
          attempts: attemptNumber,
          approval: awaiting,
          // No failure: nothing went wrong, and recording one would make the
          // history claim the work was attempted and rejected.
          failure: null,
          finishedAt: null,
        });
        this.#event("task_waiting_for_approval", {
          jobId,
          taskId,
          attempt: attemptNumber,
          gateId: awaiting.gateId,
          question: awaiting.question,
        });
        return null;
      }

      // Failure path. The decision comes from the EXISTING retry policy, applied to
      // the STRUCTURED error class and never to the message text. A permanent
      // class - a configuration error, an auth failure, an invalid request - is
      // not retryable whatever the attempt budget says.
      const policy: RetryPolicy = {
        maxAttempts: record.task.limits.maxAttempts,
        backoff: this.#backoff(),
        fallbackOnQuotaExhausted: true,
      };
      const decision = decideRetry(policy, errorClass ?? "unknown", attemptNumber, () => 0);
      const failure: ExecutionFailure = {
        errorClass: errorClass ?? "unknown",
        message: outcome.error ?? "Task failed without a reported reason",
        retryable: decision.action === "retry",
        attempt: attemptNumber,
        at: finishedAt,
      };
      this.#idempotency.complete(idempotencyKey, "failed", null);
      this.#claims.release(jobId, taskId, claim.token);
      this.#writeExecution({ ...(this.#readExecution(executionId) as Execution), state: "done", finishedAt });

      if (decision.action === "retry") {
        this.#setTaskState(jobId, taskId, "retrying", { attempts: attemptNumber, failure, finishedAt: null });
        this.#event("task_retrying", {
          jobId,
          taskId,
          attempt: attemptNumber,
          maxAttempts: record.task.limits.maxAttempts,
          backoffMs: decision.delayMs,
          errorClass: failure.errorClass,
        });
        return null;
      }
      if (decision.action === "fallback") {
        // Quota exhaustion escalates to the fallback path, which re-enters the
        // PHASE 06 routing contract. It does NOT pick a provider here: this
        // coordinator has no way to name one.
        this.#setTaskState(jobId, taskId, "retrying", { attempts: attemptNumber, failure, finishedAt: null });
        this.#event("task_retrying", {
          jobId,
          taskId,
          attempt: attemptNumber,
          reason: decision.reason,
          detail: "Quota exhausted; the next attempt re-enters routing rather than retrying the same target.",
          errorClass: failure.errorClass,
        });
        return null;
      }

      this.#setTaskState(jobId, taskId, "failed", { attempts: attemptNumber, failure, finishedAt });
      this.#event("workflow_task_failed", { jobId, taskId, attempt: attemptNumber, errorClass: failure.errorClass, reason: failure.message });
      return null;
    } finally {
      lease.release();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Settlement                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Decides whether the job is complete, waiting, or should retry.
   *
   * This is the authority the brief asks for: whether another task is released,
   * whether the workflow continues, and whether it is done. Verification is not
   * completion, so a task whose verdict is not `pass` leaves the job short of
   * complete.
   */
  public settle(jobId: string): { readonly state: JobState; readonly detail: string } {
    const job = this.#readJob(jobId);
    if (job === null) {
      return { state: "failed", detail: `No such job: ${jobId}` };
    }
    if (this.#cancelled.has(jobId) || isTerminalJobState(job.state)) {
      return { state: job.state, detail: `Job "${jobId}" is ${job.state}.` };
    }

    const records = this.tasksOf(jobId);
    const active = records.filter(
      (record) => record.state !== "completed" && record.state !== "failed" && record.state !== "cancelled" && record.state !== "skipped",
    );
    if (active.length > 0) {
      const retrying = active.filter((record) => record.state === "retrying");
      if (retrying.length > 0) {
        this.#ensureState(job, "retrying", `${retrying.length} task(s) awaiting another attempt`, null);
        return { state: "retrying", detail: `${retrying.length} task(s) awaiting another attempt.` };
      }
      const waiting = active.filter((record) => record.state === "waiting_approval" || record.state === "pending");
      if (waiting.length > 0) {
        const onApproval = waiting.filter((record) => record.state === "waiting_approval");
        this.#transition(
          job,
          "waiting",
          onApproval.length > 0 ? `Waiting on approval for ${onApproval.length} task(s)` : `Waiting on ${waiting.length} dependency(ies)`,
          onApproval.length > 0 ? "approval" : "dependency",
        );
        return { state: "waiting", detail: `${waiting.length} task(s) are not yet runnable.` };
      }
      this.#ensureState(job, "running", `${active.length} task(s) still in progress`, null);
      return { state: "running", detail: `${active.length} task(s) still in progress.` };
    }

    const failed = records.filter((record) => record.state === "failed");
    const skipped = records.filter((record) => record.state === "skipped");
    const unverified = records.filter((record) => {
      const verdict = this.#readVerdict(jobId, record.task.taskId);
      // PHASE 03 (P3-7). Two changes, both about what `null` MEANS:
      //
      //   - `verdict !== null` first. `null` is NOT MEASURED, which is what it
      //     means everywhere else in this codebase (see the `reportedVerification`
      //     rule in `authority.ts`). A run that required no verification reports
      //     none, and "nothing was checked" is not "the check failed". Requiring
      //     `pass` here meant an approval-gated task - which by definition had a
      //     gate, ran, and completed - could never satisfy the condition, so every
      //     approved job waited forever for a verification that was never going to
      //     happen. The approval path was unusable end to end.
      //   - `record.state === "completed"` unchanged: only a task that finished is
      //     in a position to be unverified.
      return verdict !== null && verdict !== "pass" && record.state === "completed" && record.task.approvalRequired;
    });

    if (unverified.length > 0) {
      this.#ensureState(job, "waiting", `${unverified.length} task(s) completed without a passing verification`, "external");
      return {
        state: "waiting",
        detail: `${unverified.length} task(s) finished but did not verify. Execution is not verification, so the job is not complete.`,
      };
    }

    if (failed.length > 0 || skipped.length > 0) {
      const first = failed[0]?.failure ?? skipped[0]?.failure ?? null;
      const detail =
        failed.length > 0
          ? `Job "${jobId}" failed: ${failed.length} task(s) failed. First: ${first?.message ?? "no reason reported"}`
          : `Job "${jobId}" did not complete: ${skipped.length} task(s) were skipped because a prerequisite did not succeed.`;
      this.#writeJob({ ...(this.#readJob(jobId) as Job), failure: first });
      this.#transition(this.#readJob(jobId) as Job, "failed", detail, null);
      return { state: "failed", detail };
    }

    const cancelledTasks = records.filter((record) => record.state === "cancelled");
    if (cancelledTasks.length > 0) {
      this.#ensureState(job, "cancelled", `${cancelledTasks.length} task(s) were cancelled`, null);
      return { state: "cancelled", detail: `${cancelledTasks.length} task(s) were cancelled.` };
    }

    this.#transition(job, "completed", `All ${records.length} task(s) completed and verified where required`, null);
    this.#event("job_completed", { jobId, tasks: records.length });
    return { state: "completed", detail: `Job "${jobId}" completed.` };
  }

  #settle(jobId: string): void {
    this.settle(jobId);
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  #setTaskState(jobId: string, taskId: string, state: JobTaskState, patch: Partial<TaskRecord> = {}): void {
    const record = this.#readTask(jobId, taskId);
    if (record === null) {
      return;
    }
    this.#writeTask(jobId, { ...record, ...patch, state });
  }

  /* ---------------------------------------------------------------------- */
  /* PHASE 12 (12.5A): the durable boundary for jobs and tasks               */
  /* ---------------------------------------------------------------------- */

  /**
   * Reads a job from the REPOSITORY and refreshes the cache from the answer.
   *
   * The repository is asked first, always. A cache hit is not an answer, because the cache can
   * be stale in a way that matters: a second process may have moved the job, or a restart may
   * have replaced the whole map. `tests/coordinatorCacheAuthority.p12` proves both by mutating
   * durable state behind the coordinator's back and reading through this path.
   *
   * `node:sqlite` is synchronous, so this costs a point lookup rather than a round trip. That is
   * the reason the design made the interface synchronous, and it is why there is no batching or
   * read-behind cache to reason about here.
   */
  #readJob(jobId: string): Job | null {
    const row = this.#durable.getJob(jobId);
    if (row === null) {
      // A cache entry with no durable row behind it is worse than nothing: it would let a job
      // that was never persisted, or was deleted, keep answering. So it is DROPPED, not returned.
      this.#jobs.delete(this.#jobKey(jobId));
      return null;
    }
    const cached = this.#jobs.get(this.#jobKey(jobId));
    const job = this.#jobFromRow(row, cached);
    this.#jobs.set(this.#jobKey(jobId), job);
    return job;
  }

  /** Reads a task from the repository, refreshing the cache from the answer. */
  #readTask(jobId: string, taskId: string): TaskRecord | null {
    const row = this.#durable.getTask(jobId, taskId);
    if (row === null) {
      this.#tasks.get(this.#jobKey(jobId))?.delete(taskId);
      return null;
    }
    const cached = this.#tasks.get(this.#jobKey(jobId))?.get(taskId);
    const record = this.#taskFromRow(row, cached);
    const bucket = this.#tasks.get(this.#jobKey(jobId)) ?? new Map<string, TaskRecord>();
    bucket.set(taskId, record);
    this.#tasks.set(this.#jobKey(jobId), bucket);
    return record;
  }

  /**
   * Persists a job, THEN caches it.
   *
   * The ordering is the whole point, and it is enforced here rather than at the call sites
   * because a call site that forgets it is invisible: the tests would still pass on any path
   * where the repository does not fail.
   *
   * If `putJob` throws, nothing is cached. That is the correct outcome - the operation failed,
   * and a cache holding a value durable state does not have would report a job that does not
   * exist.
   */
  #writeJob(job: Job): Job {
    this.#durable.putJob(this.#jobToRow(job));
    this.#jobs.set(this.#jobKey(job.jobId), job);
    return job;
  }

  /**
   * Persists a task, THEN caches it.
   *
   * `transition` is part of the SAME transaction when one is supplied, so a successful mutation
   * can never leave `task.state` and the transition history disagreeing - the failure mode that
   * a write-then-record-later pair would produce on a crash between them.
   */
  #writeTask(jobId: string, record: TaskRecord, transition: { from: JobTaskState | null; to: JobTaskState; reason: string } | null = null): TaskRecord {
    this.#durable.transaction(() => {
      this.#durable.putTask(this.#taskToRow(jobId, record));
      if (transition !== null) {
        this.#durable.putTaskTransition({
          jobId,
          taskId: record.task.taskId,
          from: transition.from,
          to: transition.to,
          at: this.#clock.nowMs(),
          reason: transition.reason,
        });
      }
    });
    const bucket = this.#tasks.get(this.#jobKey(jobId)) ?? new Map<string, TaskRecord>();
    bucket.set(record.task.taskId, record);
    this.#tasks.set(this.#jobKey(jobId), bucket);
    return record;
  }

  /**
   * Row -> Job, keeping the fields the repository does not model.
   *
   * `Job` carries `caller`, `cancellation`, `workflow` and `failure` which have no columns yet -
   * migrations for those are later slices. Taking the CACHED record as the base is correct here
   * and is NOT a second authority: the authoritative fields (`state`, `updatedAt`) always come
   * from the row, and the rest are carried forward until they are modelled. If the cache is
   * empty those fields come back empty, which is the honest answer for "not yet persisted" and
   * is why the restart tests assert on `state`, which is what durability currently covers.
   */
  #jobFromRow(row: JobRow, cached: Job | undefined): Job {
    const base = cached ?? ({} as Job);
    return {
      ...base,
      jobId: row.jobId,
      workflowId: row.workflowId,
      label: row.label,
      state: row.state,
      priority: row.priority as Job["priority"],
      owner: row.owner,
      // PHASE 12 (12.5B). This was the missing field: `budgetStatus` reads
      // `job.budget.maxDurationMs`, and a Job rebuilt without it had `budget: undefined` - so the
      // method THREW for any coordinator that rehydrated a job from the database, and the job's
      // cost and duration limits were lost across a restart.
      budget: parseBudget(row.budget),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  #jobToRow(job: Job): JobRow {
    return {
      jobId: job.jobId,
      workflowId: job.workflowId,
      label: job.label,
      state: job.state,
      priority: job.priority,
      owner: job.owner,
      correlationId: job.correlationId ?? job.jobId,
      budget: JSON.stringify(job.budget),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  #taskFromRow(row: TaskRow, cached: TaskRecord | undefined): TaskRecord {
    const definition = this.#parseDefinition(row.definition, cached?.task);
    return {
      task: definition,
      state: row.state,
      attempts: row.attempts,
      executionId: row.executionId,
      claimToken: row.claimToken,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      resultRef: row.resultRef,
      failure:
        row.failure === null
          ? null
          : {
              errorClass: (row.failureClass ?? "unknown") as ExecutionFailure["errorClass"],
              message: row.failure,
              retryable: row.retryable ?? false,
              attempt: row.attempts,
              at: row.finishedAt ?? row.startedAt ?? 0,
            },
      // Not a column yet; carried from the cache until the checkpoint slice models it.
      latestCheckpoint: cached?.latestCheckpoint ?? null,
      approval: cached?.approval ?? null,
    };
  }

  #taskToRow(jobId: string, record: TaskRecord): TaskRow {
    return {
      jobId,
      taskId: record.task.taskId,
      state: record.state,
      attempts: record.attempts,
      executionId: record.executionId,
      claimToken: record.claimToken,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      resultRef: record.resultRef,
      failure: record.failure?.message ?? null,
      failureClass: record.failure?.errorClass ?? null,
      retryable: record.failure?.retryable ?? null,
      // The caller decides whether a redrive is safe; the coordinator never guesses, because it
      // cannot know whether a provider call it made was billed.
      redriveSafe: record.task.checkpointable === true && record.failure === null,
      definition: JSON.stringify(record.task),
    };
  }

  #parseDefinition(json: string, fallback: WorkflowTask | undefined): WorkflowTask {
    if (fallback !== undefined) return fallback;
    try {
      return JSON.parse(json) as WorkflowTask;
    } catch {
      // A definition that will not parse is a CORRUPT row, and the honest answer to "what task is
      // this" when the answer is unreadable is a refusal rather than a guess.
      throw new Error("A persisted task definition could not be read; the durable row is corrupt");
    }
  }

  /* ---------------------------------------------------------------------- */
  /* PHASE 12 (12.5B): durable authority for the remaining six records      */
  /* ---------------------------------------------------------------------- */

  /*
   * Same three-part shape as 12.5A: repository first, cache second, repository-authoritative
   * reads. What changed here is only HOW MUCH is derived rather than stored.
   *
   * Two of these six turned out NOT to be list-shaped once read, and that is worth recording
   * because it was not obvious from the names:
   *
   *  - `#measuredAmount` was a per-job LIST of `{ amount, currency }` entries, appended as
   *    results arrived, and `budgetStatus` summed it. But `spent.length === 0` is load-bearing:
   *    a job that reported TOKENS with no monetary amount is "unpriced", which is different from
   *    both "nothing has run" and "it cost nothing". An aggregate of 0 cannot express that, so
   *    the durable row keeps `measured_amount` NULL until something is measured and the sum
   *    thereafter. Nothing ever read the individual entries - the only read was the reduce.
   *
   *  - `#executions`, `#attempts`, `#results` and `#verdicts` are genuinely per-identity, so they
   *    map one-to-one onto `executions`, `attempts`, `results` and `verdicts`.
   */

  /** Durable transition history for a JOB. Ordering is the table's autoincrement `seq`. */
  /**
   * PHASE 12 (12.5B-FIX): repository-authoritative job transition history.
   *
   * This used to return the cache, with a comment admitting that no durable representation
   * existed - which meant a restart silently discarded a job's entire lifecycle audit trail.
   * `job_transitions` now carries it, and the cache is rebuilt FROM the answer rather than being
   * the answer.
   */
  #readJobTransitions(jobId: string): readonly JobTransitionRecord[] {
    const rows = this.#durable.listJobTransitions(jobId);
    const list = rows.map((row) => ({
      jobId: row.jobId,
      from: row.from as JobTransitionRecord["from"],
      to: row.to as JobTransitionRecord["to"],
      at: row.at,
      reason: row.reason,
      waitingFor: row.waitingFor as JobTransitionRecord["waitingFor"],
    }));
    this.#transitions.set(this.#jobKey(jobId), [...list]);
    return list;
  }

  /** Repository first, then the cache. The sequence is allocated durably by the repository. */
  #writeJobTransition(jobId: string, record: JobTransitionRecord): void {
    this.#durable.appendJobTransition({
      jobId,
      from: record.from,
      to: record.to,
      at: record.at,
      reason: record.reason,
      waitingFor: record.waitingFor,
    });
    const history = [...(this.#transitions.get(this.#jobKey(jobId)) ?? []), record];
    this.#transitions.set(this.#jobKey(jobId), history);
  }

  /** Execution lifecycle records, keyed by executionId. */
  #readExecution(executionId: string): Execution | null {
    const row = this.#durable.getExecution(executionId);
    if (row === null) {
      this.#executions.delete(executionId);
      return null;
    }
    const execution: Execution = {
      executionId: row.executionId,
      jobId: row.jobId,
      taskId: row.taskId,
      attempt: row.attempt,
      workerId: row.workerId,
      claimToken: row.claimToken,
      state: row.state as Execution["state"],
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      traceId: row.traceId,
    };
    this.#executions.set(executionId, execution);
    return execution;
  }

  /**
   * Persists an execution, THEN caches it.
   *
   * An execution left `running` by a crash is NOT resolved here. It is written with whatever
   * state it had and left for 12.10 to classify - this slice must not decide, because the honest
   * answer is `indeterminate` and recovery is where that decision belongs.
   */
  #writeExecution(execution: Execution): Execution {
    this.#durable.putExecution({
      executionId: execution.executionId,
      jobId: execution.jobId,
      taskId: execution.taskId,
      attempt: execution.attempt,
      workerId: execution.workerId,
      claimToken: execution.claimToken,
      state: execution.state,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      traceId: execution.traceId,
    });
    this.#executions.set(execution.executionId, execution);
    return execution;
  }

  /** Attempts for a task, ordered by attempt number from the repository. */
  #readAttempts(jobId: string, taskId: string): readonly ExecutionAttempt[] {
    const rows = this.#durable.listAttempts(jobId, taskId);
    const list = rows.map((row) => ({
      attempt: row.attempt,
      executionId: row.executionId,
      jobId: row.jobId,
      taskId: row.taskId,
      claimToken: row.claimToken,
      workerId: row.workerId,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
        outcome: row.outcome as ExecutionAttempt["outcome"],
        durationMs: row.durationMs,
        errorClass: row.errorClass as ExecutionAttempt["errorClass"],
        error: row.error,
        providerId: row.providerId,
        modelId: row.modelId,
        idempotencyKey: row.idempotencyKey,
        usage: row.usage === null ? null : (JSON.parse(row.usage) as ExecutionAttempt["usage"]),
      }));
    const bucket = new Map(list.map((attempt) => [attempt.attempt, attempt]));
    this.#attempts.set(this.#taskKey(jobId, taskId), list);
    return [...bucket.values()];
  }

  #writeAttempt(attempt: ExecutionAttempt): ExecutionAttempt {
    this.#durable.putAttempt({
      jobId: attempt.jobId,
      taskId: attempt.taskId,
      attempt: attempt.attempt,
      executionId: attempt.executionId,
      claimToken: attempt.claimToken,
      workerId: attempt.workerId,
      startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        outcome: attempt.outcome,
        // PHASE 12 (12.5B): the seven fields the 12.3 schema had no columns for. `usage` is JSON
        // because the repository does not model `MeasuredUsage`; storing it verbatim keeps the
        // round trip exact rather than losing the numbers on a restart.
        durationMs: attempt.durationMs,
        errorClass: attempt.errorClass,
        error: attempt.error,
        providerId: attempt.providerId,
        modelId: attempt.modelId,
        idempotencyKey: attempt.idempotencyKey,
        usage: attempt.usage === null ? null : JSON.stringify(attempt.usage),
      });
    const existing = this.#attempts.get(this.#taskKey(attempt.jobId, attempt.taskId)) ?? [];
    const at = existing.findIndex((row) => row.attempt === attempt.attempt);
    if (at >= 0) existing[at] = attempt;
    else existing.push(attempt);
    existing.sort((a, b) => a.attempt - b.attempt);
    this.#attempts.set(this.#taskKey(attempt.jobId, attempt.taskId), existing);
    return attempt;
  }

  /** The result of one task, keyed durably by execution. */
  #readResult(jobId: string, taskId: string): ExecutionResult | null {
    const task = this.#durable.getTask(jobId, taskId);
    if (task === null || task.executionId === null) {
      return null;
    }
    const row = this.#durable.getResult(task.executionId);
    if (row === null) {
      return null;
    }
    const result: ExecutionResult = {
      executionId: row.executionId,
      jobId: row.jobId,
      taskId: row.taskId,
      succeeded: row.succeeded,
      output: row.output,
      verificationVerdict: (row.verificationVerdict ?? null) as ExecutionResult["verificationVerdict"],
      providerId: row.providerId,
      modelId: row.modelId,
      traceId: row.traceId,
      usage: null,
      failure: row.failure === null ? null : { errorClass: "unknown", message: row.failure, retryable: false, attempt: 0, at: 0 },
    };
    const cache = this.#results.get(this.#taskKey(jobId, taskId)) ?? new Map<string, ExecutionResult>();
    cache.set(result.executionId, result);
    this.#results.set(this.#taskKey(jobId, taskId), cache);
    return result;
  }

  #writeResult(result: ExecutionResult): void {
    this.#durable.putResult({
      executionId: result.executionId,
      jobId: result.jobId,
      taskId: result.taskId,
      succeeded: result.succeeded,
      output: result.output,
      verificationVerdict: result.verificationVerdict,
      providerId: result.providerId,
      modelId: result.modelId,
      traceId: result.traceId,
      failure: result.failure?.message ?? null,
    });
    const cache = this.#results.get(this.#taskKey(result.jobId, result.taskId)) ?? new Map<string, ExecutionResult>();
    cache.set(result.executionId, result);
    this.#results.set(this.#taskKey(result.jobId, result.taskId), cache);
  }

#readVerdict(jobId: string, taskId: string): "pass" | "fail" | "needs_review" | null {
      const row = this.#durable.getVerdict(jobId, taskId);
      const verdict = row?.verdict ?? null;
      // PHASE 12 (12.5B): cache ONLY. This called `#writeVerdict`, which meant every READ wrote
      // to the repository - a write on a read path, so a caller that merely asked what the
      // verdict was persisted one. Caught by the unused-private-member lint, which is the only
      // reason it was visible at all.
      this.#verdicts.set(this.#taskKey(jobId, taskId), verdict);
      return verdict;
    }

#writeVerdict(jobId: string, taskId: string, verdict: "pass" | "fail" | "needs_review" | null): void {
      this.#durable.putVerdict({ jobId, taskId, verdict });
      this.#verdicts.set(this.#taskKey(jobId, taskId), verdict);
    }

  /**
   * Measured spend for a job.
   *
   * `null` when nothing has been measured, which is the fact `budgetStatus` needs and the reason
   * an aggregate was safe to store. See the note above.
   */
  #readMeasuredAmount(jobId: string): number | null {
    const row = this.#durable.getBudget(jobId);
    const total = row === null || row.measuredAmount === null ? null : row.measuredAmount;
    this.#measuredAmount.set(this.#jobKey(jobId), total);
    return total;
  }

  /** Adds to the running total. `null` + a new amount is that amount, not zero. */
  #addMeasuredAmount(jobId: string, amount: number, currency: string): void {
    const current = this.#readMeasuredAmount(jobId);
    const next = (current ?? 0) + amount;
    this.#durable.putBudget({
      jobId,
      measuredAmount: next,
      currency,
      attemptsUsed: this.#durable.getBudget(jobId)?.attemptsUsed ?? 0,
    });
    this.#measuredAmount.set(this.#jobKey(jobId), next);
  }

  #recordAttempt(attempt: ExecutionAttempt): void {
    this.#writeAttempt(attempt);
  }

  /**
   * The backoff for the NEXT attempt.
   *
   * Recorded rather than slept on. A coordinator that actually slept would block
   * the whole job behind one task's wait, and a test of backoff would take
   * seconds of wall clock to say something the number already says.
   */
  #backoff(): BackoffPolicy {
    return {
      kind: "exponential",
      baseDelayMs: this.#backoffBaseMs,
      maxDelayMs: this.#backoffMaxMs,
      jitterRatio: 0,
    };
  }

  #event(kind: OrchestrationEventKind, metadata: Record<string, unknown>): void {
    if (this.#traces === null) {
      return;
    }
const jobId = typeof metadata["jobId"] === "string" ? metadata["jobId"] : "workflow";
      // PHASE 11: under the JOB'S correlation id, not under the job id.
      //
      // This wrote `traceId: jobId`, so workflow events sat on one trace while the
      // orchestration events they caused sat on `job.correlationId` - two traces for one job,
      // which is the `FINAL_ARCHITECTURE.md` §11 finding that `byTrace()` could not cross the
      // workflow boundary. `parentTaskId: null` stays correct: a workflow-level event belongs
      // to no task, and `jobId` on the event is what joins it to its job.
      const job = jobId === "workflow" ? null : this.job(jobId);
      this.#traces.record(
        kind,
        { traceId: job?.correlationId ?? jobId, taskId: jobId, parentTaskId: null, teamId: null },
        { ...metadata, workflowKind: kind },
        this.#clock.now(),
      );
  }
}


function canMove(job: Job, to: JobState): boolean {
  try {
    assertJobTransition(job.state, to);
    return true;
  } catch {
    return false;
  }
}

/** A minimal Result, so the coordinator does not import a second error shape. */
export interface Result_<T, E> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: E;
}

export { readyTasks };
