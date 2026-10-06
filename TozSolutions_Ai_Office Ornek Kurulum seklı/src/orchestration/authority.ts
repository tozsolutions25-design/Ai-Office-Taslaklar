/**
 * TOZ ORCHESTRATOR â€” the agent-execution authority.
 *
 * WHY THIS FILE IS THE MOST IMPORTANT ONE IN PHASE 04.
 *
 * Multi-agent systems usually fail not because an agent is weak, but because two
 * components each believe they decide what runs. `Planner`, `SpecialistPool`,
 * `ModelRouter`, `TeamRuntime`, `WorkerHost`, `AgentAdapter` and every registry
 * are SUBORDINATE. None of them can start an execution, and none of them can
 * move a task to `completed`.
 *
 * ## PHASE 08: THE CLAIM WAS TOO STRONG, AND WAS NOT TESTED
 *
 * This header used to say "the single system authority", and "this class is the only
 * place a task advances through its lifecycle". Both were FALSE as written, and nothing
 * asserted them - `TODO.md` PHASE 08 item 2 asked for the claim to be made structural and
 * tested, and it was neither.
 *
 * `ExecutionCoordinator` (`workflow/coordinator.ts`) is a second, fully-enforced state
 * machine. It creates jobs, transitions tasks, opens approval gates, and `decideApproval`
 * moves a task to `ready` or `skipped` directly. So a task's record can advance outside
 * this class, and pretending otherwise is the kind of comment that hides an architecture
 * instead of describing one.
 *
 * The fix is precision, not merger. The two authorities own DIFFERENT questions and
 * neither answers the other's:
 *
 *   - `ExecutionCoordinator` owns WORKFLOW state: which job, which task in it, whether a
 *     task may be released, whether a job is complete. It holds every approval gate and
 *     is the only place a gate is decided. It never drives itself - `runJob` exists to be
 *     called by whoever owns the job - and no production component calls it, so it cannot
 *     race this class for control of an execution.
 *   - THIS class owns AGENT EXECUTION: which agent is selected, which provider and model
 *     route it, what topology its subtasks run in, and what evidence comes back.
 *
 * They are layered, not parallel: when the coordinator does execute a task it reaches
 * execution only through `TaskExecutionPort`, whose sole production implementation
 * forwards to `orchestrator.execute`. "Who runs the agent" therefore has exactly one
 * answer even when a job is driving.
 *
 * The narrow claim - that this class is the only production site that invokes an adapter,
 * selects an agent, or runs a subtask wave - is asserted from source by
 * `tests/agentAuthority.p08-evidence.test.ts`, one call site at a time. It is stated here
 * because that is where the authority is, and it is tested because a comment is not an
 * invariant.
 *
 * This class selects, runs and routes agent work in exactly one order:
 *
 *   1  identify the task
 *   2  determine required capabilities
 *   3  discover candidate agents        (SpecialistPool)
 *   4  filter by policy                (trust, health, tools, memory)
 *   5  select agent(s)                 (deterministic rank)
 *   6  select provider/model           (ModelRouter -> existing ProviderRouter)
 *   7  determine topology              (smallest sufficient)
 *   8  determine tools                 (ToolRegistry + permissions)
 *   9  execute
 *  10  collect evidence
 *  11  verify
 *  12  record outcome                  (FeedbackStore)
 *  13  update observability            (TraceRecorder, ResourceTracker)
 *  14  persist memory                  (MemoryProvider)
 *
 * It composes existing PHASE 01 infrastructure. It does not reimplement the
 * router, the retry policy, the concurrency limiter, or the audit log: an
 * execution that needed a second routing authority would be the exact defect
 * this design exists to prevent.
 */

import { type Capability } from "../capabilities/capability.js";
import { type Clock, systemClock } from "../core/clock.js";
import { type ErrorClass } from "../core/errors.js";
import { type IdGenerator, uuidIdGenerator } from "../core/ids.js";
import { type Result, err, ok } from "../core/result.js";
import { type Evidence, EvidenceCollector, mergeEvidence, type EvidenceToolCall } from "./evidence/evidence.js";
import { type FeedbackStore, feedbackFromExecution } from "./feedback/feedback.js";
import { type MemoryAccessPolicy, type MemoryProvider, type MemoryScope, type MemorySubject } from "./memory/memory.js";
import { type MemoryService } from "./memory/service.js";
import { type MemoryItem } from "./memory/model.js";
import { type ResourceTracker } from "./observability/trace.js";
import { type TraceRecorder, type ExecutionContext } from "./observability/trace.js";
import type { AdapterRegistry } from "./agent/adapter.js";
import { type AgentRegistry } from "./agent/registry.js";
import { trustRank, type TrustLevel } from "./agent/trust.js";
import { type CapabilityRegistry } from "./capabilities/registry.js";
import { type DriftGuard } from "./policy/antiDrift.js";
import { type SecurityDecisionLog, type InputPolicy, type OutputPolicy, screenInput, screenOutput } from "./policy/security.js";
import { type SelectionDecision, type SpecialistPool } from "./pool/specialistPool.js";
import { type AgentRecord } from "./agent/record.js";
import { TeamPlan, TeamRuntime, type SubtaskExecutor, type Team, type TeamResult } from "./team/team.js";
import { type Topology } from "./team/topology.js";
import { type ExecutionPlan, type SubTask, validatePlan } from "./task/plan.js";
import { type OrchestrationTaskState, canCompleteFrom, assertOrchestrationTransition } from "./task/state.js";
import { type ToolRegistry } from "./tools/tool.js";
import { type ToolExecutionHost } from "./tools/invoker.js";
import { tryWorkspaceOf, workspaceKey, type WorkspaceRef } from "./workspace/workspace.js";
import { isVerificationKind, type VerificationResult, type VerificationRunner } from "./verification/verifier.js";
import { type ModelRoutingPort } from "./model/modelRouter.js";
import { type SecurityContext, type RoutingRestriction } from "./governance/index.js";
import { type OrchestratorGovernancePort } from "./governance/gate.js";
import {
  authorizeExecution,
  authorizeSubtask,
  describeExecutionDecision,
  establishRequestIdentity,
  routingRestriction,
} from "./governance/enforcement.js";
import { type ProviderAdapterRegistry } from "./provider/providerAdapterRegistry.js";

/** What the caller submits. */
export interface OrchestrationRequest {
  readonly taskId: string;
  readonly objective: string;
  readonly input: string;
  readonly requiredCapabilities: readonly Capability[];
  readonly taskType: string;
  /** Verifiers that must pass. Empty means "none", which is NOT the same as passing. */
  readonly verificationKinds?: readonly string[];
  readonly minimumTrust?: TrustLevel;
  readonly preferredTopology?: Topology;
  /** A pre-built plan. Required when the task needs more than one agent. */
  readonly plan?: ExecutionPlan;
  readonly signal?: AbortSignal;
  /**
   * PHASE 05. Skips recall for this request.
   *
   * Exists so a caller can run a task that must not be influenced by anything
   * remembered, and so the absence of memory in a run is a stated decision rather
   * than an accident of configuration.
   */
  readonly skipMemory?: boolean;
  /**
   * PHASE 09: who is asking.
   *
   * Carried on the request because a caller IS the only thing that knows who it
   * is - the orchestrator cannot infer an actor from a taskId, and a guessed
   * actor is exactly the failure governance exists to prevent.
   *
   * Optional, and that is the safety story: with no `governance` configured on the
   * orchestrator this field is never read, so every existing deployment is
   * unchanged. With governance configured and this ABSENT, the gate cannot
   * identify the caller and DEFAULT-DENIES - because an unidentified caller is
   * not an authorised one.
   */
  readonly securityContext?: SecurityContext;
  /**
   * PHASE 11: the caller's correlation id, ADOPTED rather than replaced.
   *
   * `execute` minted `newId("trace")` unconditionally, so a caller that already had a
   * correlation id - the workflow coordinator has `job.correlationId` - got back a trace
   * that shared nothing with its own events. `byTrace()` could then not reach across the
   * workflow boundary from either side, which is the finding `FINAL_ARCHITECTURE.md` §11
   * recorded.
   *
   * Optional and honoured when present, so every existing caller is byte-identical: a
   * caller with no correlation id still gets a fresh trace. Supplied rather than always
   * overridden, because the whole point is that the two halves share ONE id - generating a
   * second one here is what created the split in the first place.
   */
  readonly traceId?: string;
}

export interface OrchestrationResult {
  readonly taskId: string;
  readonly traceId: string;
  readonly state: OrchestrationTaskState;
  readonly output: string;
  readonly evidence: Evidence | null;
  readonly verification: VerificationResult | null;
  readonly selection: SelectionDecision | null;
  readonly topology: Topology | null;
  /** The collective result, when more than one subtask was planned. */
  readonly team: TeamResult | null;
  /** Every agent that took part, as `agentId@version`. */
  readonly agents: readonly string[];
  readonly agentId: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly outcome: "succeeded" | "failed" | "cancelled" | "escalated";
  readonly errorClass: ErrorClass | null;
  /** Every step the orchestrator took, for a caller that must explain itself. */
  readonly steps: readonly string[];
  readonly reason: string;
  /**
   * PHASE 05: the memory this run was given, and therefore what may have shaped it.
   *
   * A run that consulted memory and could not say which memory is not auditable,
   * and an unrecallable recall is how a store quietly becomes the real authority.
   * Summaries and identity only, for the same reason the agents receive no values.
   *
   * Always present, so a caller never has to wonder whether a missing field means
   * "no memory existed" or "PHASE 05 was not wired in".
   */
  readonly recalled: readonly RecalledMemory[];
}

/** One memory a run was given, in the smallest form that is still honest. */
export interface RecalledMemory {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly summary: string;
  readonly confidence: "low" | "medium" | "high" | "certain";
}

/** What one plan run produced, before it is turned into a result. */
interface PlanRun {
  readonly teamResult: TeamResult;
  /** One evidence record per subtask that reached execution. */
  readonly records: readonly Evidence[];
  readonly agents: readonly string[];
  /** The first selection made, which is the one the result reports. */
  readonly selection: SelectionDecision | null;
  readonly provider: string | null;
  readonly model: string | null;
  /** The agent that produced the terminal subtask, when it ran. */
  readonly terminalAgentId: string | null;
  /**
   * PHASE 05: memory recalled before execution, forwarded to every agent.
   *
   * Summaries only, never values: an agent handed a whole memory store will
   * eventually quote it, and a summary is the smallest thing that lets it
   * decide whether to ask for more.
   */
  readonly recalled: readonly RecalledMemory[];
}

export interface OrchestratorOptions {
  readonly agents: AgentRegistry;
  readonly capabilities: CapabilityRegistry;
  readonly pool: SpecialistPool;
  readonly models: ModelRoutingPort;
  /**
   * Provider adapters, when provider-backed execution is in use.
   *
   * Optional, and the absence is meaningful: with no registry supplied, the
   * orchestrator does not check for a missing adapter, which is correct for a
   * deployment where every agent is self-hosted and no provider is involved.
   * Supply one to make "this route has nothing behind it" a failure rather than
   * a claim in the evidence.
   */
  readonly providerAdapters?: ProviderAdapterRegistry;
  /**
   * Registered provider ids, for agents that require a specific provider.
   *
   * Supplied by the composition root rather than read from a registry here, so
   * this module keeps no second view of the provider inventory. Without it,
   * every agent that names a required provider is rejected as
   * `missing_provider`, which is the safe direction to fail in.
   */
  readonly providerIds?: () => readonly string[];
  readonly tools: ToolRegistry;
  /**
   * PHASE 05: the ONE tool authority.
   *
   * OPTIONAL, and its absence is a fail-closed state rather than a convenience. The
   * orchestrator has never invoked a tool - nothing in `src/` asks an agent to call
   * one - so with no host supplied there is nothing to authorise against, and any
   * tool call an adapter reports is REFUSED rather than believed. That is the honest
   * behaviour for "this deployment has no tool authority": a run that claims a tool
   * call it could not have performed is exactly the claim this system must not accept.
   *
   * When supplied it must share the orchestrator's `tools` registry, and the
   * constructor refuses otherwise. Two registries would mean two answers to "which
   * tools exist", and a tool one of them authorised would be invisible to the other.
   */
  readonly toolHost?: ToolExecutionHost;
  readonly verification: VerificationRunner;
  readonly memory: MemoryProvider;
  /**
   * Access policy for memory writes.
   *
   * Optional, and that is a real limitation rather than a convenience: without
   * it the orchestrator writes through the raw provider and no scope check
   * happens. Supply one to make every write auditable.
   */
  readonly memoryPolicy?: MemoryAccessPolicy;
  /**
   * PHASE 09: the control plane, wired into the real execution path.
   *
   * OPTIONAL, and that is the compatibility guarantee: with no gate configured,
   * every check is skipped and a run behaves exactly as it did in PHASE 08. A
   * deployment opts in by supplying one.
   *
   * What the gate may do is bounded by its PORT: authorize an operation, and
   * narrow routing candidates. What it may not do - select a provider or model,
   * orchestrate, plan, mutate topology, write memory, or verify - is not a
   * convention but a MISSING CAPABILITY, because the port has no method for it.
   */
  readonly governance?: OrchestratorGovernancePort;
  readonly feedback: FeedbackStore;
  readonly traces: TraceRecorder;
  readonly resources: ResourceTracker;
  readonly drift: DriftGuard;
  readonly security: SecurityDecisionLog;
  readonly inputPolicy: InputPolicy;
  readonly outputPolicy: OutputPolicy;
  readonly adapters: AdapterRegistry;
  /**
   * Concurrency and budgets for the team runtime.
   *
   * Settings, not a `TeamRuntime` instance. The orchestrator builds the runtime
   * itself because the orchestrator is what selects the agent, routes the model
   * and calls the adapter: an injected runtime would have to be handed an
   * executor that already knew all of that, which is a second way in.
   */
  readonly team?: {
    /** Maximum subtasks in flight. */
    readonly maxConcurrency?: number;
    /** Per-subtask ceiling, when tighter than the plan's own limit. */
    readonly subtaskTimeoutMs?: number;
  };
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  /**
   * PHASE 08: the trust floor applied when a request states none.
   *
   * Optional, and the absence is a compatibility guarantee rather than a policy: with none
   * supplied the floor is `"low"`, exactly as it was before this option existed. Supply one
   * to make the configured `agent.defaultMinimumTrust` the value this class actually uses -
   * which, until Phase 08, it did not: the literal `"low"` was hardcoded at three sites and
   * the configuration field was wired to the pool's misconfiguration guard instead.
   *
   * Distinct from `SpecialistPool.maximumTrustFloor`, which caps what a request may ASK
   * for. This is what is used when a request asks for nothing.
   */
  readonly defaultMinimumTrust?: TrustLevel;
  /** Memory scope the orchestrator may write execution records to. */
  readonly memoryScope?: MemoryScope;
  /**
   * PHASE 05 memory service. Optional.
   *
   * When absent, the orchestrator behaves EXACTLY as it did in PHASE 04.1: no
   * recall, no capture, no learning. Nothing here is mandatory, and a deployment
   * that supplies no memory service loses no capability it had before.
   *
   * When present, the orchestrator uses it for two things only: to RECALL relevant
   * context before execution, and to CAPTURE an outcome after verification. It
   * never lets memory advance a task, and memory never becomes a second
   * orchestration path - the service holds no reference back to this class.
   */
  readonly memoryService?: MemoryService;
  /**
   * Scopes the orchestrator may recall from.
   *
   * Explicit, because a recall that defaulted to everything readable would be a
   * way to leak global memory into a narrow task. Empty means no recall at all.
   */
  readonly recallScopes?: readonly MemoryScope[];
  /** How many memories to inject as context. */
  readonly recallLimit?: number;
}

export class OrchestratorError extends Error {
  public readonly errorClass: ErrorClass;
  public constructor(errorClass: ErrorClass, message: string) {
    super(message);
    this.name = "OrchestratorError";
    this.errorClass = errorClass;
  }
}

/**
 * The authority.
 *
 * Every method is a distinct, named step of the policy in Â§14, so the sequence
 * is readable in the code rather than implied by call order. The orchestrator
 * holds no private selection logic of its own: selection is the pool's, routing
 * is the model's, verification is the verifier's.
 */
/**
 * PHASE 06 (N-1): the key for a task whose submitter's identity did not resolve a
 * workspace.
 *
 * A leading U+0000 cannot be produced by `workspaceKey`, whose head always begins
 * with a decimal length, so the two key spaces cannot collide. That matters: if they
 * could, an unattributed task and a partitioned one with the same `taskId` would
 * share a state record - which is the defect this phase is fixing, reintroduced
 * through the back door.
 */
function unattributedStateKey(taskId: string): string {
  return `\u0000${taskId}`;
}

/** The inverse of the two key shapes above. Diagnostic only - see `knownTaskIds`. */
function taskIdFromStateKey(key: string): string {
  if (key.startsWith("\u0000")) {
    return key.slice(1);
  }
  const separator = key.indexOf("\u0001");
  return separator < 0 ? key : key.slice(separator + 1);
}

export class TozOrchestrator {
  readonly #options: OrchestratorOptions;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #states = new Map<string, OrchestrationTaskState>();
  /**
   * PHASE 08: the configured default trust floor.
   *
   * This was the literal `"low"` at three call sites, so `agent.defaultMinimumTrust` -
   * documented as exactly this - could not change it. Resolved once here rather than read
   * from `#options` at each site, so there is one value in the class rather than three
   * copies that could drift.
   */
  readonly #defaultMinimumTrust: TrustLevel;

  public constructor(options: OrchestratorOptions) {
    // PHASE 05. One registry, or the tool boundary has two answers to "which tools
    // exist" and a tool one of them authorised is invisible to the other. Refused at
    // construction, where the operator is looking, rather than on the first call.
    if (options.toolHost !== undefined && options.toolHost.registry !== options.tools) {
      throw new Error(
        "The tool host and the orchestrator must share ONE tool registry; two registries would " +
          "mean two answers to which tools exist",
      );
    }
    this.#defaultMinimumTrust = options.defaultMinimumTrust ?? "low";
    this.#options = options;
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.ids ?? uuidIdGenerator;
  }

  /**
   * PHASE 06, finding N-1. The key a task's state is stored under.
   *
   * It was the BARE `taskId`. That is a real defect and it predates tenancy: two
   * callers submitting `taskId: "t1"` shared one state record, and `stateOf("t1")`
   * returned whichever wrote last. It is invisible in a single-workspace test
   * because there is only ever one `t1` - which is why it survived to Phase 06.
   *
   * The workspace is part of the KEY rather than a field compared on read, for the
   * reason the whole phase turns on: a cross-workspace lookup should MISS rather
   * than be filtered out, because a filter is a line somebody can forget and a key
   * is not.
   *
   * An absent or unresolved workspace yields the unattributed partition, which is a
   * distinct key. Two unattributed callers still share it - and that is stated
   * rather than papered over, because there is no identity here to separate them
   * by. It is fail-closed for the partitioned case, which is the case that matters.
   */
  #stateKey(taskId: string, context: OrchestrationRequest): string {
    const resolved = tryWorkspaceOf(context.securityContext);
    return resolved.ok ? workspaceKey(resolved.workspace, taskId) : unattributedStateKey(taskId);
  }

  /**
   * Current state of a task in the UNATTRIBUTED partition.
   *
   * PHASE 06 (N-1): the bare `taskId` form addresses one partition and says so,
   * because that is the only honest thing it can do now. It used to read a
   * process-wide map and therefore returned whichever of two callers used that
   * `taskId` had written last. A partitioned reader asks `stateOfIn`.
   */
  public stateOf(taskId: string): OrchestrationTaskState | null {
    return this.#states.get(unattributedStateKey(taskId)) ?? null;
  }

  /**
   * PHASE 06: the same question, asked with a workspace.
   *
   * `stateOf(taskId)` without a workspace can only reach the unattributed
   * partition, which is why the bare form is honest about what it can see rather
   * than quietly searching everything.
   */
  public stateOfIn(workspace: WorkspaceRef, taskId: string): OrchestrationTaskState | null {
    return this.#states.get(workspaceKey(workspace, taskId)) ?? null;
  }

  /**
   * The bare task ids this orchestrator has seen, across every partition.
   *
   * Ids are only unique WITHIN a partition, so this returns the id part of each
   * composite key. It is a diagnostic, and the docblock says so - a caller that
   * needs to act on a task must name its workspace, or it will find the first
   * partition that happens to hold that id.
   */
  public knownTaskIds(): readonly string[] {
    return [...this.#states.keys()].map(taskIdFromStateKey);
  }

  /**
   * Runs one task to a terminal or blocked state.
   *
   * Returns a result rather than throwing for any expected failure, so a caller
   * can handle a refused task without a try/catch. A thrown error here would mean
   * a bug in the orchestrator rather than a problem with the work.
   */
  public async execute(submitted: OrchestrationRequest): Promise<Result<OrchestrationResult, OrchestratorError>> {
    const steps: string[] = [];
    // PHASE 11: adopt the caller's correlation id when it supplies one, so orchestration
    // events and the workflow events that caused them share a single trace. Minted only when
    // the caller has none - see the `traceId` note on `OrchestrationRequest`.
    const traceId = submitted.traceId ?? this.#ids.newId("trace");
    const startedAt = this.#clock.nowMs();
    // PHASE 03 (B-08): WHO is asking, established ONCE and before anything else
    // reads it - before the authorization boundary below, before classification,
    // planning, memory recall, routing and execution. Every later check sees the
    // same identity rather than resolving it again and possibly getting a second
    // answer. A supplied context is kept as-is; a missing one goes through the
    // runtime's identity source; an unidentifiable caller stays unidentified so
    // the gate default-denies.
    const request = establishRequestIdentity(this.#options.governance, submitted, traceId);
    // Mutable: the team id is assigned once the topology is chosen, and every
    // event recorded after that point must carry it.
    const context: { traceId: string; taskId: string; parentTaskId: string | null; teamId: string | null } = {
      traceId,
      taskId: request.taskId,
      parentTaskId: null,
      teamId: null,
    };

    this.#states.set(this.#stateKey(request.taskId, request), "created");
    // PHASE 11: the run's FIRST event, and it was declared since PHASE 04 without ever being
    // emitted. A run's history that begins at its second event cannot answer "when did this
    // start", which is the first question anyone asks of a history.
    this.#record(
      context,
      "orchestration_started",
      {
        objective: request.objective,
        taskType: request.taskType,
        requestedCapabilities: [...request.requiredCapabilities],
        actor: request.securityContext?.actor ?? null,
      },
      this.#clock.now(),
    );
    steps.push("1 identified the task");

    // --- 1. input policy -------------------------------------------------
    const screened = await screenInput(
      this.#options.inputPolicy,
      this.#options.security,
      { objective: request.objective, input: request.input },
      startedAt,
    );
    if (!screened.ok) {
      steps.push("2 refused at the input policy");
      return this.#refuse(context, request, traceId, "configuration_error", screened.error.reason, steps, startedAt);
    }
    steps.push("2 passed the input policy");

    // --- 1b. governance (PHASE 09, optional) -------------------------------
    // THE REAL AUTHORIZATION BOUNDARY. Placed here deliberately: after the input
    // screen and BEFORE classification, planning, memory recall and execution, so
    // an unauthorised request never becomes a plan, never reaches PHASE 06
    // routing, and never reaches a worker.
    //
    // Optional in the strongest sense: with no `governance` configured this is
    // skipped entirely and a run proceeds exactly as it did in PHASE 08.
    const authorization = this.#authorizeExecution(context, request, steps);
    if (authorization !== null) {
      return this.#refuse(
        context,
        request,
        traceId,
        authorization.errorClass,
        authorization.reason,
        steps,
        startedAt,
      );
    }

    // --- 2. classify ------------------------------------------------------
    this.#transition(request.taskId, "classifying", request);
    steps.push("3 classified the task");

    // --- 3. plan ---------------------------------------------------------
    this.#transition(request.taskId, "planning", request);
    const plan = request.plan ?? this.#singleAgentPlan(request);
    const validPlan = validatePlan(plan);
    if (!validPlan.ok) {
      steps.push("4 rejected an invalid plan");
      return this.#refuse(context, request, traceId, "invalid_request", validPlan.error.message, steps, startedAt);
    }

    // --- 4. drift --------------------------------------------------------
    const drift = this.#options.drift.assess(plan, this.#clock.nowMs());
    steps.push(
      drift.allowed
        ? "5 passed anti-drift limits"
        : `5 refused by anti-drift: ${drift.violations.map((v) => v.kind).join(", ")}`,
    );
    if (!drift.allowed) {
      // The same refusal path as every other early exit, so a drift refusal
      // records the same state, trace and feedback as any other failure.
      steps.push("5 refused by anti-drift");
      return this.#refuse(
        context,
        request,
        traceId,
        "configuration_error",
        `Refused by anti-drift: ${drift.violations.map((violation) => violation.detail).join("; ")}`,
        steps,
        startedAt,
      );
    }

    this.#transition(request.taskId, "ready", request);
    steps.push("6 plan validated and within limits");

    // --- 4a. recall relevant memory (PHASE 05, optional) -------------------
    // Before execution, so the recalled context is available to the agents the
    // plan will use. Optional in the strongest sense: with no memory service
    // configured, or with the caller having asked to skip it, this is a no-op and
    // the run proceeds exactly as it did in PHASE 04.1.
    const recalled = await this.#recall(request, context, steps);

    // --- 5. topology -----------------------------------------------------
    const chosen = TeamPlan.choose(plan, { requestedTopology: request.preferredTopology });
    if (!chosen.ok) {
      steps.push("7 rejected an inconsistent topology request");
      return this.#refuse(context, request, traceId, "invalid_request", chosen.error.message, steps, startedAt);
    }
    const team = chosen.value;
    context.teamId = team.teamId;
    // PHASE 11: declared since PHASE 04, never emitted. `topology_selected` is recorded after
    // the run, so before this there was no event saying a team EXISTED — only one saying what
    // shape it turned out to be, which reads as a formation that never needed forming.
    this.#record(
      context,
      "team_formed",
      { teamId: team.teamId, planId: team.planId, topology: team.topology, members: team.memberTaskIds.length },
      this.#clock.now(),
    );
    steps.push(`7 chose topology "${team.topology}" for ${team.memberTaskIds.length} subtask(s)`);

    // --- 6. select agents, route, and execute the whole plan --------------
    this.#transition(request.taskId, "running", request);
    const run = await this.#runPlan(request, plan, team, context, recalled);
    const teamResult = run.teamResult;
    this.#record(
      context,
      "topology_selected",
      { topology: teamResult.topology, status: teamResult.status, subtasks: teamResult.outcomes.length },
      this.#clock.now(),
    );
    steps.push(
      `8 executed ${teamResult.outcomes.length} subtask(s) under "${teamResult.topology}": ${teamResult.reason}`,
    );

    // Cancellation is checked before the outcome, because a run the caller
    // abandoned is not a run that failed.
    if (request.signal?.aborted === true) {
      steps.push("9 cancelled by the caller");
      this.#transition(request.taskId, "cancelled", request);
      this.#record(context, "task_cancelled", { agentId: null, subtasks: teamResult.outcomes.length }, this.#clock.now());
      this.#writeFeedback(request, traceId, team.topology, run.agents, run.provider, run.model, "cancelled", null, null, null, 0, startedAt);
      return ok({
        taskId: request.taskId,
        traceId,
        state: "cancelled",
        output: "",
        evidence: this.#mergeOrNull(run, request, traceId, teamResult, this.#clock.nowMs()),
        verification: null,
        selection: run.selection,
        topology: team.topology,
        team: teamResult,
        agents: run.agents,
        agentId: null,
        provider: run.provider,
        model: run.model,
        outcome: "cancelled",
        errorClass: null,
// PHASE 05: the memory this run was given, so the run can be audited.
recalled: run.recalled,
        steps,
        reason: "The caller's abort signal fired before the task reached a terminal state",
      });
    }

    const failedOutcome = teamResult.outcomes.find((outcome) => outcome.status === "failed") ?? null;

    if (teamResult.status !== "succeeded") {
      // `partial` is reported as a failure, not a success with a caveat: the
      // plan did not complete, and a caller must not read a partial team as a
      // finished objective.
      const errorClass = failedOutcome?.errorClass ?? "unknown";
      const escalated = teamResult.status === "escalated";
      const reason =
        teamResult.status === "partial"
          ? `Partially completed: ${teamResult.reason}`
          : teamResult.reason;
      steps.push(`9 ${teamResult.status}: ${reason}`);
      // Escalation is its own terminal state. A subtask blocked on a person is
      // not a broken task, and reporting it as `failed` would send it to the
      // wrong queue.
      this.#transition(request.taskId, escalated ? "escalated" : "failed", request);
      this.#record(
        context,
        escalated ? "subtask_escalated" : "subtask_failed",
        { agentId: run.terminalAgentId, errorClass, reason, subtaskId: failedOutcome?.taskId ?? null },
        this.#clock.now(),
      );
      this.#writeFeedback(
        request,
        traceId,
        team.topology,
        run.agents,
        run.provider,
        run.model,
        escalated ? "escalated" : "failed",
        null,
        null,
        errorClass,
        0,
        startedAt,
      );
      return ok({
        taskId: request.taskId,
        traceId,
        state: escalated ? "escalated" : "failed",
        output: "",
        evidence: this.#mergeOrNull(run, request, traceId, teamResult, this.#clock.nowMs()),
        verification: null,
        selection: run.selection,
        topology: team.topology,
        team: teamResult,
        agents: run.agents,
        agentId: run.terminalAgentId,
        provider: run.provider,
        model: run.model,
        outcome: escalated ? "escalated" : "failed",
        errorClass,
// PHASE 05: the memory this run was given, so the run can be audited.
recalled: run.recalled,
        steps,
        reason,
      });
    }

    // --- 7. assemble the task-level record --------------------------------
    const finishedAt = this.#clock.nowMs();
    const output = teamResult.terminalOutput ?? "";
    const evidence = mergeEvidence(run.records, {
      taskId: request.taskId,
      traceId,
      parentTaskId: request.taskId,
      output,
      finishedAt,
    });
    this.#record(context, "evidence_recorded", { agentId: null, agents: run.agents }, this.#clock.now());
    steps.push(`10 recorded evidence from ${run.agents.length} agent(s)`);

    // --- 8. verify ---------------------------------------------------------
    // Requested kinds come from the caller, the plan and every subtask. A kind
    // this build does not recognise cannot be satisfied, so it is reported
    // rather than dropped: silently ignoring a required check would turn a
    // missing capability into a green result.
    const requestedKinds = [
      ...(request.verificationKinds ?? []),
      ...plan.verificationKinds,
      ...plan.subtasks.flatMap((subtask) => subtask.verificationKinds),
    ];
    const unknownKinds = requestedKinds.filter((kind) => !isVerificationKind(kind));
    const requiredKinds = requestedKinds.filter(isVerificationKind);
    const verificationRequired = requiredKinds.length > 0 || unknownKinds.length > 0;
    if (verificationRequired) {
      this.#transition(request.taskId, "verifying", request);
    }

    const verification = await this.#options.verification.verify(evidence, requiredKinds, finishedAt);
    this.#record(context, "verification_completed", { verdict: verification.verdict }, this.#clock.now());

    // PHASE 02: "nothing was checked" and "a check ran and could not establish the
    // requirement" are DIFFERENT states, and this run used to report them
    // identically.
    //
    // `VerificationRunner` answers `needs_review` for an empty required-kind list,
    // which is right in isolation: it refuses to claim a pass for nothing. But the
    // orchestrator had already decided that no verification was REQUIRED, and then
    // handed that verdict to every consumer anyway. `OrchestratorTaskExecutor` reads
    // a non-`pass` verdict as "execution completed but not verified" and fails the
    // task - so a background task that asked for no verification could never
    // complete, while the same task driven directly reported success and a reason
    // of "Completed with no verification required". The payload contradicted the
    // sentence next to it.
    //
    // So: a verdict is reported only when a check was actually required. `null` then
    // means exactly what it means everywhere else in this codebase - not measured -
    // and "no verification required" is distinguishable from "verification failed".
    const reportedVerification = verificationRequired ? verification : null;
    steps.push(
      verificationRequired
        ? `11 verified: ${verification.verdict}${verification.reason ? ` (${verification.reason})` : ""}`
        : "11 no verification was required for this run, so nothing was checked and nothing is claimed about the result",
    );

    if (unknownKinds.length > 0) {
      // The verdict from a run that could not perform every required check is
      // not a pass, whatever the registered verifiers said.
      const reason = `Unrecognised verification kind(s) requested: ${[...new Set(unknownKinds)].join(", ")}`;
      steps.push(`12 escalated: ${reason}`);
      this.#transition(request.taskId, "escalated", request);
      this.#record(context, "task_escalated", { agentId: run.terminalAgentId, reason }, this.#clock.now());
      this.#writeFeedback(request, traceId, team.topology, run.agents, run.provider, run.model, "escalated", verification, evidence, null, 0, startedAt);
      return ok({
        taskId: request.taskId,
        traceId,
        state: "escalated",
        output: "",
        evidence,
        verification,
        selection: run.selection,
        topology: team.topology,
        team: teamResult,
        agents: run.agents,
        agentId: run.terminalAgentId,
        provider: run.provider,
        model: run.model,
        outcome: "escalated",
        errorClass: null,
// PHASE 05: the memory this run was given, so the run can be audited.
recalled: run.recalled,
        steps,
        reason,
      });
    }

    if (verificationRequired && !canCompleteFrom("verifying", true)) {
      // Unreachable while the state machine holds; asserted rather than
      // assumed, because a task must never complete on an unverified claim.
      return err(new OrchestratorError("unknown", "Internal: a verifying task was asked to complete without verification"));
    }

    if (verificationRequired && verification.verdict !== "pass") {
      const escalated = verification.verdict === "needs_review";
      this.#transition(request.taskId, escalated ? "escalated" : "failed", request);
      this.#record(
        context,
        escalated ? "task_escalated" : "subtask_failed",
        { agentId: run.terminalAgentId, reason: verification.reason, verdict: verification.verdict },
        this.#clock.now(),
      );
      this.#writeFeedback(
        request,
        traceId,
        team.topology,
      run.agents,
        run.provider,
        run.model,
        escalated ? "escalated" : "failed",
        verification,
        evidence,
        null,
        0,
        startedAt,
      );
      return ok({
        taskId: request.taskId,
        traceId,
        state: escalated ? "escalated" : "failed",
        output: "",
        evidence,
        verification,
        selection: run.selection,
        topology: team.topology,
        team: teamResult,
        agents: run.agents,
        agentId: run.terminalAgentId,
        provider: run.provider,
        model: run.model,
        outcome: escalated ? "escalated" : "failed",
        errorClass: null,
// PHASE 05: the memory this run was given, so the run can be audited.
recalled: run.recalled,
        steps,
        reason: verification.reason ?? `Verification returned "${verification.verdict}"`,
      });
    }

    // --- 9. complete -------------------------------------------------------
    this.#transition(request.taskId, "completed", request);
    this.#record(context, "task_completed", { agentId: run.terminalAgentId, agents: run.agents }, this.#clock.now());

    this.#writeFeedback(
      request,
      traceId,
      team.topology,
      run.agents,
      run.provider,
      run.model,
      "succeeded",
      reportedVerification,
      evidence,
      null,
      0,
      startedAt,
    );

    // --- 10. memory --------------------------------------------------------
    const scope: MemoryScope = this.#options.memoryScope ?? "task";
    // PHASE 06: no verified workspace, no memory. The write is skipped rather than
    // performed against a shared default partition.
    const memorySubject = this.#memorySubject(request);
    const remembered =
      memorySubject === null
        ? err(new Error("no verified workspace, so nothing was written to memory"))
        : await this.#writeMemory(scope, memorySubject, `${request.taskId}:outcome`, {
            taskId: request.taskId,
            agents: run.agents,
            verificationVerdict: reportedVerification?.verdict ?? null,
            finishedAt,
          });
    steps.push(
      remembered.ok
        ? "12 recorded outcome, feedback and memory"
        : `12 recorded outcome and feedback, but memory was not written: ${remembered.error.message}`,
    );

    // --- 11. offer the verified outcome to memory (PHASE 05, optional) ----
    // After verification, never before: an unverified result offered to memory
    // would let a claim about what happened become a record of what is true.
    void this.#capture(
      request,
      context,
      steps,
      {
        succeeded: true,
        escalated: false,
        verificationVerdict: reportedVerification?.verdict ?? null,
        errorClass: null,
        agents: run.agents,
        provider: run.provider,
        model: run.model,
        output,
      },
    );

    return ok({
      taskId: request.taskId,
      traceId,
      state: "completed",
      output,
      evidence,
      verification: reportedVerification,
      selection: run.selection,
      topology: team.topology,
      team: teamResult,
      agents: run.agents,
      agentId: run.terminalAgentId,
      provider: run.provider,
      model: run.model,
      outcome: "succeeded",
      errorClass: null,
// PHASE 05: the memory this run was given, so the run can be audited.
recalled: run.recalled,
      steps,
      reason: verificationRequired
        ? "Completed with a passing verification"
        : "Completed with no verification required",
    });
  }

  /**
   * Selects an agent for one subtask.
   *
   * Per subtask, not once per task: different subtasks may need different
   * capabilities, and selecting once would force one agent's limits onto work
   * it was never suited to.
   */
  #selectAgent(
    request: OrchestrationRequest,
    subtask: SubTask,
    context: ExecutionContext,
  ): SelectionDecision {
    const decision = this.#options.pool.select(
      {
        taskId: subtask.taskId,
        requiredCapabilities: [...request.requiredCapabilities, ...subtask.requiredCapabilities],
        minimumTrust: request.minimumTrust ?? this.#defaultMinimumTrust,
        requireVerifiedCapabilities: true,
      },
      {
        providerIds: () => this.#options.providerIds?.() ?? [],
        availableTools: () => this.#options.tools.ids(),
        grantedMemoryScopes: () => this.#grantedMemoryScopes(request),
      },
    );
    for (const rejected of decision.rejected) {
      this.#record(
        context,
        "agent_rejected",
        { agentId: rejected.agentKey, subtaskId: subtask.taskId, reason: rejected.rationale },
        this.#clock.now(),
      );
    }
    return decision;
  }

  /**
   * PHASE 05. The one place a claimed tool call becomes evidence.
   *
   * The permission is built here and nowhere else, from facts the system holds:
   *
   *   - `subject` is the agent that is claimed to have made the call. Not the task,
   *     because a tool permission is about WHO may call something, and an approval
   *     issued to one subject must not release another's call.
   *   - `trustLevel` is the SELECTED AGENT's own recorded trust floor, so a tool
   *     that demands more trust than the agent carries is refused. Reading the
   *     request's `minimumTrust` instead would let a permissive caller speak for the
   *     agent it selected.
   *   - `requiresApprovalForSideEffects` is TRUE, unconditionally, and there is no
   *     configuration that turns it off. It is the project definition of done -
   *     "a human approval is required for every irreversible or outbound action" -
   *     and the tool boundary is the only place an irreversible action can happen. A
   *     flag that could be set to false would be a way to switch off a security
   *     property, so it is not one.
   *   - NO APPROVAL IS PASSED. None can be obtained during execution: the approval
   *     authority is the coordinator's gate, and a tool call happens inside the
   *     execution that gate already approved. So an irreversible tool is refused,
   *     and the refusal says what would satisfy it. That is the honest current
   *     state, and it fails in the safe direction.
   *
   * With no tool host configured, ANY reported call is refused. "This deployment has
   * no tool authority" is not permission to believe a claim.
   */
  #verifyReportedTools(
    subtask: SubTask,
    agent: { readonly agentId: string; readonly version: string; readonly trustLevel: TrustLevel; readonly toolRequirements: readonly string[] },
    context: ExecutionContext,
    reported: readonly string[],
  ): { ok: true; verified: readonly EvidenceToolCall[] } | { ok: false; reason: string } {
    if (reported.length === 0) {
      return { ok: true, verified: [] };
    }
    const host = this.#options.toolHost;
    const subject = `${agent.agentId}@${agent.version}`;
    if (host === undefined) {
      for (const toolId of reported) {
        this.#record(
          context,
          "tool_refused",
          { agentId: subject, subtaskId: subtask.taskId, toolId, reason: "no tool authority is configured" },
          this.#clock.now(),
        );
      }
      return {
        ok: false,
        reason:
          `Agent "${subject}" reported tool call(s) [${reported.join(", ")}] but no tool authority is ` +
          `configured, so none of them can be authorised. An unverified tool claim fails the subtask.`,
      };
    }
    const outcome = host.verifyReported(
      agent.toolRequirements,
      { subject, trustLevel: agent.trustLevel, requiresApprovalForSideEffects: true },
      trustRank,
      reported,
    );
    for (const refusal of outcome.refusals) {
      this.#record(
        context,
        "tool_refused",
        { agentId: subject, subtaskId: subtask.taskId, toolId: refusal.toolId, reason: refusal.reason },
        this.#clock.now(),
      );
    }
    for (const call of outcome.verified) {
      this.#record(
        context,
        "tool_invoked",
        {
          agentId: subject,
          subtaskId: subtask.taskId,
          toolId: call.toolId,
          sideEffecting: call.sideEffecting,
          // Honest about its origin: this host did not perform the call.
          verifiedOnly: true,
        },
        this.#clock.now(),
      );
    }
    if (outcome.refusals.length > 0) {
      const detail = outcome.refusals.map((refusal) => `${refusal.toolId}: ${refusal.reason}`).join("; ");
      return {
        ok: false,
        reason: `Agent "${subject}" reported a tool call the system cannot authorise (${detail}).`,
      };
    }
    return { ok: true, verified: outcome.verified };
  }

  /**
   * Memory scopes this task's subject may use.
   *
   * Derived from the policy when one is configured, and empty otherwise. Empty is
   * the honest answer without a policy: an agent that declares a scope it was not
   * granted is rejected, rather than being allowed on the assumption that access
   * is unrestricted.
   */
  /**
   * PHASE 06. The subject memory authority is exercised AS.
   *
   * It used to be `` `task:${request.taskId}` `` at four sites in this file - a
   * value the CALLER supplies. Presenting another task's id therefore presented
   * that task's grants, which is an identity-confusion bug independent of tenancy.
   *
   * Now the subject is the verified actor, and the workspace comes from the one
   * function that is allowed to say where an identity is: `workspaceOf`, which
   * refuses anything that is not `provenance: "resolved"`. So a caller that
   * chooses a `taskId` chooses a memory KEY - and a key is not an identity.
   *
   * `null` when there is no verified workspace, and every caller treats that as
   * "no memory": fail-closed, and the run itself is already refused upstream by
   * `authorizeExecution` when there is no identity at all.
   */
  #memorySubject(request: OrchestrationRequest): MemorySubject | null {
    const resolved = tryWorkspaceOf(request.securityContext);
    if (!resolved.ok) {
      return null;
    }
    const actor = request.securityContext?.actor;
    if (actor === undefined || actor.trim() === "") {
      return null;
    }
    // PHASE 07: `operatingScope` is `task`, and it is a STATEMENT ABOUT WHERE THIS CODE
    // IS, not a guess about what the subject would like.
    //
    // Every memory operation on this path is a write of a task's outcome or a recall
    // performed while that task runs, so `task` is the narrowest scope that describes
    // all of them, and it is the honest answer for the widest one. Naming it `task`
    // therefore caps this subject at `task` and `conversation` - which is precisely the
    // invariant `SCOPE_BREADTH` documented from the start and never had a caller.
    //
    // It is NOT `project` or `team` "because the work belongs to one": a task does not
    // thereby become entitled to its project's memories. A deployment that genuinely
    // wants that reads it under a subject whose operating scope IS the project, which
    // is a decision someone has to make rather than one this method makes silently.
    return { id: actor, workspace: resolved.workspace, operatingScope: "task" };
  }

  #grantedMemoryScopes(request: OrchestrationRequest): readonly MemoryScope[] {
    const policy = this.#options.memoryPolicy;
    const subject = this.#memorySubject(request);
    if (!policy || subject === null) {
      return [];
    }
    return policy.readableScopes(subject);
  }

  /**
   * Runs the plan through the team runtime.
   *
   * The runtime orders and bounds the work; every decision inside a subtask
   * (which agent, which provider, which adapter) is made here, because the
   * orchestrator is the only component allowed to make it.
   */
  async #runPlan(
    request: OrchestrationRequest,
    plan: ExecutionPlan,
    team: Team,
    context: ExecutionContext,
    recalled: readonly MemoryItem[],
  ): Promise<PlanRun> {
    const records: Evidence[] = [];
    const agents: string[] = [];
    let selection: SelectionDecision | null = null;
    let provider: string | null = null;
    let model: string | null = null;
    let terminalAgentId: string | null = null;
    // Monotonic within this run, so two evidence records can be ordered without
    // relying on wall-clock resolution.
    let sequence = 0;

    const executor: SubtaskExecutor = async (subtask, runContext) => {
      const chosen = this.#selectAgent(request, subtask, context);
      const agent = chosen.selectedAgent;
      if (agent === null) {
        const message = `No eligible agent for subtask "${subtask.taskId}": ${chosen.reason}`;
        this.#record(context, "subtask_failed", { agentId: null, subtaskId: subtask.taskId, reason: message }, this.#clock.now());
        return { ok: false, error: { errorClass: "configuration_error", message } };
      }
      // The first selection is reported as THE selection, because a result
      // carries one explainable decision; every selection is still traced.
      selection ??= chosen;
      const key = `${agent.agentId}@${agent.version}`;
      if (!agents.includes(key)) {
        agents.push(key);
      }
      this.#record(context, "agent_selected", { agentId: key, subtaskId: subtask.taskId, reason: chosen.reason }, this.#clock.now());

      // A route is only required when the selected agent needs one. A
      // self-hosted specialist - an agency-hosted agent, a local tool-backed
      // agent - brings its own inference, and demanding a provider of it would
      // make the entire class inexecutable.
      let routedProvider: string | null = null;
      let routedModel: string | null = null;
      if (agent.requiresModelRoute) {
        const routing = await this.#options.models.route({
          taskId: subtask.taskId,
          capabilities: subtask.requiredCapabilities,
          // PHASE 09: governance narrows the candidate set BEFORE the hard
          // filter.
          //
          // PHASE 01 (C-1): the previous comment here claimed "`ModelRouter`
          // applies this subtraction ahead of `evaluateCandidate`, so a denied
          // provider cannot be selected". That was FALSE. `ModelRouter` applied
          // the subtraction to a local array, used it only for a length check,
          // and then called the router with no candidates at all - so the router
          // re-derived the full set and a denied provider WAS selected. The
          // restriction is now carried in the routing request and applied inside
          // `DefaultRouter`, at the single point where candidates enter it.
          //
          // Null when governance is absent or restricts nothing.
          denied: this.#routingRestriction(request, subtask.taskId),
          minimumTrust: request.minimumTrust ?? this.#defaultMinimumTrust,
        });
        if (routing.providerId === null) {
          // A real route is required. Executing with no provider would mean
          // pretending the work happened somewhere.
          const message = `No provider and model could be routed for subtask "${subtask.taskId}": ${routing.reason}`;
          // PHASE 11: declared since PHASE 04, never emitted. Recorded BEFORE the subtask
          // failure because they are different facts: "routing could not produce a route" is
          // the cause, "the subtask failed" is the consequence, and only the second was
          // visible. The `consideredOrder` is included because a refusal whose reason is
          // "everything was considered and rejected" is a different problem from one where the
          // order was empty.
          this.#record(
            context,
            "model_route_refused",
            {
              agentId: key,
              subtaskId: subtask.taskId,
              reason: routing.reason,
              consideredOrder: routing.decision?.consideredOrder ?? [],
              denied: this.#routingRestriction(request, subtask.taskId),
            },
            this.#clock.now(),
          );
          this.#record(context, "subtask_failed", { agentId: key, subtaskId: subtask.taskId, reason: message }, this.#clock.now());
          return { ok: false, error: { errorClass: "configuration_error", message } };
        }
        // PHASE 11: `model_route_fell_back`, declared since PHASE 04 and never emitted. The
        // router reports the order it CONSIDERED and the candidate it SELECTED, so "it passed
        // over something" is a fact available here and nowhere else.
        //
        // Recorded only when the selected candidate was not the FIRST considered, which is the
        // definition of having fallen back. Recording it on every route would drown the signal.
        const considered = routing.decision?.consideredOrder ?? [];
        if (
          considered.length > 1 &&
          routing.decision?.selected !== null &&
          routing.decision?.selected.provider.providerId !== considered[0]
        ) {
          this.#record(
            context,
            "model_route_fell_back",
            {
              agentId: key,
              subtaskId: subtask.taskId,
              provider: routing.providerId,
              selectedAfterSkipping: considered[0],
              consideredOrder: considered,
              denied: this.#routingRestriction(request, subtask.taskId),
            },
            this.#clock.now(),
          );
        }
        // The route is only real if something can serve it. Recording a
        // provider in evidence that has no adapter behind it is exactly the
        // claim this check exists to prevent.
        if (this.#options.providerAdapters !== undefined && !this.#options.providerAdapters.has(routing.providerId)) {
          const message =
            `Provider "${routing.providerId}" was routed for subtask "${subtask.taskId}" but no provider adapter is ` +
            `registered for it, so the work was not executed. Registered adapters: ${this.#options.providerAdapters.ids().join(", ") || "none"}.`;
          this.#record(context, "subtask_failed", { agentId: key, subtaskId: subtask.taskId, reason: message }, this.#clock.now());
          return { ok: false, error: { errorClass: "configuration_error", message } };
        }
        routedProvider = routing.providerId;
        routedModel = routing.modelId;
        this.#record(
          context,
          "model_routed",
          {
            agentId: key,
            subtaskId: subtask.taskId,
            provider: routedProvider,
            model: routedModel,
            reason: routing.reason,
            // PHASE 06: whether a route had a fallback behind it. A caller that
            // must survive a provider outage needs to know this BEFORE the
            // outage, not while it is happening.
            ...(this.#fallbackAvailability(subtask, request, routedProvider, routedModel)),
          },
          this.#clock.now(),
        );
        provider ??= routedProvider;
        model ??= routedModel;
      } else {
        this.#record(
          context,
          "model_routed",
          {
            agentId: key,
            subtaskId: subtask.taskId,
            provider: null,
            model: null,
            reason: "Agent is self-hosted and declares requiresModelRoute: false; no provider route was requested",
          },
          this.#clock.now(),
        );
      }

      const adapter = this.#options.adapters.get(agent.adapter);
      if (adapter === null) {
        const message = `Adapter "${agent.adapter}" is not registered`;
        this.#record(context, "subtask_failed", { agentId: key, subtaskId: subtask.taskId, reason: message }, this.#clock.now());
        return { ok: false, error: { errorClass: "configuration_error", message } };
      }

      // PHASE 09: the capability boundary, immediately before the worker.
      //
      // This is the last point at which an unauthorized call can be stopped
      // WITHOUT having invoked a provider, so it is the one that actually matters
      // for a deployment that cares about spend and egress, not merely about the
      // verdict. A refusal here means the adapter was never called.
      const subtaskRefusal = this.#authorizeSubtask(context, request, agent, subtask);
      if (subtaskRefusal !== null) {
        this.#record(context, "subtask_failed", { agentId: key, subtaskId: subtask.taskId, reason: subtaskRefusal.message }, this.#clock.now());
        return { ok: false, error: { errorClass: subtaskRefusal.errorClass, message: subtaskRefusal.message } };
      }

      const startedAt = this.#clock.nowMs();
      const collector = new EvidenceCollector({
        taskId: subtask.taskId,
        traceId: context.traceId,
        parentTaskId: request.taskId,
        startedAt,
        // Provenance. A retried subtask produces one record per attempt, and
        // without these two numbers the attempts of one subtask are
        // indistinguishable and cannot be ordered.
        attempt: runContext.attempt,
        sequence: (sequence += 1),
      });
      collector.agent(agent.agentId, agent.version);
      collector.route(routedProvider, routedModel);

      // PHASE 11: the crossing itself, recorded at the boundary.
      //
      // Placed AFTER the capability check on purpose. That check is the last point at which a
      // call can be stopped without having invoked a provider, so everything above this line is
      // a decision and this line is the action. `attempt` is included because a retried subtask
      // calls the adapter a second time and spends money a second time, and two invocations of
      // one subtask are otherwise indistinguishable in the record.
      this.#record(
        context,
        "adapter_invoked",
        { agentId: key, adapter: agent.adapter, attempt: runContext.attempt },
        this.#clock.now(),
      );

      const execution = await adapter.execute(agent.agentId, {
        taskId: subtask.taskId,
        objective: subtask.objective,
        input: subtask.input,
        requiredCapabilities: [...subtask.requiredCapabilities],
        timeoutMs: subtask.limits.timeoutMs,
        signal: runContext.signal,
        // PHASE 05: the recalled memory is what makes recall worth doing. Without
        // this the store was queried, the result reported, and then dropped on the
        // floor - memory that reached the orchestrator but never the worker.
        //
        // The key is added ONLY when there is something recalled, so a deployment
        // with no memory service produces a request byte-identical to PHASE 04.1's.
        ...(recalled.length === 0
          ? {}
          : {
              context: {
                // Summaries, never values: an agent handed whole memory values
                // would be holding material no one authorised it to see, and would
                // be able to carry it onward into its own output.
                recalled: recalled.map((item) => ({
                  id: item.id,
                  scope: item.scope,
                  summary: item.summary,
                  confidence: item.confidence.level,
                })),
              },
            }),
      });

      if (!execution.ok) {
        collector.fail(execution.error.errorClass);
        const evidence = collector.complete(this.#clock.nowMs());
        records.push(evidence);
        this.#recordResources(subtask.taskId, agent.agentId, evidence, routedProvider, routedModel);
        this.#record(
          context,
          "subtask_failed",
          { agentId: key, subtaskId: subtask.taskId, errorClass: execution.error.errorClass, reason: execution.error.message },
          this.#clock.now(),
        );
        return { ok: false, error: { errorClass: execution.error.errorClass, message: execution.error.message } };
      }

      // PHASE 08: reconcile what this orchestrator ROUTED with what the adapter REPORTED.
      //
      // `AgentExecutionResult` has always carried `providerId`/`modelId`, documented as
      // "Provider/model the adapter actually used, when it can report them", and nothing in
      // `src/` ever read them. On the routed path that is survivable - the orchestrator
      // knows the route and records it. On the SELF-HOSTED path (`requiresModelRoute:
      // false`) it is not: the orchestrator routed nothing, recorded `provider: null`, and
      // then discarded the only account of where the work actually went. An agent that
      // reached a provider anyway was recorded as having used no provider.
      //
      // This is a CLAIM, not a fact, and it is labelled as one: the event kind is
      // `agent_reported_route`, never `model_routed`, because `model_routed` means the
      // orchestrator chose it. There is nothing here to verify the claim against when TOZ
      // picked nothing, so the honest record is the claim plus its provenance.
      this.#recordReportedRoute(context, key, subtask, agent, routedProvider, routedModel, execution.value);

      collector.output(execution.value.output);
      if (execution.value.inputTokens !== undefined || execution.value.outputTokens !== undefined) {
        collector.cost({
          inputTokens: execution.value.inputTokens ?? null,
          outputTokens: execution.value.outputTokens ?? null,
          durationMs: execution.value.durationMs ?? null,
        });
      }
      // PHASE 05. An adapter's toolCalls are a CLAIM, and this used to be recorded as
      // fact with `sideEffecting: false` written in as a literal. The claim now goes
      // to the one tool authority, which checks the agent declared the tool, that
      // policy permits it, that the trust floor is met, and - for anything with side
      // effects - that an approval exists. A refusal fails the subtask: an
      // unverified tool claim is not a warning, it is a run that says it did something
      // the system cannot account for.
      const toolOutcome = this.#verifyReportedTools(subtask, agent, context, execution.value.toolCalls ?? []);
      if (!toolOutcome.ok) {
        collector.fail("configuration_error");
        const evidence = collector.complete(this.#clock.nowMs());
        records.push(evidence);
        this.#recordResources(subtask.taskId, agent.agentId, evidence, routedProvider, routedModel);
        this.#record(
          context,
          "subtask_failed",
          { agentId: key, subtaskId: subtask.taskId, errorClass: "configuration_error", reason: toolOutcome.reason },
          this.#clock.now(),
        );
        return { ok: false, error: { errorClass: "configuration_error", message: toolOutcome.reason } };
      }
      for (const toolCall of toolOutcome.verified) {
        collector.toolCall(toolCall);
      }
      for (const source of execution.value.sources ?? []) {
        collector.source({ reference: source, excerpt: "", retrievedAt: this.#clock.nowMs() });
      }

      // Output is screened per subtask, before it can be combined into the
      // task's answer. Screening only the final string would let one agent's
      // output reach the answer through another's subtask.
      const screened = await screenOutput(
        this.#options.outputPolicy,
        this.#options.security,
        { taskId: subtask.taskId, output: execution.value.output },
        this.#clock.nowMs(),
      );
      if (!screened.ok) {
        collector.fail("invalid_request");
        const evidence = collector.complete(this.#clock.nowMs());
        records.push(evidence);
        this.#recordResources(subtask.taskId, agent.agentId, evidence, routedProvider, routedModel);
        const message = `Output policy refused subtask "${subtask.taskId}": ${screened.error.reason}`;
        this.#record(context, "subtask_failed", { agentId: key, subtaskId: subtask.taskId, errorClass: "invalid_request", reason: message }, this.#clock.now());
        return { ok: false, error: { errorClass: "invalid_request", message } };
      }

      const evidence = collector.complete(this.#clock.nowMs());
      records.push(evidence);
      this.#recordResources(subtask.taskId, agent.agentId, evidence, routedProvider, routedModel);
      this.#record(context, "subtask_completed", { agentId: key, subtaskId: subtask.taskId }, this.#clock.now());
      if (subtask.taskId === plan.terminalTaskId) {
        terminalAgentId = agent.agentId;
      }
      return { ok: true, value: evidence.output };
    };

    const settings = this.#options.team;
    const runtime = new TeamRuntime({
      executor,
      ...(settings?.maxConcurrency === undefined ? {} : { maxConcurrency: settings.maxConcurrency }),
      ...(settings?.subtaskTimeoutMs === undefined ? {} : { subtaskTimeoutMs: settings.subtaskTimeoutMs }),
    });

    const result = await runtime.run(team, plan, { traceId: context.traceId, signal: request.signal });
    if (!result.ok) {
      // The runtime refusing to schedule is a malformed plan or a defect, not
      // a work failure, so it surfaces as an error rather than a failed task.
      throw new OrchestratorError("unknown", result.error.message);
    }

    for (const outcome of result.value.outcomes) {
      if (outcome.status === "skipped") {
        this.#record(
          context,
          "subtask_failed",
          { agentId: null, subtaskId: outcome.taskId, reason: "Skipped because a dependency did not complete" },
          this.#clock.now(),
        );
      }
    }

    return {
      teamResult: result.value,
      records,
      agents,
      selection,
      provider,
      model,
      terminalAgentId,
      recalled: recalled.map((item) => ({
        id: item.id,
        scope: item.scope,
        summary: item.summary,
        confidence: item.confidence.level,
      })),
    };
  }

  #recordResources(
    subtaskId: string,
    agentId: string,
    evidence: Evidence,
    provider: string | null,
    model: string | null,
  ): void {
    this.#options.resources.record({
      taskId: subtaskId,
      agentId,
      provider,
      model,
      inputTokens: evidence.cost.inputTokens,
      outputTokens: evidence.cost.outputTokens,
      durationMs: evidence.cost.durationMs,
      toolCallCount: evidence.toolCalls.length,
      retryCount: this.#options.resources.retriesFor(subtaskId),
      agentCount: 1,
      amount: evidence.cost.amount,
      currency: evidence.cost.currency,
    });
    // PHASE 11: `provider_usage_recorded`, declared since PHASE 04 and never emitted. The
    // `ResourceTracker` counted the usage in memory and the audit trail never saw it, so "what
    // did this run cost" was answerable only by a caller that happened to hold the tracker.
    // Two views of one number is the same disagreement D-64 removed from route accounting.
    this.#record(
      { traceId: evidence.traceId, taskId: subtaskId, parentTaskId: evidence.parentTaskId, teamId: null },
      "provider_usage_recorded",
      {
        agentId,
        provider,
        model,
        inputTokens: evidence.cost.inputTokens,
        outputTokens: evidence.cost.outputTokens,
        amount: evidence.cost.amount,
        currency: evidence.cost.currency,
        durationMs: evidence.cost.durationMs,
        toolCallCount: evidence.toolCalls.length,
        retryCount: this.#options.resources.retriesFor(subtaskId),
      },
      this.#clock.now(),
    );
  }

  /**
   * Merges per-subtask evidence, or returns null when a subtask never got far
   * enough to produce any.
   *
   * Null is correct for a plan that failed before any execution: an empty merge
   * would invent a record of work that did not happen.
   */
  #mergeOrNull(
    run: PlanRun,
    request: OrchestrationRequest,
    traceId: string,
    teamResult: TeamResult,
    finishedAt: number,
  ): Evidence | null {
    if (run.records.length === 0) {
      return null;
    }
    return mergeEvidence(run.records, {
      taskId: request.taskId,
      traceId,
      parentTaskId: request.taskId,
      output: teamResult.terminalOutput ?? "",
      finishedAt,
    });
  }
  /** A one-subtask plan, for a task that needs no decomposition. */
  #singleAgentPlan(request: OrchestrationRequest): ExecutionPlan {
    return {
      planId: `plan-${request.taskId}`,
      rootTaskId: request.taskId,
      objective: request.objective,
      topology: "single",
      subtasks: [
        {
          taskId: `${request.taskId}-1`,
          parentTaskId: request.taskId,
          objective: request.objective,
          requiredCapabilities: request.requiredCapabilities,
          input: request.input,
          expectedOutput: "A result for the stated objective",
          dependsOn: [],
          limits: { timeoutMs: 60_000, maxRetries: 1, maxChildren: 0 },
          verificationKinds: [],
        },
      ],
      limits: { timeoutMs: 60_000, maxRetries: 1, maxChildren: 0 },
      verificationKinds: [],
      terminalTaskId: `${request.taskId}-1`,
    };
  }

  /**
   * PHASE 09: the pre-execution authorization check.
   *
   * A delegation, and nothing more. The DECISION is computed by
   * `governance/enforcement.ts`; this method exists so the check appears inline on
   * the execution path, where a reader of `execute` can see it, and so the step
   * log records it. Settling the refusal - state, trace, feedback, result - stays
   * here, in the one failure path every other refusal already uses.
   *
   * Returns null when execution may proceed.
   */
  #authorizeExecution(
    context: ExecutionContext,
    request: OrchestrationRequest,
    steps: string[],
  ): { readonly errorClass: "authorization_error" | "approval_required"; readonly reason: string } | null {
    const gate = this.#options.governance;
    if (gate === undefined) {
      return null;
    }
    const authorization = authorizeExecution(gate, request);
    steps.push(describeExecutionDecision(request, authorization));
    if (authorization.refusal === null) {
      return null;
    }
    // Recorded here as well as through the one refusal path, so the decision is
    // attributable in the trace rather than only in the settled result's reason.
    this.#record(
      context,
      "subtask_failed",
      { agentId: null, reason: authorization.refusal.reason },
      this.#clock.now(),
    );
    return authorization.refusal;
  }

  /**
   * PHASE 09: the capability boundary, checked immediately before the worker.
   *
   * The last point at which an unauthorized call can be stopped WITHOUT having
   * invoked a provider, so it is the one that matters for a deployment that cares
   * about spend and egress and not merely about the verdict. A refusal here means
   * the adapter was never called.
   *
   * The decision itself is computed in `governance/enforcement.ts`; this method
   * only translates a refusal into the subtask result the runtime expects.
   */
  #authorizeSubtask(
    _context: ExecutionContext,
    request: OrchestrationRequest,
    agent: AgentRecord,
    subtask: SubTask,
  ): { readonly errorClass: "authorization_error" | "approval_required"; readonly message: string } | null {
    const gate = this.#options.governance;
    if (gate === undefined) {
      return null;
    }
    const refusal = authorizeSubtask(gate, request, agent, subtask);
    return refusal === null ? null : { errorClass: refusal.errorClass, message: refusal.reason };
  }

  /**
   * PHASE 09: governance's contribution to the routing candidate set.
   *
   * Delegated for the same reason as the two checks above, and additionally
   * because the "narrowing only" contract is much easier to verify against a
   * three-line function than against a private method on a large class.
   */
  #routingRestriction(request: OrchestrationRequest, taskId: string): RoutingRestriction | null {
    return routingRestriction(this.#options.governance, request, taskId);
  }

  #transition(taskId: string, to: OrchestrationTaskState, context?: OrchestrationRequest): void {
    // PHASE 06 (N-1): the key is workspace-scoped whenever the caller has a
    // request to scope it by. Two call sites below legitimately have no request in
    // scope and therefore address the unattributed partition, which is recorded
    // rather than guessed at.
    const key = context === undefined ? taskId : this.#stateKey(taskId, context);
    const from = this.#states.get(key) ?? "created";
    if (from === to) {
      return;
    }
    assertOrchestrationTransition(from, to);
    this.#states.set(key, to);
  }

  /**
   * PHASE 08: records what an adapter REPORTED it used, when that is not the route this
   * orchestrator chose.
   *
   * Three cases, and the third is why this is not simply "record the adapter's values":
   *
   *   - routed, and the adapter agrees        -> nothing said; TOZ already recorded the route
   *   - unrouted, and the adapter reports one -> the only account that exists
   *   - routed, and the adapter reports other -> a MISMATCH, which is the interesting one:
   *     the run was billed, egressed and audited as one route and executed as another
   *
   * Nothing here is verified. When TOZ chose the route it could compare, and does; when it
   * chose nothing there is nothing to compare against, so the value is recorded as a claim
   * under a kind that says so.
   */
  #recordReportedRoute(
    context: ExecutionContext,
    agentKey: string,
    subtask: { readonly taskId: string },
    agent: AgentRecord,
    routedProvider: string | null,
    routedModel: string | null,
    value: { readonly providerId?: string | null; readonly modelId?: string | null },
  ): void {
    const reportedProvider = value.providerId ?? null;
    const reportedModel = value.modelId ?? null;
    if (reportedProvider === null && reportedModel === null) {
      // Silent on the common case: an adapter that has nothing to say. Emitting an event
      // per subtask saying "nothing to report" would bury the events that matter.
      return;
    }
    const agrees = reportedProvider === routedProvider && reportedModel === routedModel;
    if (agrees) {
      return;
    }
    this.#record(
      context,
      "agent_reported_route",
      {
        agentId: agentKey,
        subtaskId: subtask.taskId,
        provider: reportedProvider,
        model: reportedModel,
        routedProvider,
        routedModel,
        selfHosted: !agent.requiresModelRoute,
        // Says WHICH of the two situations this is, so a reader does not have to infer it
        // from whether `routedProvider` happens to be null.
        reason: agent.requiresModelRoute
          ? "The adapter reported a provider or model other than the one it was routed to"
          : "The agent is self-hosted, so no route was requested; this is the adapter's own account of what it used",
      },
      this.#clock.now(),
    );
  }

  /**
   * PHASE 06: reports whether the chosen route had a fallback behind it.
   *
   * Narrow on purpose. The orchestrator depends on `ModelRoutingPort`, which
   * promises only `route()`, so a deployment supplying its own router is not
   * required to implement planning. When the capability is absent the fields are
   * omitted rather than reported as `false` - "no fallback" would be a claim
   * about a router the orchestrator cannot see inside, and an absent field is
   * honestly "unknown".
   */
  #fallbackAvailability(
    subtask: { readonly taskId: string; readonly requiredCapabilities: readonly Capability[] },
    request: OrchestrationRequest,
    routedProvider: string,
    routedModel: string | null,
  ): Readonly<Record<string, unknown>> {
    const router = this.#options.models;
    if (router.plan === undefined) {
      return {};
    }
    try {
      const chain = router.plan({
        taskId: subtask.taskId,
        capabilities: subtask.requiredCapabilities,
        minimumTrust: request.minimumTrust ?? this.#defaultMinimumTrust,
        // PHASE 01 (C-1): the same denial `route()` was given. Without this the
        // reported fallback chain would list providers governance has denied,
        // which is both a false claim about the route and a leak of which
        // candidates were suppressed.
        denied: this.#routingRestriction(request, subtask.taskId),
      });
      const alternatives = chain.hops
        .slice(1)
        .map((hop) => `${hop.candidate.provider.providerId}/${hop.candidate.model?.modelId ?? ""}`);
      return {
        fallbackAvailable: alternatives.length > 0,
        fallbackChain: [`${routedProvider}/${routedModel ?? ""}`, ...alternatives],
      };
    } catch {
      // A planning failure must never fail a route that has already been decided.
      // The route stands and the fallback stays unknown, which the absent field
      // already means.
      return {};
    }
  }

  #record(
    context: ExecutionContext,
    kind: Parameters<TraceRecorder["record"]>[0],
    detail: Readonly<Record<string, unknown>> & { readonly agentId?: string | null },
    at: Date,
  ): void {
    this.#options.traces.record(kind, context, detail, at);
  }

  #writeFeedback(
    request: OrchestrationRequest,
    traceId: string,
    topology: Topology,
    /** Agent keys that took part, as `agentId@version`. Empty when none did. */
    agents: readonly string[],
    provider: string | null,
    model: string | null,
    outcome: "succeeded" | "failed" | "cancelled" | "escalated",
    verification: VerificationResult | null,
    evidence: Evidence | null,
    errorClass: ErrorClass | null,
    retries: number,
    startedAt: number,
  ): void {
    this.#options.feedback.append(
      feedbackFromExecution({
        traceId,
        taskId: request.taskId,
        taskType: request.taskType,
        // The first participant stands in for "the agent" of a single-agent run;
        // a multi-agent run records every key in the trace and evidence, and
        // names the first here so the record is never silently blank.
        agentId: agents[0]?.split("@")[0] ?? null,
        agentVersion: agents[0]?.split("@")[1] ?? null,
        provider,
        model,
        topology,
        outcome,
        verificationVerdict: verification?.verdict ?? null,
        errorClass,
        latencyMs: evidence === null ? null : this.#clock.nowMs() - startedAt,
        inputTokens: evidence?.cost.inputTokens ?? null,
        outputTokens: evidence?.cost.outputTokens ?? null,
        retries,
        clock: this.#clock,
      }),
    );
  }

  /**
  /**
   * Recalls memory for this request, before execution.
   *
   * Returns the recalled items, or an empty list. A recall that fails is reported
   * in the steps and the trace, and the task proceeds: memory is context, not a
   * precondition, and a memory backend being down must not stop work that does not
   * depend on it.
   */
  async #recall(
    request: OrchestrationRequest,
    context: ExecutionContext,
    steps: string[],
  ): Promise<readonly MemoryItem[]> {
    const service = this.#options.memoryService;
    const scopes = this.#options.recallScopes ?? [];
    // PHASE 06: recall is scoped to the verified workspace, and skipped entirely
    // when there is none. A run with no verified workspace recalls nothing rather
    // than recalling a shared partition.
    const recallSubject = this.#memorySubject(request);
    if (service === undefined || scopes.length === 0 || request.skipMemory === true || recallSubject === null) {
      return [];
    }
    const subject: MemorySubject = recallSubject;
    const result = await service.recall(
      subject,
      {
        text: `${request.objective} ${request.input}`.slice(0, 2_000),
        scopes,
        limit: this.#options.recallLimit ?? 5,
        taskId: request.taskId,
      },
      context,
    );
    if (result.refusedScopes.length > 0) {
      steps.push(
        `6a recalled memory from ${result.searchedScopes.join(", ") || "no permitted scope"}; refused: ${result.refusedScopes.join(", ")}`,
      );
    } else {
      steps.push(
        `6a recalled ${result.retrieval.hitCount} item(s) of ${result.retrieval.examinedCount} examined from ${result.searchedScopes.join(", ")}` +
          (result.retrieval.unavailableReason === null ? "" : `; semantic search unavailable: ${result.retrieval.unavailableReason}`),
      );
    }
    // PHASE 11: `memory_retrieved`, declared since PHASE 04 and never emitted. Recorded AFTER
    // the result is known, and carrying the miss as well as the hit — a run that recalled
    // nothing is the more interesting event when someone asks why an agent behaved as it did.
    //
    // Summaries only, never values: the retrieved MEMORY VALUES must not enter the trace, which
    // is the whole reason Phase 07 writes them into memory with a scope the trace cannot see.
    this.#record(
      context,
      "memory_retrieved",
      {
        searchedScopes: [...result.searchedScopes],
        refusedScopes: [...result.refusedScopes],
        hitCount: result.retrieval.hitCount,
        examinedCount: result.retrieval.examinedCount,
        strategies: [...result.retrieval.strategies],
        unavailableReason: result.retrieval.unavailableReason,
        summaries: result.retrieval.items.map((item) => item.summary),
      },
      this.#clock.now(),
    );
    return result.retrieval.items;
  }

  /**
   * Captures the outcome as a memory candidate, after verification.
   *
   * Two invariants:
   *
   *   - a candidate is offered ONLY for a completed run. A task that failed is
   *     not remembered as a fact; at most it becomes a lesson, and the write
   *     policy decides which.
   *   - the capture result is reported in the steps whether it succeeded or was
   *     refused, so "we decided not to remember that" is visible rather than
   *     silent.
   */
  // Not `async`: it awaits nothing. It reads the memory service, which is
  // synchronous by contract, so an `await` here would imply a network call that
  // does not happen. Kept symmetric in shape with `#recall` so the two memory
  // points in the policy read alike.
  #capture(
    request: OrchestrationRequest,
    context: ExecutionContext,
    steps: string[],
    outcome: {
      readonly succeeded: boolean;
      readonly escalated: boolean;
      readonly verificationVerdict: "pass" | "fail" | "needs_review" | null;
      readonly errorClass: ErrorClass | null;
      readonly agents: readonly string[];
      readonly provider: string | null;
      readonly model: string | null;
      readonly output: string;
    },
  ): void {
    const service = this.#options.memoryService;
    if (service === undefined) {
      return;
    }
    service.learnFromOutcome(
      {
        taskId: request.taskId,
        traceId: context.traceId,
        agents: outcome.agents,
        succeeded: outcome.succeeded,
        verificationVerdict: outcome.verificationVerdict,
        errorClass: outcome.errorClass,
        escalated: outcome.escalated,
      },
      context,
    );

    if (outcome.succeeded && outcome.verificationVerdict === "pass") {
      // PHASE 06: capture attributes to the verified subject, not to a literal
      // `"system"`. `"system"` was never a subject in this process - it was a
      // string that happened to be readable, and `subjectSource` in the memory
      // service classified it as system-level provenance.
      const captureSubject = this.#memorySubject(request);
      if (captureSubject === null) {
        return;
      }
      const result = service.capture(
        {
          scope: this.#options.memoryScope ?? "task",
          key: `${request.taskId}:outcome`,
          // The verified outcome is a decision-like record: it is what later runs
          // most want to be reminded of, and the most expensive to get wrong.
          type: "episodic",
          value: {
            objective: request.objective,
            taskType: request.taskType,
            output: outcome.output.slice(0, 4_000),
            agents: outcome.agents,
            provider: outcome.provider,
            model: outcome.model,
          },
          summary: `Verified outcome of "${request.objective.slice(0, 120)}"`,
          subject: captureSubject,
          taskId: request.taskId,
          traceId: context.traceId,
          verification: outcome.verificationVerdict,
          outcome: "succeeded",
          errorClass: null,
          sourceReference: context.traceId,
        },
        context,
      );
      steps.push(
        result.item === null
          ? `13 offered a verified outcome to memory, which was refused: ${result.evaluation.reason}`
          : `13 remembered the verified outcome under ${result.item.scope}/${result.item.key}`,
      );
      // PHASE 11: `memory_captured`, declared since PHASE 04 and never emitted. The REFUSAL is
      // the half worth recording — a run whose verified outcome could not be remembered is a
      // fact an operator needs and which existed only in a `steps` string on the result.
      this.#record(
        context,
        "memory_captured",
        {
          scope: this.#options.memoryScope ?? "task",
          key: `${request.taskId}:outcome`,
          stored: result.item !== null,
          reason: result.item === null ? result.evaluation.reason : null,
          verification: outcome.verificationVerdict,
        },
        this.#clock.now(),
      );
    }
  }

  /**
   * Writes one memory record, through the policy when one is configured.
   *
   * The policy is `OrchestratorOptions.memoryPolicy`, NOT the provider. The
   * previous version passed the provider as the policy argument, which typechecked
   * only because both were structurally loose, and would have made every scoped
   * write consult a non-existent grant.
   *
   * Returns a Result rather than throwing. A refused write is an expected
   * condition, not a defect: the work is already done and verified, so it is
   * reported in the result's steps and the trace, and the task still completes.
   * Throwing here would break `execute`'s contract that expected failures come
   * back as values.
   */
  async #writeMemory(
    scope: MemoryScope,
    subject: MemorySubject,
    key: string,
    value: unknown,
  ): Promise<Result<true, Error>> {
    const provider = this.#options.memory as {
      writeScoped?: (
        policy: MemoryAccessPolicy,
        s: MemorySubject,
        entry: { scope: MemoryScope; key: string; value: unknown; writtenAt: number; writtenBy: string },
      ) => Promise<void>;
      write?: (
        w: MemorySubject["workspace"],
        entry: { scope: MemoryScope; key: string; value: unknown; writtenAt: number; writtenBy: string },
      ) => Promise<void>;
    };
    const entry = { scope, key, value, writtenAt: this.#clock.nowMs(), writtenBy: subject.id };
    try {
      if (this.#options.memoryPolicy && typeof provider.writeScoped === "function") {
        await provider.writeScoped(this.#options.memoryPolicy, subject, entry);
        return ok(true);
      }
      if (typeof provider.write === "function") {
        // No policy configured, so this write is unchecked. Named here because an
        // unlogged policy bypass is exactly the kind of thing that gets forgotten.
        // PHASE 06: the workspace is still REQUIRED on the raw write, so an
        // unchecked write is still a partition, not a shared bucket.
        await provider.write(subject.workspace, entry);
        return ok(true);
      }
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
    return err(new Error("The configured memory provider exposes no write method"));
  }

  /**
   * Records a refusal and returns a failed result.
   *
   * Declared without `async` because it performs no awaiting work: it only
   * settles local state, trace, and feedback. Keeping it non-async makes that
   * fact visible, and it is still awaited by callers uniformly with the other
   * settle paths.
   */
  #refuse(
    context: ExecutionContext,
    request: OrchestrationRequest,
    traceId: string,
    errorClass: ErrorClass,
    reason: string,
    steps: readonly string[],
    startedAt: number,
  ): Promise<Result<OrchestrationResult, OrchestratorError>> {
    // Set directly rather than through `#transition`: a refusal may happen from
    // any state, and forcing a legal edge from each one would be theatre.
    this.#states.set(this.#stateKey(request.taskId, request), "failed");
    this.#record(context, "subtask_failed", { agentId: null, reason }, this.#clock.now());
    this.#writeFeedback(request, traceId, "single", [], null, null, "failed", null, null, errorClass, 0, startedAt);
    const result: Result<OrchestrationResult, OrchestratorError> = ok({
      taskId: request.taskId,
      traceId,
      state: "failed",
      output: "",
      evidence: null,
      verification: null,
      selection: null,
      topology: null,
      team: null,
      agents: [],
      agentId: null,
      provider: null,
      model: null,
      outcome: "failed",
      errorClass,
      // A refusal reached no plan run, so it consumed no memory and reports none.
      recalled: [],
      steps,
      reason,
    });
    return Promise.resolve(result);
  }
}
