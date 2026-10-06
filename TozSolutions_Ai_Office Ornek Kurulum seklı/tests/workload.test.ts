import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ValidationError } from "../src/core/errors.js";
import { WORKLOAD_CLASSES, isWorkloadClass, validateWorkload } from "../src/workload/index.js";

describe("workload model", () => {
  it("validates a well-formed workload", () => {
    const result = validateWorkload({
      class: "coding",
      requiredCapabilities: ["coding", "tool_calling"],
      minContextTokens: 32_000,
      requiredTools: ["read_file", "run_tests"],
      reliability: "high",
      latencyPreference: "balanced",
      costPreference: "low_cost",
      fallbackRequired: true,
    });
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
    if (!result.ok) return;
    assert.equal(result.value.class, "coding");
    assert.equal(result.value.requirements.minContextTokens, 32_000);
    assert.equal(result.value.requirements.reliability, "high");
    assert.equal(result.value.requirements.fallbackRequired, true);
  });

  it("applies documented defaults for omitted optional fields", () => {
    const result = validateWorkload({ class: "research" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.requirements.requiredCapabilities, []);
    assert.equal(result.value.requirements.minContextTokens, null);
    assert.equal(result.value.requirements.reliability, "standard");
    assert.equal(result.value.requirements.fallbackRequired, false);
  });

  it("rejects a non-object", () => {
    for (const input of [null, undefined, 42, "coding", ["coding"]]) {
      const result = validateWorkload(input);
      assert.equal(result.ok, false, `expected ${JSON.stringify(input)} to be rejected`);
    }
  });

  it("rejects a missing or unknown workload class", () => {
    assert.equal(validateWorkload({}).ok, false);
    const result = validateWorkload({ class: "teleportation" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((issue) => /class/.test(issue)));
  });

  it("accepts every documented workload class", () => {
    for (const workloadClass of WORKLOAD_CLASSES) {
      assert.equal(validateWorkload({ class: workloadClass }).ok, true, `${workloadClass} should validate`);
    }
  });

  it("rejects an unknown capability in the requirements", () => {
    const result = validateWorkload({ class: "coding", requiredCapabilities: ["telepathy"] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((issue) => /telepathy/.test(issue)));
  });

  it("rejects a non-array capability list", () => {
    assert.equal(validateWorkload({ class: "coding", requiredCapabilities: "coding" }).ok, false);
  });

  it("rejects an invalid context requirement", () => {
    for (const value of [0, -1, 1.5, "big"]) {
      const result = validateWorkload({ class: "coding", minContextTokens: value });
      assert.equal(result.ok, false, `expected ${String(value)} to be rejected`);
    }
  });

  it("accepts null as an unspecified context requirement", () => {
    const result = validateWorkload({ class: "coding", minContextTokens: null });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.requirements.minContextTokens, null);
  });

  it("rejects invalid enum values", () => {
    assert.equal(validateWorkload({ class: "coding", reliability: "very_high" }).ok, false);
    assert.equal(validateWorkload({ class: "coding", latencyPreference: "instant" }).ok, false);
    assert.equal(validateWorkload({ class: "coding", costPreference: "cheapest" }).ok, false);
  });

  it("rejects a non-boolean fallback requirement", () => {
    const result = validateWorkload({ class: "coding", fallbackRequired: "yes" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.issues.some((issue) => /fallbackRequired/.test(issue)));
  });

  it("rejects a non-object metadata field", () => {
    const result = validateWorkload({ class: "coding", metadata: ["a"] });
    assert.equal(result.ok, false);
  });

  it("collects multiple issues in one pass", () => {
    const result = validateWorkload({
      class: "nope",
      requiredCapabilities: ["telepathy"],
      minContextTokens: -5,
      reliability: "nope",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error instanceof ValidationError);
    assert.ok(result.error.issues.length >= 4, `expected 4+ issues, got ${result.error.issues.length}`);
  });

  it("keeps unknown extension keys without rejecting them", () => {
    const result = validateWorkload({
      class: "coding",
      futurePhaseField: { anything: true },
    });
    assert.equal(result.ok, true, "extensibility must not require a core change");
  });

  it("carries metadata through", () => {
    const result = validateWorkload({ class: "coding", metadata: { tenant: "acme" } });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.metadata, { tenant: "acme" });
  });

  it("does not encode a routing decision in the definition", () => {
    const result = validateWorkload({ class: "coding", requiredCapabilities: ["coding"] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const serialised = JSON.stringify(result.value);
    assert.equal(/provider|endpoint|modelId/i.test(serialised), false, "a workload must not name a provider");
  });

  it("validates workload class names", () => {
    assert.equal(isWorkloadClass("seo"), true);
    assert.equal(isWorkloadClass("nope"), false);
  });
});
