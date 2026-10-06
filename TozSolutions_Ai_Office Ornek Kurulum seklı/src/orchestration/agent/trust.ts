/**
 * Agent trust and policy primitives.
 *
 * Split out from `record.ts` so both the record and the adapter contract can
 * depend on the trust vocabulary without depending on each other.
 *
 * Trust is a GATE, not a score. It answers "may this agent be selected for this
 * work", never "how good is this agent". Those are different questions, and
 * conflating them is how an untrusted integration ends up running privileged
 * work.
 */

export const TRUST_LEVELS = ["untrusted", "low", "standard", "high", "privileged"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

const TRUST_ORDER: Readonly<Record<TrustLevel, number>> = {
  untrusted: 0,
  low: 1,
  standard: 2,
  high: 3,
  privileged: 4,
};

export function trustRank(level: TrustLevel): number {
  return TRUST_ORDER[level];
}

/** True when `level` is at or above `floor`. */
export function meetsTrustFloor(level: TrustLevel, floor: TrustLevel): boolean {
  return TRUST_ORDER[level] >= TRUST_ORDER[floor];
}

/** Latency class, derived from measurement once a measurement exists. */
export const AGENT_LATENCY_CLASSES = ["realtime", "fast", "standard", "slow", "unknown"] as const;
export type AgentLatencyClass = (typeof AGENT_LATENCY_CLASSES)[number];

/**
 * PHASE 08: `AgentTrustRequirement` and `DEFAULT_TRUST_REQUIREMENT` were REMOVED.
 *
 * They were declared here and referenced by nothing in `src/` or in any test - only
 * re-exported, which propagates a declaration rather than calling it. `DEFAULT_TRUST_
 * REQUIREMENT` was a constant named "the default" that no default used, and the type it
 * belonged to described a requirement no caller could express.
 *
 * `requireFreshHealth` is the part worth recording. It was not impossible: `HealthObservation
 * .observedAt` exists, `null` means never observed, so a freshness rule has the data it
 * would need. It was unimplemented because nobody has decided what counts as stale or over
 * what window - and that is a policy decision, not a missing line. PHASE 07 removed
 * `duplicate_of_recent` from `POLICY_RULES` for the same reason (D-53): implementable is not
 * the same as decided.
 *
 * If freshness is wanted it should arrive as a requirement with a window attached. The
 * enforcement that actually exists is untouched by this removal: the pool refuses a
 * candidate below the requested floor (`trust_below_floor`), and governance enforces a
 * floor independently through `meetsTrustFloor`.
 */

/** Relative cost class. Never a monetary figure for a specific agent. */
export const AGENT_COST_CLASSES = ["free", "low", "standard", "premium", "unknown"] as const;
export type AgentCostClass = (typeof AGENT_COST_CLASSES)[number];

const COST_ORDER: Readonly<Record<AgentCostClass, number>> = {
  free: 0,
  low: 1,
  standard: 2,
  premium: 3,
  // Unknown is ranked last: an unmeasured agent must not be treated as cheap.
  unknown: 4,
};

export function costRank(costClass: AgentCostClass): number {
  return COST_ORDER[costClass];
}
