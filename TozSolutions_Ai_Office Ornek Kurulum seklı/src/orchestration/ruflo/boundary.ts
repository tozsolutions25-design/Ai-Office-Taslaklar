/**
 * Ruflo compatibility boundary.
 *
 * Ruflo is a REFERENCE ARCHITECTURE in this system. No Ruflo package is
 * installed, none is required, and nothing here calls one.
 *
 * WHAT IS IN THIS FILE, and why it is not a fake integration:
 *
 * 1. `RUFLO_CONCEPTS` - the concepts taken from Ruflo, each mapped to its TOZ
 *    equivalent, each marked with whether this repository actually implements the
 *    TOZ side. This is the whole of what was adopted. Anything not on this list
 *    was not verified and is therefore not claimed.
 *
 * 2. `RufloAdapterBoundary` - the shape a future `RufloAdapter` must take: a
 *    leaf, disabled by default, with no reference to the orchestrator, the pool,
 *    the router, or any registry. It cannot enqueue work, cannot advance task
 *    state, and cannot be constructed in a mode that claims authority.
 *
 * WHY NOT SHIP A `RufloAdapter` THAT CALLS RUFLO: because no Ruflo is installed,
 * such a class would be a claim about an integration that does not exist. The
 * boundary, the concept mapping and the tests are the honest deliverable; the
 * adapter is written when there is something to call.
 */

import { type ErrorClass } from "../../core/errors.js";
import { type Result, err } from "../../core/result.js";

/** A concept adopted from the reference architecture, and what it became. */
export interface RufloConcept {
  /** The reference concept, named as the reference names it. */
  readonly reference: string;
  /** The TOZ component that implements it, or null where TOZ has none. */
  readonly tozEquivalent: string | null;
  /**
   * True when the TOZ side is actually implemented and tested in this
   * repository.
   *
   * A concept with no TOZ equivalent, or one that is planned but not built, is
   * recorded as unimplemented rather than quietly counted as coverage.
   */
  readonly implemented: boolean;
}

/**
 * The adopted concepts.
 *
 * Sourced from the reference relationship already recorded in `ARCHITECTURE.md`
 * §21, and from nothing else. Every entry names a TOZ module that exists in this
 * repository, except where the gap is the point of recording it.
 */
export const RUFLO_CONCEPTS: readonly RufloConcept[] = [
  { reference: "router-driven execution", tozEquivalent: "src/orchestration/model/modelRouter.ts", implemented: true },
  { reference: "capability-based agent selection", tozEquivalent: "src/orchestration/pool/specialistPool.ts", implemented: true },
  { reference: "specialist agents", tozEquivalent: "src/orchestration/agent/record.ts", implemented: true },
  { reference: "swarm / team composition", tozEquivalent: "src/orchestration/team/team.ts", implemented: true },
  { reference: "hierarchical topology", tozEquivalent: "src/orchestration/team/topology.ts", implemented: true },
  { reference: "agent lifecycle", tozEquivalent: "src/orchestration/agent/registry.ts", implemented: true },
  { reference: "memory persistence", tozEquivalent: "src/orchestration/memory/memory.ts", implemented: true },
  { reference: "learning from outcomes", tozEquivalent: "src/orchestration/feedback/feedback.ts", implemented: true },
  { reference: "background workers", tozEquivalent: "src/orchestration/workers/worker.ts", implemented: true },
  { reference: "MCP integration", tozEquivalent: "src/orchestration/tools/tool.ts", implemented: true },
  { reference: "observability and cost tracking", tozEquivalent: "src/orchestration/observability/trace.ts", implemented: true },
  { reference: "plugin extensibility", tozEquivalent: "src/orchestration/extensions/extension.ts", implemented: true },
  { reference: "task decomposition", tozEquivalent: "src/orchestration/task/plan.ts", implemented: true },
  { reference: "verification", tozEquivalent: "src/orchestration/verification/verifier.ts", implemented: true },
  // Not adopted, and not claimed. Recorded so their absence is a decision
  // rather than an omission someone re-litigates later.
  { reference: "federation", tozEquivalent: null, implemented: false },
  { reference: "neural routing", tozEquivalent: null, implemented: false },
  { reference: "vector infrastructure", tozEquivalent: null, implemented: false },
  { reference: "CRDT-based shared state", tozEquivalent: null, implemented: false },
  { reference: "QUIC transport", tozEquivalent: null, implemented: false },
];

/** Looks up a reference concept by name. */
export function rufloConcept(reference: string): RufloConcept | null {
  return RUFLO_CONCEPTS.find((concept) => concept.reference === reference) ?? null;
}

/** Concepts adopted and implemented in TOZ. */
export function implementedRufloConcepts(): readonly RufloConcept[] {
  return RUFLO_CONCEPTS.filter((concept) => concept.implemented && concept.tozEquivalent !== null);
}

/**
 * The shape a Ruflo-shaped result takes, as this boundary understands it.
 *
 * Declared so the translation can be written and tested now, against a documented
 * shape, rather than guessed at when the dependency finally exists. Nothing in
 * this repository produces one.
 */
export interface RufloShapedOutcome {
  readonly status: "completed" | "failed" | "cancelled" | "timeout";
  readonly output?: string;
  readonly agentHandle?: string;
  readonly durationMs?: number | null;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/** The TOZ-shaped result of translating one reference outcome. */
export interface TranslatedOutcome {
  readonly ok: boolean;
  readonly output: string;
  readonly errorClass: ErrorClass | null;
  readonly message: string | null;
}

/**
 * Translates a reference-shaped outcome into TOZ's vocabulary.
 *
 * Total and pure, so it can be tested without a Ruflo installation, and so the
 * decision about what counts as a failure lives in one readable place.
 */
export function translateRufloOutcome(outcome: RufloShapedOutcome): TranslatedOutcome {
  switch (outcome.status) {
    case "completed":
      return {
        ok: true,
        output: outcome.output ?? "",
        errorClass: null,
        message: null,
      };
    case "cancelled":
      return { ok: false, output: "", errorClass: "unknown", message: outcome.errorMessage ?? "Cancelled" };
    case "timeout":
      return { ok: false, output: "", errorClass: "timeout", message: outcome.errorMessage ?? "Timed out" };
    case "failed":
      return {
        ok: false,
        output: "",
        // Permanent by default. A boundary that guessed "retryable" for an
        // unknown failure would turn an outage into a retry storm.
        errorClass: "unknown",
        message: outcome.errorMessage ?? outcome.errorCode ?? "Failed",
      };
  }
}

/** Why the boundary is unavailable. Distinct per reason, so tests can be exact. */
export type RufloUnavailableReason = "not_installed" | "not_enabled" | "authority_claimed";

export interface RufloBoundaryOptions {
  /** Must be explicitly true. There is no default-on path. */
  readonly enabled?: boolean;
  /**
   * A boundary that claims to orchestrate is refused.
   *
   * Accepted as an option only so the refusal is a runtime, testable guarantee
   * rather than a comment: constructing one with this set throws.
   */
  readonly claimsAuthority?: boolean;
}

/**
 * The Ruflo boundary.
 *
 * Disabled by default, and disabled in the only way that matters: with no Ruflo
 * package present, `status()` reports `not_installed` and `execute()` returns a
 * classified failure. TOZ runs identically whether or not this object exists -
 * which is asserted by test, not by assertion in a comment.
 */
export class RufloAdapterBoundary {
  readonly #enabled: boolean;

  public constructor(options: RufloBoundaryOptions = {}) {
    if (options.claimsAuthority === true) {
      throw new Error(
        "A Ruflo boundary cannot claim orchestration authority. Authority belongs to the TOZ Orchestrator; " +
          "the reference architecture may inform it and must not replace it.",
      );
    }
    this.#enabled = options.enabled ?? false;
  }

  /** Whether the boundary has been explicitly switched on. */
  public get enabled(): boolean {
    return this.#enabled;
  }

  /**
   * Why the boundary cannot be used, or `null` when it can.
   *
   * `not_installed` is checked first and is the truthful answer in this
   * repository: no Ruflo package is present, so the boundary has nothing to call
   * however it is configured.
   */
  public status(): RufloUnavailableReason | null {
    if (!this.#enabled) return "not_enabled";
    return "not_installed";
  }

  /**
   * Executes through the boundary.
   *
   * Fails with a classified error rather than pretending. An integration that
   * cannot run must say so, and must say so in a way the orchestrator can turn
   * into a failed subtask with a reason.
   */
  public execute(agentHandle: string): Promise<Result<{ output: string }, Error>> {
    const status = this.status();
    if (status !== null) {
      return Promise.resolve(
        err(
          new Error(
            `Ruflo boundary unavailable (${status}); agent "${agentHandle}" was not executed. ` +
              "No Ruflo package is installed in this repository, so no Ruflo execution is possible.",
          ),
        ),
      );
    }
    // Unreachable while no package is installed. Present so that adding one
    // later forces a decision here rather than falling through to a fake result.
    return Promise.resolve(err(new Error("Ruflo boundary has no transport: implement one before enabling")));
  }
}
