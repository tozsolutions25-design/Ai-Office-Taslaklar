import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { ClassifiedError } from "../src/core/errors.js";
import {
  DEFAULT_BACKOFF,
  PERMANENT_ERROR_CLASSES,
  RetryExecutor,
  computeBackoffDelay,
  decideRetry,
  isRetryableUnder,
  validateRetryPolicy,
  type RetryPolicy,
} from "../src/retry/index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

const policy = (overrides: Partial<RetryPolicy> = {}): RetryPolicy => ({
  maxAttempts: 3,
  backoff: { kind: "fixed", baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0 },
  fallbackOnQuotaExhausted: true,
  ...overrides,
});

describe("backoff", () => {
  it("returns zero delay for the none policy", () => {
    assert.equal(computeBackoffDelay({ ...DEFAULT_BACKOFF, kind: "none" }, 1), 0);
  });

  it("computes a fixed delay independent of attempt number", () => {
    const fixed: RetryPolicy["backoff"] = { kind: "fixed", baseDelayMs: 200, maxDelayMs: 10_000, jitterRatio: 0 };
    assert.equal(computeBackoffDelay(fixed, 1), 200);
    assert.equal(computeBackoffDelay(fixed, 5), 200);
  });

  it("doubles the delay on each attempt for exponential backoff", () => {
    const exponential: RetryPolicy["backoff"] = { kind: "exponential", baseDelayMs: 100, maxDelayMs: 100_000, jitterRatio: 0 };
    assert.equal(computeBackoffDelay(exponential, 1), 100);
    assert.equal(computeBackoffDelay(exponential, 2), 200);
    assert.equal(computeBackoffDelay(exponential, 3), 400);
    assert.equal(computeBackoffDelay(exponential, 4), 800);
  });

  it("caps the delay at maxDelayMs", () => {
    const exponential: RetryPolicy["backoff"] = { kind: "exponential", baseDelayMs: 1_000, maxDelayMs: 2_500, jitterRatio: 0 };
    assert.equal(computeBackoffDelay(exponential, 10), 2_500);
  });

  it("applies symmetric jitter within the configured ratio", () => {
    const jittered: RetryPolicy["backoff"] = { kind: "fixed", baseDelayMs: 1_000, maxDelayMs: 10_000, jitterRatio: 0.5 };
    assert.equal(computeBackoffDelay(jittered, 1, () => 0), 500);
    assert.equal(computeBackoffDelay(jittered, 1, () => 1), 1_500);
    assert.equal(computeBackoffDelay(jittered, 1, () => 0.5), 1_000);
  });
});

describe("retry policy validation", () => {
  it("accepts a valid policy", () => {
    assert.deepEqual(validateRetryPolicy(policy()), []);
  });

  it("rejects a zero or negative attempt count", () => {
    assert.ok(validateRetryPolicy(policy({ maxAttempts: 0 })).length > 0);
    assert.ok(validateRetryPolicy(policy({ maxAttempts: -1 })).length > 0);
  });

  it("rejects an unbounded attempt count", () => {
    const issues = validateRetryPolicy(policy({ maxAttempts: 10_000 }));
    assert.ok(issues.some((issue) => /exceed 100/.test(issue)));
  });

  it("rejects a max delay below the base delay", () => {
    const issues = validateRetryPolicy(
      policy({ backoff: { kind: "fixed", baseDelayMs: 5_000, maxDelayMs: 10, jitterRatio: 0 } }),
    );
    assert.ok(issues.some((issue) => /maxDelayMs/.test(issue)));
  });

  it("rejects an out-of-range jitter ratio", () => {
    const issues = validateRetryPolicy(
      policy({ backoff: { kind: "fixed", baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 2 } }),
    );
    assert.ok(issues.some((issue) => /jitterRatio/.test(issue)));
  });

  it("rejects configuring a permanent class as retryable", () => {
    for (const errorClass of PERMANENT_ERROR_CLASSES) {
      const issues = validateRetryPolicy(policy({ retryableClasses: [errorClass] }));
      assert.ok(issues.length > 0, `${errorClass} must not be configurable as retryable`);
    }
  });
});

describe("retryable classification", () => {
  it("treats transient classes as retryable", () => {
    for (const errorClass of ["timeout", "transient_provider_failure", "rate_limit", "temporary_outage"] as const) {
      assert.equal(isRetryableUnder(policy(), errorClass), true, `${errorClass} should be retryable`);
    }
  });

  it("never treats a permanent class as retryable, even if configured", () => {
    for (const errorClass of PERMANENT_ERROR_CLASSES) {
      assert.equal(isRetryableUnder(policy(), errorClass), false, `${errorClass} must never retry`);
      assert.equal(
        isRetryableUnder(policy({ retryableClasses: ["timeout"] }), errorClass),
        false,
      );
    }
  });

  it("treats an unclassified error as non-retryable by default", () => {
    assert.equal(isRetryableUnder(policy(), "unknown"), false);
  });
});

describe("retry decision", () => {
  it("schedules a retry while attempts remain", () => {
    const decision = decideRetry(policy(), "timeout", 1);
    assert.equal(decision.action, "retry");
    if (decision.action !== "retry") return;
    assert.equal(decision.attempt, 2);
    assert.equal(decision.delayMs, 100);
  });

  it("fails once the attempt budget is spent", () => {
    const decision = decideRetry(policy(), "timeout", 3);
    assert.deepEqual(decision, { action: "fail", reason: "attempts_exhausted" });
  });

  it("fails immediately on a permanent error without consuming attempts", () => {
    const decision = decideRetry(policy(), "authentication_failure", 1);
    assert.deepEqual(decision, { action: "fail", reason: "permanent_error" });
  });

  it("escalates quota exhaustion to fallback", () => {
    const decision = decideRetry(policy(), "quota_exhausted", 1);
    assert.deepEqual(decision, { action: "fallback", reason: "quota_exhausted" });
  });

  it("retries quota exhaustion when fallback is disabled", () => {
    const decision = decideRetry(policy({ fallbackOnQuotaExhausted: false }), "quota_exhausted", 1);
    assert.equal(decision.action, "retry");
  });
});

describe("retry executor", () => {
  it("succeeds on the first attempt without sleeping", async () => {
    const clock = new ManualClock(NOW);
    const executor = new RetryExecutor({ policy: policy(), clock });
    let calls = 0;
    const outcome = await executor.execute(async () => {
      calls += 1;
      return "done";
    });
    assert.equal(outcome.succeeded, true);
    assert.equal(outcome.value, "done");
    assert.equal(outcome.attempts, 1);
    assert.equal(calls, 1);
    assert.deepEqual(clock.recordedSleeps, []);
  });

  it("retries a retryable failure and succeeds", async () => {
    const clock = new ManualClock(NOW);
    const executor = new RetryExecutor({ policy: policy(), clock });
    let calls = 0;
    const outcome = await executor.execute(async () => {
      calls += 1;
      if (calls < 3) {
        throw new ClassifiedError("timeout", "timed out");
      }
      return "recovered";
    });
    assert.equal(outcome.succeeded, true);
    assert.equal(outcome.value, "recovered");
    assert.equal(outcome.attempts, 3);
    assert.deepEqual(clock.recordedSleeps, [100, 100], "backoff must be applied between attempts");
  });

  it("gives up immediately on an authentication failure", async () => {
    const clock = new ManualClock(NOW);
    const executor = new RetryExecutor({ policy: policy(), clock });
    let calls = 0;
    const outcome = await executor.execute(async () => {
      calls += 1;
      throw new ClassifiedError("authentication_failure", "bad key");
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(calls, 1, "a permanent failure must not be retried");
    assert.equal(outcome.errorClass, "authentication_failure");
    assert.equal(outcome.finalAction, "permanent_failure");
    assert.deepEqual(clock.recordedSleeps, []);
  });

  it("stops at the maximum attempt count", async () => {
    const clock = new ManualClock(NOW);
    const executor = new RetryExecutor({ policy: policy({ maxAttempts: 2 }), clock });
    let calls = 0;
    const outcome = await executor.execute(async () => {
      calls += 1;
      throw new ClassifiedError("transient_provider_failure", "flaky");
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(calls, 2);
    assert.equal(outcome.attempts, 2);
    assert.equal(outcome.finalAction, "exhausted");
  });

  it("terminates for a policy allowing a large attempt budget", async () => {
    const clock = new ManualClock(NOW);
    const executor = new RetryExecutor({ policy: policy({ maxAttempts: 6 }), clock });
    let calls = 0;
    const outcome = await executor.execute(async () => {
      calls += 1;
      throw new ClassifiedError("timeout", "always times out");
    });
    assert.equal(calls, 6, "the loop must be strictly bounded");
    assert.equal(outcome.succeeded, false);
  });

  it("uses a fallback when quota is exhausted", async () => {
    const clock = new ManualClock(NOW);
    const executor = new RetryExecutor({ policy: policy(), clock });
    let primaryCalls = 0;
    const outcome = await executor.execute(
      async () => {
        primaryCalls += 1;
        throw new ClassifiedError("quota_exhausted", "no quota");
      },
      { fallback: () => Promise.resolve("from-fallback") },
    );
    assert.equal(outcome.succeeded, true);
    assert.equal(outcome.value, "from-fallback");
    assert.equal(outcome.finalAction, "fallback_required");
    assert.equal(primaryCalls, 1, "the exhausted provider must not be retried");
  });

  it("fails when the fallback selector returns nothing", async () => {
    const clock = new ManualClock(NOW);
    const executor = new RetryExecutor({ policy: policy(), clock });
    const outcome = await executor.execute(
      async () => {
        throw new ClassifiedError("quota_exhausted", "no quota");
      },
      { fallback: () => null },
    );
    assert.equal(outcome.succeeded, false);
  });

  it("records an attempt-failure history with classifications", async () => {
    const clock = new ManualClock(NOW);
    const seen: string[] = [];
    const executor = new RetryExecutor({
      policy: policy({ maxAttempts: 2 }),
      clock,
      onAttemptFailed: (record) => seen.push(record.errorClass),
    });
    await executor.execute(async () => {
      throw new ClassifiedError("rate_limit", "slow down");
    });
    assert.deepEqual(seen, ["rate_limit", "rate_limit"]);
  });

  it("treats an unclassified throw as a non-retryable unknown", async () => {
    const clock = new ManualClock(NOW);
    const executor = new RetryExecutor({ policy: policy(), clock });
    let calls = 0;
    const outcome = await executor.execute(async () => {
      calls += 1;
      throw new Error("something unexpected");
    });
    assert.equal(calls, 1);
    assert.equal(outcome.errorClass, "unknown");
    assert.equal(outcome.succeeded, false);
  });

  it("applies exponential backoff across retries", async () => {
    const clock = new ManualClock(NOW);
    const executor = new RetryExecutor({
      policy: policy({
        maxAttempts: 4,
        backoff: { kind: "exponential", baseDelayMs: 100, maxDelayMs: 10_000, jitterRatio: 0 },
      }),
      clock,
    });
    await executor.execute(async () => {
      throw new ClassifiedError("timeout", "t");
    });
    assert.deepEqual(clock.recordedSleeps, [100, 200, 400]);
  });
});
