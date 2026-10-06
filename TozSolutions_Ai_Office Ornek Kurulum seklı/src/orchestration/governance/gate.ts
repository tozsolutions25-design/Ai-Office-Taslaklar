/**
 * PHASE 09: the governance integration seam.
 *
 * PHASE 08 built a complete control plane and documented that it was "not wired
 * into the orchestrator's execution path", as a deployment choice. PHASE 09 was
 * asked to stop treating that as acceptable and to determine whether a SAFE
 * boundary exists.
 *
 * IT DOES, and it is the one the repository already had.
 *
 * `TozOrchestrator.execute` already has step 2: the input-policy screen, which
 * refuses a request before anything is classified, planned, recalled or executed,
 * and which already reports through one `#refuse` path with a classified error.
 * That is a genuine pre-execution authorization boundary, and putting governance
 * there means a denied request never becomes a plan, never reaches PHASE 06
 * routing, and never reaches a worker.
 *
 * This file supplies only the PORT the orchestrator depends on and the concrete
 * implementation behind it. It deliberately does NOT contain the wiring - that
 * lives in `authority.ts` next to the boundary, so a reader of the execution path
 * can see the check inline rather than having to follow a call.
 *
 * WHAT THE PORT CAN AND CANNOT DO
 *
 *   can  authorize an operation, producing ALLOW / DENY / REQUIRE_APPROVAL
 *   can  contribute a `RoutingRestriction`, which only REMOVES candidates
 *   must not select a provider or a model
 *   must not orchestrate, plan, mutate topology, or touch memory or verification
 *
 * The narrowing hook is optional and, when it misbehaves, is contained: the
 * orchestrator applies whatever candidates survive and still hands them to PHASE
 * 06 `evaluateCandidate`, which remains the hard filter.
 */

import { type Capability } from "../../capabilities/capability.js";
import { type Clock, systemClock } from "../../core/clock.js";
import type {
  PolicyEngine} from "../governance/index.js";
import {
  type GovernanceDecision,
  type GovernanceResource,
  type Operation,
  type RoutingRestriction,
  type SecurityContext,
  type GovernanceRecorder,
  applyRoutingRestriction,
} from "../governance/index.js";
import { type RoutingCandidate } from "../../routing/router.js";

/** The decision an authorization produced, with the work it refused to allow. */
export interface AuthorizationOutcome {
  readonly decision: GovernanceDecision;
  /** True when execution may start now. */
  readonly permitted: boolean;
  /**
   * True when work must not proceed pending a human.
   *
   * Distinct from `!permitted` on purpose: a denial is FINAL and a pending
   * approval is BLOCKED. Conflating them makes a deployment retry a denial or
   * abandon an approval, and both are wrong.
   */
  readonly awaitingApproval: boolean;
  /** A class suitable for `#refuse`. Null when permitted. */
  readonly errorClass: "authorization_error" | "approval_required" | null;
  /** Non-secret, quotable reason for a refusal. */
  readonly reason: string;
}

/**
 * What the orchestrator depends on.
 *
 * A port, for the same reason `ModelRoutingPort` is one: a deployment with its own
 * authorization system satisfies this contract without the orchestrator learning
 * about it, and the orchestrator gains no ability to route, orchestrate or verify.
 */
export interface OrchestratorGovernancePort {
  authorize(input: {
    readonly context: SecurityContext;
    readonly operation: Operation;
    readonly resource?: GovernanceResource | null;
    readonly capability?: Capability | null;
    readonly jobId?: string | null;
    readonly taskId?: string | null;
    readonly executionId?: string | null;
    readonly policy?: string;
  }): AuthorizationOutcome;

  /**
   * Candidates governance wants removed. OPTIONAL.
   *
   * Contributions are subtracted from the candidate set BEFORE
   * `evaluateCandidate`. It may not reorder, may not add, and may not express a
   * preference - `RoutingRestriction` has no field through which it could.
   */
  narrowRouting?(context: SecurityContext, input: { readonly taskId: string | null }): RoutingRestriction | null;

  /**
   * Resolves the actor for a request that carried none. OPTIONAL.
   *
   * PHASE 03 (B-08): this is `GovernanceGate.resolve`, and it had no caller
   * anywhere in `src/` - `RuntimeOptions.identity.resolve` was documented as the
   * runtime's identity source and nothing ever consulted it, so identity on the
   * execution path was caller-asserted only. `enforcement.establishRequestIdentity`
   * is now the one call site, and it runs BEFORE authorization.
   *
   * Returning null means "this caller could not be identified", and the gate then
   * DEFAULT-DENIES. That is the safe reading: an unidentified caller is not an
   * authorised one, and guessing an actor would defeat the entire subsystem.
   */
  resolve?(input: {
    readonly taskId: string;
    readonly jobId: string | null;
    readonly traceId: string;
  }): SecurityContext | null;
}

export interface GovernanceGateOptions {
  /**
   * The one policy engine this gate answers from.
   *
   * PHASE 02: required, and no longer built here.
   *
   * The gate previously constructed its own `PolicyEngine` from `rules`. A
   * `GovernanceRecorder` cannot be given that engine, because it did not exist yet
   * when the gate was constructed - so any runtime that wired a recorder ended up
   * with TWO engines. And because the gate delegates every decision to the
   * recorder when one is present (`authorize` below), the engine it had built was
   * the one whose verdicts nothing ever saw. Two decision authorities, one of them
   * authoritative for nothing, is exactly the shape of defect this project exists
   * to remove, so the engine is now supplied and there is one.
   */
  readonly engine: PolicyEngine;
  readonly recorder?: GovernanceRecorder;
  readonly clock?: Clock;
  /**
   * Resolves the actor for a request.
   *
   * Returning null means "this caller could not be identified", and the gate
   * then DEFAULT-DENIES. That is the safe reading: an unidentified caller is not
   * an authorised one, and guessing an actor would defeat the entire subsystem.
   */
  readonly resolveContext: (input: {
    readonly taskId: string;
    readonly jobId: string | null;
    readonly traceId: string;
  }) => SecurityContext | null;
}

/**
 * The concrete gate.
 *
 * Deliberately thin. Every decision belongs to the `PolicyEngine` this holds; the
 * gate resolves WHO is asking, asks, and translates the answer into a shape the
 * orchestrator can refuse with. It holds no registry, so it cannot route, select,
 * plan, write memory or verify.
 */
export class GovernanceGate implements OrchestratorGovernancePort {
  readonly #engine: PolicyEngine;
  readonly #recorder: GovernanceRecorder | null;
  readonly #clock: Clock;
  readonly #resolveContext: GovernanceGateOptions["resolveContext"];
  readonly #restrictions: ReadonlyMap<string, RoutingRestriction>;

  public constructor(
    options: GovernanceGateOptions,
    restrictions: ReadonlyMap<string, RoutingRestriction> = new Map(),
  ) {
    this.#engine = options.engine;
    this.#clock = options.clock ?? systemClock;
    this.#recorder = options.recorder ?? null;
    this.#resolveContext = options.resolveContext;
    this.#restrictions = restrictions;
  }

  public authorize(input: {
    context: SecurityContext;
    operation: Operation;
    resource?: GovernanceResource | null;
    capability?: Capability | null;
    jobId?: string | null;
    taskId?: string | null;
    executionId?: string | null;
    policy?: string;
  }): AuthorizationOutcome {
    if (this.#recorder !== null) {
      const outcome = this.#recorder.authorize({
        context: input.context,
        operation: input.operation,
        ...(input.resource === undefined ? {} : { resource: input.resource }),
        ...(input.capability === undefined ? {} : { capability: input.capability }),
        ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        ...(input.policy === undefined ? {} : { policy: input.policy }),
      });
      return toOutcome(outcome.decision, outcome.permitted);
    }
    const decision = this.#engine.check({
      context: input.context,
      operation: input.operation,
      ...(input.resource === undefined ? {} : { resource: input.resource }),
      ...(input.capability === undefined ? {} : { capability: input.capability }),
      ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
      ...(input.policy === undefined ? {} : { policy: input.policy }),
    });
    return toOutcome(decision, decision.verdict === "ALLOW" || decision.verdict === "NOT_APPLICABLE");
  }

  /**
   * The engine's own most recent decision that REQUIRED an approval for a task.
   *
   * PHASE 03 (B-10). `bridgeApproval` needs a `GovernanceDecision` to turn into an
   * instruction, and the honest one to hand it is the decision governance actually
   * made - not a second evaluation, and not a decision the composition root
   * synthesised from an error code. The engine records every decision it makes, so
   * the answer is already there and is read rather than recomputed.
   *
   * Read-only, and scoped to the newest matching decision, because a stale
   * REQUIRE_APPROVAL from an earlier attempt must not be handed to the gate as if it
   * were this attempt's. Null means "no such decision", which the caller must read
   * as "I cannot open a gate" rather than as "no gate is needed".
   */
  public approvalRequiringFor(taskId: string): GovernanceDecision | null {
    const history = this.#engine.decisions();
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const decision = history[index];
      if (decision !== undefined && decision.verdict === "REQUIRE_APPROVAL" && decision.taskId === taskId) {
        return decision;
      }
    }
    return null;
  }

  public narrowRouting(
    _context: SecurityContext,
    input: { readonly taskId: string | null },
  ): RoutingRestriction | null {
    if (this.#restrictions.size === 0) {
      return null;
    }
    const perTask = input.taskId === null ? null : this.#restrictions.get(input.taskId);
    const global = this.#restrictions.get("*");
    if (perTask === null && global === null) {
      return null;
    }
    const merge = (a: RoutingRestriction | null, b: RoutingRestriction | null): RoutingRestriction | null => {
      if (a === null) return b;
      if (b === null) return a;
      return {
        deniedProviders: [...new Set([...a.deniedProviders, ...b.deniedProviders])],
        deniedModels: [...new Set([...a.deniedModels, ...b.deniedModels])],
        deniedProviderTypes: [...new Set([...a.deniedProviderTypes, ...b.deniedProviderTypes])],
        reason: `${a.reason}; ${b.reason}`,
        decidedBy: `${a.decidedBy}; ${b.decidedBy}`,
      };
    };
    return merge(global ?? null, perTask ?? null);
  }

  /** Resolves the actor for a request, or reports that nobody could be identified. */
  public resolve(input: { taskId: string; jobId: string | null; traceId: string }): SecurityContext | null {
    return this.#resolveContext(input);
  }

  public get engine(): PolicyEngine {
    return this.#engine;
  }

  public nowMs(): number {
    return this.#clock.nowMs();
  }
}

function toOutcome(decision: GovernanceDecision, permitted: boolean): AuthorizationOutcome {
  if (permitted) {
    return {
      decision,
      permitted: true,
      awaitingApproval: false,
      errorClass: null,
      reason: decision.reason,
    };
  }
  const awaitingApproval = decision.verdict === "REQUIRE_APPROVAL";
  return {
    decision,
    permitted: false,
    awaitingApproval,
    errorClass: awaitingApproval ? "approval_required" : "authorization_error",
    reason: decision.reason,
  };
}

/**
 * Applies a restriction to a candidate set.
 *
 * Re-exported here so the orchestrator imports ONE thing for governance rather
 * than reaching into `routing/` itself, and so the "narrowing only" contract is
 * stated where the narrowing happens.
 */
export { applyRoutingRestriction, type RoutingCandidate };
