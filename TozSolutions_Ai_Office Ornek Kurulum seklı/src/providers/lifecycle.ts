/**
 * Provider lifecycle.
 *
 *   DISCOVER -> VERIFY -> PROBE -> CLASSIFY -> HUMAN_APPROVAL
 *            -> REGISTER -> HEALTH_MONITOR -> PRODUCTION_POOL
 *
 * Transitions are explicit and controlled. A state may only advance along a
 * declared edge; anything else is a programmer error and throws.
 */

import { InvalidTransitionError } from "../core/errors.js";

export const LIFECYCLE_STATES = [
  "discovered",
  "verified",
  "probed",
  "classified",
  "awaiting_approval",
  "approved",
  "rejected",
  "registered",
  "health_monitored",
  "production_pool",
  "retired",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === "string" && (LIFECYCLE_STATES as readonly string[]).includes(value);
}

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === "string" && (APPROVAL_STATUSES as readonly string[]).includes(value);
}

/** Declared legal edges. Absence of an edge means the transition is illegal. */
const TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  discovered: ["verified", "rejected", "retired"],
  verified: ["probed", "rejected", "retired"],
  probed: ["classified", "rejected", "retired"],
  classified: ["awaiting_approval", "rejected", "retired"],
  awaiting_approval: ["approved", "rejected", "retired"],
  approved: ["registered", "retired"],
  // A rejected provider may be re-verified if the rejection reason is fixed.
  rejected: ["discovered", "retired"],
  registered: ["health_monitored", "retired"],
  health_monitored: ["production_pool", "registered", "retired"],
  production_pool: ["health_monitored", "retired"],
  retired: [],
};

/** States from which a provider may not move again. */
export const TERMINAL_STATES: readonly LifecycleState[] = ["retired"];

export function allowedTransitions(from: LifecycleState): readonly LifecycleState[] {
  return TRANSITIONS[from];
}

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError("lifecycle", from, to);
  }
}

/** Only a production-pool provider may receive production traffic. */
export function isProductionEligible(state: LifecycleState, enabled: boolean, approvalStatus: ApprovalStatus): boolean {
  return state === "production_pool" && enabled && approvalStatus === "approved";
}

/** Tracks one provider's lifecycle position. */
export class ProviderLifecycle {
  #state: LifecycleState;
  #approvalStatus: ApprovalStatus;
  readonly #history: Array<{ from: LifecycleState; to: LifecycleState }> = [];

  public constructor(
    initial: LifecycleState = "discovered",
    approvalStatus: ApprovalStatus = "pending",
  ) {
    this.#state = initial;
    this.#approvalStatus = approvalStatus;
  }

  public get state(): LifecycleState {
    return this.#state;
  }

  public get approvalStatus(): ApprovalStatus {
    return this.#approvalStatus;
  }

  public get history(): ReadonlyArray<{ from: LifecycleState; to: LifecycleState }> {
    return this.#history;
  }

  public canTransitionTo(to: LifecycleState): boolean {
    return canTransition(this.#state, to);
  }

  public transitionTo(to: LifecycleState): void {
    assertTransition(this.#state, to);
    const from = this.#state;
    this.#state = to;
    if (to === "approved") {
      this.#approvalStatus = "approved";
    } else if (to === "rejected") {
      this.#approvalStatus = "rejected";
    }
    this.#history.push({ from, to });
  }

  /** A transition that returns a Result instead of throwing. */
  public tryTransitionTo(to: LifecycleState): { ok: true } | { ok: false; error: InvalidTransitionError } {
    if (!canTransition(this.#state, to)) {
      return { ok: false, error: new InvalidTransitionError("lifecycle", this.#state, to) };
    }
    this.transitionTo(to);
    return { ok: true };
  }
}
