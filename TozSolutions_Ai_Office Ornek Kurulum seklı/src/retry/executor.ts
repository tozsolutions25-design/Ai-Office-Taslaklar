import { type Clock, systemClock } from "../core/clock.js";
import { type ErrorClass, isErrorClass } from "../core/errors.js";
import { type RetryPolicy, decideRetry } from "./policy.js";

/**
 * Retry executor.
 *
 * The executor owns the attempt loop; the policy owns the decision. That split
 * keeps the termination guarantee in one pure function (`decideRetry`) that is
 * exhaustively testable, and keeps the async plumbing thin.
 */

export interface AttemptRecord {
  readonly attempt: number;
  readonly errorClass: ErrorClass;
  readonly message: string;
  readonly at: Date;
  readonly delayBeforeNextMs: number;
}

export interface ExecutionAttemptOutcome<T> {
  readonly succeeded: boolean;
  readonly value: T | null;
  readonly errorClass: ErrorClass | null;
  readonly message: string | null;
  readonly attempts: number;
  readonly history: readonly AttemptRecord[];
  readonly finalAction: "completed" | "exhausted" | "permanent_failure" | "fallback_required";
}

export interface RetryExecutorOptions {
  readonly policy: RetryPolicy;
  readonly clock?: Clock;
  /** Injected for deterministic backoff tests. */
  readonly random?: () => number;
  /** Invoked after every failed attempt. Must not throw. */
  readonly onAttemptFailed?: (record: AttemptRecord) => void;
}

export type FallbackSelector<T> = (errorClass: ErrorClass) => Promise<T | null> | T | null;

export class RetryExecutor {
  readonly #policy: RetryPolicy;
  readonly #clock: Clock;
  readonly #random: () => number;
  readonly #onAttemptFailed: ((record: AttemptRecord) => void) | undefined;

  public constructor(options: RetryExecutorOptions) {
    this.#policy = options.policy;
    this.#clock = options.clock ?? systemClock;
    this.#random = options.random ?? Math.random;
    this.#onAttemptFailed = options.onAttemptFailed;
  }

  /**
   * Runs `operation` under the retry policy.
   *
   * The loop is bounded by `policy.maxAttempts`, which is itself validated to
   * be within 1..100. There is no path that retries indefinitely.
   */
  public async execute<T>(
    operation: (attempt: number) => Promise<T>,
    options: { fallback?: FallbackSelector<T> } = {},
  ): Promise<ExecutionAttemptOutcome<T>> {
    const history: AttemptRecord[] = [];
    let attempts = 0;

    for (;;) {
      attempts += 1;
      try {
        const value = await operation(attempts);
        return {
          succeeded: true,
          value,
          errorClass: null,
          message: null,
          attempts,
          history,
          finalAction: "completed",
        };
      } catch (error) {
        const errorClass = toErrorClass(error);
        const message = toMessage(error);
        const decision = decideRetry(this.#policy, errorClass, attempts, this.#random);

        if (decision.action === "retry") {
          const record: AttemptRecord = {
            attempt: attempts,
            errorClass,
            message,
            at: this.#clock.now(),
            delayBeforeNextMs: decision.delayMs,
          };
          history.push(record);
          this.#onAttemptFailed?.(record);
          if (decision.delayMs > 0) {
            await this.#clock.sleep(decision.delayMs);
          }
          continue;
        }

        const record: AttemptRecord = {
          attempt: attempts,
          errorClass,
          message,
          at: this.#clock.now(),
          delayBeforeNextMs: 0,
        };
        history.push(record);
        this.#onAttemptFailed?.(record);

        if (decision.action === "fallback" && options.fallback) {
          const fallbackValue = await options.fallback(errorClass);
          if (fallbackValue !== null && fallbackValue !== undefined) {
            return {
              succeeded: true,
              value: fallbackValue,
              errorClass: null,
              message: null,
              attempts,
              history,
              finalAction: "fallback_required",
            };
          }
        }

        return {
          succeeded: false,
          value: null,
          errorClass,
          message,
          attempts,
          history,
          finalAction: decision.reason === "attempts_exhausted" ? "exhausted" : "permanent_failure",
        };
      }
    }
  }
}

/** Normalizes any thrown value into the core error taxonomy. */
export function toErrorClass(error: unknown): ErrorClass {
  if (typeof error === "object" && error !== null && "errorClass" in error) {
    const candidate = (error).errorClass;
    if (isErrorClass(candidate)) {
      return candidate;
    }
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "timeout";
  }
  return "unknown";
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
