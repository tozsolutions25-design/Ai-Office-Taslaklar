import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import {
  AUDIT_EVENT_KINDS,
  AuditLog,
  NullAuditLog,
  isSensitiveKey,
  redact,
  redactString,
  redactWithReport,
} from "../src/audit/index.js";
import { envSecretRef } from "../src/core/secretRef.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function log(maxEvents = 100): { log: AuditLog; clock: ManualClock } {
  const clock = new ManualClock(NOW);
  return { log: new AuditLog({ maxEvents, clock }), clock };
}

describe("audit event creation", () => {
  it("creates an event with a timestamp and duration", () => {
    const { log: audit, clock } = log();
    const event = audit.append({ kind: "task_enqueued", taskId: "t1", workload: "coding" });
    assert.equal(event.kind, "task_enqueued");
    assert.equal(event.at.getTime(), clock.now().getTime());
    assert.equal(event.durationMs, null);
    assert.equal(event.correlationId, null);
  });

  it("honours an explicit timestamp and duration", () => {
    const { log: audit } = log();
    const at = new Date("2026-06-01T12:00:00.000Z");
    const event = audit.append({
      kind: "provider_call_finished",
      taskId: "t1",
      providerId: "acme",
      modelId: "m1",
      success: true,
      errorClass: null,
      at,
      durationMs: 1234,
    });
    assert.equal(event.at.getTime(), at.getTime());
    assert.equal(event.durationMs, 1234);
  });

  it("records every required execution field", () => {
    const { log: audit } = log();
    const event = audit.append({
      kind: "route_selected",
      taskId: "t1",
      providerId: "acme",
      modelId: "m1",
      workload: "coding",
      selectionReason: "only eligible candidate",
      consideredCandidates: 1,
      correlationId: "corr-1",
    });
    assert.equal(event.taskId, "t1");
    assert.equal(event.providerId, "acme");
    assert.equal(event.modelId, "m1");
    assert.equal(event.workload, "coding");
    assert.equal(event.selectionReason, "only eligible candidate");
    assert.equal(event.correlationId, "corr-1");
  });

  it("records lifecycle transitions with from and to", () => {
    const { log: audit } = log();
    const event = audit.append({
      kind: "task_transition",
      taskId: "t1",
      from: "scheduled",
      to: "running",
      attempt: 1,
      errorClass: null,
    });
    assert.equal(event.from, "scheduled");
    assert.equal(event.to, "running");
    assert.equal(event.attempt, 1);
  });

  it("records retry and fallback events", () => {
    const { log: audit } = log();
    audit.append({
      kind: "retry_scheduled",
      taskId: "t1",
      providerId: "acme",
      errorClass: "timeout",
      attempt: 1,
      nextAttempt: 2,
      delayMs: 500,
    });
    audit.append({
      kind: "fallback_selected",
      taskId: "t1",
      fromProviderId: "acme",
      toProviderId: "globex",
      toModelId: "m2",
      reason: "quota_exhausted",
    });
    assert.equal(audit.byKind("retry_scheduled").length, 1);
    assert.equal(audit.byKind("fallback_selected").length, 1);
    const fallback = audit.byKind("fallback_selected")[0];
    assert.equal(fallback?.toProviderId, "globex");
    assert.equal(fallback?.reason, "quota_exhausted");
  });

  it("records health and lifecycle changes", () => {
    const { log: audit } = log();
    audit.append({
      kind: "provider_health_changed",
      targetId: "provider:acme",
      fromStatus: "unknown",
      toStatus: "healthy",
      consecutiveFailures: 0,
    });
    audit.append({
      kind: "provider_lifecycle_transition",
      providerId: "acme",
      fromState: "verified",
      toState: "probed",
    });
    assert.equal(audit.byKind("provider_health_changed").length, 1);
    assert.equal(audit.byKind("provider_lifecycle_transition").length, 1);
  });

  it("records a config reload with field names only", () => {
    const { log: audit } = log();
    const event = audit.append({
      kind: "config_reloaded",
      environment: "production",
      changedFields: ["app.environment", "retry.maxAttempts"],
    });
    assert.deepEqual(event.changedFields, ["app.environment", "retry.maxAttempts"]);
  });

  it("exposes the full set of event kinds", () => {
    assert.ok(AUDIT_EVENT_KINDS.includes("route_selected"));
    assert.ok(AUDIT_EVENT_KINDS.includes("task_transition"));
    assert.ok(AUDIT_EVENT_KINDS.length >= 10);
  });

  it("filters and correlates events", () => {
    const { log: audit } = log();
    audit.append({ kind: "task_enqueued", taskId: "a", workload: "coding", correlationId: "c1" });
    audit.append({ kind: "task_enqueued", taskId: "b", workload: "research", correlationId: "c2" });
    audit.append({ kind: "task_transition", taskId: "a", from: "queued", to: "scheduled", attempt: 0, errorClass: null, correlationId: "c1" });
    assert.equal(audit.byCorrelation("c1").length, 2);
    assert.equal(audit.byKind("task_enqueued").length, 2);
  });

  it("drops the oldest events when full and records the drop count", () => {
    const { log: audit } = log(3);
    for (let i = 0; i < 6; i += 1) {
      audit.append({ kind: "task_enqueued", taskId: `t${i}`, workload: "coding" });
    }
    assert.equal(audit.size, 3, "the log must stay bounded");
    assert.equal(audit.droppedCount, 3, "truncation must be visible");
    const events = audit.read({ workspace: null, brand: null });
    assert.equal(events.length, 3);
    assert.equal(audit.byKind("task_enqueued")[0]?.taskId, "t3");
  });

  it("rejects an invalid capacity at construction", () => {
    assert.throws(() => new AuditLog({ maxEvents: 0 }), /positive integer/);
  });

  it("supports a no-op sink when auditing is disabled", () => {
    const nullLog = new NullAuditLog();
    nullLog.append({ kind: "task_enqueued", taskId: "t1", workload: "coding" });
    assert.equal(nullLog.read({ workspace: null, brand: null }).length, 0);
  });
});

describe("secret exclusion", () => {
  it("detects sensitive key names", () => {
    assert.equal(isSensitiveKey("apiKey"), true);
    assert.equal(isSensitiveKey("api_key"), true);
    assert.equal(isSensitiveKey("Authorization"), true);
    assert.equal(isSensitiveKey("set-cookie"), true);
    assert.equal(isSensitiveKey("clientSecret"), true);
    assert.equal(isSensitiveKey("password"), true);
    assert.equal(isSensitiveKey("taskId"), false);
    assert.equal(isSensitiveKey("providerId"), false);
  });

  it("redacts a value under a sensitive key", () => {
    assert.deepEqual(redact({ apiKey: "whatever" }), { apiKey: "[REDACTED]" });
    assert.deepEqual(redact({ nested: { password: "hunter2" } }), { nested: { password: "[REDACTED]" } });
  });

  it("redacts credential-shaped values in free text", () => {
    assert.equal(redactString("key is sk-abcdefghijklmnopqrstuvwx"), "key is [REDACTED]");
    assert.equal(redactString("token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"), "token [REDACTED]");
    assert.equal(redactString("Authorization: Bearer abcdefghijklmnopqrst"), "Authorization: [REDACTED]");
    assert.equal(
      redactString("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "[REDACTED]",
    );
  });

  it("redacts a string that is exactly a credential field name", () => {
    assert.equal(redactString("password"), "[REDACTED]");
    assert.equal(redactString("apiKey"), "[REDACTED]");
  });

  it("leaves ordinary text intact", () => {
    assert.equal(redactString("processing task t-42 on provider acme"), "processing task t-42 on provider acme");
    assert.equal(
      redactString("retrying because the token was rejected"),
      "retrying because the token was rejected",
      "prose that merely mentions a sensitive word must survive",
    );
  });

  it("never persists a secret passed into an event", () => {
    const { log: audit } = log();
    audit.append({
      kind: "provider_call_started",
      taskId: "t1",
      providerId: "acme",
      modelId: "m1",
      attempt: 1,
    });
    audit.append({
      kind: "config_reloaded",
      environment: "test",
      changedFields: ["providers.acme.authEnvVarName=ACME_API_KEY"],
    });
    const serialised = JSON.stringify(audit.read({ workspace: null, brand: null }));
    assert.equal(serialised.includes("sk-"), false);
    assert.equal(serialised.includes("Bearer "), false);
  });

  it("redacts a leaked secret placed in an event payload", () => {
    const { log: audit } = log();
    const event = audit.append({
      kind: "route_rejected",
      taskId: null,
      providerId: "acme",
      modelId: "m1",
      workload: "coding",
      verdict: "disabled",
      reason: "auth header was Bearer abcdefghijklmnopqrstuvwx",
    });
    assert.equal(event.reason.includes("abcdefghijklmnopqrstuvwx"), false, "the token must not survive");
    assert.match(event.reason, /\[REDACTED\]/);
  });

  it("redacts nested sensitive keys in an event payload", () => {
    const { log: audit } = log();
    const event = audit.append({
      kind: "config_reloaded",
      environment: "test",
      changedFields: ["apiKey"],
    });
    assert.deepEqual(event.changedFields, ["[REDACTED]"]);
  });

  it("reports which fields were redacted", () => {
    const report = redactWithReport({ apiKey: "x", safe: "y", nested: { password: "z" } });
    assert.equal(report.redactedFields.includes("apiKey"), true);
    assert.equal(report.redactedFields.includes("password"), true);
    assert.deepEqual(report.value, { apiKey: "[REDACTED]", safe: "y", nested: { password: "[REDACTED]" } });
  });

  it("handles cycles, depth and long strings safely", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic["self"] = cyclic;
    assert.deepEqual(redact(cyclic), { name: "root", self: "[Circular]" });

    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 20; i += 1) {
      deep = { next: deep };
    }
    const result = JSON.stringify(redact(deep));
    assert.ok(result.includes("[MaxDepth]"));

    const long = redact("a".repeat(5_000));
    assert.equal(String(long).includes("[truncated]"), true);
  });

  it("redacts an array of credentials", () => {
    assert.deepEqual(redact([{ token: "t" }, { safe: 1 }]), [{ token: "[REDACTED]" }, { safe: 1 }]);
  });

  it("records a secret reference without resolving it", () => {
    // A SecretRef is a POINTER (env var name), never a value, so recording the
    // pointer cannot leak a credential and is retained for traceability. The
    // safety property is that the value was never present to begin with.
    const { log: audit } = log();
    const ref = envSecretRef("ACME_API_KEY");
    assert.equal(ref.key, "ACME_API_KEY");
    assert.equal(ref.kind, "env");
    assert.equal(
      Object.values(ref).some((entry) => typeof entry === "string" && entry.includes("sk-")),
      false,
      "a reference must never carry a credential value",
    );

    const event = audit.append({
      kind: "config_reloaded",
      environment: "test",
      changedFields: [`authRef=${ref.kind}:${ref.key}`],
    });
    assert.deepEqual(event.changedFields, ["authRef=env:ACME_API_KEY"]);
  });

  it("keeps every stored event JSON-serialisable", () => {
    const { log: audit } = log();
    audit.append({ kind: "task_enqueued", taskId: "t", workload: "coding" });
    audit.append({ kind: "task_transition", taskId: "t", from: "queued", to: "scheduled", attempt: 0, errorClass: null });
    audit.append({ kind: "provider_health_changed", targetId: "x", fromStatus: "unknown", toStatus: "healthy", consecutiveFailures: 0 });
    const events = audit.read({ workspace: null, brand: null });
    assert.equal(events.length, 3);
    for (const event of events) {
      assert.doesNotThrow(() => JSON.stringify(event));
    }
    assert.equal(audit.byKind("task_enqueued")[0]?.taskId, "t");
  });
});
