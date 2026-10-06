import {
  type HealthMonitor,
  type HealthObservation,
  type HealthThresholds,
  DEFAULT_HEALTH_THRESHOLDS,
  UNKNOWN_HEALTH,
  deriveHealth,
} from "./health.js";
import { type Clock, systemClock } from "../core/clock.js";
import type { AuditEventInputOf, AuditEventKind } from "../audit/events.js";

/**
 * In-memory health monitor.
 *
 * Implements the PHASE 01 interface. It does NOT schedule probes; a future
 * phase wires a scheduler to it. It only stores observations, so tests can
 * verify health transitions deterministically.
 *
 * ## PHASE 11: it now RECORDS a transition, which it never did
 *
 * `provider_health_changed` had been declared in the AUDIT vocabulary since PHASE 01 and in
 * the ORCHESTRATION vocabulary as well, with different payload shapes, and emitted by neither.
 * `TODO.md` PHASE 11 item 3 called the collision; the audit found the worse half — a name that
 * existed twice and an observation nobody could make.
 *
 * The fix is in the direction that keeps the meaning. Provider health is a PROVIDER concern, so
 * the orchestration duplicate is deleted and the audit event is produced HERE, in the component
 * that already computes the transition and is already composed by the composition root. Emitting
 * from anywhere else would have meant a second place deciding what "degraded" means.
 *
 * The sink is OPTIONAL and the absence is a limitation rather than a convenience: with none
 * supplied, health still works and is still queryable, and simply leaves no trail.
 */
export class InMemoryHealthMonitor implements HealthMonitor {
  readonly #observations = new Map<string, HealthObservation>();
  readonly #clock: Clock;
  readonly #thresholds: HealthThresholds;
  readonly #sink: { append<K extends AuditEventKind>(input: AuditEventInputOf<K>): unknown } | undefined;

  public constructor(
    options: {
      clock?: Clock;
      thresholds?: HealthThresholds;
      sink?: { append<K extends AuditEventKind>(input: AuditEventInputOf<K>): unknown };
    } = {},
  ) {
    this.#clock = options.clock ?? systemClock;
    this.#thresholds = options.thresholds ?? DEFAULT_HEALTH_THRESHOLDS;
    this.#sink = options.sink;
  }

  public record(targetId: string, observation: HealthObservation): void {
    this.#observations.set(targetId, observation);
  }

  public current(targetId: string): HealthObservation {
    return this.#observations.get(targetId) ?? UNKNOWN_HEALTH;
  }

  /**
   * Applies a real success/failure report to the stored observation.
   *
   * PHASE 11: emits `provider_health_changed` when — and ONLY when — the derived status
   * differs from the stored one. Repeated identical reports are the normal case (a provider
   * that keeps succeeding), and an event per report would bury the transition that matters.
   */
  public report(
    targetId: string,
    report: { success: boolean; latencyMs?: number | null; detail?: string | null },
    at: Date = this.#clock.now(),
  ): HealthObservation {
    const previous = this.current(targetId);
    const next = deriveHealth(previous, { ...report, at }, this.#thresholds);
    this.record(targetId, next);
    if (next.status !== previous.status) {
      this.#sink?.append({
        kind: "provider_health_changed",
        targetId,
        fromStatus: previous.status,
        toStatus: next.status,
        consecutiveFailures: next.consecutiveFailures,
        at,
      });
    }
    return next;
  }

  public targets(): readonly string[] {
    return [...this.#observations.keys()];
  }

  public clear(): void {
    this.#observations.clear();
  }
}
