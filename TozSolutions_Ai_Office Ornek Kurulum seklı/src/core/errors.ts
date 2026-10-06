/**
 * Canonical error classification.
 *
 * This taxonomy is the single vocabulary shared by the retry policy, the
 * failover logic, the health model and the audit log. It is intentionally
 * provider-agnostic: a provider adapter translates its own transport errors
 * into one of these classes at the boundary, so provider-specific error
 * shapes never leak into the core.
 */

export const ERROR_CLASSES = [
  /** The call did not complete within its deadline. */
  "timeout",
  /** Provider reachable but failed in a way that may succeed on retry. */
  "transient_provider_failure",
  /** Provider rejected the request due to request-rate limits. */
  "rate_limit",
  /** Provider account/plan quota is exhausted. */
  "quota_exhausted",
  /** Provider is temporarily down or in maintenance. */
  "temporary_outage",
  /** The requested model does not exist or is not served. */
  "invalid_model",
  /** Credentials missing, malformed, or rejected. */
  "authentication_failure",
  /** Local configuration is wrong (bad endpoint, bad secret reference). */
  "configuration_error",
  /** Input rejected by the provider for content or schema reasons. */
  "invalid_request",
  /**
   * PHASE 09. The actor is not permitted to perform the operation.
   *
   * Added because an authorization refusal previously had to be reported as
   * `configuration_error` or `invalid_request`, both of which describe a
   * MISTAKE rather than a DECISION. A denial is neither: it is the correct
   * outcome of a correct request, and an operator reading a run needs to be able
   * to tell "this is broken" from "this was refused on purpose".
   *
   * Permanent and non-retryable. Retrying an authorization refusal is exactly
   * the loop this class exists to stop.
   */
  "authorization_error",
  /**
   * PHASE 09. An approval is required and has not been granted.
   *
   * Distinct from `authorization_error` because the remedy differs: a denial is
   * final, while this is blocked pending a decision at the PHASE 07 gate.
   */
  "approval_required",
  /** Could not classify. Treated as non-retryable by default (fail safe). */
  "unknown",
] as const;

export type ErrorClass = (typeof ERROR_CLASSES)[number];

export function isErrorClass(value: unknown): value is ErrorClass {
  return typeof value === "string" && (ERROR_CLASSES as readonly string[]).includes(value);
}

/**
 * Retryability is a property of the error class, not of the provider.
 *
 * Permanent classes are listed explicitly so that an authentication or
 * configuration mistake can never be retried into an infinite loop.
 */
const RETRYABLE_BY_DEFAULT: ReadonlySet<ErrorClass> = new Set<ErrorClass>([
  "timeout",
  "transient_provider_failure",
  "rate_limit",
  "quota_exhausted",
  "temporary_outage",
]);

export function isRetryableErrorClass(errorClass: ErrorClass): boolean {
  return RETRYABLE_BY_DEFAULT.has(errorClass);
}

/** An error that has been classified and is safe to move through the core. */
export class ClassifiedError extends Error {
  public readonly errorClass: ErrorClass;
  public readonly retryable: boolean;
  public readonly providerId: string | null;
  public readonly modelId: string | null;

  public constructor(
    errorClass: ErrorClass,
    message: string,
    options: {
      providerId?: string | null;
      modelId?: string | null;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ClassifiedError";
    this.errorClass = errorClass;
    this.retryable = options.retryable ?? isRetryableErrorClass(errorClass);
    this.providerId = options.providerId ?? null;
    this.modelId = options.modelId ?? null;
  }
}

/** Raised when a controlled state machine is asked for an illegal transition. */
export class InvalidTransitionError extends Error {
  public readonly entity: string;
  public readonly from: string;
  public readonly to: string;

  public constructor(entity: string, from: string, to: string) {
    super(`Illegal ${entity} transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

/** Raised when a registry rejects a malformed record. */
export class ValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(message: string, issues: readonly string[] = []) {
    super(issues.length > 0 ? `${message}: ${issues.join("; ")}` : message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/** Raised when a bounded resource (queue, semaphore) refuses new work. */
export class CapacityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CapacityError";
  }
}
