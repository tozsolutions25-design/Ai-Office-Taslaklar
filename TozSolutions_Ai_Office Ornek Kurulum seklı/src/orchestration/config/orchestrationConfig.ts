/**
 * Orchestration configuration.
 *
 * Extends the PHASE 01 configuration schema rather than replacing it, and is
 * validated through the same path. No module in `src/orchestration` reads
 * `process.env` directly; `env.ts` maps allow-listed variables and
 * `validate.ts` checks them, so configuration behaviour is testable without a
 * process.
 *
 * Secret values are never represented here. Credentials are referenced by
 * variable name, exactly as in PHASE 01.
 */

import { type TrustLevel } from "../agent/trust.js";
import { ALL_MEMORY_SCOPES, isAnyMemoryScope } from "../memory/model.js";
import { ROUTING_POLICIES } from "../../routing/policy.js";
import { OPERATIONS, isOperation } from "../governance/operations.js";

/**
 * The shipped policy names, taken from the policy table itself.
 *
 * Read from one place so a new policy is immediately valid configuration and a
 * removed one immediately invalid, with no second list to forget to update.
 */
const ROUTING_POLICY_NAMES: readonly string[] = Object.keys(ROUTING_POLICIES);

/**
 * Scopes a deployment may name for recall.
 *
 * Checked against the model rather than restated here, so a scope added to the
 * model is immediately recallable and a scope removed here cannot linger as a
 * grant that names nothing.
 */
const RECALLABLE_MEMORY_SCOPES = ALL_MEMORY_SCOPES;
const isRecallableMemoryScope = isAnyMemoryScope;

export interface AgentLimitsConfig {
  /** Agents selectable for one task. */
  readonly maxSelectedAgents: number;
  /** Subtasks a plan may declare. */
  readonly maxSubtasksPerPlan: number;
  /** Deepest plan nesting. */
  readonly maxPlanDepth: number;
  /** Per-subtask timeout ceiling. */
  readonly subtaskTimeoutMs: number;
  /** Retries permitted per subtask. */
  readonly maxSubtasksRetries: number;
  /**
   * Default trust floor when a task does not state one.
   *
   * PHASE 08: this field was documented here and implemented NOWHERE. Its only read in
   * `src/` fed `SpecialistPool.maximumTrustFloor`, which is a different question, and the
   * behaviour this field claims was hardcoded as the literal `"low"` in three places in
   * `authority.ts`. Both are now wired to the field that means what it says.
   */
  readonly defaultMinimumTrust: TrustLevel;
  /**
   * The HIGHEST trust floor a task may demand.
   *
   * PHASE 08, new field. This is a misconfiguration guard, not a default: a task asking
   * for a floor above it is REFUSED rather than served, because a deployment that says
   * `standard` and then answers `privileged` requests is answering a question it was never
   * asked to answer.
   *
   * It is deliberately NOT the same setting as `defaultMinimumTrust`, and the two being
   * confused is what produced the defect above. The default is the floor used when a task
   * is silent; the maximum is the ceiling on what a task may ask for. Defaults to
   * `privileged`, which imposes no restriction - the safe choice is to answer what was
   * asked, not to refuse work the configuration never forbade.
   */
  readonly maximumTrustFloor: TrustLevel;
}

/**
 * The memory section.
 *
 * PHASE 04 added the first three fields; PHASE 05 extended the SAME section
 * rather than adding a second one, so a deployment has one place to configure
 * memory and cannot end up with two sections that disagree.
 */
export interface MemoryConfig {
  readonly enabled: boolean;
  /** Scope execution records are written to. */
  readonly executionScope: string;
  /** Scopes granted to an agent by default. */
  readonly defaultAgentScopes: readonly string[];
  /* ---- PHASE 05 ---- */
  /** Scopes the orchestrator may recall from. Empty means no recall. */
  readonly recallScopes: readonly string[];
  /** How many memories to inject as context. */
  readonly recallLimit: number;
  /** Below this importance, nothing is remembered. */
  readonly minimumImportance: number;
  /** Ceiling on any single item's importance. */
  readonly importanceCeiling: number;
  /** Half-life for the recency signal, in ms. */
  readonly recencyHalfLifeMs: number;
  /** Knowledge material above this length is refused. */
  readonly maximumKnowledgeLength: number;
  /** Whether outcomes are recorded as learning events. */
  readonly recordLearning: boolean;
}

export interface WorkerConfig {
  readonly enabled: boolean;
  readonly defaultTimeoutMs: number;
  readonly maxAttempts: number;
  readonly maxHistory: number;
}

export interface OrchestrationConfig {
  readonly agent: AgentLimitsConfig;
  readonly memory: MemoryConfig;
  readonly worker: WorkerConfig;
  readonly observability: {
    readonly enabled: boolean;
    /** Whether a capability may be admitted without a positive declaration. */
    readonly allowUnverifiedCapabilities: boolean;
  };
  readonly security: {
    readonly inputPolicy: "permissive" | "deny_all" | "heuristic";
    readonly outputPolicy: "permissive" | "deny_all";
  };
  /** PHASE 04.1: agent sources. */
  readonly agents: OrchestrationAgentsConfig;
  /** PHASE 04.1: the Ruflo compatibility boundary. */
  readonly ruflo: OrchestrationRufloConfig;
  /** PHASE 04.1: tool execution. */
  readonly tools: OrchestrationToolsConfig;
  /** PHASE 04.1: learning. */
  readonly learning: OrchestrationLearningConfig;
  /** PHASE 06: provider and model routing. */
  readonly routing: OrchestrationRoutingConfig;
  /** PHASE 07: autonomous workflows and background workers. */
  readonly workflow: OrchestrationWorkflowConfig;
  /** PHASE 08: governance, policy and the control plane. */
  readonly governance: OrchestrationGovernanceConfig;
}

/**
 * PHASE 08: governance configuration.
 *
 * `enforced` decides whether a DENY actually stops work, and it ships TRUE.
 * Shipping it false would mean a deployment could believe it had a control plane
 * when it had an advisor, and the difference is invisible until it is needed.
 *
 * `deferToSubsystem` is how governance stays ADDITIVE rather than duplicative:
 * naming an operation hands it back to the subsystem that already owns it, which
 * is the mechanism by which PHASE 05 memory authority and PHASE 06 routing stay
 * authoritative rather than being shadowed by a second opinion.
 */
export interface OrchestrationGovernanceConfig {
  /** Whether a DENY actually stops work. False makes governance advisory. */
  readonly enforced: boolean;
  /** Operations governance hands back to their owning subsystem. */
  readonly deferToSubsystem: readonly string[];
  /** Operations that always require a human approval before they run. */
  readonly approvalRequired: readonly string[];
  /** Ceiling on simultaneous operations, across all actors. null = none. */
  readonly maxConcurrent: number | null;
  /** Ceiling on attempts per actor. null = none beyond PHASE 07's. */
  readonly maxAttemptsPerActor: number | null;
  /** Ceiling on runtime per actor, in ms. null = none. */
  readonly maxRuntimeMsPerActor: number | null;
  /**
   * Whether a cost budget that cannot be evaluated blocks.
   *
   * TRUE by default, and the safe direction: an unknown cost is not a zero cost,
   * so a budget that read it as zero could never fail.
   */
  readonly blockOnUnknownCost: boolean;
}

/**
 * PHASE 07: workflow and worker configuration.
 *
 * `maxConcurrency` is validated rather than trusted, because an unbounded worker
 * pool is precisely the failure this phase exists to prevent. There is no
 * "unlimited" value: a deployment that wants more concurrency configures a
 * larger number, and pays for it visibly.
 */
export interface OrchestrationWorkflowConfig {
  /** Hard ceiling on simultaneously executing tasks across all jobs. */
  readonly maxConcurrency: number;
  /** Default attempts for a task that states none. Always >= 1. */
  readonly defaultMaxAttempts: number;
  /** Default per-task timeout, in ms. */
  readonly defaultTimeoutMs: number;
  /** How long a claim is honoured before it is considered abandoned. */
  readonly claimTtlMs: number;
  /** Retry backoff base, in ms. */
  readonly backoffBaseMs: number;
  /** Retry backoff ceiling, in ms. */
  readonly backoffMaxMs: number;
  /** Whether a job may stop for an approval gate at all. */
  readonly allowApprovalGates: boolean;
}

/**
 * PHASE 06: routing policy configuration.
 *
 * These are OPERATOR preferences about how to choose between eligible candidates.
 * They are deliberately not defaults that quietly express an opinion: the policy
 * name must resolve to a known policy, and the fallback bounds are explicit,
 * because a chain nobody bounded is a latency budget nobody agreed to.
 */
export interface OrchestrationRoutingConfig {
  /**
   * The policy used when a request names none.
   *
   * Validated against the shipped policy names, so a typo is reported at
   * configuration load rather than silently selecting a different policy than
   * the operator believes is in force.
   */
  readonly defaultPolicy: string;
  /** Maximum fallback hops, including the primary. */
  readonly maxFallbackHops: number;
  /** How long a failed target is skipped, in ms. Zero disables the guard. */
  readonly fallbackCooldownMs: number;
  /** Whether a route with no fallback may still be taken. */
  readonly allowUnprotectedRoutes: boolean;
}

export interface OrchestrationAgentsConfig {
  /** Sources permitted to contribute agents. Empty means none are contacted. */
  readonly enabledSources: readonly string[];
  /** Trust ceiling applied to any externally sourced agent. */
  readonly maximumExternalTrust: TrustLevel;
  /** Whether ingestion may promote an agent to available. Off by default. */
  readonly autoPromote: boolean;
}

export interface OrchestrationRufloConfig {
  /**
   * Off by default, and false in every shipped default.
   *
   * Even enabled it cannot execute: no Ruflo package is installed. The switch
   * exists so the intent is recorded, not to imply a working integration.
   */
  readonly enabled: boolean;
}

export interface OrchestrationToolsConfig {
  /** Per-call ceiling. */
  readonly defaultTimeoutMs: number;
}

export interface OrchestrationLearningConfig {
  /** Off by default. Selection stays deterministic until someone opts in. */
  readonly enabled: boolean;
  /** Observations required before a signal may influence a tie. */
  readonly minimumSamples: number;
}

export const DEFAULT_ORCHESTRATION_CONFIG: OrchestrationConfig = {
  agent: {
    maxSelectedAgents: 4,
    maxSubtasksPerPlan: 24,
    maxPlanDepth: 3,
    subtaskTimeoutMs: 60_000,
    maxSubtasksRetries: 3,
    defaultMinimumTrust: "low",
    maximumTrustFloor: "privileged",
  },
  memory: {
    enabled: true,
    executionScope: "task",
    defaultAgentScopes: ["task", "agent"],
    // PHASE 05 defaults. The floor is above the conversational tier on
    // purpose: a store that keeps everything retrieves noise.
    //
    // `recallScopes` ships EMPTY, and that is the whole point. A recall is a read
    // of memory on the authority of configuration, so a default that named scopes
    // would hand every deployment that supplies a memory service a standing read
    // grant over task and project memory without anyone having asked for it. An
    // operator opts in by naming a scope, and the orchestrator treats an empty
    // list as "no recall", never as "everything readable".
    recallScopes: [],
    recallLimit: 5,
    minimumImportance: 0.35,
    importanceCeiling: 1,
    recencyHalfLifeMs: 7 * 24 * 60 * 60 * 1_000,
    maximumKnowledgeLength: 200_000,
    recordLearning: false,
  },
  worker: {
    enabled: true,
    defaultTimeoutMs: 30_000,
    maxAttempts: 2,
    maxHistory: 200,
  },
  observability: {
    enabled: true,
    allowUnverifiedCapabilities: false,
  },
  security: {
    // Permissive by default, and named as such. See policy/security.ts: a real
    // control belongs here, and inventing one would be worse than an honest
    // "not configured".
    inputPolicy: "permissive",
    outputPolicy: "permissive",
  },
  // PHASE 04.1 defaults, chosen so that switching the code on changes nothing
  // until an operator says otherwise:
  //   - no agent source is contacted
  //   - ingestion never promotes
  //   - the Ruflo boundary is off, and would still have no package to call
  //   - an agent may call only what it declared
  //   - learning is off, so selection stays deterministic
  agents: {
    enabledSources: [],
    maximumExternalTrust: "standard",
    autoPromote: false,
  },
  ruflo: {
    enabled: false,
  },
  tools: {
    defaultTimeoutMs: 30_000,
  },
  learning: {
    enabled: false,
    minimumSamples: 5,
  },
  governance: {
    // PHASE 08. Enforced by default: a control plane that ships advisory is not a
    // control plane, and the difference is invisible until the moment it is
    // needed. A deployment that wants it advisory must say so.
    enforced: true,
    // Empty by default. Governance answers every operation, and a deployment
    // hands back the ones another subsystem already owns well - which is how
    // PHASE 05 memory authority and PHASE 06 routing stay authoritative.
    deferToSubsystem: [],
    // The two that genuinely need a human by default: resolving an approval, and
    // changing the governance configuration itself.
    approvalRequired: ["approval.resolve", "admin.configure"],
    maxConcurrent: null,
    maxAttemptsPerActor: null,
    maxRuntimeMsPerActor: null,
    // TRUE. An unknown cost is not a zero cost, so a budget that read it as zero
    // could never fail, and would not be a budget.
    blockOnUnknownCost: true,
  },
  workflow: {
    // PHASE 07. Bounded on purpose, and with no "unlimited" option: the
    // concurrency ceiling is the only thing standing between a slow provider and
    // a stampede, so it is a number an operator chose rather than a default that
    // happens to be absent.
    maxConcurrency: 4,
    defaultMaxAttempts: 3,
    defaultTimeoutMs: 60_000,
    claimTtlMs: 30_000,
    backoffBaseMs: 500,
    backoffMaxMs: 30_000,
    // On by default. A deployment that forbids human approval entirely is
    // unusual, and the safer default is that the gate exists and must be passed.
    allowApprovalGates: true,
  },
  routing: {
    // PHASE 06. `capability-first` is the default because it is the ordering that
    // assumes the least: it ranks on what a deployment has explicitly declared and
    // asks for no opinion about quality, latency or price.
    defaultPolicy: "capability-first",
    // Bounded, and the bound is visible. An unbounded fallback chain over a slow
    // provider is a latency budget nobody agreed to.
    maxFallbackHops: 3,
    // On by default. A failed target must be skipped, or the system re-routes to
    // the thing that just failed and loops until something else breaks.
    fallbackCooldownMs: 60_000,
    // A route with no fallback is still taken, and the fact is reported. Refusing it
    // would mean a single-provider deployment could not run at all.
    allowUnprotectedRoutes: true,
  },
};

export interface OrchestrationConfigIssue {
  readonly field: string;
  readonly message: string;
}

/**
 * Renders an untrusted value for an error message.
 *
 * A rejected value may be an object, and `String({})` yields `"[object Object]"`,
 * which tells the reader nothing. Describing the type instead keeps the message
 * honest without ever trusting `toString` on caller-supplied data.
 */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") return "object";
  if (typeof value === "string") return `"${value}"`;
  return `${typeof value}`;
}

function positiveInt(issues: OrchestrationConfigIssue[], field: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    issues.push({ field, message: `must be a positive integer, received: ${describeValue(value)}` });
    return fallback;
  }
  return numeric;
}

function oneOf<T extends string>(issues: OrchestrationConfigIssue[], field: string, value: unknown, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  issues.push({ field, message: `must be one of: ${allowed.join(", ")} (received: ${describeValue(value)})` });
  return fallback;
}

function booleanField(issues: OrchestrationConfigIssue[], field: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  issues.push({ field, message: `must be a boolean, received: ${describeValue(value)}` });
  return fallback;
}

/** Validates a raw orchestration configuration object. */
export function validateOrchestrationConfig(raw: Record<string, unknown> = {}): OrchestrationConfigIssue[] {
  const issues: OrchestrationConfigIssue[] = [];
  const base = DEFAULT_ORCHESTRATION_CONFIG;

  const agent = asSection(raw["agent"], "agent", issues);
  const memorySection = asSection(raw["memory"], "memory", issues);
  const worker = asSection(raw["worker"], "worker", issues);
  const observability = asSection(raw["observability"], "observability", issues);
  const security = asSection(raw["security"], "security", issues);
  const agents = asSection(raw["agents"], "agents", issues);
  const ruflo = asSection(raw["ruflo"], "ruflo", issues);
  const tools = asSection(raw["tools"], "tools", issues);
  const learning = asSection(raw["learning"], "learning", issues);
  const routing = asSection(raw["routing"], "routing", issues);
  const workflow = asSection(raw["workflow"], "workflow", issues);
  const governance = asSection(raw["governance"], "governance", issues);

  const maxSelectedAgents = positiveInt(issues, "agent.maxSelectedAgents", agent["maxSelectedAgents"], base.agent.maxSelectedAgents);
  const maxSubtasks = positiveInt(issues, "agent.maxSubtasksPerPlan", agent["maxSubtasksPerPlan"], base.agent.maxSubtasksPerPlan);
  positiveInt(issues, "agent.maxPlanDepth", agent["maxPlanDepth"], base.agent.maxPlanDepth);
  positiveInt(issues, "agent.subtaskTimeoutMs", agent["subtaskTimeoutMs"], base.agent.subtaskTimeoutMs);
  const maxRetries = positiveInt(issues, "agent.maxSubtasksRetries", agent["maxSubtasksRetries"], base.agent.maxSubtasksRetries);
  oneOf(issues, "agent.defaultMinimumTrust", agent["defaultMinimumTrust"], TRUST_FLOORS, base.agent.defaultMinimumTrust);
  oneOf(issues, "agent.maximumTrustFloor", agent["maximumTrustFloor"], TRUST_FLOORS, base.agent.maximumTrustFloor);

  positiveInt(issues, "worker.defaultTimeoutMs", worker["defaultTimeoutMs"], base.worker.defaultTimeoutMs);
  positiveInt(issues, "worker.maxAttempts", worker["maxAttempts"], base.worker.maxAttempts);
  positiveInt(issues, "worker.maxHistory", worker["maxHistory"], base.worker.maxHistory);
  booleanField(issues, "worker.enabled", worker["enabled"], base.worker.enabled);

  booleanField(issues, "memory.enabled", memorySection["enabled"], base.memory.enabled);
  booleanField(issues, "observability.enabled", observability["enabled"], base.observability.enabled);
  booleanField(issues, "observability.allowUnverifiedCapabilities", observability["allowUnverifiedCapabilities"], base.observability.allowUnverifiedCapabilities);

  oneOf(issues, "security.inputPolicy", security["inputPolicy"], INPUT_POLICIES, base.security.inputPolicy);
  oneOf(issues, "security.outputPolicy", security["outputPolicy"], OUTPUT_POLICIES, base.security.outputPolicy);

  if (maxSelectedAgents > maxSubtasks) {
    issues.push({ field: "agent.maxSelectedAgents", message: "must not exceed agent.maxSubtasksPerPlan" });
  }
  booleanField(issues, "agents.autoPromote", agents["autoPromote"], base.agents.autoPromote);
  oneOf(issues, "agents.maximumExternalTrust", agents["maximumExternalTrust"], TRUST_FLOORS, base.agents.maximumExternalTrust);
  stringArray(issues, "agents.enabledSources", agents["enabledSources"], base.agents.enabledSources);

  booleanField(issues, "ruflo.enabled", ruflo["enabled"], base.ruflo.enabled);

  positiveInt(issues, "tools.defaultTimeoutMs", tools["defaultTimeoutMs"], base.tools.defaultTimeoutMs);

  booleanField(issues, "learning.enabled", learning["enabled"], base.learning.enabled);
  const minimumSamples = positiveInt(issues, "learning.minimumSamples", learning["minimumSamples"], base.learning.minimumSamples);
  if (minimumSamples < 2 && learning["enabled"] === true) {
    // With one sample the "rate" is 0 or 1 and learning becomes superstition.
    issues.push({ field: "learning.minimumSamples", message: "must be at least 2 when learning is enabled" });
  }

  // PHASE 06 routing. The policy name is checked against the SHIPPED policies
  // rather than accepted as a free string, because a typo that survives to
  // runtime would be reported as a routing failure on every single request -
  // and would look like "routing is broken" rather than "the config is wrong".
  const defaultPolicy = routing["defaultPolicy"];
  if (defaultPolicy !== undefined) {
    if (typeof defaultPolicy !== "string" || !ROUTING_POLICY_NAMES.includes(defaultPolicy)) {
      issues.push({
        field: "routing.defaultPolicy",
        message: `must be one of: ${ROUTING_POLICY_NAMES.join(", ")}`,
      });
    }
  }
  const maxFallbackHops = positiveInt(
    issues,
    "routing.maxFallbackHops",
    routing["maxFallbackHops"],
    base.routing.maxFallbackHops,
  );
  if (maxFallbackHops < 1) {
    issues.push({
      field: "routing.maxFallbackHops",
      message: "must be at least 1, because a chain of zero hops can never route anything",
    });
  }
  const cooldown = routing["fallbackCooldownMs"];
  if (cooldown !== undefined && (typeof cooldown !== "number" || cooldown < 0)) {
    issues.push({
      field: "routing.fallbackCooldownMs",
      message: "must be a non-negative number. Zero disables the loop guard, which is a deliberate choice and not a default",
    });
  }
  booleanField(issues, "routing.allowUnprotectedRoutes", routing["allowUnprotectedRoutes"], base.routing.allowUnprotectedRoutes);
  // Per-key allow-list, as every other section has. Without it a typo such as
  // `defaultPolciy` is silently ignored and the DEFAULT policy is used, which
  // looks exactly like the setting having been applied and obeyed.
  rejectUnknownKeys(issues, "routing", routing, [
    "defaultPolicy",
    "maxFallbackHops",
    "fallbackCooldownMs",
    "allowUnprotectedRoutes",
  ]);

  // PHASE 07. Concurrency and attempt ceilings are the two values where a
  // plausible-looking misconfiguration turns into an outage, so both are
  // validated rather than merely coerced.
  const maxConcurrency = positiveInt(issues, "workflow.maxConcurrency", workflow["maxConcurrency"], base.workflow.maxConcurrency);
  if (maxConcurrency < 1) {
    issues.push({
      field: "workflow.maxConcurrency",
      message: "must be at least 1. There is no unlimited value: a workflow engine with no concurrency ceiling is an outage generator",
    });
  }
  const defaultMaxAttempts = positiveInt(
    issues,
    "workflow.defaultMaxAttempts",
    workflow["defaultMaxAttempts"],
    base.workflow.defaultMaxAttempts,
  );
  if (defaultMaxAttempts < 1) {
    issues.push({
      field: "workflow.defaultMaxAttempts",
      message: "must be at least 1; a task that may not be attempted cannot run at all",
    });
  }
  positiveInt(issues, "workflow.defaultTimeoutMs", workflow["defaultTimeoutMs"], base.workflow.defaultTimeoutMs);
  positiveInt(issues, "workflow.claimTtlMs", workflow["claimTtlMs"], base.workflow.claimTtlMs);
  positiveInt(issues, "workflow.backoffBaseMs", workflow["backoffBaseMs"], base.workflow.backoffBaseMs);
  const backoffMax = positiveInt(issues, "workflow.backoffMaxMs", workflow["backoffMaxMs"], base.workflow.backoffMaxMs);
  const backoffBase = numberOr(workflow["backoffBaseMs"], base.workflow.backoffBaseMs);
  if (backoffBase > backoffMax) {
    issues.push({
      field: "workflow.backoffBaseMs",
      message: `must not exceed workflow.backoffMaxMs (${backoffMax}); a base above the ceiling is a configuration contradiction, not a very long delay`,
    });
  }
  booleanField(issues, "workflow.allowApprovalGates", workflow["allowApprovalGates"], base.workflow.allowApprovalGates);
  rejectUnknownKeys(issues, "workflow", workflow, [
    "maxConcurrency",
    "defaultMaxAttempts",
    "defaultTimeoutMs",
    "claimTtlMs",
    "backoffBaseMs",
    "backoffMaxMs",
    "allowApprovalGates",
  ]);

  // PHASE 08 governance. The operation names are validated against the real
  // catalogue rather than accepted as free strings, because a permission checked
  // as "tools.invoke" in configuration and "tool.invoke" in the catalogue is two
  // permissions with a typo between them - and the typo reads as a denial.
  booleanField(issues, "governance.enforced", governance["enforced"], base.governance.enforced);
  booleanField(issues, "governance.blockOnUnknownCost", governance["blockOnUnknownCost"], base.governance.blockOnUnknownCost);
  for (const field of ["deferToSubsystem", "approvalRequired"] as const) {
    const value = governance[field];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      issues.push({ field: `governance.${field}`, message: "must be an array of operation names" });
      continue;
    }
    const unknown = (value as string[]).filter((entry) => !isOperation(entry));
    if (unknown.length > 0) {
      issues.push({
        field: `governance.${field}`,
        message: `contains operation(s) that do not exist: ${unknown.join(", ")}. Known operations: ${OPERATIONS.join(", ")}`,
      });
    }
  }
  for (const field of ["maxConcurrent", "maxAttemptsPerActor", "maxRuntimeMsPerActor"] as const) {
    const value = governance[field];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      issues.push({
        field: `governance.${field}`,
        message: "must be a positive integer or null. null means no governance limit, which is different from zero",
      });
    }
  }
  rejectUnknownKeys(issues, "governance", governance, [
    "enforced",
    "deferToSubsystem",
    "approvalRequired",
    "maxConcurrent",
    "maxAttemptsPerActor",
    "maxRuntimeMsPerActor",
    "blockOnUnknownCost",
  ]);

  booleanField(issues, "memory.enabled", memorySection["enabled"], base.memory.enabled);
  positiveInt(issues, "memory.recallLimit", memorySection["recallLimit"], base.memory.recallLimit);
  positiveInt(issues, "memory.recencyHalfLifeMs", memorySection["recencyHalfLifeMs"], base.memory.recencyHalfLifeMs);
  positiveInt(issues, "memory.maximumKnowledgeLength", memorySection["maximumKnowledgeLength"], base.memory.maximumKnowledgeLength);
  booleanField(issues, "memory.recordLearning", memorySection["recordLearning"], base.memory.recordLearning);
  stringArray(issues, "memory.recallScopes", memorySection["recallScopes"], base.memory.recallScopes);
  // A scope name that does not exist is not a harmless typo. It is a grant that
  // silently recalls nothing, so the deployment looks configured and behaves as
  // though memory were broken. Authority that cannot be checked is reported.
  const requestedScopes = memorySection["recallScopes"];
  if (Array.isArray(requestedScopes)) {
    const unknownScopes = requestedScopes.filter(
      (entry) => typeof entry === "string" && !isRecallableMemoryScope(entry),
    );
    if (unknownScopes.length > 0) {
      issues.push({
        field: "memory.recallScopes",
        message: `contains scope(s) that do not exist: ${unknownScopes.join(", ")}. Known scopes: ${RECALLABLE_MEMORY_SCOPES.join(", ")}`,
      });
    }
  }
  const minimumImportance = numberOr(memorySection["minimumImportance"], base.memory.minimumImportance);
  if (minimumImportance < 0 || minimumImportance > 1) {
    issues.push({ field: "memory.minimumImportance", message: "must be between 0 and 1" });
  }
  const importanceCeiling = numberOr(memorySection["importanceCeiling"], base.memory.importanceCeiling);
  if (importanceCeiling <= 0 || importanceCeiling > 1) {
    issues.push({ field: "memory.importanceCeiling", message: "must be greater than 0 and at most 1" });
  }
  if (importanceCeiling < minimumImportance) {
    // A ceiling below the floor would refuse everything: a silent total amnesia
    // is a configuration that typechecks and behaves like a bug.
    issues.push({ field: "memory.importanceCeiling", message: "must not be below memory.minimumImportance" });
  }

  if (maxRetries > 100) {
    issues.push({ field: "agent.maxSubtasksRetries", message: "must not exceed 100; an unbounded retry budget is not permitted" });
  }

  // Unknown keys are reported. A misspelled setting that is silently ignored is
  // a limit that looks configured and is not - the most expensive kind of
  // configuration bug, because it fails open.
  rejectUnknownKeys(issues, "", raw, [
    "agent",
    "memory",
    "worker",
    "observability",
    "security",
    "agents",
    "ruflo",
    "tools",
    "learning",
    // PHASE 06. Without this the section is rejected as an unknown setting and
    // every routing value below it is unreachable - found by running the CLI,
    // because the unit test only asserted that a bad policy was reported and
    // never that a good one was accepted.
    "routing",
    // PHASE 07. `workflow` was briefly dropped from this list while PHASE 08 was
    // being added, which made the whole section unconfigurable without any test
    // failing. Asserted directly in the config tests from now on.
    "workflow",
    // PHASE 08.
    "governance",
  ]);
  rejectUnknownKeys(issues, "agent", agent, [
    "maxSelectedAgents",
    "maxSubtasksPerPlan",
    "maxPlanDepth",
    "subtaskTimeoutMs",
    "maxSubtasksRetries",
    "defaultMinimumTrust",
    "maximumTrustFloor",
  ]);
  // ONE memory section: PHASE 04 and PHASE 05 fields live together, so a
  // deployment cannot configure two disagreeing memory sections.
  rejectUnknownKeys(issues, "memory", memorySection, [
    "enabled",
    "executionScope",
    "defaultAgentScopes",
    "recallScopes",
    "recallLimit",
    "minimumImportance",
    "importanceCeiling",
    "recencyHalfLifeMs",
    "maximumKnowledgeLength",
    "recordLearning",
  ]);
  rejectUnknownKeys(issues, "worker", worker, ["enabled", "defaultTimeoutMs", "maxAttempts", "maxHistory"]);
  rejectUnknownKeys(issues, "observability", observability, ["enabled", "allowUnverifiedCapabilities"]);
  rejectUnknownKeys(issues, "security", security, ["inputPolicy", "outputPolicy"]);
  rejectUnknownKeys(issues, "agents", agents, ["enabledSources", "maximumExternalTrust", "autoPromote"]);
  rejectUnknownKeys(issues, "ruflo", ruflo, ["enabled"]);
  rejectUnknownKeys(issues, "tools", tools, ["defaultTimeoutMs"]);
  rejectUnknownKeys(issues, "learning", learning, ["enabled", "minimumSamples"]);

  return issues;
}

function rejectUnknownKeys(
  issues: OrchestrationConfigIssue[],
  prefix: string,
  section: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(section)) {
    if (!allowed.includes(key)) {
      issues.push({
        field: prefix === "" ? key : `${prefix}.${key}`,
        message: `is not a known setting (known: ${allowed.join(", ")})`,
      });
    }
  }
}

const TRUST_FLOORS = ["untrusted", "low", "standard", "high", "privileged"] as const;
const INPUT_POLICIES = ["permissive", "deny_all", "heuristic"] as const;
const OUTPUT_POLICIES = ["permissive", "deny_all"] as const;

function asSection(value: unknown, field: string, issues: OrchestrationConfigIssue[]): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    issues.push({ field, message: "must be an object" });
    return {};
  }
  return value as Record<string, unknown>;
}

/** Builds a validated configuration, falling back to defaults for anything absent. */
export function loadOrchestrationConfig(raw: Record<string, unknown> = {}): OrchestrationConfig {
  const base = DEFAULT_ORCHESTRATION_CONFIG;
  const agent = (raw["agent"] ?? {}) as Record<string, unknown>;
  const memory = (raw["memory"] ?? {}) as Record<string, unknown>;
  const worker = (raw["worker"] ?? {}) as Record<string, unknown>;
  const observability = (raw["observability"] ?? {}) as Record<string, unknown>;
  const security = (raw["security"] ?? {}) as Record<string, unknown>;
  const agents = (raw["agents"] ?? {}) as Record<string, unknown>;
  const ruflo = (raw["ruflo"] ?? {}) as Record<string, unknown>;
  const tools = (raw["tools"] ?? {}) as Record<string, unknown>;
  const learning = (raw["learning"] ?? {}) as Record<string, unknown>;
  const routing = (raw["routing"] ?? {}) as Record<string, unknown>;
  const workflow = (raw["workflow"] ?? {}) as Record<string, unknown>;
  const governance = (raw["governance"] ?? {}) as Record<string, unknown>;

  return {
    agent: {
      maxSelectedAgents: numberOr(agent["maxSelectedAgents"], base.agent.maxSelectedAgents),
      maxSubtasksPerPlan: numberOr(agent["maxSubtasksPerPlan"], base.agent.maxSubtasksPerPlan),
      maxPlanDepth: numberOr(agent["maxPlanDepth"], base.agent.maxPlanDepth),
      subtaskTimeoutMs: numberOr(agent["subtaskTimeoutMs"], base.agent.subtaskTimeoutMs),
      maxSubtasksRetries: numberOr(agent["maxSubtasksRetries"], base.agent.maxSubtasksRetries),
      defaultMinimumTrust: (agent["defaultMinimumTrust"] as TrustLevel) ?? base.agent.defaultMinimumTrust,
      maximumTrustFloor: (agent["maximumTrustFloor"] as TrustLevel) ?? base.agent.maximumTrustFloor,
    },
    memory: {
      enabled: memory["enabled"] === undefined ? base.memory.enabled : memory["enabled"] === true,
      executionScope: typeof memory["executionScope"] === "string" ? memory["executionScope"] : base.memory.executionScope,
      defaultAgentScopes: Array.isArray(memory["defaultAgentScopes"])
        ? (memory["defaultAgentScopes"] as string[])
        : [...base.memory.defaultAgentScopes],
      recallScopes: stringArrayOr(memory["recallScopes"], base.memory.recallScopes),
      recallLimit: numberOr(memory["recallLimit"], base.memory.recallLimit),
      minimumImportance: numberOr(memory["minimumImportance"], base.memory.minimumImportance),
      importanceCeiling: numberOr(memory["importanceCeiling"], base.memory.importanceCeiling),
      recencyHalfLifeMs: numberOr(memory["recencyHalfLifeMs"], base.memory.recencyHalfLifeMs),
      maximumKnowledgeLength: numberOr(memory["maximumKnowledgeLength"], base.memory.maximumKnowledgeLength),
      recordLearning:
        memory["recordLearning"] === undefined ? base.memory.recordLearning : memory["recordLearning"] === true,
    },
    worker: {
      enabled: worker["enabled"] === undefined ? base.worker.enabled : worker["enabled"] === true,
      defaultTimeoutMs: numberOr(worker["defaultTimeoutMs"], base.worker.defaultTimeoutMs),
      maxAttempts: numberOr(worker["maxAttempts"], base.worker.maxAttempts),
      maxHistory: numberOr(worker["maxHistory"], base.worker.maxHistory),
    },
    observability: {
      enabled: observability["enabled"] === undefined ? base.observability.enabled : observability["enabled"] === true,
      allowUnverifiedCapabilities:
        observability["allowUnverifiedCapabilities"] === undefined
          ? base.observability.allowUnverifiedCapabilities
          : observability["allowUnverifiedCapabilities"] === true,
    },
    security: {
      inputPolicy: oneOfValue(
        security["inputPolicy"],
        base.security.inputPolicy,
        ["permissive", "deny_all", "heuristic"],
      ),
      outputPolicy: oneOfValue(security["outputPolicy"], base.security.outputPolicy, ["permissive", "deny_all"]),
    },
    agents: {
      enabledSources: stringArrayOr(agents["enabledSources"], base.agents.enabledSources),
      maximumExternalTrust: oneOfValue(
        agents["maximumExternalTrust"],
        base.agents.maximumExternalTrust,
        TRUST_FLOORS,
      ),
      autoPromote: agents["autoPromote"] === undefined ? base.agents.autoPromote : agents["autoPromote"] === true,
    },
    ruflo: {
      enabled: ruflo["enabled"] === undefined ? base.ruflo.enabled : ruflo["enabled"] === true,
    },
    tools: {
      defaultTimeoutMs: numberOr(tools["defaultTimeoutMs"], base.tools.defaultTimeoutMs),
    },
    learning: {
      enabled: learning["enabled"] === undefined ? base.learning.enabled : learning["enabled"] === true,
      minimumSamples: numberOr(learning["minimumSamples"], base.learning.minimumSamples),
    },
    governance: {
      // Read from the supplied raw object, NOT hard-coded: a normalisation
      // function that ignores its input is worse than one that does not exist.
      enforced: governance["enforced"] === undefined ? base.governance.enforced : governance["enforced"] === true,
      deferToSubsystem: stringArrayOr(governance["deferToSubsystem"], base.governance.deferToSubsystem),
      approvalRequired: stringArrayOr(governance["approvalRequired"], base.governance.approvalRequired),
      maxConcurrent: nullableNumberOr(governance["maxConcurrent"], base.governance.maxConcurrent),
      maxAttemptsPerActor: nullableNumberOr(governance["maxAttemptsPerActor"], base.governance.maxAttemptsPerActor),
      maxRuntimeMsPerActor: nullableNumberOr(governance["maxRuntimeMsPerActor"], base.governance.maxRuntimeMsPerActor),
      blockOnUnknownCost:
        governance["blockOnUnknownCost"] === undefined
          ? base.governance.blockOnUnknownCost
          : governance["blockOnUnknownCost"] === true,
    },
    workflow: {
    // Read from the supplied raw object, NOT hard-coded. A normalisation
    // function that ignores its input is worse than one that does not exist,
    // because a deployment would see its setting accepted and then ignored.
    maxConcurrency: numberOr(workflow["maxConcurrency"], base.workflow.maxConcurrency),
    defaultMaxAttempts: numberOr(workflow["defaultMaxAttempts"], base.workflow.defaultMaxAttempts),
    defaultTimeoutMs: numberOr(workflow["defaultTimeoutMs"], base.workflow.defaultTimeoutMs),
    claimTtlMs: numberOr(workflow["claimTtlMs"], base.workflow.claimTtlMs),
    backoffBaseMs: numberOr(workflow["backoffBaseMs"], base.workflow.backoffBaseMs),
    backoffMaxMs: numberOr(workflow["backoffMaxMs"], base.workflow.backoffMaxMs),
    allowApprovalGates:
      workflow["allowApprovalGates"] === undefined
        ? base.workflow.allowApprovalGates
        : workflow["allowApprovalGates"] === true,
  },
  routing: {
      defaultPolicy:
        typeof routing["defaultPolicy"] === "string" && routing["defaultPolicy"] !== ""
          ? routing["defaultPolicy"]
          : base.routing.defaultPolicy,
      maxFallbackHops: numberOr(routing["maxFallbackHops"], base.routing.maxFallbackHops),
      fallbackCooldownMs: numberOr(routing["fallbackCooldownMs"], base.routing.fallbackCooldownMs),
      allowUnprotectedRoutes:
        routing["allowUnprotectedRoutes"] === undefined
          ? base.routing.allowUnprotectedRoutes
          : routing["allowUnprotectedRoutes"] === true,
    },
  };
}

/**
 * Falls back for a value outside the allowed set.
 *
 * `loadOrchestrationConfig` is called on paths that never run the validator, so
 * an unrecognised string must not reach the running system as if it were a
 * policy: a typo in a policy name is a configuration failure, not a new policy.
 */
function oneOfValue<T extends string>(value: unknown, fallback: T, allowed: readonly T[]): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Validates a string array, reporting anything that is not a string. */
function stringArray(
  issues: OrchestrationConfigIssue[],
  field: string,
  value: unknown,
  fallback: readonly string[],
): readonly string[] {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value)) {
    issues.push({ field, message: "must be an array of strings" });
    return fallback;
  }
  const bad = value.filter((entry) => typeof entry !== "string");
  if (bad.length > 0) {
    issues.push({ field, message: `must contain only strings; ${bad.length} entr(y|ies) were not` });
    return fallback;
  }
  return value as string[];
}

/**
 * A number that may also be explicitly null.
 *
 * `null` here means "no governance limit", which is NOT the same as `0`. Reading
 * an omitted limit as zero would make every operation exceed it.
 */
function nullableNumberOr(value: unknown, fallback: number | null): number | null {
  if (value === undefined) {
    return fallback;
  }
  if (value === null) {
    return null;
  }
  // An environment value arrives as a STRING, and coercing it here is what makes
  // `TOZ_GOVERNANCE_MAX_CONCURRENT=8` work at all. The validator still reports a
  // non-numeric value; this is conversion, not leniency.
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : fallback;
}

function stringArrayOr(value: unknown, fallback: readonly string[]): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [...fallback];
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : fallback;
}

export { booleanField, oneOf, positiveInt };

/**
 * Reads the orchestration settings out of the application configuration.
 *
 * The app config carries this section so there is ONE configuration object for
 * the whole system, but it is a raw passthrough: the core cannot validate these
 * fields without importing this layer, which is why the schema lives here.
 *
 * Returns the issues as well as the config, so a caller that only wants the
 * values is not forced to ignore the fact that some of them were rejected and a
 * default was substituted.
 */
export function orchestrationConfigFromApp(appConfig: {
  readonly orchestration?: Readonly<Record<string, unknown>>;
}): { readonly config: OrchestrationConfig; readonly issues: readonly OrchestrationConfigIssue[] } {
  const raw = { ...(appConfig.orchestration ?? {}) };
  const issues = validateOrchestrationConfig(raw);
  return { config: loadOrchestrationConfig(raw), issues };
}
