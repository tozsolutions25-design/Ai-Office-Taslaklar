import type { CapabilitySet } from "./capability.js";
import { type Capability, type CapabilityStatus, CAPABILITIES } from "./capability.js";

/**
 * Deterministic capability matching.
 *
 * Pure function. No I/O, no clock, no randomness — the same inputs always
 * produce the same verdict, which makes it independently testable and
 * safe to run inside the routing hot path.
 */

export const MATCH_VERDICTS = ["compatible", "incompatible", "unknown"] as const;
export type MatchVerdict = (typeof MATCH_VERDICTS)[number];

/** Why a candidate was rejected, or why it could not be judged. */
export interface CapabilityGap {
  readonly capability: Capability;
  readonly actual: CapabilityStatus;
  readonly required: true;
}

export interface CapabilityMatch {
  readonly verdict: MatchVerdict;
  /** Missing requirements, each with the observed status that caused the gap. */
  readonly gaps: readonly CapabilityGap[];
  /** Requirements positively satisfied. */
  readonly satisfied: readonly Capability[];
}

const COMPATIBLE: MatchVerdict = "compatible";
const INCOMPATIBLE: MatchVerdict = "incompatible";
const UNKNOWN: MatchVerdict = "unknown";

/**
 * Matches a set of required capabilities against an observed profile.
 *
 * Decision order is fixed and documented:
 *   1. Any `unsupported` requirement  -> incompatible.
 *   2. Any `unknown` requirement      -> unknown (needs verification).
 *   3. Otherwise                      -> compatible.
 *
 * `unknown` is never promoted to `supported`. Callers that require certainty
 * must treat the `unknown` verdict as a non-match.
 */
export function matchCapabilities(
  required: readonly Capability[],
  actual: CapabilitySet,
): CapabilityMatch {
  const gaps: CapabilityGap[] = [];
  const satisfied: Capability[] = [];
  let hasUnknown = false;
  let hasUnsupported = false;

  for (const capability of required) {
    const status = actual.statusOf(capability);
    if (status === "supported") {
      satisfied.push(capability);
    } else {
      gaps.push({ capability, actual: status, required: true });
      if (status === "unknown") {
        hasUnknown = true;
      } else {
        hasUnsupported = true;
      }
    }
  }

  // A definite failure outranks an unverified gap.
  const verdict: MatchVerdict = hasUnsupported
    ? INCOMPATIBLE
    : hasUnknown
      ? UNKNOWN
      : COMPATIBLE;
  return { verdict, gaps, satisfied };
}

/** True only for a definite `compatible` verdict. */
export function isStrictlyCompatible(match: CapabilityMatch): boolean {
  return match.verdict === COMPATIBLE;
}

/**
 * A stricter policy for callers that cannot tolerate unverified capability:
 * an `unknown` verdict is treated as a rejection.
 */
export function matchCapabilitiesRequiringCertainty(
  required: readonly Capability[],
  actual: CapabilitySet,
): MatchVerdict {
  const { verdict } = matchCapabilities(required, actual);
  return verdict === UNKNOWN ? INCOMPATIBLE : verdict;
}

/** Convenience: capabilities that are still unverified on a profile. */
export function unverifiedCapabilities(actual: CapabilitySet): Capability[] {
  return CAPABILITIES.filter((capability: Capability) => actual.isUnknown(capability));
}
