/**
 * Agent record.
 *
 * A machine-readable description of an agent: who it is, what it can do, what
 * it needs to run, and how much it should be trusted.
 *
 * SEPARATION OF DOMAINS. An agent record references providers, models, tools and
 * memory scopes **by id**. It does not embed them, and it is not one of them:
 *
 *   Agent != Capability  an agent HAS capabilities
 *   Agent != Provider    an agent RUNS ON a provider
 *   Agent != Model       an agent USES a model
 *   Agent != Tool        an agent CALLS tools
 *   Agent != Memory      an agent READS memory under policy
 *
 * Every quantitative field is nullable and `null` means "not measured". Nothing
 * here is defaulted into a claim, for the same reason `ModelRecord` is not: a
 * fabricated latency figure is worse than an absent one.
 */

import { type Capability, CapabilitySet } from "../../capabilities/capability.js";
import { type HealthObservation, UNKNOWN_HEALTH } from "../../health/health.js";
import { type MemoryScope } from "../memory/memory.js";
import { type AgentCostClass, type AgentLatencyClass, type TrustLevel } from "./trust.js";

export {
  AGENT_COST_CLASSES,
  AGENT_LATENCY_CLASSES,
  TRUST_LEVELS,
  costRank,
  meetsTrustFloor,
  trustRank,
  type AgentCostClass,
  type AgentLatencyClass,
  type TrustLevel,
} from "./trust.js";

/** What kind of thing an agent is. Affects nothing but reporting. */
export const AGENT_TYPES = [
  "specialist",
  "generalist",
  "planner",
  "synthesizer",
  "verifier",
  "supervisor",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

/** How an agent is executed. */
export const EXECUTION_MODES = ["local", "remote", "in_process", "sandboxed"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/**
 * Where an agent came from.
 *
 * Recorded on every agent because provenance decides how much the system may
 * trust what the agent says about itself. An agent TOZ declared is a first-party
 * claim; an agent an external framework described is a third-party claim, and
 * the record must not blur the two.
 *
 * `native`   declared inside this repository (TOZ's own agents)
 * `agency`   supplied by an external agent agency, through `AgentSource`
 * `ruflo`    supplied through the Ruflo compatibility boundary
 * `remote`   reached over a network transport
 * `custom`   anything else, named in `AgentRecord.metadata.sourceRef`
 */
export const AGENT_ORIGIN_KINDS = ["native", "agency", "ruflo", "remote", "custom"] as const;
export type AgentOriginKind = (typeof AGENT_ORIGIN_KINDS)[number];

/** Provenance of an agent. */
export interface AgentOrigin {
  readonly kind: AgentOriginKind;
  /**
   * Identifier within the source: an agency roster id, a framework handle, a
   * service name. `null` for a native agent, which has no external reference.
   */
  readonly ref: string | null;
}

/** The provenance of an agent TOZ declared itself. */
export const NATIVE_ORIGIN: AgentOrigin = { kind: "native", ref: null };

export function isAgentOriginKind(value: unknown): value is AgentOriginKind {
  return typeof value === "string" && (AGENT_ORIGIN_KINDS as readonly string[]).includes(value);
}

/**
 * True when the agent is described by something outside this repository.
 *
 * External agents are never granted `high` or `privileged` trust by default: a
 * third-party description of an agent is a claim about that agent, not a
 * measurement of it.
 */
export function isExternalOrigin(source: AgentOrigin): boolean {
  return source.kind !== "native";
}

/**
 * Latency ordering.
 *
 * A derived ordering, used by the pool. `unknown` ranks last so an unmeasured
 * agent cannot be preferred as fast.
 */
const LATENCY_ORDER: Readonly<Record<AgentLatencyClass, number>> = {
  realtime: 0,
  fast: 1,
  standard: 2,
  slow: 3,
  unknown: 4,
};

export function latencyRank(latencyClass: AgentLatencyClass): number {
  return LATENCY_ORDER[latencyClass];
}

export const AGENT_STATUSES = [
  "active",
  "disabled",
  "draining",
  "unavailable",
  "retired",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** True when an agent in this state may be selected for new work. */
export function isSelectableStatus(status: AgentStatus): boolean {
  return status === "active";
}

/**
 * The shape of the input an agent accepts.
 *
 * Deliberately descriptive rather than a schema language: a JSON Schema or
 * Zod schema can be carried in `metadata` by a future adapter, but the core must
 * not depend on a validator library to describe a contract.
 */
export interface AgentContract {
  /** Human-readable summary of what the agent expects. */
  readonly description: string;
  /** Names the agent is able to consume, e.g. `["text/plain"]`. */
  readonly accepts: readonly string[];
  /** Names the agent produces. */
  readonly produces: readonly string[];
  /** True when the agent refuses input it cannot handle. */
  readonly strict: boolean;
}

export const DEFAULT_CONTRACT: AgentContract = {
  description: "Unspecified contract",
  accepts: ["text/plain"],
  produces: ["text/plain"],
  strict: false,
};

/** What a verifier must be able to establish about the output. */
export interface VerificationRequirement {
  /** A verifier kind, e.g. `schema`, `source`, `test`, `policy`. */
  readonly kind: string;
  readonly required: boolean;
}

export interface AgentRecord {
  readonly agentId: string;
  readonly name: string;
  readonly version: string;
  readonly status: AgentStatus;
  readonly type: AgentType;
  /**
   * What the agent is known to support.
   *
   * `CapabilitySet` rather than a plain list, so "not declared" stays `unknown`
   * and a capability is never assumed from a specialisation label.
   */
  readonly capabilities: CapabilitySet;
  /**
   * Narrower roles the agent fills, e.g. `["financial_analysis"]`.
   *
   * Distinct from capabilities: a specialisation is a role, not a thing the
   * agent can be asked to do. Used for reporting and for soft preference only —
   * never for hard eligibility.
   */
  readonly specializations: readonly string[];
  /** Provider ids this agent needs. Empty means "no provider constraint". */
  readonly providerRequirements: readonly string[];
  /** Tool names this agent needs. */
  readonly toolRequirements: readonly string[];
  /** Memory scopes this agent needs access to. */
  readonly memoryScopes: readonly MemoryScope[];
  readonly trustLevel: TrustLevel;
  readonly costClass: AgentCostClass;
  readonly latencyClass: AgentLatencyClass;
  /** Measured latency in ms. null = never measured. Never inferred from class. */
  readonly measuredLatencyMs: number | null;
  readonly executionMode: ExecutionMode;
  readonly inputContract: AgentContract;
  readonly outputContract: AgentContract;
  readonly verificationRequirements: readonly VerificationRequirement[];
  readonly health: HealthObservation;
  /**
   * Identifier of the adapter that executes this agent.
   *
   * A reference, so the registry has no dependency on any adapter
   * implementation and no adapter can be reached through it.
   */
  readonly adapter: string;
  /**
   * Where this agent came from.
   *
   * Carried on the record rather than inferred from the adapter name, so
   * "which agents did an external agency give us?" is answerable from the
   * registry without an audit of adapter implementations.
   */
  readonly source: AgentOrigin;
  /**
   * Whether executing this agent requires a routed provider and model.
   *
   * `true`  the agent is a prompt plus capabilities, and inference must be
   *         supplied by a provider Toz routes to.
   * `false` the agent is self-hosted: it brings its own inference, or it is not
   *         a model call at all. An agency-hosted specialist is the motivating
   *         case - demanding a provider route of it would make the whole class
   *         inexecutable.
   *
   * Defaults to `true`, the stricter answer: a new agent is assumed to need a
   * route until something declares otherwise.
   */
  readonly requiresModelRoute: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AgentRecordInput {
  readonly agentId: string;
  readonly name?: string;
  readonly version: string;
  readonly status?: AgentStatus;
  readonly type?: AgentType;
  readonly capabilities?: CapabilitySet;
  readonly specializations?: readonly string[];
  readonly providerRequirements?: readonly string[];
  readonly toolRequirements?: readonly string[];
  readonly memoryScopes?: readonly MemoryScope[];
  readonly trustLevel?: TrustLevel;
  readonly costClass?: AgentCostClass;
  readonly latencyClass?: AgentLatencyClass;
  readonly measuredLatencyMs?: number | null;
  readonly executionMode?: ExecutionMode;
  readonly inputContract?: AgentContract;
  readonly outputContract?: AgentContract;
  readonly verificationRequirements?: readonly VerificationRequirement[];
  readonly health?: HealthObservation;
  readonly adapter: string;
  readonly source?: AgentOrigin;
  readonly requiresModelRoute?: boolean;
  readonly now: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** The key an agent is identified by. Version is part of it on purpose. */
export function agentKey(agentId: string, version: string): string {
  return `${agentId}@${version}`;
}

export function buildAgentRecord(input: AgentRecordInput): AgentRecord {
  return {
    agentId: input.agentId,
    name: input.name ?? input.agentId,
    version: input.version,
    status: input.status ?? "disabled",
    type: input.type ?? "specialist",
    capabilities: input.capabilities ?? CapabilitySet.unknown(),
    specializations: input.specializations ?? [],
    providerRequirements: input.providerRequirements ?? [],
    toolRequirements: input.toolRequirements ?? [],
    memoryScopes: input.memoryScopes ?? [],
    trustLevel: input.trustLevel ?? "standard",
    costClass: input.costClass ?? "unknown",
    latencyClass: input.latencyClass ?? "unknown",
    measuredLatencyMs: input.measuredLatencyMs ?? null,
    executionMode: input.executionMode ?? "in_process",
    inputContract: input.inputContract ?? DEFAULT_CONTRACT,
    outputContract: input.outputContract ?? DEFAULT_CONTRACT,
    verificationRequirements: input.verificationRequirements ?? [],
    health: input.health ?? UNKNOWN_HEALTH,
    adapter: input.adapter,
    source: input.source ?? NATIVE_ORIGIN,
    requiresModelRoute: input.requiresModelRoute ?? true,
    createdAt: input.now,
    updatedAt: input.now,
    metadata: input.metadata ?? {},
  };
}

/** True when the agent is declared to support a capability. */
export function agentSupports(record: AgentRecord, capability: Capability): boolean {
  return record.capabilities.isSupported(capability);
}
