/**
 * The memory model.
 *
 * PHASE 04 gave memory a storage port and an access policy. Neither answers the
 * question that actually matters once memory is useful: *which of the thousands
 * of things we know should I bring into this task, and how much do I believe it?*
 *
 * This module is the typed layer that does. It sits ABOVE `MemoryProvider` and
 * changes nothing about it: a `MemoryItem` is stored through the same port, under
 * the same scopes, subject to the same grants. Swapping the backend for SQLite or
 * a document store requires no change here.
 *
 * THE FOUR QUESTIONS THIS MODEL EXISTS TO ANSWER
 *
 *   Where did this come from?      -> `MemoryProvenance`
 *   Why was this retrieved?       -> `MemoryRetrievalResult.explanation`
 *   How much do I believe it?      -> `MemoryConfidence`
 *   Is it still true?              -> `MemoryStatus` + `supersedes`/`supersededBy`
 *
 * Two invariants are enforced by construction rather than by convention:
 *
 *   1. A persisted item ALWAYS has provenance. There is no way to build one
 *      without it, so "where did this come from" is always answerable.
 *   2. A retrieval result ALWAYS explains itself. A memory that cannot say why it
 *      was selected is indistinguishable from one that was selected arbitrarily.
 */

import { MEMORY_SCOPES, SCOPE_BREADTH, type MemoryScope, isMemoryScope } from "./memory.js";

/* ------------------------------------------------------------------ */
/* Scope                                                               */
/* ------------------------------------------------------------------ */

/**
 * PHASE 05 scopes, added to the PHASE 04 set.
 *
 * `MemoryScope` in `memory.ts` is the single storage vocabulary; this list names
 * the three PHASE 05 added, for a caller that cares about which are new. The
 * existing eight are untouched and still valid.
 */
export const EXTENDED_MEMORY_SCOPES = ["conversation", "organization", "global"] as const;
export type ExtendedMemoryScope = (typeof EXTENDED_MEMORY_SCOPES)[number];

/** Every scope this build understands. Identical to `MemoryScope` today. */
export const ALL_MEMORY_SCOPES: readonly MemoryScope[] = MEMORY_SCOPES;

export function isAnyMemoryScope(value: unknown): value is MemoryScope {
  return isMemoryScope(value);
}

/** Alias: PHASE 05 code reads better against the extended vocabulary. */
export type AnyMemoryScope = MemoryScope;

/**
 * Scopes ordered from narrowest to widest.
 *
 * PHASE 07: this used to be a second hand-maintained table here, and the two disagreed
 * with `MEMORY_SCOPES`' declaration order. It now lives in `memory.ts` and is DERIVED
 * from that declaration - which is the only place it could be derived, because
 * `MemoryAccessPolicy` consults it and `model.ts` imports `memory.ts`, so the reverse
 * would be circular. Re-exported here because callers already import it from this
 * module, and a move that broke every import would be a move nobody would make.
 *
 * See `memory.ts` for what breadth is FOR and the single place it is enforced.
 */
export { SCOPE_BREADTH, MAX_SCOPE_BREADTH } from "./memory.js";

export function isBroaderScope(candidate: MemoryScope, than: MemoryScope): boolean {
  return SCOPE_BREADTH[candidate] > SCOPE_BREADTH[than];
}

/* ------------------------------------------------------------------ */
/* Type, source, status                                                */
/* ------------------------------------------------------------------ */

/**
 * What kind of thing a memory is.
 *
 * The distinction is functional, not decorative. An `episodic` memory is "what
 * happened", a `semantic` memory is "what is true", a `procedural` memory is "how
 * to do it". They have different lifetimes and different consequences when wrong,
 * so they are never stored under one generic label.
 */
export const MEMORY_TYPES = [
  /** What happened during a specific execution. */
  "episodic",
  /** A fact believed to be true. */
  "semantic",
  /** How to perform a kind of work. */
  "procedural",
  /** A decision, with its rationale. */
  "decision",
  /** A verified reference, kept so a claim can be re-checked. */
  "evidence",
  /** A preference or rule learned from outcomes. */
  "preference",
  /** A summary of a conversation or task thread. */
  "conversational",
  /** Knowledge about the system or its domain, independent of any task. */
  "knowledge",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === "string" && (MEMORY_TYPES as readonly string[]).includes(value);
}

/**
 * Where a memory came from, at the coarsest level.
 *
 * A provenance chain records the detail; this records the class, which is what a
 * policy needs in order to decide how much to trust something without reading it.
 */
export const MEMORY_SOURCES = [
  /** TOZ itself: the orchestrator, a worker, or a subsystem. */
  "system",
  /** A person: an operator, a reviewer, or a user. */
  "human",
  /** An agent, named in the provenance. */
  "agent",
  /** An external knowledge provider or document store. */
  "knowledge_provider",
  /** A learning event: an outcome, recorded rather than asserted. */
  "learning",
  /** Imported from outside the system entirely. */
  "external",
] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

/**
 * The lifecycle of a memory.
 *
 * `superseded` and `invalidated` are retained rather than deleted, because a
 * memory that was believed and then withdrawn is itself evidence about how the
 * system reasons. Deletion is a separate, explicit act.
 */
export const MEMORY_STATUSES = ["active", "stale", "superseded", "invalidated", "deleted"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export function isMemoryStatus(value: unknown): value is MemoryStatus {
  return typeof value === "string" && (MEMORY_STATUSES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Confidence                                                          */
/* ------------------------------------------------------------------ */

export const MEMORY_CONFIDENCE_LEVELS = ["low", "medium", "high", "certain"] as const;
export type MemoryConfidenceLevel = (typeof MEMORY_CONFIDENCE_LEVELS)[number];

/**
 * How much a memory is believed.
 *
 * A LEVEL plus the evidence for it, never a bare number. A score with no reasons
 * cannot be audited, and an unauditable confidence is indistinguishable from an
 * arbitrary one.
 */
export interface MemoryConfidence {
  readonly level: MemoryConfidenceLevel;
  /** 0..1. Null when a source cannot quantify its own certainty. */
  readonly score: number | null;
  /** Non-secret reasons the level was assigned. */
  readonly reasons: readonly string[];
}

export const CONFIDENCE_RANK: Readonly<Record<MemoryConfidenceLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  certain: 3,
};

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

/**
 * Where a memory came from, in enough detail to audit it.
 *
 * Required on every persisted item. This is the difference between a memory
 * system and a cache: a cache's entries are disposable, and a memory's entries
 * change what the system believes, so the belief must be traceable.
 */
export interface MemoryProvenance {
  readonly source: MemorySource;
  /** Who or what, within that class. e.g. `agent:research-agent@1.0.0`. */
  readonly sourceRef: string;
  /** Task this arose from, when it arose from work. */
  readonly taskId: string | null;
  /** Trace that produced it, when it was produced by an execution. */
  readonly traceId: string | null;
  /** Epoch ms. When the underlying fact was observed, not when it was written. */
  readonly observedAt: number;
  /** Verification verdict, when the memory came from verified work. */
  readonly verification: "pass" | "fail" | "needs_review" | null;
  /**
   * How the work behind this ended, when there was work behind it.
   *
   * Part of provenance because a failure remembered as a lesson and a success
   * remembered as a fact are different claims, and the policy needs to tell them
   * apart before deciding what confidence to assign.
   */
  readonly outcome?: "succeeded" | "failed" | "cancelled" | "escalated" | null;
  /** Why the work failed, when it did. Classified, never free text. */
  readonly errorClass?: string | null;
  /** Non-secret reference to the source material. */
  readonly sourceReference: string | null;
}

/* ------------------------------------------------------------------ */
/* Sensitivity and metadata                                            */
/* ------------------------------------------------------------------ */

/**
 * How sensitive a memory is.
 *
 * Determines who may hold it and whether it may be injected into a task's
 * context. `restricted` is the default for anything the writer did not classify,
 * because the cost of over-protecting one memory is much lower than the cost of
 * leaking one.
 */
export const MEMORY_SENSITIVITIES = ["public", "internal", "confidential", "restricted"] as const;
export type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];

export interface MemoryMetadata {
  /** Tags for filtering. Free-form, so a caller is not blocked by a fixed list. */
  readonly tags: readonly string[];
  /** Capabilities this memory is relevant to. Reused by retrieval. */
  readonly capabilities: readonly string[];
  /** Non-secret structured detail. */
  readonly attributes: Readonly<Record<string, unknown>>;
}

/* ------------------------------------------------------------------ */
/* The item                                                            */
/* ------------------------------------------------------------------ */

/**
 * One remembered thing.
 *
 * `id` is stable and opaque. `key` is the storage address within a scope and is
 * what a correction supersedes on; the two are separate because a corrected
 * memory keeps its identity while a new observation gets a new id.
 */
export interface MemoryItem {
  readonly id: string;
  readonly scope: AnyMemoryScope;
  readonly key: string;
  readonly type: MemoryType;
  /** The content. Kept opaque here so the store never has to understand it. */
  readonly value: unknown;
  /** Short human-readable summary, used for listing and explanation. */
  readonly summary: string;
  readonly confidence: MemoryConfidence;
  readonly provenance: MemoryProvenance;
  readonly status: MemoryStatus;
  readonly sensitivity: MemorySensitivity;
  /** 0..1. How much this matters. Distinct from confidence: something can be certain and unimportant. */
  readonly importance: number;
  /** Epoch ms. Null = never expires. */
  readonly expiresAt: number | null;
  /** Epoch ms of the underlying observation, for recency. */
  readonly observedAt: number;
  /** Epoch ms it was written. */
  readonly writtenAt: number;
  /** Items this one replaces. */
  readonly supersedes: readonly string[];
  readonly metadata: MemoryMetadata;
}

/** What a caller must supply. Everything else is derived or defaulted. */
export interface MemoryDraft {
  readonly scope: AnyMemoryScope;
  readonly key: string;
  readonly type: MemoryType;
  readonly value: unknown;
  readonly summary: string;
  readonly provenance: MemoryProvenance;
  readonly confidence?: MemoryConfidence;
  readonly sensitivity?: MemorySensitivity;
  readonly importance?: number;
  readonly expiresAt?: number | null;
  readonly supersedes?: readonly string[];
  readonly metadata?: Partial<MemoryMetadata>;
  readonly id?: string;
}

/** Raised when a memory cannot be built at all. */
export class MemoryModelError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MemoryModelError";
  }
}

/**
 * Builds a complete item from a draft.
 *
 * Defaults are chosen to be the safe direction rather than the convenient one:
 * sensitivity `restricted`, status `active`, importance derived from the type, and
 * no expiry unless the caller states one. A caller that forgets to classify
 * something gets it protected, not published.
 *
 * Provenance has NO default. It is the one field the model refuses to invent,
 * because a fabricated origin is worse than a refusal: the question "where did
 * this come from?" would have an answer, and the answer would be wrong.
 */
export function buildMemoryItem(draft: MemoryDraft, now: number): MemoryItem {
  if (draft.provenance === undefined || draft.provenance === null) {
    throw new MemoryModelError(
      `Memory "${draft.key}" cannot be built: provenance is required, because a memory of unknown origin cannot be audited`,
    );
  }
  const importance = draft.importance ?? defaultImportance(draft.type);
  return {
    id: draft.id ?? `${draft.scope}:${draft.key}`,
    scope: draft.scope,
    key: draft.key,
    type: draft.type,
    value: draft.value,
    summary: draft.summary,
    confidence: draft.confidence ?? {
      level: "medium",
      score: null,
      reasons: ["No confidence stated by the writer"],
    },
    provenance: draft.provenance,
    status: "active",
    sensitivity: draft.sensitivity ?? "restricted",
    importance,
    expiresAt: draft.expiresAt ?? null,
    observedAt: draft.provenance.observedAt,
    writtenAt: now,
    supersedes: draft.supersedes ?? [],
    metadata: {
      tags: draft.metadata?.tags ?? [],
      capabilities: draft.metadata?.capabilities ?? [],
      attributes: draft.metadata?.attributes ?? {},
    },
  };
}

/**
 * Baseline importance by type.
 *
 * A verified decision outranks a passing conversation, because a reader that
 * cannot tell them apart will treat a pleasantry as a fact.
 */
export function defaultImportance(type: MemoryType): number {
  switch (type) {
    case "decision":
      return 0.9;
    case "evidence":
      return 0.85;
    case "semantic":
      return 0.75;
    case "procedural":
      return 0.7;
    case "preference":
      return 0.6;
    case "knowledge":
      return 0.65;
    case "episodic":
      return 0.5;
    case "conversational":
      return 0.3;
  }
}

/* ------------------------------------------------------------------ */
/* Queries and retrieval                                               */
/* ------------------------------------------------------------------ */

/**
 * A retrieval request.
 *
 * A query is a SCOPE decision as much as a text one. `scopes` is explicit: a
 * retrieval that defaulted to "everything readable" would be a way to leak
 * global memory into a narrow task.
 */
export interface MemoryQuery {
  readonly text: string;
  /** Scopes to search. Explicit, never implied. */
  readonly scopes: readonly AnyMemoryScope[];
  /** Hard ceiling on returned items. */
  readonly limit: number;
  /** Only items at or above this confidence. */
  readonly minimumConfidence?: MemoryConfidenceLevel;
  /** Only items with at least this importance. */
  readonly minimumImportance?: number;
  /** Only items not expired at this time. Defaults to true. */
  readonly includeExpired?: boolean;
  readonly types?: readonly MemoryType[];
  readonly tags?: readonly string[];
  readonly capabilities?: readonly string[];
  /** Task the retrieval is for, recorded in the explanation. */
  readonly taskId?: string | null;
}

/** A retrieval strategy, and what it contributed. */
export const RETRIEVAL_STRATEGIES = ["exact", "metadata", "semantic", "recency"] as const;
export type RetrievalStrategy = (typeof RETRIEVAL_STRATEGIES)[number];

/**
 * Why one item was returned.
 *
 * Mandatory. A result that cannot explain itself is the failure mode the whole
 * memory layer exists to avoid: an agent acting on a memory it cannot justify.
 */
export interface RetrievalExplanation {
  readonly strategies: readonly RetrievalStrategy[];
  /** Per-term contribution to the final score, largest first. */
  readonly contributions: readonly { readonly term: string; readonly weight: number }[];
  /** Human-readable summary. */
  readonly reason: string;
}

export interface MemoryRetrievalResult {
  readonly items: readonly MemoryItem[];
  /** Scored, best first. */
  readonly ranked: readonly ScoredMemory[];
  /** Items examined, for a hit/miss ratio a reader can trust. */
  readonly examinedCount: number;
  /** How many were returned. */
  readonly hitCount: number;
  readonly explanation: RetrievalExplanation;
  /** Epoch ms the retrieval took. Measured, never defaulted to zero. */
  readonly durationMs: number;
  /** Strategies actually used. */
  readonly strategies: readonly RetrievalStrategy[];
  /** Populated when retrieval was refused, with a reason. */
  readonly unavailableReason: string | null;
}

export interface ScoredMemory {
  readonly item: MemoryItem;
  readonly score: number;
  readonly explanation: RetrievalExplanation;
}

export function emptyRetrieval(reason: string, durationMs: number): MemoryRetrievalResult {
  return {
    items: [],
    ranked: [],
    examinedCount: 0,
    hitCount: 0,
    explanation: { strategies: [], contributions: [], reason },
    durationMs,
    strategies: [],
    unavailableReason: reason,
  };
}

/* ------------------------------------------------------------------ */
/* Knowledge                                                           */
/* ------------------------------------------------------------------ */

/**
 * A knowledge item: something believed to be true about the domain, as distinct
 * from something remembered about a task.
 *
 * Separate from `MemoryItem` because the two have different lifecycles: knowledge
 * is expected to be shared and long-lived, and a memory is often personal and
 * short-lived. Conflating them makes "what do we know?" unanswerable.
 */
export interface KnowledgeItem {
  readonly id: string;
  readonly topic: string;
  readonly content: string;
  /** Non-secret reference to the material this was derived from. */
  readonly reference: string | null;
  readonly provenance: MemoryProvenance;
  readonly confidence: MemoryConfidence;
  /** Epoch ms. Knowledge expires when the world changes, so this is meaningful. */
  readonly observedAt: number;
  readonly writtenAt: number;
  readonly metadata: MemoryMetadata;
}

/* ------------------------------------------------------------------ */
/* Learning                                                            */
/* ------------------------------------------------------------------ */

/**
 * What happened, recorded as a signal.
 *
 * A learning event is a FACT about an outcome. It is deliberately not an
 * instruction: nothing in this system reads events to change behaviour without a
 * human opting in, which is the rule PHASE 04.1 established for learning signals
 * and which this extends.
 */
export const LEARNING_EVENT_KINDS = [
  "task_succeeded",
  "task_failed",
  "output_corrected",
  "user_correction",
  "preference_repeated",
  "agent_performance",
  "tool_performance",
  "routing_outcome",
  "verification_result",
  "model_result",
  "workflow_result",
  "memory_useful",
  "memory_not_useful",
] as const;
export type LearningEventKind = (typeof LEARNING_EVENT_KINDS)[number];

/**
 * One learning event.
 *
 * `appliedPolicy` records whether anything acted on it. It is always false in
 * this phase, and it exists so that "learning changed behaviour" can never happen
 * invisibly: a future subsystem that acts on an event has to write here.
 */
export interface LearningEvent {
  readonly eventId: string;
  readonly kind: LearningEventKind;
  /** What the event is about: an agent key, a tool id, a model id. */
  readonly subject: string;
  /** Task it came from. */
  readonly taskId: string | null;
  readonly traceId: string | null;
  /** Non-secret, structured detail. */
  readonly detail: Readonly<Record<string, unknown>>;
  /** Confidence in the event itself: a single run is weak evidence. */
  readonly confidence: MemoryConfidence;
  readonly observedAt: number;
  /** Whether any subsystem acted on this. Always false in PHASE 05. */
  readonly appliedPolicy: boolean;
  /** How many comparable events have been seen. Context for a later decision. */
  readonly sampleSize: number;
}
