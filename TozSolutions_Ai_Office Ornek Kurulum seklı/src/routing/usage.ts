/**
 * PHASE 06: usage and cost accounting.
 *
 * The rule this module exists to enforce: **a number is recorded only when a
 * provider reported it.** Token counts, latency and monetary amounts come from a
 * provider's own response. Where a provider does not report something, the field
 * is `null` and the summary says "unknown". Nothing here estimates, extrapolates
 * from a price table, or fills a gap with a plausible figure.
 *
 * That is not caution for its own sake. A routing policy that reads cost, and a
 * finance report that reads cost, are both downstream of this. An invented price
 * would be a fabricated financial claim that looks exactly like a measured one
 * once it is in a report, and the difference is unrecoverable by then.
 *
 * Note what is deliberately NOT here: no `pricePerThousandTokens`, no currency
 * conversion, and no cross-provider comparison of monetary amounts. Relative
 * preference is handled by the existing `costClass`, which is a declaration, not
 * a price.
 */

import { type Clock, systemClock } from "../core/clock.js";
import { ValidationError } from "../core/errors.js";
import { type Result, err, ok } from "../core/result.js";

/** What a provider actually reported about one call. */
export interface ReportedUsage {
  readonly providerId: string;
  readonly modelId: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Provider-reported latency. null when the provider did not report it. */
  readonly latencyMs: number | null;
  /** Provider-reported monetary amount. null unless a price was actually quoted. */
  readonly amount: number | null;
  readonly currency: string | null;
}

export interface UsageRecord extends ReportedUsage {
  readonly taskId: string;
  readonly attempt: number;
  readonly succeeded: boolean;
  readonly recordedAt: number;
  /** Where the figures came from, for an auditor. Never a secret. */
  readonly source: string;
}

function isNonNegativeIntOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

/**
 * Validates a provider report.
 *
 * Strict about shape, and refuses a monetary amount with no currency. An amount
 * without a currency is not a cost, it is a number of unknown denomination, and
 * accepting it would put an uninterpretable figure into a financial field.
 */
export function validateReportedUsage(input: unknown): Result<ReportedUsage, ValidationError> {
  const issues: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err(new ValidationError("Usage must be an object", ["usage must be an object"]));
  }
  const raw = input as Record<string, unknown>;

  for (const field of ["providerId", "modelId"] as const) {
    const value = raw[field];
    if (typeof value !== "string" || value.trim() === "") {
      issues.push(`${field} must be a non-empty string`);
    }
  }
  if (!isNonNegativeIntOrNull(raw["inputTokens"])) {
    issues.push("inputTokens must be a non-negative integer or null");
  }
  if (!isNonNegativeIntOrNull(raw["outputTokens"])) {
    issues.push("outputTokens must be a non-negative integer or null");
  }
  if (raw["latencyMs"] !== null && (typeof raw["latencyMs"] !== "number" || raw["latencyMs"] < 0)) {
    issues.push("latencyMs must be a non-negative number or null");
  }
  if (raw["amount"] !== null && (typeof raw["amount"] !== "number" || raw["amount"] < 0)) {
    issues.push("amount must be a non-negative number or null");
  }
  if (raw["amount"] !== null && (raw["currency"] === null || raw["currency"] === undefined)) {
    // The whole reason this module exists. An amount with no currency cannot be
    // reported as a cost, so it is refused rather than stored.
    issues.push("an amount must carry its currency; a number with no denomination is not a cost");
  }

  if (issues.length > 0) {
    return err(new ValidationError("Provider usage validation failed", issues));
  }

  // Every field is re-read through a guard rather than asserted. The checks
  // above have already rejected anything malformed, but a cast would let a future
  // edit to the checks leave this construction silently wrong.
  const numberOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const stringOrNull = (value: unknown): string | null =>
    typeof value === "string" && value !== "" ? value : null;

  return ok({
    providerId: raw["providerId"] as string,
    modelId: raw["modelId"] as string,
    inputTokens: numberOrNull(raw["inputTokens"]),
    outputTokens: numberOrNull(raw["outputTokens"]),
    latencyMs: numberOrNull(raw["latencyMs"]),
    amount: numberOrNull(raw["amount"]),
    currency: stringOrNull(raw["currency"]),
  });
}

export interface ProviderSummary {
  readonly providerId: string;
  readonly calls: number;
  readonly successes: number;
  readonly failures: number;
  /** null when no call ever reported input tokens. Never estimated. */
  readonly inputTokens: number | null;
  /** null when no call ever reported output tokens. Never estimated. */
  readonly outputTokens: number | null;
  /** Mean of reported latencies. null when none were reported. */
  readonly meanLatencyMs: number | null;
  /** null unless a monetary amount was actually quoted. */
  readonly amount: number | null;
  readonly currency: string | null;
  /** How many calls reported usage at all, so "0" is distinguishable from "unknown". */
  readonly callsReportingUsage: number;
}

export interface LedgerSummary {
  readonly providers: readonly ProviderSummary[];
  readonly totalCalls: number;
  /**
   * True when at least one field anywhere is unknown.
   *
   * A consumer that must not act on guessed figures can refuse to trust the
   * summary outright when this is true, rather than having to check each field.
   */
  readonly hasUnknowns: boolean;
  readonly unknownFields: readonly string[];
}

export class UsageLedger {
  readonly #records: UsageRecord[] = [];
  readonly #clock: Clock;
  readonly #limit: number;

  public constructor(options: { clock?: Clock; limit?: number } = {}) {
    this.#clock = options.clock ?? systemClock;
    // Bounded for the same reason the learning store is: an unbounded ledger in a
    // long-running process is a leak, and a silently dropped record is worse than
    // a visible one - so the count of drops is retained below.
    this.#limit = options.limit ?? 10_000;
  }

  public get size(): number {
    return this.#records.length;
  }

  /** Records dropped by the bound, so truncation is visible rather than silent. */
  public get droppedCount(): number {
    return this.#dropped;
  }
  #dropped = 0;

  public record(input: {
    readonly usage: ReportedUsage;
    readonly taskId: string;
    readonly attempt: number;
    readonly succeeded: boolean;
    readonly source?: string;
  }): UsageRecord {
    const record: UsageRecord = {
      ...input.usage,
      taskId: input.taskId,
      attempt: input.attempt,
      succeeded: input.succeeded,
      recordedAt: this.#clock.now().getTime(),
      source: input.source ?? "provider response",
    };
    this.#records.push(record);
    while (this.#records.length > this.#limit) {
      this.#records.shift();
      this.#dropped += 1;
    }
    return record;
  }

  public all(): readonly UsageRecord[] {
    return [...this.#records];
  }

  public forTask(taskId: string): readonly UsageRecord[] {
    return this.#records.filter((record) => record.taskId === taskId);
  }

  public forProvider(providerId: string): readonly UsageRecord[] {
    return this.#records.filter((record) => record.providerId === providerId);
  }

  /**
   * Summarises by provider.
   *
   * Every aggregate is null when NO contributing call reported that field. Note
   * that a provider reporting tokens on some calls and not others is summarised
   * over the calls that did report, with `callsReportingUsage` making the gap
   * visible - never filled in by assuming the missing calls matched the mean.
   */
  public summary(): LedgerSummary {
    const byProvider = new Map<string, UsageRecord[]>();
    for (const record of this.#records) {
      const bucket = byProvider.get(record.providerId) ?? [];
      bucket.push(record);
      byProvider.set(record.providerId, bucket);
    }

    const unknownFields = new Set<string>();
    const providers: ProviderSummary[] = [];

    for (const [providerId, records] of byProvider) {
      const reporting = records.filter(
        (record) => record.inputTokens !== null || record.outputTokens !== null,
      );
      const inputTokens = sumOrNull(records.map((record) => record.inputTokens));
      const outputTokens = sumOrNull(records.map((record) => record.outputTokens));
      const latencies = records
        .map((record) => record.latencyMs)
        .filter((value): value is number => value !== null);
      // A monetary amount is only summable within one currency. Mixed currencies
      // are reported as unknown rather than added together, which would be a
      // meaningless number.
      const currencies = [...new Set(records.map((record) => record.currency))];
      const monetary = records.filter((record) => record.amount !== null);
      const singleCurrency = monetary.length > 0 && currencies.length === 1;
      const amount = singleCurrency ? monetary.reduce((sum, record) => sum + (record.amount ?? 0), 0) : null;
      const currency = singleCurrency ? (currencies[0] ?? null) : null;

      if (inputTokens === null) unknownFields.add(`${providerId}.inputTokens`);
      if (outputTokens === null) unknownFields.add(`${providerId}.outputTokens`);
      if (latencies.length === 0) unknownFields.add(`${providerId}.latencyMs`);
      if (monetary.length === 0) unknownFields.add(`${providerId}.amount`);

      providers.push({
        providerId,
        calls: records.length,
        successes: records.filter((record) => record.succeeded).length,
        failures: records.filter((record) => !record.succeeded).length,
        inputTokens,
        outputTokens,
        meanLatencyMs:
          latencies.length === 0
            ? null
            : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
        amount,
        currency,
        callsReportingUsage: reporting.length,
      });
    }

    return {
      providers,
      totalCalls: this.#records.length,
      hasUnknowns: unknownFields.size > 0,
      unknownFields: [...unknownFields],
    };
  }

  public clear(): void {
    this.#records.length = 0;
    this.#dropped = 0;
  }
}

/**
 * Sums only the values that were actually reported.
 *
 * null when none were. A single missing value does NOT poison the sum - the
 * result is explicitly "a total over the calls that reported", and
 * `callsReportingUsage` says how many that was.
 */
function sumOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }
  return present.reduce((sum, value) => sum + value, 0);
}
