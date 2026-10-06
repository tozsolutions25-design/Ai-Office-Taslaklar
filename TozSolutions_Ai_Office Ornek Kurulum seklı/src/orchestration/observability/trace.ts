/**
 * Observability.
 *
 * Selection must be explainable and resource consumption attributable. That needs
 * structured records, not console strings: a console line cannot be joined to a
 * task, and it cannot be asserted on.
 *
 * The existing `AuditSink` is used as the sink, so orchestration events and
 * provider events share one stream. A second sink would mean two histories.
 */

import { type AuditEvent, type AuditEventKind, type AuditEventOf, type AuditEventInputOf, type AuditReadScope } from "../../audit/events.js";
import { NullAuditLog } from "../../audit/events.js";
import { type ErrorClass } from "../../core/errors.js";
import { redact } from "../../audit/redaction.js";

/**
 * PHASE 11: the recorder's default bound.
 *
 * Mirrors `AuditLog`'s, so the two histories in one process age the same way. The value is a
 * judgement and is stated rather than implied: a run's worth of events is retained, and
 * `droppedCount()` says what no longer fits.
 */
const DEFAULT_MAX_EVENTS = 10_000;


/**
 * PHASE 11: TWO KINDS REMOVED, because the path each would describe does not exist.
 *
 * `TODO.md` PHASE 11 asked the union to stop containing declared-but-never-emitted names, and
 * offered the rule this repository already had as D-53: remove or implement, never accumulate.
 * Of the ten unemittable kinds found, eight were emitted at real call sites and two described
 * nothing:
 *
 *   - `tool_failed`. `ToolExecutionHost.invoke` has ZERO callers in `src/`. An agent in this
 *     build cannot execute a tool - it can only REPORT having done so, and the report is
 *     verified after the fact by `#verifyReportedTools`. A refusal of a reported call is
 *     already recorded as `tool_refused`, which is emitted. There is no tool failure to
 *     report because there is no tool execution, and emitting it would mean inventing a
 *     producer. It returns with a real invoker - PHASE 13's external tool boundaries.
 *
 *   - `knowledge_ingested`. `IngestionService`, `StaticKnowledgeIngestor` and
 *     `UnreachableKnowledgeIngestor` exist and are tested, but the composition root constructs
 *     none of them - `TODO.md` PHASE 10 item 2 calls that boundary-only and it is correct. With
 *     no ingestor composed, nothing ingests knowledge, so this event could only be produced by
 *     a test. It returns with whatever actually ingests something.
 *
 * Neither removal weakens an enforcement path; both remove a name that promised an
 * observation nobody could make.
 */
/** The event kinds the orchestrator adds. Extends, never replaces. */
export const ORCHESTRATION_EVENT_KINDS = [
  "orchestration_started",
  "agent_selected",
  "agent_rejected",
  "agent_source_ingested",
  "topology_selected",
  "team_formed",
  "model_routed",
  /**
   * PHASE 08: what an adapter REPORTED it used, when the orchestrator routed nothing.
   *
   * A separate kind from `model_routed` on purpose. `model_routed` means the orchestrator
   * chose that provider and model; reusing it for a value an adapter supplied would make a
   * claim indistinguishable from an authority decision in the one place an auditor looks.
   *
   * Also emitted when a routed agent reports a DIFFERENT provider or model than the one it
   * was given - a mismatch worth having in the record rather than reconciling silently.
   */
  "agent_reported_route",
  /**
   * PHASE 11: the boundary crossing into an adapter.
   *
   * `TODO.md` PHASE 11 item 1 recorded that adapter calls are bracketed by `subtask_started`
   * and `subtask_completed` but leave no event of their own. Audited, that was accurate and
   * the consequence was concrete rather than cosmetic: NO event anywhere carried the adapter
   * registry key, so the record said "agent `researcher@1` ran" without saying through which
   * adapter.
   *
   * That is invisible in PHASE 01-12, where one adapter serves every agent, and becomes wrong
   * the moment PHASE 13 registers a second one - `openai_compatible` beside `anthropic`, or a
   * real adapter beside `unavailable`. Two runs of the same agent version through different
   * boundaries would be indistinguishable records. `agent_reported_route` does not cover it
   * either: an adapter that cannot report a route (`requiresModelRoute: false`) is precisely
   * the case with nothing else to show.
   *
   * A separate kind from `agent_selected` on purpose: that records the orchestrator's CHOICE,
   * emitted before the capability check and before any call, and reusing it here would make a
   * decision and an action share one name. Not `tool_invoked` either - that is a governed tool
   * call inside the host, a different boundary with its own authorization.
   *
   * Emitted ONLY when the call actually happens, never on the paths that refuse it: an
   * unregistered adapter and a refused capability are already `subtask_failed` with an
   * `errorClass`, and recording a crossing that did not occur would make the event a lie.
   */
  "adapter_invoked",
  /**
   * PHASE 09: a skill was loaded for a caller that already held what it requires.
   *
   * Declared AND emitted - the composition root wires the sink that writes it, and
   * `tests/skillContract.p09-evidence.test.ts` asserts both the declaration and the emitter,
   * because `TODO.md` PHASE 11 already records 15 orchestration kinds that are declared and
   * never emitted and calls that "a fabricated capability". Adding a sixteenth would make
   * this phase part of that problem rather than a correction of it.
   */
  "skill_loaded",
  /**
   * PHASE 09: a skill load was REFUSED, and this is the interesting one.
   *
   * Recorded on every refusal - a missing capability, an unreachable tool, or an unknown
   * skill. A log of successful loads is a log of what worked.
   */
  "skill_load_refused",
  "subtask_started",
  "subtask_retried",
  "subtask_completed",
  "subtask_failed",
  "subtask_skipped",
  "subtask_escalated",
  "tool_invoked",
  "tool_refused",
  "memory_read",
  "memory_written",
  "memory_write_refused",
  "evidence_recorded",
  "verification_completed",
  "memory_retrieved",
  "memory_captured",
  "learning_event_recorded",
  // PHASE 06: routing. `model_routed` already existed and records the route that
  // was chosen. The three below record what a route alone cannot explain - why no
  // route existed, that a fallback hop was actually spent, and what a provider
  // really reported rather than what we estimated.
  "model_route_refused",
  "model_route_fell_back",
  "provider_usage_recorded",
  // PHASE 11: REMOVED - the collision `TODO.md` item 3 described.
  //
  // `provider_health_changed` was declared in BOTH vocabularies with different payload
  // shapes, so a consumer switching on `kind` could not tell which it held. The audit found
  // the worse half: it was emitted by NEITHER, so it was a name that existed twice and an
  // observation nobody could make.
  //
  // Resolved in the direction that keeps the meaning. Provider health is a PROVIDER concern,
  // not an orchestration one, so the duplicate goes here and the AUDIT event is produced by
  // `InMemoryHealthMonitor` - the component that already computes the transition and is
  // already composed. Emitting it from the orchestrator would have meant a second place
  // deciding what "degraded" means.
  // PHASE 07: the durable job lifecycle. `task_completed` / `task_failed` above
  // are about an orchestrated in-run task; these are about a background JOB, whose
  // states, approvals, claims and budgets are separate concerns with a separate
  // authority. Adding to this list rather than creating a second logger is the
  // point: one history, so a job's whole life is readable in one place.
  "job_created",
  "job_state_changed",
  "job_cancelled",
  "job_completed",
  "job_stopped_on_budget",
  "task_retrying",
  "task_skipped",
  "task_started",
  "workflow_task_failed",
  "task_result_refused",
  "checkpoint_recorded",
  "approval_requested",
  "approval_decided",
  // PHASE 03: governance held a task and a gate is open, so the attempt ended in
  // neither success nor failure. Recorded separately from `approval_requested` -
  // which says a gate was opened, not that an execution reached the point of
  // needing one - so a held task is distinguishable from a task that was never
  // started.
  "task_waiting_for_approval",
  "duplicate_delivery_refused",
  "idempotency_conflict",
  "idempotent_replay",
  // PHASE 08: the governance decision itself. Recorded in the SAME history as
  // the work it governed, so an authorisation and its execution are readable
  // together rather than in two logs that can disagree.
  "governance_decided",
  "task_escalated",
  "task_completed",
  "task_cancelled",
  // PHASE 02: the composition root's own start. Recorded in the SAME history as
  // everything else, because the first question about any run is what the runtime
  // it ran on was configured to do - and a startup that left no record leaves that
  // question unanswerable after the process exits.
  "runtime_started",
] as const;

export type OrchestrationEventKind = (typeof ORCHESTRATION_EVENT_KINDS)[number];

/** Context every orchestration event carries. */
export interface ExecutionContext {
  readonly traceId: string;
  readonly taskId: string;
  readonly parentTaskId: string | null;
  readonly teamId: string | null;
}

interface OrchestrationBase {
  readonly kind: OrchestrationEventKind;
  readonly traceId: string;
  readonly taskId: string;
  readonly parentTaskId: string | null;
  /**
   * PHASE 11: the job this event belongs to, as a field rather than a metadata key.
   *
   * `FINAL_ARCHITECTURE.md` §11 recorded that joining job events to tasks "requires reaching
   * into metadata". Two producers wrote the job in two different places - the coordinator's
   * per-task context puts it in `parentTaskId`, its workflow-level emitter puts it in
   * `metadata.jobId` - so no single field could answer the question and `byTrace` on one side
   * could not reach the other.
   *
   * Derived at record time from either source rather than asking every call site to be
   * consistent, because the two conventions already exist in production code and asking two
   * authors to change their habits is a weaker guarantee than accepting both at the boundary.
   */
  readonly jobId: string | null;
  readonly teamId: string | null;
  readonly agentId: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly at: Date;
  readonly durationMs: number | null;
  readonly errorClass: ErrorClass | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type OrchestrationEvent = OrchestrationBase & Readonly<Record<string, unknown>>;

/**
 * Records orchestration events.
 *
 * Writes into an existing audit sink. Deliberately not an `AuditLog` of its own,
 * because two sinks would mean two histories and a question of which is
 * authoritative.
 */
export class TraceRecorder {
  readonly #sink: { append<K extends AuditEventKind>(input: AuditEventInputOf<K>): unknown; read(scope: AuditReadScope): readonly AuditEvent[] };
  readonly #events: OrchestrationEvent[] = [];
  // PHASE 11: see the constructor. Mirrors `AuditLog`'s `#maxEvents` / `#droppedCount`.
  readonly #maxEvents: number;
  #droppedCount = 0;

  public constructor(
    sink?: { append<K extends AuditEventKind>(input: AuditEventInputOf<K>): unknown; read(scope: AuditReadScope): readonly AuditEvent[] },
    options: { readonly maxEvents?: number } = {},
  ) {
    this.#sink = sink ?? new NullAuditLog();
    // PHASE 11. `AuditLog` has had a bound and a dropped count since PHASE 01; the recorder had
    // neither, so a long-lived process accumulated every event it was ever handed - with RAW
    // metadata, see `record` below - forever. Mirrored rather than invented, because the
    // sibling class in this same repository already does it correctly.
    this.#maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  }

  /** PHASE 11: how many events this recorder keeps. Finite by default - an unbounded buffer
   *  of unbounded strings is a denial of service against the process meant to observe. */
  public maxEvents(): number {
    return this.#maxEvents;
  }

  /** PHASE 11: how many events this recorder has DISCARDED. Reported rather than inferred, so
   *  a caller can tell "I saw them all" from "the buffer was full". */
  public droppedCount(): number {
    return this.#droppedCount;
  }

  public record(
    kind: OrchestrationEventKind,
    context: ExecutionContext,
    detail: Readonly<Record<string, unknown>> & {
      readonly agentId?: string | null;
      readonly provider?: string | null;
      readonly model?: string | null;
      readonly durationMs?: number | null;
      readonly errorClass?: ErrorClass | null;
    },
    at: Date,
  ): OrchestrationEvent {
const safeDetail = redact(detail) as Readonly<Record<string, unknown>>;
      // PHASE 11: the job, from whichever of the two places a producer put it. `detail` is
      // checked first because the coordinator's workflow emitter labels events with
      // `metadata.jobId` while its per-task context puts the job in `parentTaskId`; both are
      // real producers, so both are read rather than one being declared correct.
      const labelledJob = typeof safeDetail["jobId"] === "string" ? safeDetail["jobId"] : null;
      const event = {
        kind,
        traceId: context.traceId,
        taskId: context.taskId,
        parentTaskId: context.parentTaskId,
        jobId: labelledJob ?? context.parentTaskId,
      teamId: context.teamId,
      agentId: detail.agentId ?? null,
      provider: detail.provider ?? null,
      model: detail.model ?? null,
      at,
      durationMs: detail.durationMs ?? null,
      errorClass: detail.errorClass ?? null,
      // PHASE 11: REDACT ON THE WAY IN, and this is the whole point of the fix.
      //
      // This used to be `{ ...detail }` - raw. The SINK redacted its own copy inside
      // `AuditLog.append`, so the audit log held `[REDACTED]` while this recorder held the
      // secret, in the same process, for the same event - and every read path here
      // (`events`, `byTrace`, `byTask`, `byKind`) returned the raw one. The redaction was
      // real; it was applied to the copy nobody reads.
      //
      // The in-memory history is what an operator actually inspects, which made the component
      // whose entire job is that history the one place a secret survived. `redact` is the SAME
      // function `AuditLog.append` uses, so the two cannot form a second opinion about what a
      // secret is.
      metadata: { ...safeDetail },
    } as OrchestrationEvent;
    this.#events.push(event);
    // Oldest-first, matching `AuditLog`: an operator reconstructing a run needs the tail.
    while (this.#events.length > this.#maxEvents) {
      this.#events.shift();
      this.#droppedCount += 1;
    }
    // Mirrored into the shared audit sink under its OWN kind, so orchestration
    // events and provider events form one history rather than two. It was
    // previously written as `task_transition` to "running", which asserted a
    // state change that did not happen and collapsed every milestone into one
    // indistinguishable kind.
    this.#sink.append({
      kind: "orchestration_event",
      taskId: context.taskId,
      parentTaskId: context.parentTaskId,
      teamId: context.teamId,
      step: kind,
      agentId: detail.agentId ?? null,
      providerId: detail.provider ?? null,
      modelId: detail.model ?? null,
      errorClass: detail.errorClass ?? null,
      // The SAME redacted copy goes across, so the two views cannot disagree. Passing the raw
      // detail here and relying on the sink to redact is the defect being fixed.
      metadata: { ...safeDetail },
      at,
      durationMs: detail.durationMs ?? null,
      correlationId: context.traceId,
    });
    return event;
  }

  public events(): readonly OrchestrationEvent[] {
    return [...this.#events];
  }

  /** Events for one trace, which is how a run is reconstructed. */
  public byTrace(traceId: string): readonly OrchestrationEvent[] {
    return this.#events.filter((event) => event.traceId === traceId);
  }

  public byTask(taskId: string): readonly OrchestrationEvent[] {
    return this.#events.filter((event) => event.taskId === taskId);
  }

  /**
   * PHASE 11: events for one job.
   *
   * The coordinator's comment claimed this method existed - "`byTask(jobId)`'s sibling,
   * `byJob`, added below rather than by overloading this one again" - and it did not. A
   * comment describing an API that was never written is the same defect class this phase has
   * been correcting all along, so the method is added rather than the comment softened.
   *
   * It matches the first-class `jobId`, which is derived at record time from either
   * `metadata.jobId` (the workflow emitter) or `parentTaskId` (the per-task context). Added as
   * a sibling rather than by teaching `byTask` to match both fields, for the reason the original
   * comment gives: a lookup that silently matches two different identifiers is a lookup whose
   * result cannot be explained.
   */
  public byJob(jobId: string): readonly OrchestrationEvent[] {
    return this.#events.filter((event) => event.jobId === jobId);
  }

  public byKind(kind: OrchestrationEventKind): readonly OrchestrationEvent[] {
    return this.#events.filter((event) => event.kind === kind);
  }

  public get size(): number {
    return this.#events.length;
  }

  public clear(): void {
    this.#events.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Resource accounting                                                 */
/* ------------------------------------------------------------------ */

export interface ResourceUsage {
  readonly taskId: string;
  readonly agentId: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number | null;
  readonly toolCallCount: number;
  readonly retryCount: number;
  /** Agents used for this task. */
  readonly agentCount: number;
  /** Monetary amount, only when a provider reported one. */
  readonly amount: number | null;
  readonly currency: string | null;
}

/**
 * Attributes resource use to the thing that caused it.
 *
 * The requirement is that "where did the resources go?" is answerable, so every
 * figure carries the task, agent and provider it belongs to. Unmeasured figures
 * stay null rather than becoming zero, because "we did not measure it" and "it
 * was free" are different facts.
 */
export class ResourceTracker {
  readonly #usages: ResourceUsage[] = [];
  readonly #retryCounts = new Map<string, number>();

  public record(usage: ResourceUsage): void {
    this.#usages.push(usage);
  }

  public recordRetry(taskId: string): number {
    const next = (this.#retryCounts.get(taskId) ?? 0) + 1;
    this.#retryCounts.set(taskId, next);
    return next;
  }

  public retriesFor(taskId: string): number {
    return this.#retryCounts.get(taskId) ?? 0;
  }

  public usages(): readonly ResourceUsage[] {
    return [...this.#usages];
  }

  public forTask(taskId: string): readonly ResourceUsage[] {
    return this.#usages.filter((usage) => usage.taskId === taskId);
  }

  public byAgent(agentId: string): readonly ResourceUsage[] {
    return this.#usages.filter((usage) => usage.agentId === agentId);
  }

  public byProvider(providerId: string): readonly ResourceUsage[] {
    return this.#usages.filter((usage) => usage.provider === providerId);
  }

  /**
   * Totals across recorded usage.
   *
   * A null measurement is excluded from the total rather than counted as zero,
   * and `countedMeasurements` says how many figures were actually available, so
   * a total is never mistaken for a complete one.
   */
  public totals(): {
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    toolCalls: number;
    executions: number;
    countedInputTokens: number;
    countedOutputTokens: number;
    countedDurationMs: number;
  } {
    let input = 0;
    let output = 0;
    let duration = 0;
    let toolCalls = 0;
    let countedInput = 0;
    let countedOutput = 0;
    let countedDuration = 0;
    for (const usage of this.#usages) {
      if (usage.inputTokens !== null) {
        input += usage.inputTokens;
        countedInput += 1;
      }
      if (usage.outputTokens !== null) {
        output += usage.outputTokens;
        countedOutput += 1;
      }
      if (usage.durationMs !== null) {
        duration += usage.durationMs;
        countedDuration += 1;
      }
      toolCalls += usage.toolCallCount;
    }
    return {
      inputTokens: countedInput > 0 ? input : null,
      outputTokens: countedOutput > 0 ? output : null,
      durationMs: countedDuration > 0 ? duration : null,
      toolCalls,
      executions: this.#usages.length,
      countedInputTokens: countedInput,
      countedOutputTokens: countedOutput,
      countedDurationMs: countedDuration,
    };
  }

  public clear(): void {
    this.#usages.length = 0;
    this.#retryCounts.clear();
  }
}

/** Convenience alias so consumers need not import the audit types directly. */
export type { AuditEventOf };
