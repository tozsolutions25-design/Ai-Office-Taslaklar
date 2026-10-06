import { validateRetryPolicy } from "../retry/policy.js";
import { ERROR_CLASSES, type ErrorClass, isErrorClass } from "../core/errors.js";
import { err, ok, type Result } from "../core/result.js";
import {
  APP_ENVIRONMENTS,
  type AppConfig,
  DEFAULT_CONFIG,
  LOG_LEVELS,
  type LogLevel,
  type AppEnvironment,
  type ProviderConfig,
} from "./schema.js";
import { redactString } from "../audit/redaction.js";

/**
 * Configuration validation.
 *
 * Unknown values are rejected rather than coerced. A missing required value is
 * an error; an optional value with a safe default is filled in. Defaults
 * exist for development ergonomics only and are documented in .env.example.
 */

export interface ConfigIssue {
  readonly field: string;
  readonly message: string;
}

export interface ConfigValidationError {
  readonly issues: readonly ConfigIssue[];
}

const COST_CLASSES = ["free", "low", "standard", "premium", "unknown"] as const;
const FREE_TIER_STATUSES = ["unknown", "available", "not_available", "exhausted"] as const;
const BACKOFF_KINDS = ["none", "fixed", "exponential"] as const;

/**
 * Renders a value for an error message.
 *
 * Uses JSON for structured values so the message stays informative, and never
 * falls back to the useless default `[object Object]`.
 */
function describe(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "<unserialisable>" : encoded;
  } catch {
    return "<unserialisable>";
  }
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function checkPositiveInt(
  issues: ConfigIssue[],
  field: string,
  value: unknown,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    issues.push({ field, message: `must be a positive integer, received: ${describe(value)}` });
    return fallback;
  }
  return numeric;
}

function checkNonNegativeNumber(
  issues: ConfigIssue[],
  field: string,
  value: unknown,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric < 0) {
    issues.push({ field, message: `must be a number >= 0, received: ${describe(value)}` });
    return fallback;
  }
  return numeric;
}

function checkBoolean(issues: ConfigIssue[], field: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  issues.push({ field, message: `must be a boolean, received: ${describe(value)}` });
  return fallback;
}

function checkEnum<T extends string>(
  issues: ConfigIssue[],
  field: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) {
    return fallback;
  }
  if (isOneOf(value, allowed)) {
    return value;
  }
  issues.push({ field, message: `must be one of: ${allowed.join(", ")} (received: ${describe(value)})` });
  return fallback;
}

/**
 * Validates a raw, already-parsed configuration object.
 *
 * `TOZ_ENV` is the only REQUIRED value: the core must know which environment
 * it is running in before it applies any defaults.
 */
export function validateConfig(raw: Record<string, unknown>): Result<AppConfig, ConfigValidationError> {
  const issues: ConfigIssue[] = [];
  const base = DEFAULT_CONFIG;

  const app = readSection(raw["app"], issues);
  const logging = readSection(raw["logging"], issues);
  const queue = readSection(raw["queue"], issues);
  const concurrency = readSection(raw["concurrency"], issues);
  const retry = readSection(raw["retry"], issues);
  const health = readSection(raw["health"], issues);
  const routing = readSection(raw["routing"], issues);
  const request = readSection(raw["request"], issues);
  const providers = readSection(raw["providers"], issues);
  // Passthrough: the shape is owned by PHASE 04, so the core checks only that it is an object.

  // ---- app.environment is REQUIRED ----
  let environment: AppEnvironment = base.app.environment;
  if (app["environment"] === undefined) {
    issues.push({
      field: "app.environment",
      message: `is required. Set TOZ_ENV to one of: ${APP_ENVIRONMENTS.join(", ")}`,
    });
  } else {
    environment = checkEnum(issues, "app.environment", app["environment"], APP_ENVIRONMENTS, base.app.environment);
  }

  const name =
    typeof app["name"] === "string" && app["name"].trim() !== ""
      ? app["name"]
      : base.app.name;
  if (app["name"] !== undefined && typeof app["name"] !== "string") {
    issues.push({ field: "app.name", message: "must be a string when provided" });
  }

  const instanceId =
    typeof app["instanceId"] === "string" && app["instanceId"].trim() !== ""
      ? app["instanceId"]
      : base.app.instanceId;

  // ---- logging / audit ----
  const level: LogLevel = checkEnum(issues, "logging.level", logging["level"], LOG_LEVELS, base.logging.level);
  const auditEnabled = checkBoolean(issues, "logging.auditEnabled", logging["auditEnabled"], base.logging.auditEnabled);
  const auditMaxEvents = checkPositiveInt(issues, "logging.auditMaxEvents", logging["auditMaxEvents"], base.logging.auditMaxEvents);

  // ---- queue ----
  const maxTasks = checkPositiveInt(issues, "queue.maxTasks", queue["maxTasks"], base.queue.maxTasks);
  const logical = readSection(queue["logical"], issues);
  const maxAgents = checkPositiveInt(issues, "queue.logical.maxAgents", logical["maxAgents"], base.queue.logical.maxAgents);
  const maxWorkflows = checkPositiveInt(
    issues,
    "queue.logical.maxConcurrentWorkflows",
    logical["maxConcurrentWorkflows"],
    base.queue.logical.maxConcurrentWorkflows,
  );

  // ---- concurrency ----
  const globalLimit = checkPositiveInt(issues, "concurrency.globalLimit", concurrency["globalLimit"], base.concurrency.globalLimit);
  const globalMaxWaiting = checkNonNegativeNumber(
    issues,
    "concurrency.globalMaxWaiting",
    concurrency["globalMaxWaiting"],
    base.concurrency.globalMaxWaiting,
  );
  if (!Number.isInteger(globalMaxWaiting)) {
    issues.push({ field: "concurrency.globalMaxWaiting", message: "must be an integer" });
  }
  checkLimitMap(issues, "concurrency.providerLimits", concurrency["providerLimits"], globalLimit);
  checkLimitMap(issues, "concurrency.modelLimits", concurrency["modelLimits"], globalLimit);

  // ---- retry ----
  const backoff = readSection(retry["backoff"], issues);
  const retryableClasses = readRetryableClasses(retry["retryableClasses"], issues);
  const retryPolicy = {
    maxAttempts: checkPositiveInt(issues, "retry.maxAttempts", retry["maxAttempts"], base.retry.maxAttempts),
    ...(retryableClasses ? { retryableClasses } : {}),
    backoff: {
      kind: checkEnum(issues, "retry.backoff.kind", backoff["kind"], BACKOFF_KINDS, base.retry.backoff.kind),
      baseDelayMs: checkNonNegativeNumber(issues, "retry.backoff.baseDelayMs", backoff["baseDelayMs"], base.retry.backoff.baseDelayMs),
      maxDelayMs: checkNonNegativeNumber(issues, "retry.backoff.maxDelayMs", backoff["maxDelayMs"], base.retry.backoff.maxDelayMs),
      jitterRatio: checkNonNegativeNumber(issues, "retry.backoff.jitterRatio", backoff["jitterRatio"], base.retry.backoff.jitterRatio),
    },
    fallbackOnQuotaExhausted: checkBoolean(
      issues,
      "retry.fallbackOnQuotaExhausted",
      retry["fallbackOnQuotaExhausted"],
      base.retry.fallbackOnQuotaExhausted,
    ),
  };
  for (const message of validateRetryPolicy(retryPolicy)) {
    issues.push({ field: "retry", message });
  }

  // ---- health ----
  const healthConfig = {
    intervalMs: checkPositiveInt(issues, "health.intervalMs", health["intervalMs"], base.health.intervalMs),
    degradedAfterFailures: checkPositiveInt(
      issues,
      "health.degradedAfterFailures",
      health["degradedAfterFailures"],
      base.health.degradedAfterFailures,
    ),
    unavailableAfterFailures: checkPositiveInt(
      issues,
      "health.unavailableAfterFailures",
      health["unavailableAfterFailures"],
      base.health.unavailableAfterFailures,
    ),
    degradedLatencyMs:
      health["degradedLatencyMs"] === undefined || health["degradedLatencyMs"] === null
        ? null
        : checkPositiveInt(issues, "health.degradedLatencyMs", health["degradedLatencyMs"], 0),
  };
  if (healthConfig.unavailableAfterFailures < healthConfig.degradedAfterFailures) {
    issues.push({
      field: "health.unavailableAfterFailures",
      message: "must be >= health.degradedAfterFailures",
    });
  }

  // ---- routing ----
  const allowUnknownCapabilities = checkBoolean(
    issues,
    "routing.allowUnknownCapabilities",
    routing["allowUnknownCapabilities"],
    base.routing.allowUnknownCapabilities,
  );

  // ---- request ----
  const timeoutMs = checkPositiveInt(issues, "request.timeoutMs", request["timeoutMs"], base.request.timeoutMs);

  // ---- providers ----
  const providerConfigs = validateProviders(providers, issues);

  if (issues.length > 0) {
    return err({ issues });
  }

  return ok({
    app: { name, environment, instanceId },
    logging: { level, auditEnabled, auditMaxEvents },
    queue: { maxTasks, logical: { maxAgents, maxConcurrentWorkflows: maxWorkflows } },
    concurrency: {
      globalLimit,
      globalMaxWaiting,
      providerLimits: toNumberMap(concurrency["providerLimits"]),
      providerMaxWaiting: toNumberMap(concurrency["providerMaxWaiting"]),
      modelLimits: toNumberMap(concurrency["modelLimits"]),
      modelMaxWaiting: toNumberMap(concurrency["modelMaxWaiting"]),
    },
    retry: retryPolicy,
    health: healthConfig,
    routing: { allowUnknownCapabilities },
    request: { timeoutMs },
    providers: providerConfigs,
    // Copied verbatim; `orchestrationConfigFromApp` applies the real schema,
    // because the core cannot import the layer that owns it.
    orchestration: readSection(raw["orchestration"], issues),
  });
}

/**
 * Reads an optional retryable error-class allow-list.
 *
 * Permanent classes are rejected here rather than silently dropped, so a
 * configuration asking to retry authentication failures fails loudly instead
 * of being quietly ignored at execution time.
 */
function readRetryableClasses(
  value: unknown,
  issues: ConfigIssue[],
): readonly ErrorClass[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    issues.push({ field: "retry.retryableClasses", message: "must be an array of error class names" });
    return undefined;
  }
  const parsed: ErrorClass[] = [];
  for (const entry of value) {
    if (!isErrorClass(entry)) {
      issues.push({
        field: "retry.retryableClasses",
        message: `unknown error class: ${String(entry)}. Known classes: ${ERROR_CLASSES.join(", ")}`,
      });
      continue;
    }
    parsed.push(entry);
  }
  return parsed;
}

function readSection(value: unknown, issues: ConfigIssue[]): Record<string, unknown> {  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    // PHASE 10: the received value goes through the same redaction as everything
    // else. This message is printed by the CLI, and a malformed secret-bearing
    // section would otherwise be echoed verbatim to a terminal and a log.
    issues.push({ field: "(section)", message: `expected an object, received: ${redactString(JSON.stringify(value))}` });
    return {};
  }
  return value as Record<string, unknown>;
}

function checkLimitMap(
  issues: ConfigIssue[],
  field: string,
  value: unknown,
  fallback: number,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push({ field, message: "must be an object mapping name -> positive integer" });
    return;
  }
  for (const [key, limit] of Object.entries(value as Record<string, unknown>)) {
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
      issues.push({ field: `${field}.${key}`, message: `must be a positive integer, received: ${describe(limit)}` });
    }
  }
  if (fallback <= 0) {
    issues.push({ field, message: "cannot resolve a positive fallback limit" });
  }
}

function toNumberMap(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "number") {
      out[key] = entry;
    }
  }
  return out;
}

function validateProviders(
  raw: Record<string, unknown>,
  issues: ConfigIssue[],
): Record<string, ProviderConfig> {
  const out: Record<string, ProviderConfig> = {};
  if (raw["enabled"] === undefined && Object.keys(raw).length === 0) {
    return out;
  }
  for (const [id, entryRaw] of Object.entries(raw)) {
    if (id === "enabled") {
      // Convenience flag, not a provider.
      continue;
    }
    const entry = readSection(entryRaw, issues);
    const authEnvVarName = entry["authEnvVarName"];
    if (authEnvVarName !== undefined && authEnvVarName !== null && typeof authEnvVarName !== "string") {
      issues.push({
        field: `providers.${id}.authEnvVarName`,
        message: "must be an environment variable NAME (string) or null, never a secret value",
      });
    }
    if (typeof authEnvVarName === "string" && authEnvVarName.trim() === "") {
      issues.push({ field: `providers.${id}.authEnvVarName`, message: "must not be an empty string" });
    }
    const endpoint = entry["endpoint"];
    if (endpoint !== undefined && endpoint !== null && typeof endpoint !== "string") {
      issues.push({ field: `providers.${id}.endpoint`, message: "must be a string URL or null" });
    }
    out[id] = {
      name: typeof entry["name"] === "string" ? entry["name"] : id,
      type: typeof entry["type"] === "string" ? entry["type"] : "unknown",
      enabled: checkBoolean(issues, `providers.${id}.enabled`, entry["enabled"], false),
      endpoint: typeof endpoint === "string" ? endpoint : null,
      authEnvVarName: typeof authEnvVarName === "string" ? authEnvVarName : null,
      maxConcurrentRequests:
        entry["maxConcurrentRequests"] === undefined || entry["maxConcurrentRequests"] === null
          ? null
          : checkPositiveInt(issues, `providers.${id}.maxConcurrentRequests`, entry["maxConcurrentRequests"], 0),
      costClass: checkEnum(issues, `providers.${id}.costClass`, entry["costClass"], COST_CLASSES, "unknown"),
      freeTierStatus: checkEnum(
        issues,
        `providers.${id}.freeTierStatus`,
        entry["freeTierStatus"],
        FREE_TIER_STATUSES,
        "unknown",
      ),
    };
  }
  return out;
}
