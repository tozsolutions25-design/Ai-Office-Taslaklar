/**
 * The memory write policy.
 *
 * The failure mode of a memory system is not that it forgets. It is that it
 * remembers everything: every pleasantry, every intermediate draft, every dead
 * end. A store that saves all of it retrieves noise, and a reader cannot tell a
 * durable fact from a sentence someone said once.
 *
 * So nothing is written until a policy has decided it should be. The policy
 * answers, for every candidate:
 *
 *   Should this be remembered at all?
 *   Into which scope?
 *   With what confidence?
 *   For how long?
 *   With what sensitivity?
 *   How important?
 *
 * AND IT ANSWERS AUDIBLY. A decision carries a reason and a list of the rules
 * that fired, so "why is this in memory?" is answerable after the fact. A policy
 * that cannot explain a rejection is indistinguishable from one that rejected at
 * random.
 *
 * The policy is a PORT. `MemoryWritePolicy` is the interface; `DefaultWritePolicy`
 * is a reference implementation with real, stated rules. A deployment that
 * disagrees supplies its own, and nothing above this file changes.
 */

import { isSensitiveKey } from "../../audit/redaction.js";
import {
  type AnyMemoryScope,
  type MemoryConfidence,
  type MemoryConfidenceLevel,
  type MemoryDraft,
  type MemorySensitivity,
  type MemoryType,
  type MemoryProvenance,
  SCOPE_BREADTH,
  MAX_SCOPE_BREADTH,
} from "./model.js";
import { isRetryableSubtaskFailure } from "../team/team.js";
import { defaultImportance } from "./model.js";
import { isErrorClass } from "../../core/errors.js";

/** Why a candidate was accepted, adjusted, or refused. */
export const POLICY_DECISIONS = ["accepted", "adjusted", "refused"] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

/**
 * The rules a reference policy can state. Names, so a decision can cite them.
 *
 * PHASE 07: `ephemeral_content` and `duplicate_of_recent` were REMOVED from this union.
 * They had been declared since PHASE 05 and had no implementation anywhere - a rule
 * NAME with nothing behind it, cited by nobody, asserted by no test.
 *
 * A name in this list is a claim that the policy CAN state that rule, and
 * `PolicyEvaluation.rules` reports it in every decision. A rule that can never appear
 * there is a fabricated capability in the same shape `DECISIONS.md` D-46 rejected for
 * MCP - "a stub shaped like a client" - except quieter, because nothing ever tried to
 * call it.
 *
 * Neither was implemented in this phase either, and that is deliberate rather than an
 * omission:
 *
 *   - `ephemeral_content` would have to define when content is ephemeral, and
 *     `expiring_type` already does the part that matters: a `conversational` memory is
 *     given a seven-day TTL. A second rule with a vaguer definition would have been a
 *     second way to say it.
 *   - `duplicate_of_recent` needs a window of RECENT WRITES, and `evaluate(draft)` is
 *     stateless - it takes no history and returns no decision to be revised. Implementing
 *     it means threading write history through the policy interface, which is a design
 *     change nobody asked for and which this phase could not test honestly.
 *
 * If either is wanted, it should arrive as a requirement with a definition attached.
 */
export const POLICY_RULES = [
  "no_provenance",
  "empty_summary",
  "below_importance_floor",
  "sensitive_content",
  "restricted_without_justification",
  "verified_evidence",
  "human_assertion",
  "unverified_agent_claim",
  "transient_failure",
  "expiring_type",
  "scope_requires_task",
  "importance_ceiling",
] as const;
export type PolicyRule = (typeof POLICY_RULES)[number];

export interface PolicyEvaluation {
  readonly decision: PolicyDecision;
  /** The draft as it should be written, after any adjustment. */
  readonly draft: MemoryDraft | null;
  /** Rules that fired, in the order they were evaluated. */
  readonly rules: readonly PolicyRule[];
  /** Human-readable reason. Present for every decision. */
  readonly reason: string;
}

/** The port. */
export interface MemoryWritePolicy {
  readonly name: string;
  evaluate(candidate: MemoryDraft, now: number): PolicyEvaluation;
}

export interface WritePolicyOptions {
  /**
   * How important a memory must be to be stored.
   *
   * PHASE 07 (D3): the documented default was 0.3, and the CODE default is 0.35 -
   * chosen deliberately, with a comment at the assignment, so that `conversational`
   * (whose default importance is 0.3) is excluded ENTIRELY rather than "only at the
   * boundary". The old text therefore described a floor the code does not have, and
   * understated it.
   *
   * Set it to 0 to remember everything, which the policy permits and the
   * documentation discourages: a store that keeps everything will retrieve noise.
   */
  readonly minimumImportance?: number;
  /** Lifetimes by type, in ms. A type absent here never expires. */
  readonly ttlByType?: Partial<Record<MemoryType, number>>;
  /** Ceiling on any single item's importance, so nothing crowds out the rest. */
  readonly importanceCeiling?: number;
  /** Sensitivity assigned to a candidate the writer did not classify. */
  readonly defaultSensitivity?: MemorySensitivity;
}

const DEFAULT_TTL: Partial<Record<MemoryType, number>> = {
  // A conversation thread is about the present. Keeping it is how a memory store
  // becomes a transcript archive nobody can search.
  conversational: 24 * 60 * 60 * 1_000,
  episodic: 30 * 24 * 60 * 60 * 1_000,
  // A fact does not expire on a schedule; it is superseded or invalidated.
};

/**
 * Reference write policy.
 *
 * The rules, and the reasoning, in one place so they can be disagreed with:
 *
 *  - No provenance means no write. A memory of unknown origin cannot be audited,
 *    and a store that accepts one cannot answer "where did this come from?".
 *  - Nothing below the importance floor is stored. This is the rule that stops a
 *    memory system from becoming a transcript archive.
 *  - Content that looks sensitive is refused unless a human asserted it. A
 *    machine noticing a credential-shaped key is not grounds for storing it; a
 *    person saying so is.
 *  - Ephemeral content is stored, but short-lived. Refusing it entirely would
 *    lose the thread that explains a decision.
 *  - Verified evidence is promoted: higher confidence, longer life.
 *  - An unverified agent claim is kept, but at low confidence and short life,
 *    because an agent's word about its own work is a claim, not a measurement.
 *  - A transient failure is recorded as a low-importance lesson with a short life,
 *    so a retry pattern is learnable without a failure looking like a fact.
 */
export class DefaultWritePolicy implements MemoryWritePolicy {
  public readonly name = "default";
  readonly #minimumImportance: number;
  readonly #ttl: Partial<Record<MemoryType, number>>;
  readonly #ceiling: number;
  readonly #defaultSensitivity: MemorySensitivity;

  public constructor(options: WritePolicyOptions = {}) {
    // Above the conversational tier (0.3) ON PURPOSE: a thread of a conversation is
    // the default value for a `conversational` memory, so a floor at 0.3 would
    // accept the entire class and the rule would never bite.
    this.#minimumImportance = options.minimumImportance ?? 0.35;
    this.#ttl = { ...DEFAULT_TTL, ...options.ttlByType };
    this.#ceiling = options.importanceCeiling ?? 1;
    this.#defaultSensitivity = options.defaultSensitivity ?? "restricted";
  }

  public get minimumImportance(): number {
    return this.#minimumImportance;
  }

  public evaluate(candidate: MemoryDraft, now: number): PolicyEvaluation {
    const rules: PolicyRule[] = [];
    const refuse = (rule: PolicyRule, reason: string): PolicyEvaluation => ({
      decision: "refused",
      draft: null,
      rules: [...rules, rule],
      reason,
    });

    if (candidate.provenance === undefined || candidate.provenance.sourceRef.trim() === "") {
      return refuse("no_provenance", "No provenance: a memory of unknown origin cannot be audited, so it was refused");
    }
    rules.push("no_provenance");

    if (candidate.summary.trim() === "") {
      return refuse("empty_summary", "No summary: a memory that cannot be described cannot be judged or found");
    }
    rules.push("empty_summary");

    // The SAME default the item model applies, so a draft that states no importance is
    // treated as its type implies rather than as zero. Reading it as zero made every
    // unstated draft fall below the floor, which refused the entire default path.
    const importance = this.#boundedImportance(candidate.importance ?? defaultImportance(candidate.type), candidate.type);
    if (importance < this.#minimumImportance) {
      return refuse(
        "below_importance_floor",
        `Importance ${importance.toFixed(2)} is below the floor of ${this.#minimumImportance.toFixed(2)}: ` +
          "this is the rule that keeps a memory store from becoming a transcript archive",
      );
    }
    rules.push("below_importance_floor");

    // PHASE 07: the PER-SCOPE ceiling, applied after the floor.
    //
    // The order is the design, not an accident. The floor asks "is this worth
    // remembering at all?" and refuses; the ceiling asks "how much should it count once
    // it is?" and clamps. Applying the ceiling first would turn a `global` memory with
    // importance 0.8 into 0.2 and then REFUSE it for falling below the 0.35 floor -
    // which is not "hard to justify", it is "impossible to write", and it would have
    // been reached by accident rather than by decision.
    //
    // The rule fires when EITHER ceiling clamped, compared against the value the
    // candidate actually stated - so the audit trail shows the constraint that applied
    // rather than only the second one that happened to be tighter at the time.
    const stated = candidate.importance ?? defaultImportance(candidate.type);
    const bounded = this.#boundedImportance(stated, candidate.type);
    const scoped = Math.min(bounded, importanceCeilingFor(candidate.scope));
    if (scoped < stated) {
      rules.push("importance_ceiling");
    }
    const scopedImportance = scoped;

    const sensitive = looksSensitive(candidate);
    const humanAsserted = candidate.provenance.source === "human";
    if (sensitive && !humanAsserted) {
      rules.push("sensitive_content");
      return refuse(
        "sensitive_content",
        "The content looks like a credential or secret, and no human asserted it may be stored",
      );
    }
    if (sensitive) {
      rules.push("sensitive_content");
    }

    if (candidate.type === "evidence" && candidate.provenance.verification === "pass") {
      rules.push("verified_evidence");
    }
    if (humanAsserted) {
      rules.push("human_assertion");
    }
    if (candidate.provenance.source === "agent" && candidate.provenance.verification === null) {
      rules.push("unverified_agent_claim");
    }

    const sensitivity = candidate.sensitivity ?? (sensitive ? "restricted" : this.#defaultSensitivity);
    if (sensitivity === "restricted" && !humanAsserted) {
      rules.push("restricted_without_justification");
    }

    let confidence = candidate.confidence ?? derivedConfidence(candidate);
    if (candidate.provenance.source === "agent" && candidate.provenance.verification === null) {
      // An agent's unverified claim about its own work is evidence that it said
      // so, not evidence that it is true.
      confidence = {
        level: "low",
        score: null,
        reasons: ["Agent assertion with no verification", ...(candidate.confidence?.reasons ?? [])],
      };
    }
    if (candidate.provenance.source === "human") {
      confidence = {
        level: candidate.confidence?.level ?? "high",
        score: candidate.confidence?.score ?? null,
        reasons: ["Asserted by a person", ...(candidate.confidence?.reasons ?? [])],
      };
    }

    const ttl = this.#ttl[candidate.type];
    let expiresAt = candidate.expiresAt ?? null;
    if (expiresAt === null && ttl !== undefined) {
      expiresAt = now + ttl;
      rules.push("expiring_type");
    }
    if (candidate.type === "episodic" && candidate.provenance.outcome === "failed") {
      const transient = isErrorClass(candidate.provenance.errorClass)
        ? isRetryableSubtaskFailure(candidate.provenance.errorClass)
        : false;
      rules.push("transient_failure");
      // A PERMANENT failure is the useful lesson: do not do that again, and it
      // deserves weight. A TRANSIENT failure is usually the environment, so it
      // is kept short-lived and low-weight - otherwise a provider outage becomes
      // a durable belief about the system.
      confidence = {
        level: transient ? "low" : "medium",
        score: null,
        reasons: [
          transient
            ? "Transient failure: environmental noise, kept short-lived"
            : "Permanent failure: a lesson worth carrying",
          ...confidence.reasons,
        ],
      };
      if (transient && expiresAt === null) {
        expiresAt = now + 7 * 24 * 60 * 60 * 1_000;
      }
    }

    if (candidate.scope === "task" && candidate.provenance.taskId === null) {
      // A task-scoped memory with no task is a memory nobody can ever scope a
      // read to, so it would be unreachable in practice.
      rules.push("scope_requires_task");
    }

    const adjusted =
      candidate.importance === scopedImportance &&
      candidate.confidence === confidence &&
      candidate.sensitivity === sensitivity &&
      candidate.expiresAt === expiresAt;

    return {
      decision: adjusted ? "accepted" : "adjusted",
      draft: {
        ...candidate,
        importance: scopedImportance,
        confidence,
        sensitivity,
        expiresAt,
        provenance: candidate.provenance,
      },
      rules,
      reason:
        `Stored as ${candidate.type} in scope "${candidate.scope}" at confidence "${confidence.level}"` +
        `${expiresAt === null ? " with no expiry" : ` expiring at ${new Date(expiresAt).toISOString()}`}` +
        `; rules: ${rules.join(", ")}`,
    };
  }

  #boundedImportance(importance: number, type: MemoryType): number {
    // A non-finite figure is not a claim of zero; it is no claim at all, so the
    // type default applies rather than the memory being refused as worthless.
    if (!Number.isFinite(importance)) {
      return defaultImportance(type);
    }
    return Math.max(0, Math.min(this.#ceiling, importance));
  }
}


/**
 * Confidence implied by the provenance, when the writer states none.
 *
 * The point is that a memory's confidence follows from where it came from, so a
 * caller cannot assert certainty by writing it into a field.
 */
export function derivedConfidence(candidate: MemoryDraft): MemoryConfidence {
  const { source, verification } = candidate.provenance;
  if (verification === "pass") {
    return { level: "high", score: null, reasons: ["Carried by verified work"] };
  }
  if (source === "human") {
    return { level: "high", score: null, reasons: ["Asserted by a person"] };
  }
  if (verification === "needs_review") {
    return { level: "low", score: null, reasons: ["Verification could not decide"] };
  }
  if (verification === "fail") {
    return { level: "low", score: null, reasons: ["The work behind it failed verification"] };
  }
  if (source === "agent") {
    return { level: "low", score: null, reasons: ["Agent assertion, unverified"] };
  }
  if (source === "knowledge_provider") {
    return { level: "medium", score: null, reasons: ["From a knowledge provider"] };
  }
  if (source === "learning") {
    return { level: "medium", score: null, reasons: ["Derived from a recorded outcome"] };
  }
  return { level: "medium", score: null, reasons: ["Stated by the system with no verification"] };
}

/**
 * Whether a candidate looks like it carries a secret.
 *
 * Reuses the audit layer's `isSensitiveKey`, so memory and the audit log agree on
 * what counts. Checking the KEY rather than the value is deliberate: a memory
 * legitimately holds prose that contains a word like "password" while a field
 * NAMED `password` is the problem.
 */
export function looksSensitive(candidate: MemoryDraft): boolean {
  if (candidate.sensitivity === "restricted" || candidate.sensitivity === "confidential") {
    return false;
  }
  const value = candidate.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Highest importance a memory in this scope can carry.
 *
 * Wider scope is not automatically more important. A global memory is long-lived and
 * shared, so it must be genuinely worth carrying to everyone.
 *
 * ## PHASE 07: THE DIVISOR WAS WRONG, AND THAT IS WHY THE FLOOR NEVER FIRED
 *
 * This read `1 - SCOPE_BREADTH[scope] / 20`. Breadth runs `0..10`, so the result
 * spanned `1.0` down to `0.5` and the `Math.max(0.2, ...)` floor beside it could never
 * be reached - a floor that reads as a deliberate policy and cannot fire documents an
 * intent the code does not implement.
 *
 * The divisor is now `MAX_SCOPE_BREADTH`, so the ceiling spans `1.0` down to `0.0` and
 * the floor is real: the three widest scopes (`system`, `organization`, `global`) clamp
 * at 0.2. That is what the floor is for. A memory with importance 0 is never retrieved,
 * so a scope whose memories could all reach 0 would be a scope whose memories you paid
 * to store and can never read back.
 *
 * ## IT WAS ALSO DEAD
 *
 * `importance_ceiling` was pushed onto the rules list UNCONDITIONALLY and clamped
 * nothing: the per-policy `importanceCeiling` (default 1) is a separate constant, and
 * this function had no caller anywhere in `src/`. A rule that always fires and can never
 * fail is noise in an audit trail - it looks like evidence of a constraint. It is now
 * called, and the rule fires only when it actually clamped something.
 */
export function importanceCeilingFor(scope: AnyMemoryScope): number {
  return Math.max(MIN_SCOPE_IMPORTANCE, 1 - SCOPE_BREADTH[scope] / MAX_SCOPE_BREADTH);
}

/** The floor a scope's importance cannot fall below, whatever its breadth. */
export const MIN_SCOPE_IMPORTANCE = 0.2;

/** Re-exported so a caller building a policy needs one import. */
export type { MemoryConfidenceLevel, MemoryProvenance };
