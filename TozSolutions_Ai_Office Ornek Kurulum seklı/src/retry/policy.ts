import { type ErrorClass, isRetryableErrorClass } from "../core/errors.js";

/**
 * Backoff policy.
 *
 * Jitter is a configurable fraction of the computed delay. With the default of
 * 0 the delay is fully deterministic, which is what makes the retry tests
 * reproducible; production deployments should set a non-zero value.
 */

export const BACKOFF_KINDS = ["none", "fixed", "exponential"] as const;
export type BackoffKind = (typeof BACKOFF_KINDS)[number];

export interface BackoffPolicy {
  readonly kind: BackoffKind;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** 0 = deterministic, 0.2 = up to 20% random. */
  readonly jitterRatio: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  kind: "exponential",
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitterRatio: 0,
};

/**
 * Delay before the given attempt number (1-based attempt that just failed).
 * Pure: no clock, no randomness beyond the injected source.
 */
export function computeBackoffDelay(
  policy: BackoffPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  if (policy.kind === "none" || attempt < 1) {
    return 0;
  }
  const raw =
    policy.kind === "fixed"
      ? policy.baseDelayMs
      : policy.baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(raw, policy.maxDelayMs);
  if (policy.jitterRatio <= 0) {
    return capped;
  }
  const jitterSpan = capped * policy.jitterRatio;
  const offset = (random() * 2 - 1) * jitterSpan;
  return Math.max(0, Math.round(capped + offset));
}

export const RETRYABLE_ERROR_CLASSES: readonly ErrorClass[] = [
  "timeout",
  "transient_provider_failure",
  "rate_limit",
  "quota_exhausted",
  "temporary_outage",
];

/**
 * Permanent classes. Listed explicitly so a permanent configuration mistake
 * can never be retried indefinitely.
 */
export const PERMANENT_ERROR_CLASSES: readonly ErrorClass[] = [
  "invalid_model",
  "authentication_failure",
  "configuration_error",
  "invalid_request",
  // PHASE 09. An authorization refusal and an outstanding approval are both
  // permanent: retrying either is a loop, not a recovery. Listed explicitly so a
  // future `isRetryableErrorClass` change cannot quietly make them retryable.
  "authorization_error",
  "approval_required",
];

export interface RetryPolicy {
  /** Total attempts including the first. Must be >= 1. */
  readonly maxAttempts: number;
  readonly backoff: BackoffPolicy;
  /**
   * Classes eligible for retry. When undefined, the built-in default table
   * applies. `unknown` is retryable only if explicitly listed here.
   */
  readonly retryableClasses?: readonly ErrorClass[];
  /**
   * When true, quota exhaustion escalates to a fallback candidate instead of
   * consuming the remaining attempts against the same provider.
   */
  readonly fallbackOnQuotaExhausted: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoff: DEFAULT_BACKOFF,
  fallbackOnQuotaExhausted: true,
};

export function validateRetryPolicy(policy: RetryPolicy): readonly string[] {
  const issues: string[] = [];
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    issues.push("retry.maxAttempts must be an integer >= 1");
  }
  if (policy.maxAttempts > 100) {
    // A hard ceiling makes an infinite-retry bug impossible by construction.
    issues.push("retry.maxAttempts must not exceed 100");
  }
  if (!(BACKOFF_KINDS as readonly string[]).includes(policy.backoff.kind)) {
    issues.push(`retry.backoff.kind must be one of: ${BACKOFF_KINDS.join(", ")}`);
  }
  if (policy.backoff.baseDelayMs < 0) {
    issues.push("retry.backoff.baseDelayMs must be >= 0");
  }
  if (policy.backoff.maxDelayMs < policy.backoff.baseDelayMs) {
    issues.push("retry.backoff.maxDelayMs must be >= baseDelayMs");
  }
  if (policy.backoff.jitterRatio < 0 || policy.backoff.jitterRatio > 1) {
    issues.push("retry.backoff.jitterRatio must be between 0 and 1");
  }
  if (policy.retryableClasses !== undefined) {
    for (const errorClass of policy.retryableClasses) {
      if (PERMANENT_ERROR_CLASSES.includes(errorClass)) {
        issues.push(`retry.retryableClasses must not include permanent class: ${errorClass}`);
      }
    }
  }
  return issues;
}

/** Decides whether an error class is retryable under a policy. */
export function isRetryableUnder(
  policy: RetryPolicy,
  errorClass: ErrorClass,
): boolean {
  if (PERMANENT_ERROR_CLASSES.includes(errorClass)) {
    // Permanent classes are never retryable, regardless of configuration.
    return false;
  }
  if (policy.retryableClasses !== undefined) {
    return policy.retryableClasses.includes(errorClass);
  }
  return isRetryableErrorClass(errorClass);
}

export type RetryDecision =
  | { readonly action: "retry"; readonly attempt: number; readonly delayMs: number }
  | { readonly action: "fallback"; readonly reason: "quota_exhausted" }
  | { readonly action: "fail"; readonly reason: "permanent_error" | "attempts_exhausted" | "not_retryable" };

/**
 * Decides what to do after a failed attempt. Pure and total: given the same
 * inputs it always returns the same decision, which is what guarantees the
 * executor terminates.
 */
export function decideRetry(
  policy: RetryPolicy,
  errorClass: ErrorClass,
  attemptsUsed: number,
  random: () => number = Math.random,
): RetryDecision {
  if (!isRetryableUnder(policy, errorClass)) {
    return { action: "fail", reason: isRetryableErrorClass(errorClass) ? "not_retryable" : "permanent_error" };
  }
  if (policy.fallbackOnQuotaExhausted && errorClass === "quota_exhausted") {
    return { action: "fallback", reason: "quota_exhausted" };
  }
  if (attemptsUsed >= policy.maxAttempts) {
    return { action: "fail", reason: "attempts_exhausted" };
  }
  return {
    action: "retry",
    attempt: attemptsUsed + 1,
    delayMs: computeBackoffDelay(policy.backoff, attemptsUsed, random),
  };
}
