import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APP_ENVIRONMENTS,
  DEFAULT_CONFIG,
  diffFromDefaults,
  loadConfig,
  loadConfigFromObject,
  rawConfigFromEnv,
  validateConfig,
} from "../src/config/index.js";

describe("configuration", () => {
  it("accepts a minimal valid configuration", () => {
    const result = loadConfigFromObject({ app: { environment: "development" } });
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
    if (!result.ok) return;
    assert.equal(result.value.app.environment, "development");
    assert.equal(result.value.concurrency.globalLimit, DEFAULT_CONFIG.concurrency.globalLimit);
    assert.equal(result.value.retry.maxAttempts, DEFAULT_CONFIG.retry.maxAttempts);
  });

  it("rejects a configuration missing the required environment", () => {
    const result = loadConfigFromObject({});
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((issue) => issue.field === "app.environment"));
  });

  it("rejects an unknown environment value", () => {
    const result = loadConfigFromObject({ app: { environment: "prod" } });
    assert.equal(result.ok, false);
    if (result.ok) return;
    const issue = result.error.issues.find((i) => i.field === "app.environment");
    assert.ok(issue, "expected an issue for app.environment");
    assert.match(issue.message, /must be one of/);
  });

  it("accepts every documented environment", () => {
    for (const environment of APP_ENVIRONMENTS) {
      const result = validateConfig({ app: { environment } });
      assert.equal(result.ok, true, `expected ${environment} to be valid`);
    }
  });

  it("rejects a non-positive concurrency limit", () => {
    const result = validateConfig({
      app: { environment: "test" },
      concurrency: { globalLimit: 0 },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((i) => i.field === "concurrency.globalLimit"));
  });

  it("rejects a non-integer queue capacity", () => {
    const result = validateConfig({
      app: { environment: "test" },
      queue: { maxTasks: 12.5 },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((i) => i.field === "queue.maxTasks"));
  });

  it("rejects a retry policy whose max delay is below its base delay", () => {
    const result = validateConfig({
      app: { environment: "test" },
      retry: { backoff: { baseDelayMs: 5000, maxDelayMs: 100 } },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((i) => /maxDelayMs/.test(i.message)));
  });

  it("rejects retryableClasses that include a permanent error class", () => {
    const result = validateConfig({
      app: { environment: "test" },
      retry: { retryableClasses: ["authentication_failure"] },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((i) => /permanent class/.test(i.message)));
  });

  it("reports multiple issues at once rather than only the first", () => {
    const result = validateConfig({
      app: { environment: "nope" },
      concurrency: { globalLimit: -1 },
      request: { timeoutMs: 0 },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.length >= 3, `expected 3+ issues, got ${result.error.issues.length}`);
  });

  it("rejects a health config where unavailable is below degraded", () => {
    const result = validateConfig({
      app: { environment: "test" },
      health: { degradedAfterFailures: 5, unavailableAfterFailures: 2 },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((i) => i.field === "health.unavailableAfterFailures"));
  });

  it("rejects a non-boolean flag", () => {
    const result = validateConfig({
      app: { environment: "test" },
      logging: { auditEnabled: "yes" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((i) => i.field === "logging.auditEnabled"));
  });

  it("accepts boolean strings, which is how env vars arrive", () => {
    const result = validateConfig({
      app: { environment: "test" },
      logging: { auditEnabled: "false" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.logging.auditEnabled, false);
  });

  it("maps environment variables onto configuration", () => {
    const result = loadConfig({
      TOZ_ENV: "staging",
      TOZ_LOG_LEVEL: "debug",
      TOZ_CONCURRENCY_GLOBAL_MAX: "16",
      TOZ_RETRY_MAX_ATTEMPTS: "5",
      TOZ_AUDIT_ENABLED: "false",
    });
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
    if (!result.ok) return;
    assert.equal(result.value.app.environment, "staging");
    assert.equal(result.value.logging.level, "debug");
    assert.equal(result.value.concurrency.globalLimit, 16);
    assert.equal(result.value.retry.maxAttempts, 5);
    assert.equal(result.value.logging.auditEnabled, false);
  });

  it("fails when the environment variable environment is absent", () => {
    const result = loadConfig({});
    assert.equal(result.ok, false);
  });

  it("fails on a non-numeric numeric variable rather than defaulting it", () => {
    const result = loadConfig({ TOZ_ENV: "test", TOZ_CONCURRENCY_GLOBAL_MAX: "many" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((i) => i.field === "concurrency.globalLimit"));
  });

  it("ignores unrecognised TOZ_ variables instead of applying them", () => {
    const raw = rawConfigFromEnv({ TOZ_ENV: "test", TOZ_TOTALLY_UNKNOWN: "surprise" });
    assert.equal(JSON.stringify(raw).includes("surprise"), false);
  });

  it("ships zero provider configurations", () => {
    const result = loadConfig({ TOZ_ENV: "test" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.providers, {});
  });

  it("stores only an auth environment variable NAME, never a value", () => {
    const result = validateConfig({
      app: { environment: "test" },
      providers: { acme: { authEnvVarName: "ACME_API_KEY" } },
    });
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
    if (!result.ok) return;
    const provider = result.value.providers["acme"];
    assert.ok(provider);
    assert.equal(provider.authEnvVarName, "ACME_API_KEY");
    assert.equal(provider.enabled, false, "providers must be opt-in");
  });

  it("rejects a non-string authEnvVarName", () => {
    const result = validateConfig({
      app: { environment: "test" },
      providers: { acme: { authEnvVarName: { secret: "literal" } } },
    });
    assert.equal(result.ok, false);
  });

  it("reports which fields were overridden, without revealing values", () => {
    const result = loadConfig({ TOZ_ENV: "production" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const changed = diffFromDefaults(result.value);
    assert.ok(changed.includes("app.environment"), `changed: ${changed.join(",")}`);
  });
});
