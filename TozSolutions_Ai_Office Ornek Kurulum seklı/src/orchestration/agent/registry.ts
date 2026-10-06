/**
 * Agent registry.
 *
 * The central inventory of available agents.
 *
 * Pattern deliberately mirrors the existing `ProviderRegistry`: explicit
 * lifecycle, duplicate rejection, `Result` returns rather than throws for
 * expected failures, and a `productionPool`-style view of who may be selected.
 *
 * The registry STORES. It does not execute, score, or choose agents; those
 * belong to `SpecialistPool`. It holds no adapter implementation, so an adapter
 * can never be reached through the registry.
 */

import { type Clock, systemClock } from "../../core/clock.js";
import { type WorkspaceRef, workspaceKey } from "../workspace/workspace.js";
import { ValidationError } from "../../core/errors.js";
import { err, ok, type Result } from "../../core/result.js";
import { type HealthObservation } from "../../health/health.js";
import { type AgentStatus, type AgentRecord, type AgentRecordInput, agentKey, buildAgentRecord, isSelectableStatus } from "./record.js";

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export const AGENT_LIFECYCLE_STATES = [
  "discovered",
  "verified",
  "registered",
  "available",
  "draining",
  "retired",
] as const;

export type AgentLifecycleState = (typeof AGENT_LIFECYCLE_STATES)[number];

/**
 * Declared legal edges.
 *
 * An agent cannot become `available` without passing through `verified` and
 * `registered`, so a freshly inserted record is never selectable by accident.
 */
const TRANSITIONS: Readonly<Record<AgentLifecycleState, readonly AgentLifecycleState[]>> = {
  discovered: ["verified", "retired"],
  verified: ["registered", "retired"],
  registered: ["available", "retired"],
  available: ["draining", "retired"],
  // A draining agent may return to service, or be retired.
  draining: ["available", "retired"],
  retired: [],
};

export function allowedAgentTransitions(from: AgentLifecycleState): readonly AgentLifecycleState[] {
  return TRANSITIONS[from];
}

export function canTransitionAgent(from: AgentLifecycleState, to: AgentLifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class DuplicateAgentError extends Error {
  public readonly agentKey: string;
  public constructor(agentKey: string) {
    super(`Agent already registered: ${agentKey}`);
    this.name = "DuplicateAgentError";
    this.agentKey = agentKey;
  }
}

export class UnknownAgentError extends Error {
  public readonly agentKey: string;
  public constructor(agentKey: string) {
    super(`Agent not found: ${agentKey}`);
    this.name = "UnknownAgentError";
    this.agentKey = agentKey;
  }
}

export class AgentLifecycleError extends Error {
  public readonly from: AgentLifecycleState;
  public readonly to: AgentLifecycleState;
  public constructor(from: AgentLifecycleState, to: AgentLifecycleState) {
    super(`Illegal agent lifecycle transition: ${from} -> ${to}`);
    this.name = "AgentLifecycleError";
    this.from = from;
    this.to = to;
  }
}

export type AgentRegistryError =
  | ValidationError
  | DuplicateAgentError
  | UnknownAgentError
  | AgentLifecycleError;

export interface RegisteredAgent {
  readonly record: AgentRecord;
  readonly lifecycle: AgentLifecycleState;
}

export interface AgentRegistryOptions {
  readonly clock?: Clock;
  /** PHASE 06. Absent means the unattributed partition, never "all workspaces". */
  readonly workspace?: WorkspaceRef | null;
}

/**
 * In-memory agent registry.
 *
 * IDEMPOTENCY. Registration is keyed by `agentId@version`. Re-registering the
 * identical version is rejected as a duplicate rather than silently replacing
 * the record, because a replacement would change the meaning of every decision
 * already made about that agent. A NEW version registers as a new key, so an
 * upgrade does not erase history.
 */
export class AgentRegistry {
  readonly #agents = new Map<string, RegisteredAgent>();
  readonly #byAgentId = new Map<string, Set<string>>();
  readonly #clock: Clock;
  /**
   * PHASE 06: the workspace whose agents this registry holds.
   *
   * `null` is the unattributed partition, not "every workspace". An agent record
   * carries what an agent is and what it may reach - tool requirements, memory
   * scopes, a trust level - so this is customer data and is partitioned rather than
   * listed in `PLATFORM_SCOPED_REGISTRIES`.
   */
  readonly #workspace: WorkspaceRef | null;

  public constructor(options: AgentRegistryOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#workspace = options.workspace ?? null;
  }

  public get size(): number {
    return this.#agents.size;
  }

  public register(input: Omit<AgentRecordInput, "now">): Result<RegisteredAgent, AgentRegistryError> {
    const issues = validateAgentInput(input);
    if (issues.length > 0) {
      return err(new ValidationError("Agent record validation failed", issues));
    }
    const key = this.#key(input.agentId, input.version);
    if (this.#agents.has(key)) {
      return err(new DuplicateAgentError(key));
    }
    const record = buildAgentRecord({ ...input, now: this.#clock.now() });
    const entry: RegisteredAgent = { record, lifecycle: "discovered" };
    this.#agents.set(key, entry);
    const bucket = this.#byAgentId.get(this.#partition(input.agentId)) ?? new Set<string>();
    bucket.add(key);
    this.#byAgentId.set(this.#partition(input.agentId), bucket);
    return ok(entry);
  }

  public has(agentId: string, version: string): boolean {
    return this.#agents.has(this.#key(agentId, version));
  }

  public get(agentId: string, version: string): RegisteredAgent | null {
    return this.#agents.get(this.#key(agentId, version)) ?? null;
  }

  public require(agentId: string, version: string): Result<RegisteredAgent, UnknownAgentError> {
    const entry = this.get(agentId, version);
    return entry ? ok(entry) : err(new UnknownAgentError(this.#key(agentId, version)));
  }

  public list(): readonly RegisteredAgent[] {
    return [...this.#agents.values()];
  }

  /** Every registered version of an agent, oldest key first. */
  public versionsOf(agentId: string): readonly RegisteredAgent[] {
    return [...(this.#byAgentId.get(this.#partition(agentId)) ?? [])]
      .map((key) => this.#agents.get(key))
      .filter((entry): entry is RegisteredAgent => entry !== undefined);
  }

  public transition(
    agentId: string,
    version: string,
    to: AgentLifecycleState,
  ): Result<RegisteredAgent, AgentRegistryError> {
    const key = this.#key(agentId, version);
    const entry = this.#agents.get(key);
    if (!entry) {
      return err(new UnknownAgentError(key));
    }
    if (!canTransitionAgent(entry.lifecycle, to)) {
      return err(new AgentLifecycleError(entry.lifecycle, to));
    }
    const next: RegisteredAgent = {
      record: { ...entry.record, updatedAt: this.#clock.now() },
      lifecycle: to,
    };
    this.#agents.set(key, next);
    return ok(next);
  }

  public setStatus(agentId: string, version: string, status: AgentStatus): Result<RegisteredAgent, AgentRegistryError> {
    return this.#mutate(agentId, version, (record) => ({ ...record, status, updatedAt: this.#clock.now() }));
  }

  public setHealth(agentId: string, version: string, health: HealthObservation): Result<RegisteredAgent, AgentRegistryError> {
    return this.#mutate(agentId, version, (record) => ({ ...record, health, updatedAt: this.#clock.now() }));
  }

  /**
   * Agents eligible for selection.
   *
   * Requires BOTH a lifecycle state of `available` and a record status of
   * `active`. One alone is not sufficient: an agent can be lifecycle-available
   * while its record is `disabled`, and a record can be `active` while the
   * lifecycle has not reached `available`.
   */
  public selectable(): readonly AgentRecord[] {
    return this.list()
      .filter((entry) => entry.lifecycle === "available" && isSelectableStatus(entry.record.status))
      .map((entry) => entry.record);
  }

  /** Rejects a duplicate id and returns the existing entry, for idempotent callers. */
  public registerOrGet(input: Omit<AgentRecordInput, "now">): Result<RegisteredAgent, AgentRegistryError> {
    const key = this.#key(input.agentId, input.version);
    const existing = this.#agents.get(key);
    if (existing) {
      return ok(existing);
    }
    return this.register(input);
  }

  public retire(agentId: string, version: string): Result<RegisteredAgent, AgentRegistryError> {
    const key = this.#key(agentId, version);
    const entry = this.#agents.get(key);
    if (!entry) {
      return err(new UnknownAgentError(key));
    }
    if (entry.lifecycle !== "retired" && canTransitionAgent(entry.lifecycle, "retired")) {
      return this.transition(agentId, version, "retired");
    }
    return ok(entry);
  }

  /**
   * The ONLY place this registry composes a store key.
   *
   * `workspaceKey` length-prefixes each part, so no combination of workspace,
   * brand and agent key can be spelled two ways and collide - `"ab" + "c"` and
   * `"a" + "bc"` produce different keys.
   */
  #key(agentId: string, version: string): string {
    return workspaceKey(this.#workspace, agentKey(agentId, version));
  }

  /** The secondary index, which is keyed by bare `agentId` and must partition too. */
  #partition(agentId: string): string {
    return workspaceKey(this.#workspace, agentId);
  }

  #mutate(
    agentId: string,
    version: string,
    fn: (record: AgentRecord) => AgentRecord,
  ): Result<RegisteredAgent, AgentRegistryError> {
    const key = this.#key(agentId, version);
    const existing = this.#agents.get(key);
    if (!existing) {
      return err(new UnknownAgentError(key));
    }
    const next: RegisteredAgent = { record: fn(existing.record), lifecycle: existing.lifecycle };
    this.#agents.set(key, next);
    return ok(next);
  }
}

function validateAgentInput(input: Omit<AgentRecordInput, "now">): string[] {
  const issues: string[] = [];
  if (typeof input.agentId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(input.agentId)) {
    issues.push("agentId must be 1-128 characters of letters, digits, dot, underscore or dash");
  }
  if (typeof input.version !== "string" || !/^[A-Za-z0-9.+-]{1,64}$/.test(input.version)) {
    issues.push("version must be 1-64 characters of letters, digits, dot, plus or dash");
  }
  if (typeof input.adapter !== "string" || input.adapter.trim() === "") {
    issues.push("adapter must be a non-empty adapter identifier");
  }
  if (input.measuredLatencyMs !== undefined && input.measuredLatencyMs !== null) {
    const value = input.measuredLatencyMs;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      issues.push("measuredLatencyMs must be a non-negative finite number or null");
    }
  }
  if (input.measuredLatencyMs !== undefined && input.measuredLatencyMs !== null && input.latencyClass !== undefined && input.latencyClass !== "unknown") {
    issues.push("measuredLatencyMs must not be supplied alongside a declared latencyClass; the class is derived, not asserted");
  }
  return issues;
}
