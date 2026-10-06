import { type Clock, systemClock } from "../core/clock.js";
import type { ErrorClass } from "../core/errors.js";
import type { MatchVerdict } from "../capabilities/match.js";
import type { TaskState } from "../queue/taskState.js";
import { redact } from "./redaction.js";

/**
 * Audit / event model.
 *
 * Structured events, one discriminated kind per lifecycle moment, so that a
 * future owner console can reconstruct what happened and why without parsing
 * free text.
 *
 * Every payload passes through `redact` before it is stored. A `SecretRef`
 * describes a reference and is therefore safe to record, but no field of this
 * module accepts a resolved secret value.
 */

export const AUDIT_EVENT_KINDS = [
  "task_enqueued",
  "task_transition",
  "route_selected",
  "route_rejected",
  "provider_call_started",
  "provider_call_finished",
  "retry_scheduled",
  "fallback_selected",
  "provider_health_changed",
  "provider_lifecycle_transition",
  "config_reloaded",
  "orchestration_event",
] as const;

export type AuditEventKind = (typeof AUDIT_EVENT_KINDS)[number];

interface AuditEventBase {
  readonly kind: AuditEventKind;
  /** Stable, non-secret identifier for correlation. */
  readonly correlationId: string | null;
  readonly at: Date;
  readonly durationMs: number | null;
  /**
   * PHASE 06. Which workspace this event belongs to, and which brand within it.
   *
   * STAMPED BY THE SINK, never by the producer - see `AuditLog.append`. It is on
   * every event so an exported or serialised event is self-describing, and so that
   * aggregating logs from two runtimes does not produce unattributable records.
   *
   * `null` means this log was composed without a workspace, and such an event is
   * invisible to every partitioned reader.
   */
  readonly workspace: string | null;
  readonly brand: string | null;
}

export interface TaskEnqueuedEvent extends AuditEventBase {
  readonly kind: "task_enqueued";
  readonly taskId: string;
  readonly workload: string;
}

export interface TaskTransitionEvent extends AuditEventBase {
  readonly kind: "task_transition";
  readonly taskId: string;
  readonly from: TaskState | null;
  readonly to: TaskState;
  readonly attempt: number;
  readonly errorClass: ErrorClass | null;
}

export interface RouteSelectedEvent extends AuditEventBase {
  readonly kind: "route_selected";
  readonly taskId: string | null;
  readonly providerId: string;
  readonly modelId: string;
  readonly workload: string;
  /** Why this candidate won. Human-readable, non-secret. */
  readonly selectionReason: string;
  readonly consideredCandidates: number;
}

export interface RouteRejectedEvent extends AuditEventBase {
  readonly kind: "route_rejected";
  readonly taskId: string | null;
  readonly providerId: string;
  readonly modelId: string;
  readonly workload: string;
  readonly verdict: MatchVerdict | "disabled" | "unapproved" | "capacity" | "not_eligible";
  readonly reason: string;
}

export interface ProviderCallStartedEvent extends AuditEventBase {
  readonly kind: "provider_call_started";
  readonly taskId: string | null;
  readonly providerId: string;
  readonly modelId: string;
  readonly attempt: number;
}

export interface ProviderCallFinishedEvent extends AuditEventBase {
  readonly kind: "provider_call_finished";
  readonly taskId: string | null;
  readonly providerId: string;
  readonly modelId: string;
  readonly success: boolean;
  readonly errorClass: ErrorClass | null;
}

export interface RetryScheduledEvent extends AuditEventBase {
  readonly kind: "retry_scheduled";
  readonly taskId: string | null;
  readonly providerId: string | null;
  readonly errorClass: ErrorClass;
  readonly attempt: number;
  readonly nextAttempt: number;
  readonly delayMs: number;
}

export interface FallbackSelectedEvent extends AuditEventBase {
  readonly kind: "fallback_selected";
  readonly taskId: string | null;
  readonly fromProviderId: string | null;
  readonly toProviderId: string;
  readonly toModelId: string;
  /**
   * Why the fallback happened: an `ErrorClass` name, or a short non-secret
   * explanation. Typed as `string` because `ErrorClass` is itself a string
   * subtype; the vocabulary is documented rather than enforced here, since an
   * audit record must also be able to carry a human explanation.
   */
  readonly reason: string;
}

export interface ProviderHealthChangedEvent extends AuditEventBase {
  readonly kind: "provider_health_changed";
  readonly targetId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly consecutiveFailures: number;
}

export interface ProviderLifecycleTransitionEvent extends AuditEventBase {
  readonly kind: "provider_lifecycle_transition";
  readonly providerId: string;
  readonly fromState: string;
  readonly toState: string;
}

export interface ConfigReloadedEvent extends AuditEventBase {
  readonly kind: "config_reloaded";
  readonly environment: string;
  /** Field names changed. Values are never recorded. */
  readonly changedFields: readonly string[];
}

/**
 * An orchestration milestone.
 *
 * Added by PHASE 04 so agent selection, topology choice, evidence, verification
 * and escalation appear in the SAME stream as provider and queue events. A
 * separate sink would mean two histories and no way to answer "which agent
 * produced this provider call?".
 *
 * `step` carries the specific milestone (selection, topology, subtask start,
 * verification, ...). It is a `string` rather than a closed union on purpose:
 * the orchestration vocabulary is still growing, and an audit record must be
 * able to store a step this build does not know about instead of dropping it.
 */
export interface OrchestrationEventAuditEvent extends AuditEventBase {
  readonly kind: "orchestration_event";
  readonly taskId: string;
  readonly parentTaskId: string | null;
  readonly teamId: string | null;
  readonly step: string;
  readonly agentId: string | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly errorClass: ErrorClass | null;
  /** Non-secret, redacted detail. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type AuditEvent =
  | TaskEnqueuedEvent
  | TaskTransitionEvent
  | RouteSelectedEvent
  | RouteRejectedEvent
  | ProviderCallStartedEvent
  | ProviderCallFinishedEvent
  | RetryScheduledEvent
  | FallbackSelectedEvent
  | ProviderHealthChangedEvent
  | ProviderLifecycleTransitionEvent
  | ConfigReloadedEvent
  | OrchestrationEventAuditEvent;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The concrete event shape for a given kind. */
export type AuditEventOf<K extends AuditEventKind> = Extract<AuditEvent, { kind: K }>;

/** Append input for a given kind: the event minus the audit-assigned fields. */
export type AuditEventInputOf<K extends AuditEventKind> = DistributiveOmit<
  AuditEventOf<K>,
  "at" | "durationMs" | "correlationId" | "workspace" | "brand"
> & {
  /**
   * Declared explicitly (rather than inherited from the distributive omit) so
   * TypeScript can infer `K` from the call site instead of falling back to the
   * full union of kinds.
   */
  readonly kind: K;
  readonly at?: Date;
  readonly durationMs?: number | null;
  readonly correlationId?: string | null;
  /**
   * PHASE 06. NOT an input. The workspace is stamped by the sink, because a
   * producer-supplied tenancy field is a field twenty call sites can each forget,
   * and a forgotten field is the class of defect this phase exists to remove. The
   * omission is the enforcement: a producer cannot even express a claim about which
   * workspace an event belongs to.
   */
};

/**
 * PHASE 06. The scope an audit read is confined to.
 *
 * A structural shape rather than the orchestration layer's `WorkspaceRef`, because
 * `core` must not import `orchestration` - a constraint a test enforces. It holds
 * the same two values, and nothing depends on which type is used.
 *
 * `workspace: null` means "the unattributed history", and is what a runtime that
 * declared no workspace reads. It is NOT a wildcard: an unattributed reader sees
 * only unattributed events, and a partitioned reader sees only its own. There is
 * no value of this type that reads everything, and that is the point.
 */
export interface AuditReadScope {
  readonly workspace: string | null;
  readonly brand: string | null;
}

/**
 * A narrowing applied on top of a read scope.
 *
 * PHASE 11: `read` could filter by scope but not by kind, while `byKind` could filter by kind
 * but not by scope. Neither could answer the question an operator actually asks - "this
 * workspace's events of kind K" - so every consumer read everything and filtered client-side,
 * which is both wasteful and easy to get wrong.
 */
export interface AuditReadFilter {
  readonly kind?: AuditEvent["kind"];
  /** Only events at or after this instant. */
  readonly since?: Date;
}

/** True when two read scopes name the same history. */
export function sameAuditScope(scope: AuditReadScope, workspace: string | null, brand: string | null): boolean {
  return scope.workspace === workspace && scope.brand === brand;
}

export interface AuditSink {
  append<K extends AuditEventKind>(input: AuditEventInputOf<K>): void;
  /**
   * PHASE 06. The read is workspace-scoped, and the scope is REQUIRED.
   *
   * It used to take no arguments and return the entire buffer, which meant every
   * caller read every workspace's events - the one `src/` caller took `.length` of
   * the whole thing. There is now no unfiltered read on this interface at all,
   * which is the structural half of the guarantee: a cross-workspace read is not
   * something a caller can forget to scope, because the unscoped call does not
   * exist.
   */
  read(scope: AuditReadScope, filter?: AuditReadFilter): readonly AuditEvent[];
}

/**
 * Bounded in-memory audit log.
 *
 * Bounded on purpose: an unbounded event log is a memory leak. When the
 * buffer is full the OLDEST events are dropped and the drop count is tracked,
 * so truncation is visible rather than silent.
 */
export class AuditLog implements AuditSink {
  readonly #events: AuditEvent[] = [];
  readonly #maxEvents: number;
  readonly #clock: Clock;
  /**
   * PHASE 06. The workspace this log records for, or `null` when it was composed
   * without one.
   *
   * STAMPED BY THE SINK rather than supplied per event, and that is deliberate. A
   * per-event field would be a field every one of the ~20 append call sites has to
   * remember, and a forgotten field is exactly the defect this phase exists to
   * remove - C-1 was a denial list computed correctly and then not passed on. The
   * sink knows which workspace it serves; a producer does not get to say.
   *
   * An event this log could not attribute is invisible to every partitioned reader.
   */
  readonly #workspace: string | null;
  readonly #brand: string | null;
  #droppedCount = 0;

  public constructor(options: { maxEvents?: number; clock?: Clock; workspace?: string | null; brand?: string | null } = {}) {
    const maxEvents = options.maxEvents ?? 10_000;
    if (!Number.isInteger(maxEvents) || maxEvents <= 0) {
      throw new RangeError("AuditLog maxEvents must be a positive integer");
    }
    this.#maxEvents = maxEvents;
    this.#clock = options.clock ?? systemClock;
    this.#workspace = options.workspace ?? null;
    this.#brand = options.brand ?? null;
  }

  /** The workspace this log records for. `null` when composed without one. */
  public get workspace(): string | null {
    return this.#workspace;
  }

  public get size(): number {
    return this.#events.length;
  }

  public get droppedCount(): number {
    return this.#droppedCount;
  }

  public get capacity(): number {
    return this.#maxEvents;
  }

  /**
   * Records an event. The payload is redacted on the way in, so a caller
   * cannot accidentally persist a secret even by mistake.
   */
  public append<K extends AuditEventKind>(input: AuditEventInputOf<K>): AuditEventOf<K> {
    const { at, durationMs, correlationId, kind: _kind, ...rest } = input;
    const event = {
      kind: input.kind,
      ...(redact(rest) as Omit<AuditEventOf<K>, "at" | "durationMs" | "correlationId" | "kind">),
      at: at ?? this.#clock.now(),
      durationMs: durationMs ?? null,
      correlationId: correlationId ?? null,
      // PHASE 06. Stamped by the log, so an exported event says which workspace it
      // came from without the producer having had an opinion. Set LAST and after
      // redaction, so a producer cannot supply its own and neither can a key whose
      // name happens to look like a tenancy field.
      workspace: this.#workspace,
      brand: this.#brand,
    } as AuditEventOf<K>;

    this.#events.push(event);
    while (this.#events.length > this.#maxEvents) {
      this.#events.shift();
      this.#droppedCount += 1;
    }
    return event;
  }

  /**
   * Reads ONLY the history of the scope named.
   *
   * There is deliberately no way to read everything. A caller that wants the whole
   * buffer has to say which workspace it is asking on behalf of, and a caller that
   * names the wrong one gets nothing rather than another customer's decisions.
   */
public read(scope: AuditReadScope, filter?: AuditReadFilter): readonly AuditEvent[] {
      return this.#events.filter(
        (event) =>
          event.workspace === scope.workspace &&
          event.brand === scope.brand &&
          // Both axes applied together, which is the point: scope alone could not narrow by
          // kind, and kind alone (`byKind`) crosses workspace boundaries entirely.
          (filter?.kind === undefined || event.kind === filter.kind) &&
          (filter?.since === undefined || event.at.getTime() >= filter.since.getTime()),
    );
  }

  /** Every event in the log, whatever workspace it is for. Diagnostics only. */
  public readAllForDiagnostics(): readonly AuditEvent[] {
    return [...this.#events];
  }

  public byKind<K extends AuditEvent["kind"]>(kind: K): readonly AuditEventOf<K>[] {
    return this.#events.filter(
      (event): event is AuditEventOf<K> => event.kind === kind,
    );
  }

  public byCorrelation(correlationId: string): readonly AuditEvent[] {
    return this.#events.filter((event) => event.correlationId === correlationId);
  }

  public clear(): void {
    this.#events.length = 0;
    this.#droppedCount = 0;
  }
}

/** A sink that records nothing. Used when auditing is disabled. */
export class NullAuditLog implements AuditSink {
  public append<K extends AuditEventKind>(_input: AuditEventInputOf<K>): void {
    // Intentionally empty.
  }

  public read(_scope: AuditReadScope): readonly AuditEvent[] {
    return [];
  }
}
