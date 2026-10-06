/**
 * Provider / model health model.
 *
 * PHASE 01 ships the representation and the interfaces only. No probe has
 * been executed, so every value produced by this module is `unknown` unless a
 * caller explicitly reports an observation. Health data is never invented.
 */

export const HEALTH_STATUSES = [
  "unknown",
  "healthy",
  "degraded",
  "unavailable",
  "disabled",
] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export function isHealthStatus(value: unknown): value is HealthStatus {
  return typeof value === "string" && (HEALTH_STATUSES as readonly string[]).includes(value);
}

/** Statuses that should not receive production traffic. */
export function isRoutableStatus(status: HealthStatus): boolean {
  return status === "healthy" || status === "degraded" || status === "unknown";
}

export interface HealthObservation {
  readonly status: HealthStatus;
  /** When the observation was taken. null = never observed. */
  readonly observedAt: Date | null;
  /** Observed round-trip latency. null = not measured. */
  readonly latencyMs: number | null;
  /** Consecutive failures since the last success. */
  readonly consecutiveFailures: number;
  /** Non-sensitive human-readable detail. Must never contain secrets. */
  readonly detail: string | null;
}

export const UNKNOWN_HEALTH: HealthObservation = Object.freeze({
  status: "unknown" as const,
  observedAt: null,
  latencyMs: null,
  consecutiveFailures: 0,
  detail: null,
});

/**
 * Derives a health observation from raw success/failure reports.
 *
 * The thresholds are configuration, not hardcoded policy, and no historical
 * data exists yet, so this function is only ever called with data a real
 * prober supplies.
 */
export interface HealthThresholds {
  /** Consecutive failures that move `healthy` -> `degraded`. */
  readonly degradedAfterFailures: number;
  /** Consecutive failures that move to `unavailable`. */
  readonly unavailableAfterFailures: number;
  /** Latency above this (ms) counts as degraded, when known. */
  readonly degradedLatencyMs: number | null;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  degradedAfterFailures: 2,
  unavailableAfterFailures: 5,
  degradedLatencyMs: null,
};

export function deriveHealth(
  previous: HealthObservation,
  report: { success: boolean; at: Date; latencyMs?: number | null; detail?: string | null },
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): HealthObservation {
  if (report.success) {
    return {
      status: "healthy",
      observedAt: report.at,
      latencyMs: report.latencyMs ?? null,
      consecutiveFailures: 0,
      detail: report.detail ?? null,
    };
  }

  const consecutiveFailures = previous.consecutiveFailures + 1;
  const status: HealthStatus =
    consecutiveFailures >= thresholds.unavailableAfterFailures
      ? "unavailable"
      : consecutiveFailures >= thresholds.degradedAfterFailures
        ? "degraded"
        : previous.status === "unknown"
          ? "unknown"
          : "healthy";

  return {
    status,
    observedAt: report.at,
    latencyMs: report.latencyMs ?? null,
    consecutiveFailures,
    detail: report.detail ?? null,
  };
}

/** A source of health observations. Implemented by the future live prober. */
export interface HealthProbe {
  /** Entity being probed, e.g. "provider:acme" or "model:acme/model-x". */
  readonly targetId: string;
  /** Executes a single probe. Must not throw for expected failure conditions. */
  probe(signal: AbortSignal): Promise<{ success: boolean; latencyMs?: number | null; detail?: string | null }>;
}

/** A component that consumes probe results. Implemented by the future monitor. */
export interface HealthMonitor {
  record(targetId: string, observation: HealthObservation): void;
  current(targetId: string): HealthObservation;
}
