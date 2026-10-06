/**
 * The memory service.
 *
 * One surface for everything PHASE 05 added, so nothing above it has to know
 * that storage, policy, retrieval and learning are four separate concerns.
 *
 *   capture -> policy -> store -> (conflict) -> learning event
 *   recall  -> scope check -> retrieve -> explained results
 *   correct -> supersede -> history preserved
 *   observe -> one audit history, no parallel logger
 *
 * IT IS A SERVICE, NOT AN ORCHESTRATOR.
 *
 * It holds no reference to the orchestrator, the agent registry, the pool or the
 * router. It cannot start a task, schedule work, select an agent, or advance any
 * state. It answers questions about memory and records facts about outcomes. That
 * is the whole of its authority, and the tests assert the absence of the rest
 * rather than trusting a comment.
 *
 * THE AGENT PATH IS AGENT -> CAPABILITY -> SERVICE -> STORE, never
 * agent -> store. `recallForAgent` takes a `MemorySubject` and applies the same
 * `MemoryAccessPolicy` as every other read, so an agent that reaches for memory
 * goes through exactly the same authorisation as the orchestrator does. An agent
 * cannot widen its own access by asking a different method.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { type ErrorClass } from "../../core/errors.js";
import type { MemoryAccessPolicy} from "./memory.js";
import { type MemorySubject } from "./memory.js";
import { type MemoryStore, type StoreOutcome } from "./store.js";
import { type MemoryWritePolicy, type PolicyEvaluation } from "./policy.js";
import { type MemoryConfidence } from "./model.js";
import { type RetrievalEngine } from "./retrieval.js";
import { type LearningEventInput, type LearningEventStore } from "./learning.js";
import { type TraceRecorder, type ExecutionContext } from "../observability/trace.js";
import {
  type AnyMemoryScope,
  type LearningEventKind,
  type MemoryDraft,
  type MemoryItem,
  type MemoryQuery,
  type MemoryRetrievalResult,
  type MemoryType,
  emptyRetrieval,
} from "./model.js";

/** What a caller asked to remember, before the policy has ruled on it. */
export interface MemoryCandidate {
  readonly scope: AnyMemoryScope;
  readonly key: string;
  readonly type: MemoryType;
  readonly value: unknown;
  readonly summary: string;
  readonly subject: MemorySubject;
  /** Non-secret reference to the source material. */
  readonly sourceReference?: string | null;
  readonly taskId?: string | null;
  readonly traceId?: string | null;
  readonly verification?: "pass" | "fail" | "needs_review" | null;
  readonly outcome?: "succeeded" | "failed" | "cancelled" | "escalated" | null;
  readonly errorClass?: ErrorClass | null;
  readonly importance?: number;
  readonly sensitivity?: "public" | "internal" | "confidential" | "restricted";
  readonly expiresAt?: number | null;
  readonly tags?: readonly string[];
  readonly capabilities?: readonly string[];
}

export interface CaptureResult {
  /** What the policy decided. */
  readonly evaluation: PolicyEvaluation;
  /** What the store did, when the policy allowed a write. */
  readonly stored: StoreOutcome | null;
  /** The memory now in effect, when there is one. */
  readonly item: MemoryItem | null;
}

/** A recall, for one subject, with the subject's own scopes resolved. */
export interface RecallResult {
  readonly retrieval: MemoryRetrievalResult;
  /** Scopes actually searched, after the policy narrowed them. */
  readonly searchedScopes: readonly AnyMemoryScope[];
  /** Scopes the subject could have read but which the query did not name. */
  readonly refusedScopes: readonly AnyMemoryScope[];
}

export interface MemoryServiceOptions {
  readonly store: MemoryStore;
  readonly retrieval: RetrievalEngine;
  readonly policy: MemoryWritePolicy;
  readonly learning?: LearningEventStore;
  /** Authorisation. Omit only where every caller is trusted. */
  readonly access?: MemoryAccessPolicy;
  /** Audit. Omit to run without one; the event log stops, nothing else. */
  readonly traces?: TraceRecorder;
  readonly clock?: Clock;
  /** How many learning events a capture records. Off by default. */
  readonly recordLearning?: boolean;
}

export class MemoryService {
  readonly #store: MemoryStore;
  readonly #retrieval: RetrievalEngine;
  readonly #policy: MemoryWritePolicy;
  readonly #learning: LearningEventStore | undefined;
  readonly #access: MemoryAccessPolicy | undefined;
  readonly #traces: TraceRecorder | undefined;
  readonly #clock: Clock;
  readonly #recordLearning: boolean;
  #readCount = 0;
  #writeCount = 0;
  #refusedCount = 0;
  #invalidationCount = 0;

  public constructor(options: MemoryServiceOptions) {
    this.#store = options.store;
    this.#retrieval = options.retrieval;
    this.#policy = options.policy;
    this.#learning = options.learning;
    this.#access = options.access;
    this.#traces = options.traces;
    this.#clock = options.clock ?? systemClock;
    this.#recordLearning = options.recordLearning ?? false;
  }

  public get store(): MemoryStore {
    return this.#store;
  }

  /* ---------------------------------------------------------------- */
  /* Capture                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Offers a memory for storage.
   *
   * The order is fixed and each step can refuse: authorisation, then policy, then
   * the store. A candidate the subject may not write is refused before the policy
   * is consulted, because a policy decision about something that was never going
   * to be written is a decision about nothing.
   *
   * Never throws for a refusal. The caller gets a result that says no and says
   * why, because "we decided not to remember that" is an answer, not an error.
   */
  public capture(candidate: MemoryCandidate, context?: ExecutionContext): CaptureResult {
    const now = this.#clock.nowMs();
    const scopeCheck = this.#assertWrite(candidate.subject, candidate.scope);
    if (scopeCheck !== null) {
      this.#refusedCount += 1;
      this.#record(context, "memory_write_refused", {
        subject: candidate.subject.id,
        scope: candidate.scope,
        reason: scopeCheck.message,
      });
      return {
        evaluation: { decision: "refused", draft: null, rules: ["below_importance_floor"], reason: scopeCheck.message },
        stored: null,
        item: null,
      };
    }

    const draft: MemoryDraft = {
      scope: candidate.scope,
      key: candidate.key,
      type: candidate.type,
      value: candidate.value,
      summary: candidate.summary,
      provenance: {
        source: candidate.subject.id === "system" ? "system" : subjectSource(candidate.subject.id),
        sourceRef: candidate.subject.id,
        taskId: candidate.taskId ?? null,
        traceId: candidate.traceId ?? null,
        observedAt: now,
        verification: candidate.verification ?? null,
        outcome: candidate.outcome ?? null,
        errorClass: candidate.errorClass ?? null,
        sourceReference: candidate.sourceReference ?? null,
      },
      ...(candidate.importance === undefined ? {} : { importance: candidate.importance }),
      ...(candidate.sensitivity === undefined ? {} : { sensitivity: candidate.sensitivity }),
      ...(candidate.expiresAt === undefined ? {} : { expiresAt: candidate.expiresAt }),
      metadata: { tags: candidate.tags ?? [], capabilities: candidate.capabilities ?? [] },
    };

    const evaluation = this.#policy.evaluate(draft, now);
    if (evaluation.draft === null) {
      this.#refusedCount += 1;
      this.#record(context, "memory_write_refused", {
        subject: candidate.subject.id,
        scope: candidate.scope,
        reason: evaluation.reason,
        rules: evaluation.rules,
      });
      return { evaluation, stored: null, item: null };
    }

    const stored = this.#store.store(evaluation.draft);
    if (!stored.ok) {
      this.#refusedCount += 1;
      this.#record(context, "memory_write_refused", {
        subject: candidate.subject.id,
        scope: candidate.scope,
        reason: stored.error.message,
      });
      return {
        evaluation: { decision: "refused", draft: null, rules: evaluation.rules, reason: stored.error.message },
        stored: null,
        item: null,
      };
    }
    this.#writeCount += 1;
    this.#record(context, "memory_written", {
      subject: candidate.subject.id,
      scope: candidate.scope,
      key: candidate.key,
      kind: stored.value.kind,
      rules: evaluation.rules,
    });
    const item = "item" in stored.value ? stored.value.item : stored.value.conflict.incoming;
    if (stored.value.kind === "conflict") {
      // A conflict is a learning event as well as a memory event: the system
      // changed its mind about something, and that is worth recording.
      this.learn({
        kind: "output_corrected",
        subject: candidate.scope,
        taskId: candidate.taskId ?? null,
        detail: { key: candidate.key, reason: "conflicting memory superseded" },
      });
    }
    return { evaluation, stored: stored.value, item };
  }

  /* ---------------------------------------------------------------- */
  /* Recall                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Recalls for a subject.
   *
   * The query's scopes are INTERSECTED with what the subject may read, so a
   * caller cannot widen its own access by naming a scope it was not granted. The
   * refused scopes are reported rather than dropped silently: a caller that
   * expected project memory and did not get it should be able to see why.
   */
  public async recall(subject: MemorySubject, query: MemoryQuery, context?: ExecutionContext): Promise<RecallResult> {
    const searchable: AnyMemoryScope[] = [];
    const refused: AnyMemoryScope[] = [];
    for (const scope of query.scopes) {
      if (this.#canRead(subject, scope)) {
        searchable.push(scope);
      } else {
        refused.push(scope);
      }
    }
    this.#readCount += 1;
    if (searchable.length === 0) {
      const retrieval = emptyRetrieval(
        refused.length === 0
          ? "The query named no scopes"
          : `Subject "${subject.id}" may not read any of the ${refused.length} requested scope(s): ${refused.join(", ")}`,
        0,
      );
      this.#record(context, "memory_read", {
        subject: subject.id,
        refusedScopes: refused,
        hitCount: 0,
        examinedCount: 0,
        reason: retrieval.explanation.reason,
      });
      return { retrieval, searchedScopes: [], refusedScopes: refused };
    }

    const retrieval = await this.#retrieval.retrieve({ ...query, scopes: searchable });
    this.#record(context, "memory_read", {
      subject: subject.id,
      scopes: searchable,
      hitCount: retrieval.hitCount,
      examinedCount: retrieval.examinedCount,
      durationMs: retrieval.durationMs,
      reasons: retrieval.ranked.map((entry) => entry.explanation.reason),
    });
    return { retrieval, searchedScopes: searchable, refusedScopes: refused };
  }

  /**
   * The path an agent uses.
   *
   * Identical to `recall` and separate from it on purpose: an agent asking for
   * memory through the capability interface is making a different claim from the
   * orchestrator's own housekeeping read, and the distinction should be visible
   * in the audit rather than assumed.
   */
  public async recallForAgent(
    subject: MemorySubject,
    query: MemoryQuery,
    context?: ExecutionContext,
  ): Promise<RecallResult> {
    const result = await this.recall(subject, query, context);
    this.#record(context, "memory_read", {
      subject: subject.id,
      viaCapability: true,
      hitCount: result.retrieval.hitCount,
    });
    return result;
  }

  /** Builds the query an agent would use, with the subject's readable scopes. */
  public queryFor(
    subject: MemorySubject,
    options: { text: string; limit: number; scopes?: readonly AnyMemoryScope[]; taskId?: string | null },
  ): MemoryQuery {
    const requested = options.scopes ?? (this.#access === undefined ? [] : this.#access.readableScopes(subject));
    return {
      text: options.text,
      scopes: requested.filter((scope) => this.#canRead(subject, scope)),
      limit: options.limit,
      taskId: options.taskId ?? null,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Correction                                                       */
  /* ---------------------------------------------------------------- */

  /** Corrects a memory. The original is retained, marked superseded. */
  public correct(
    id: string,
    correction: Omit<MemoryDraft, "scope" | "key"> & {
      readonly subject: MemorySubject;
      /** Confidence for the replacement, when the corrector states one. */
      readonly confidence?: MemoryConfidence;
    },
    context?: ExecutionContext,
  ): { readonly ok: boolean; readonly item: MemoryItem | null; readonly reason: string | null } {
    const existing = this.#findById(id);
    if (existing === null) {
      return { ok: false, item: null, reason: `Unknown memory: ${id}` };
    }
    const denied = this.#assertWrite(correction.subject, existing.scope);
    if (denied !== null) {
      this.#refusedCount += 1;
      this.#record(context, "memory_write_refused", { subject: correction.subject.id, reason: denied.message });
      return { ok: false, item: null, reason: denied.message };
    }
    const outcome = this.#store.correct(id, {
      scope: existing.scope,
      key: existing.key,
      type: correction.type,
      value: correction.value,
      summary: correction.summary,
      provenance: {
        source: subjectSource(correction.subject.id),
        sourceRef: correction.subject.id,
        taskId: existing.provenance.taskId,
        traceId: existing.provenance.traceId,
        observedAt: this.#clock.nowMs(),
        verification: correction.provenance.verification ?? null,
        outcome: null,
        errorClass: null,
        sourceReference: correction.provenance.sourceReference ?? null,
      },
      ...(correction.confidence === undefined ? {} : { confidence: correction.confidence }),

      ...(correction.importance === undefined ? {} : { importance: correction.importance }),
      ...(correction.expiresAt === undefined ? {} : { expiresAt: correction.expiresAt }),
      ...(correction.metadata === undefined ? {} : { metadata: correction.metadata }),
    });
    if (!outcome.ok) {
      return { ok: false, item: null, reason: outcome.error.message };
    }
    this.#writeCount += 1;
    this.#record(context, "memory_written", {
      subject: correction.subject.id,
      key: existing.key,
      kind: "corrected",
      supersedes: existing.id,
    });
    this.learn({
      kind: "output_corrected",
      subject: existing.scope,
      taskId: existing.provenance.taskId,
      detail: { key: existing.key, corrected: true },
    });
    return { ok: true, item: outcome.value, reason: null };
  }

  /** Withdraws a memory. It stops being returned; it stays on the record. */
  public invalidate(
    id: string,
    reason: string,
    subject: MemorySubject,
    context?: ExecutionContext,
  ): { readonly ok: boolean; readonly reason: string | null } {
    const existing = this.#findById(id);
    if (existing === null) {
      return { ok: false, reason: `Unknown memory: ${id}` };
    }
    const denied = this.#assertWrite(subject, existing.scope);
    if (denied !== null) {
      return { ok: false, reason: denied.message };
    }
    const outcome = this.#store.invalidate(id, reason);
    if (!outcome.ok) {
      return { ok: false, reason: outcome.error.message };
    }
    this.#invalidationCount += 1;
    this.#record(context, "memory_write_refused", {
      subject: subject.id,
      key: existing.key,
      kind: "invalidated",
      reason,
    });
    this.learn({
      kind: "output_corrected",
      subject: existing.scope,
      taskId: existing.provenance.taskId,
      detail: { key: existing.key, invalidated: true, reason },
    });
    return { ok: true, reason: null };
  }

  /** Marks a memory stale without withdrawing it. */
  public markStale(id: string): { readonly ok: boolean; readonly reason: string | null } {
    const outcome = this.#store.markStale(id);
    return outcome.ok ? { ok: true, reason: null } : { ok: false, reason: outcome.error.message };
  }

  /* ---------------------------------------------------------------- */
  /* Learning                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Records a learning event, if a store was supplied.
   *
   * Recording is opt-in. A deployment that wants outcomes but no learning layer
   * omits the store, and nothing breaks: this returns null.
   */
  public learn(input: LearningEventInput, context?: ExecutionContext): boolean {
    if (!this.#recordLearning || this.#learning === undefined) {
      return false;
    }
    const event = this.#learning.record(input);
    this.#record(context, "learning_event_recorded", {
      kind: event.kind,
      subject: event.subject,
      appliedPolicy: event.appliedPolicy,
      sampleSize: event.sampleSize,
    });
    return true;
  }

  /**
   * Records the events a completed task implies.
   *
   * Derived from the outcome rather than guessed: a failed task is a
   * `task_failed`, a passed verification is a `verification_result`. Nothing here
   * acts on them; they exist to be read later.
   */
  public learnFromOutcome(
    outcome: {
      readonly taskId: string;
      readonly traceId: string;
      readonly agents: readonly string[];
      readonly succeeded: boolean;
      readonly verificationVerdict: "pass" | "fail" | "needs_review" | null;
      readonly errorClass: ErrorClass | null;
      readonly escalated: boolean;
    },
    context?: ExecutionContext,
  ): void {
    if (!this.#recordLearning) {
      return;
    }
    for (const agent of outcome.agents) {
      this.learn(
        {
          kind: outcome.succeeded ? "task_succeeded" : "task_failed",
          subject: agent,
          taskId: outcome.taskId,
          traceId: outcome.traceId,
          detail: { errorClass: outcome.errorClass, escalated: outcome.escalated },
        },
        context,
      );
    }
    if (outcome.verificationVerdict !== null) {
      this.learn(
        {
          kind: "verification_result",
          subject: outcome.taskId,
          taskId: outcome.taskId,
          traceId: outcome.traceId,
          detail: { verdict: outcome.verificationVerdict },
        },
        context,
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Observation                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Counters, for a dashboard.
   *
   * Derived from the same events written to the shared audit history, so a
   * dashboard and the audit cannot disagree.
   */
  public metrics(): {
    readonly reads: number;
    readonly writes: number;
    readonly refused: number;
    readonly invalidations: number;
    readonly stored: number;
    readonly learningEvents: number;
    readonly scopes: number;
  } {
    return {
      reads: this.#readCount,
      writes: this.#writeCount,
      refused: this.#refusedCount,
      invalidations: this.#invalidationCount,
      stored: this.#store.size(),
      learningEvents: this.#learning?.size() ?? 0,
      scopes: this.#store.scopes().length,
    };
  }

  /**
   * PHASE 07: REMOVED - `public learning(): LearningEventStore | undefined`.
   *
   * `TODO.md` PHASE 07 listed seven dead `MemoryService` methods and asked for a
   * KEEP / REMOVE / WIRE decision each, with source evidence. The evidence for this one
   * was that it had **zero callers** - not in `src/` and not in any test - while the
   * other six had 1 to 7 test callers each.
   *
   * A public accessor for an internal store, callable by nobody, is API surface a reader
   * must still reason about: it says the learning log is part of the contract, and
   * nothing in the repository exercises that claim. Removing the ACCESSOR is not the same
   * as removing learning - `#learning` is still written by `learn()`, still counted by
   * `metrics()`, and still part of what the service does.
   */
  // (removed; the field and its writers remain)

  /* ---------------------------------------------------------------- */
  /* internals                                                        */
  /* ---------------------------------------------------------------- */

  #assertWrite(subject: MemorySubject, scope: AnyMemoryScope): Error | null {
    if (this.#access === undefined) {
      return null;
    }
    const allowed = this.#access.assertWrite(subject, scope);
    return allowed.ok ? null : allowed.error;
  }

  #canRead(subject: MemorySubject, scope: AnyMemoryScope): boolean {
    return this.#access === undefined || this.#access.canRead(subject, scope);
  }

  #findById(id: string): MemoryItem | null {
    for (const scope of this.#store.scopes()) {
      const item = this.#store.listScope(scope, { includeInactive: true }).find((entry) => entry.id === id);
      if (item !== undefined) {
        return item;
      }
    }
    return null;
  }

  #record(
    context: ExecutionContext | undefined,
    kind: Parameters<TraceRecorder["record"]>[0],
    detail: Readonly<Record<string, unknown>>,
  ): void {
    if (this.#traces === undefined) {
      return;
    }
    this.#traces.record(
      kind,
      context ?? { traceId: "memory", taskId: "memory", parentTaskId: null, teamId: null },
      detail,
      this.#clock.now(),
    );
  }
}

/** Maps a subject id onto a provenance class. */
function subjectSource(subjectId: string): "system" | "human" | "agent" {
  if (subjectId === "system") {
    return "system";
  }
  if (subjectId.startsWith("agent:")) {
    return "agent";
  }
  if (subjectId.startsWith("user:") || subjectId.startsWith("operator:")) {
    return "human";
  }
  // Anything else is a component of the system acting under its own name.
  return "system";
}

/** Re-exported so a caller building an outcome needs one import. */
export type { LearningEventKind };
