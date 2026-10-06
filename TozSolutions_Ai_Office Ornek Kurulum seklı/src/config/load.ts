import type { Result } from "../core/result.js";
import { type AppConfig, DEFAULT_CONFIG } from "./schema.js";
import { type ConfigIssue, type ConfigValidationError, validateConfig } from "./validate.js";

/**
 * Environment-variable -> configuration mapping.
 *
 * Only a fixed allow-list of variables is read. A `TOZ_` prefix is NOT
 * sufficient to inject a value, which prevents an unexpected variable from
 * silently changing runtime behaviour. There is deliberately no generic
 * "JSON blob" variable, because that would defeat validation entirely.
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

function str(env: EnvSource, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

function bool(env: EnvSource, key: string): boolean | undefined {
  const value = str(env, key);
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  // Deliberately returns undefined (i.e. "not supplied") for anything else so
  // the validator reports it as an invalid value rather than silently
  // treating garbage as false.
  return undefined;
}

function num(env: EnvSource, key: string): number | string | undefined {
  const value = str(env, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}

/** Projects the allow-listed environment variables into a raw config object. */
export function rawConfigFromEnv(env: EnvSource): Record<string, unknown> {
  const app: Record<string, unknown> = {};
  if (str(env, "TOZ_ENV") !== undefined) app["environment"] = str(env, "TOZ_ENV");
  if (str(env, "TOZ_APP_NAME") !== undefined) app["name"] = str(env, "TOZ_APP_NAME");
  if (str(env, "TOZ_INSTANCE_ID") !== undefined) app["instanceId"] = str(env, "TOZ_INSTANCE_ID");

  const logging: Record<string, unknown> = {};
  if (str(env, "TOZ_LOG_LEVEL") !== undefined) logging["level"] = str(env, "TOZ_LOG_LEVEL");
  if (bool(env, "TOZ_AUDIT_ENABLED") !== undefined) logging["auditEnabled"] = bool(env, "TOZ_AUDIT_ENABLED");
  if (num(env, "TOZ_AUDIT_MAX_EVENTS") !== undefined) logging["auditMaxEvents"] = num(env, "TOZ_AUDIT_MAX_EVENTS");

  const queue: Record<string, unknown> = {};
  if (num(env, "TOZ_QUEUE_MAX_TASKS") !== undefined) queue["maxTasks"] = num(env, "TOZ_QUEUE_MAX_TASKS");

  const concurrency: Record<string, unknown> = {};
  if (num(env, "TOZ_CONCURRENCY_GLOBAL_MAX") !== undefined) {
    concurrency["globalLimit"] = num(env, "TOZ_CONCURRENCY_GLOBAL_MAX");
  }
  if (num(env, "TOZ_CONCURRENCY_QUEUE_MAX") !== undefined) {
    concurrency["globalMaxWaiting"] = num(env, "TOZ_CONCURRENCY_QUEUE_MAX");
  }

  const retry: Record<string, unknown> = {};
  if (num(env, "TOZ_RETRY_MAX_ATTEMPTS") !== undefined) {
    retry["maxAttempts"] = num(env, "TOZ_RETRY_MAX_ATTEMPTS");
  }
  const backoff: Record<string, unknown> = {};
  if (str(env, "TOZ_RETRY_BACKOFF_KIND") !== undefined) {
    backoff["kind"] = str(env, "TOZ_RETRY_BACKOFF_KIND");
  }
  if (num(env, "TOZ_RETRY_BASE_DELAY_MS") !== undefined) {
    backoff["baseDelayMs"] = num(env, "TOZ_RETRY_BASE_DELAY_MS");
  }
  if (num(env, "TOZ_RETRY_MAX_DELAY_MS") !== undefined) {
    backoff["maxDelayMs"] = num(env, "TOZ_RETRY_MAX_DELAY_MS");
  }
  const backoffSection =
    Object.keys(backoff).length > 0 ? { backoff } : undefined;

  const health: Record<string, unknown> = {};
  if (num(env, "TOZ_HEALTH_INTERVAL_MS") !== undefined) {
    health["intervalMs"] = num(env, "TOZ_HEALTH_INTERVAL_MS");
  }
  if (num(env, "TOZ_HEALTH_FAILURE_THRESHOLD") !== undefined) {
    health["degradedAfterFailures"] = num(env, "TOZ_HEALTH_FAILURE_THRESHOLD");
  }

  const request: Record<string, unknown> = {};
  if (num(env, "TOZ_REQUEST_TIMEOUT_MS") !== undefined) {
    request["timeoutMs"] = num(env, "TOZ_REQUEST_TIMEOUT_MS");
  }

  return {
    app,
    logging,
    queue,
    concurrency,
    retry: { ...retry, ...backoffSection },
    health,
    request,
    // Providers are intentionally not read from the environment in PHASE 01.
    // Provider wiring arrives with a real, approved integration.
    providers: {},
  };
}

/**
 * Loads and validates configuration.
 *
 * Order matters: env projection, then validation, then defaults. An
 * environment of `production` is NEVER silently defaulted, because
 * `app.environment` is required.
 */
export function loadConfig(env: EnvSource = process.env): Result<AppConfig, ConfigValidationError> {
  return validateConfig(rawConfigFromEnv(env));
}

/** Validates a fully explicit config object, bypassing env projection. */
export function loadConfigFromObject(raw: Record<string, unknown>): Result<AppConfig, ConfigValidationError> {
  return validateConfig(raw);
}

/** Fields that differ from DEFAULT_CONFIG. Values are never included. */
export function diffFromDefaults(config: AppConfig): readonly string[] {
  const changed: string[] = [];
  const walk = (path: string, actual: unknown, expected: unknown): void => {
    if (actual === expected) {
      return;
    }
    if (
      actual !== null &&
      expected !== null &&
      typeof actual === "object" &&
      typeof expected === "object" &&
      !Array.isArray(actual) &&
      !Array.isArray(expected)
    ) {
      const keys = new Set([
        ...Object.keys(actual),
        ...Object.keys(expected),
      ]);
      for (const key of keys) {
        walk(
          path ? `${path}.${key}` : key,
          (actual as Record<string, unknown>)[key],
          (expected as Record<string, unknown>)[key],
        );
      }
      return;
    }
    changed.push(path);
  };
  walk("", config, DEFAULT_CONFIG);
  return changed.filter((path) => path.length > 0);
}

export { validateConfig, type ConfigIssue, type ConfigValidationError };
