/**
 * Orchestration environment mapping.
 *
 * A fixed allow-list, exactly as `src/config/load.ts` does for the core. A
 * `TOZ_` prefix is NOT sufficient to inject a value, so an unexpected variable
 * cannot silently change orchestration behaviour.
 *
 * NO SECRET VALUES ARE READ. Nothing in this file resolves a credential; that
 * happens at a provider-adapter boundary, and no adapter ships in PHASE 04.
 */

import { type OrchestrationConfig, loadOrchestrationConfig } from "./orchestrationConfig.js";
import { governanceSectionFromEnv } from "./governanceEnv.js";

export type OrchestrationEnv = Readonly<Record<string, string | undefined>>;

/**
 * The raw value of a variable, or undefined when it is unset or empty.
 *
 * Named `raw` rather than `num` because it does not convert anything: the
 * validators own conversion, so a malformed value is REPORTED as malformed
 * rather than being quietly coerced. It also gates what a deployment may grant,
 * so a reader should not have to guess whether it returns a string or a number.
 */
function raw(env: OrchestrationEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

function bool(env: OrchestrationEnv, key: string): boolean | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  // Anything else is passed through as a string so the validator reports it,
  // rather than being silently treated as false.
  return value as unknown as boolean;
}

/**
 * Projects the allow-listed variables into a raw configuration object.
 *
 * Only the variables named here are read.
 */
export function rawOrchestrationConfigFromEnv(env: OrchestrationEnv): Record<string, unknown> {
  const agent: Record<string, unknown> = {};
  if (raw(env, "TOZ_AGENT_MAX_SELECTED") !== undefined) agent["maxSelectedAgents"] = raw(env, "TOZ_AGENT_MAX_SELECTED");
  if (raw(env, "TOZ_AGENT_MAX_SUBTASKS") !== undefined) agent["maxSubtasksPerPlan"] = raw(env, "TOZ_AGENT_MAX_SUBTASKS");
  if (raw(env, "TOZ_AGENT_MAX_DEPTH") !== undefined) agent["maxPlanDepth"] = raw(env, "TOZ_AGENT_MAX_DEPTH");
  if (raw(env, "TOZ_AGENT_SUBTASK_TIMEOUT_MS") !== undefined) agent["subtaskTimeoutMs"] = raw(env, "TOZ_AGENT_SUBTASK_TIMEOUT_MS");
  if (raw(env, "TOZ_AGENT_MAX_RETRIES") !== undefined) agent["maxSubtasksRetries"] = raw(env, "TOZ_AGENT_MAX_RETRIES");
  if (raw(env, "TOZ_AGENT_DEFAULT_TRUST") !== undefined) agent["defaultMinimumTrust"] = raw(env, "TOZ_AGENT_DEFAULT_TRUST");

  const memory: Record<string, unknown> = {};
  if (bool(env, "TOZ_MEMORY_ENABLED") !== undefined) memory["enabled"] = bool(env, "TOZ_MEMORY_ENABLED");
  if (raw(env, "TOZ_MEMORY_SCOPE") !== undefined) memory["executionScope"] = raw(env, "TOZ_MEMORY_SCOPE");

  const worker: Record<string, unknown> = {};
  if (bool(env, "TOZ_WORKER_ENABLED") !== undefined) worker["enabled"] = bool(env, "TOZ_WORKER_ENABLED");
  if (raw(env, "TOZ_WORKER_TIMEOUT_MS") !== undefined) worker["defaultTimeoutMs"] = raw(env, "TOZ_WORKER_TIMEOUT_MS");
  if (raw(env, "TOZ_WORKER_MAX_ATTEMPTS") !== undefined) worker["maxAttempts"] = raw(env, "TOZ_WORKER_MAX_ATTEMPTS");

  const observability: Record<string, unknown> = {};
  if (bool(env, "TOZ_OBSERVABILITY_ENABLED") !== undefined) {
    observability["enabled"] = bool(env, "TOZ_OBSERVABILITY_ENABLED");
  }
  if (bool(env, "TOZ_ALLOW_UNVERIFIED_CAPABILITIES") !== undefined) {
    observability["allowUnverifiedCapabilities"] = bool(env, "TOZ_ALLOW_UNVERIFIED_CAPABILITIES");
  }

  const security: Record<string, unknown> = {};
  if (raw(env, "TOZ_SECURITY_INPUT_POLICY") !== undefined) {
    security["inputPolicy"] = raw(env, "TOZ_SECURITY_INPUT_POLICY");
  }
  if (raw(env, "TOZ_SECURITY_OUTPUT_POLICY") !== undefined) {
    security["outputPolicy"] = raw(env, "TOZ_SECURITY_OUTPUT_POLICY");
  }

  // PHASE 04.1. `TOZ_AGENT_SOURCES` is a comma-separated allow-list: naming a
  // source is what permits it to be contacted at all. An unset value means no
  // source is contacted, which is the safe default and the shipped one.
  const agents: Record<string, unknown> = {};
  const sources = raw(env, "TOZ_AGENT_SOURCES");
  if (sources !== undefined) {
    agents["enabledSources"] = sources
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  }
  if (raw(env, "TOZ_AGENT_MAX_EXTERNAL_TRUST") !== undefined) {
    agents["maximumExternalTrust"] = raw(env, "TOZ_AGENT_MAX_EXTERNAL_TRUST");
  }
  if (bool(env, "TOZ_AGENT_AUTO_PROMOTE") !== undefined) {
    agents["autoPromote"] = bool(env, "TOZ_AGENT_AUTO_PROMOTE");
  }

  const ruflo: Record<string, unknown> = {};
  if (bool(env, "TOZ_RUFLO_ENABLED") !== undefined) {
    ruflo["enabled"] = bool(env, "TOZ_RUFLO_ENABLED");
  }

  const tools: Record<string, unknown> = {};
  if (raw(env, "TOZ_TOOL_TIMEOUT_MS") !== undefined) {
    tools["defaultTimeoutMs"] = raw(env, "TOZ_TOOL_TIMEOUT_MS");
  }

  const learning: Record<string, unknown> = {};
  if (bool(env, "TOZ_LEARNING_ENABLED") !== undefined) {
    learning["enabled"] = bool(env, "TOZ_LEARNING_ENABLED");
  }
  if (raw(env, "TOZ_LEARNING_MIN_SAMPLES") !== undefined) {
    learning["minimumSamples"] = raw(env, "TOZ_LEARNING_MIN_SAMPLES");
  }

  // PHASE 05. `TOZ_MEMORY_RECALL_SCOPES` is a comma-separated allow-list: naming a
  // scope is what permits the orchestrator to read it at all.
  const memoryRecall = raw(env, "TOZ_MEMORY_RECALL_SCOPES");
  if (memoryRecall !== undefined) {
    memory["recallScopes"] = memoryRecall
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  }
  if (raw(env, "TOZ_MEMORY_RECALL_LIMIT") !== undefined) {
    memory["recallLimit"] = raw(env, "TOZ_MEMORY_RECALL_LIMIT");
  }
  if (raw(env, "TOZ_MEMORY_MIN_IMPORTANCE") !== undefined) {
    memory["minimumImportance"] = raw(env, "TOZ_MEMORY_MIN_IMPORTANCE");
  }
  if (bool(env, "TOZ_MEMORY_RECORD_LEARNING") !== undefined) {
    memory["recordLearning"] = bool(env, "TOZ_MEMORY_RECORD_LEARNING");
  }

  // PHASE 06 routing. The policy name is passed through as written so the
  // validator can NAME the bad value, rather than being rejected here where the
  // operator would only see "not a valid string".
  const routing: Record<string, unknown> = {};
  if (raw(env, "TOZ_ROUTING_POLICY") !== undefined) {
    routing["defaultPolicy"] = raw(env, "TOZ_ROUTING_POLICY");
  }
  if (raw(env, "TOZ_ROUTING_MAX_FALLBACK_HOPS") !== undefined) {
    routing["maxFallbackHops"] = raw(env, "TOZ_ROUTING_MAX_FALLBACK_HOPS");
  }
  if (raw(env, "TOZ_ROUTING_FALLBACK_COOLDOWN_MS") !== undefined) {
    routing["fallbackCooldownMs"] = raw(env, "TOZ_ROUTING_FALLBACK_COOLDOWN_MS");
  }
  if (bool(env, "TOZ_ROUTING_ALLOW_UNPROTECTED") !== undefined) {
    routing["allowUnprotectedRoutes"] = bool(env, "TOZ_ROUTING_ALLOW_UNPROTECTED");
  }

  // PHASE 07 workflow and worker bounds. Concurrency and attempt ceilings are
  // passed through as written so the validator can NAME a bad value rather than
  // silently coercing it into something that looks configured.
  //
  // These were documented in `.env.example` for PHASE 07 but this block was never
  // added, so every `TOZ_WORKFLOW_*` variable was silently inert. A documented
  // setting that does nothing is worse than an absent one, because a deployment
  // reads it as applied.
  const workflow: Record<string, unknown> = {};
  if (raw(env, "TOZ_WORKFLOW_MAX_CONCURRENCY") !== undefined) {
    workflow["maxConcurrency"] = raw(env, "TOZ_WORKFLOW_MAX_CONCURRENCY");
  }
  if (raw(env, "TOZ_WORKFLOW_DEFAULT_MAX_ATTEMPTS") !== undefined) {
    workflow["defaultMaxAttempts"] = raw(env, "TOZ_WORKFLOW_DEFAULT_MAX_ATTEMPTS");
  }
  if (raw(env, "TOZ_WORKFLOW_DEFAULT_TIMEOUT_MS") !== undefined) {
    workflow["defaultTimeoutMs"] = raw(env, "TOZ_WORKFLOW_DEFAULT_TIMEOUT_MS");
  }
  if (raw(env, "TOZ_WORKFLOW_CLAIM_TTL_MS") !== undefined) {
    workflow["claimTtlMs"] = raw(env, "TOZ_WORKFLOW_CLAIM_TTL_MS");
  }
  if (raw(env, "TOZ_WORKFLOW_BACKOFF_BASE_MS") !== undefined) {
    workflow["backoffBaseMs"] = raw(env, "TOZ_WORKFLOW_BACKOFF_BASE_MS");
  }
  if (raw(env, "TOZ_WORKFLOW_BACKOFF_MAX_MS") !== undefined) {
    workflow["backoffMaxMs"] = raw(env, "TOZ_WORKFLOW_BACKOFF_MAX_MS");
  }
  if (bool(env, "TOZ_WORKFLOW_ALLOW_APPROVAL") !== undefined) {
    workflow["allowApprovalGates"] = bool(env, "TOZ_WORKFLOW_ALLOW_APPROVAL");
  }

  // PHASE 08 governance. Split into its own module because the block is long
  // enough to have buried the surrounding sections, and these are the values a
  // deployment is most likely to get wrong.
  const governance = governanceSectionFromEnv(env);

  return { agent, memory, worker, observability, security, agents, ruflo, tools, learning, routing, workflow, governance };
}

/** Loads and normalises orchestration configuration from the environment. */
export function loadOrchestrationConfigFromEnv(env: OrchestrationEnv): OrchestrationConfig {
  return loadOrchestrationConfig(rawOrchestrationConfigFromEnv(env));
}
