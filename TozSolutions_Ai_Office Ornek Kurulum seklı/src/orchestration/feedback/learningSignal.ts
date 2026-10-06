/**
 * Learning signals.
 *
 * LEARNING IS NOT MEMORY. Memory stores facts about the world (§ memory).
 * Learning stores facts about US: what worked, what did not, and what to try
 * next. They are separate types, separate stores, and this file must never read
 * memory - a learning signal derived from a memory read would be a claim about
 * the world being mistaken for a claim about our own performance.
 *
 * WHY THIS IS OPT-IN AND TINY.
 *
 * PHASE 04 deliberately did not feed outcomes back into selection, and that
 * decision stands. A self-modifying selection policy that nobody can explain is
 * the failure this architecture exists to avoid. So the signal here:
 *
 *   - is OFF unless a caller supplies a source
 *   - is used ONLY as a tiebreaker, after every recorded fact has been compared
 *   - can NEVER make an ineligible agent eligible
 *   - requires a minimum sample count, so one lucky run is not a signal
 *   - reports null rather than a number when nothing has been measured
 *
 * A signal that cannot explain itself, or that changes eligibility, is not a
 * learning signal. It is an oracle.
 */

import { type FeedbackStore } from "./feedback.js";

/** What has been observed about one agent. */
export interface LearningSignal {
  readonly agentId: string;
  /** Completed executions. Below the minimum, this signal is not used. */
  readonly samples: number;
  /** Outcomes that succeeded, 0..1. null when nothing was measured. */
  readonly successRate: number | null;
  /** Verified passes over verified runs, 0..1. null when nothing was verified. */
  readonly verifiedPassRate: number | null;
}

/**
 * Supplies learning signals.
 *
 * A port, so a caller can source signals from a feedback store, a metrics
 * pipeline, or a hand-maintained table without the pool knowing which.
 */
export interface LearningSignalSource {
  /** The signal for one agent, or null when there is nothing to say. */
  signalFor(agentId: string): LearningSignal | null;
}

export interface FeedbackLearningOptions {
  /**
   * Observations required before a signal may be used at all.
   *
   * Default 5. With fewer, the rate is dominated by a single run, and preferring
   * an agent because it once succeeded is superstition, not learning.
   */
  readonly minimumSamples?: number;
  /** When true, no signal is ever produced. The default. */
  readonly enabled?: boolean;
}

/**
 * Learning signals derived from recorded outcomes.
 *
 * Reads `FeedbackStore` and nothing else. There is no memory reference anywhere
 * in this file, by design.
 */
export class FeedbackLearningSource implements LearningSignalSource {
  readonly #store: FeedbackStore;
  readonly #minimumSamples: number;
  readonly #enabled: boolean;

  public constructor(store: FeedbackStore, options: FeedbackLearningOptions = {}) {
    this.#store = store;
    this.#minimumSamples = options.minimumSamples ?? 5;
    this.#enabled = options.enabled ?? false;
  }

  public get enabled(): boolean {
    return this.#enabled;
  }

  public signalFor(agentId: string): LearningSignal | null {
    if (!this.#enabled) {
      return null;
    }
    const records = this.#store.forAgent(agentId);
    if (records.length < this.#minimumSamples) {
      // Below the threshold, the honest answer is "not enough has happened yet".
      return null;
    }
    return {
      agentId,
      samples: records.length,
      successRate: records.filter((record) => record.outcome === "succeeded").length / records.length,
      verifiedPassRate: summariseVerified(records),
    };
  }
}

function summariseVerified(
  records: ReturnType<FeedbackStore["forAgent"]>,
): number | null {
  const verified = records.filter((record) => record.verificationVerdict !== null);
  if (verified.length === 0) {
    return null;
  }
  return verified.filter((record) => record.verificationVerdict === "pass").length / verified.length;
}

/**
 * The signal's contribution to a ranking, as an integer.
 *
 * Returns 0 for "no signal" and 0 for "no difference", so a caller that forgets
 * to check for a signal gets the deterministic behaviour rather than a surprise.
 * The scale is deliberately coarse: a learning signal is a tiebreaker, and a
 * fine-grained score would let it outweigh the recorded facts it sits beside.
 */
export function signalWeight(signal: LearningSignal | null): number {
  if (signal === null) {
    return 0;
  }
  // Verified outcomes outrank unverified ones, and a verified-pass rate of 0.5
  // contributes nothing either way.
  const verified = signal.verifiedPassRate === null ? 0.5 : signal.verifiedPassRate;
  const success = signal.successRate ?? 0.5;
  return Math.round((verified * 0.7 + success * 0.3 - 0.5) * 20);
}
