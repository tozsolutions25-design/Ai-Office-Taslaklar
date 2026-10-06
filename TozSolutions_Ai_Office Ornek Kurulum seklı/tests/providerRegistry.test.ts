import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { ValidationError } from "../src/core/errors.js";
import { envSecretRef } from "../src/core/secretRef.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import {
  DuplicateProviderError,
  ProviderLifecycle,
  ProviderRegistry,
  UnknownProviderError,
  canTransition,
  deriveProviderTraits,
  isProductionEligible,
} from "../src/providers/index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function registry(): { reg: ProviderRegistry; clock: ManualClock } {
  const clock = new ManualClock(NOW);
  return { reg: new ProviderRegistry({ clock }), clock };
}

describe("provider registry", () => {
  it("registers a provider and reports size", () => {
    const { reg } = registry();
    const result = reg.register({ providerId: "acme", name: "Acme" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(reg.size, 1);
    assert.equal(result.value.providerId, "acme");
    assert.equal(result.value.name, "Acme");
  });

  it("looks a provider up by id", () => {
    const { reg } = registry();
    reg.register({ providerId: "acme" });
    const found = reg.get("acme");
    assert.ok(found);
    assert.equal(found.providerId, "acme");
    assert.equal(reg.has("acme"), true);
  });

  it("returns null for an unknown provider", () => {
    const { reg } = registry();
    assert.equal(reg.get("nope"), null);
  });

  it("rejects a duplicate provider id instead of overwriting", () => {
    const { reg } = registry();
    const first = reg.register({ providerId: "acme", name: "First" });
    assert.equal(first.ok, true);
    const second = reg.register({ providerId: "acme", name: "Second" });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.ok(second.error instanceof DuplicateProviderError);
    assert.equal(reg.size, 1, "registry size must not change on a rejected duplicate");
    assert.equal(reg.get("acme")?.name, "First", "the original record must be untouched");
  });

  it("rejects invalid provider data", () => {
    const { reg } = registry();
    const emptyId = reg.register({ providerId: "  " });
    assert.equal(emptyId.ok, false);
    if (emptyId.ok) return;
    assert.ok(emptyId.error instanceof ValidationError);
    assert.ok(emptyId.error.issues.some((issue) => /providerId/.test(issue)));
  });

  it("rejects an invalid provider type", () => {
    const { reg } = registry();
    const result = reg.register({
      providerId: "acme",
      type: "not-a-type" as never,
    });
    assert.equal(result.ok, false);
  });

  it("rejects a non-positive context limit", () => {
    const { reg } = registry();
    const result = reg.register({ providerId: "acme", contextLimitTokens: -5 });
    assert.equal(result.ok, false);
  });

  it("keeps unknown values unknown rather than inventing defaults", () => {
    const { reg } = registry();
    reg.register({ providerId: "acme" });
    const record = reg.get("acme");
    assert.ok(record);
    assert.equal(record.contextLimitTokens, null);
    assert.equal(record.latencyP50Ms, null);
    assert.equal(record.costClass, "unknown");
    assert.equal(record.freeTierStatus, "unknown");
    assert.equal(record.health.status, "unknown");
    assert.equal(record.health.observedAt, null);
    assert.equal(record.enabled, false);
  });

  it("starts every capability as unknown for a provider with no declarations", () => {
    const { reg } = registry();
    reg.register({ providerId: "acme" });
    const record = reg.get("acme");
    assert.ok(record);
    assert.equal(record.capabilities.isUnknown("coding"), true);
    assert.equal(record.capabilities.isSupported("coding"), false);
  });

  it("enables and disables a provider", () => {
    const { reg } = registry();
    reg.register({ providerId: "acme" });
    const enabled = reg.enable("acme");
    assert.equal(enabled.ok, true);
    if (!enabled.ok) return;
    assert.equal(enabled.value.enabled, true);
    const disabled = reg.disable("acme");
    assert.equal(disabled.ok, true);
    if (!disabled.ok) return;
    assert.equal(disabled.value.enabled, false);
  });

  it("fails to enable an unknown provider", () => {
    const { reg } = registry();
    const result = reg.enable("ghost");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error instanceof UnknownProviderError);
  });

  it("stores only a secret reference, never a secret value", () => {
    const { reg } = registry();
    const ref = envSecretRef("ACME_API_KEY");
    reg.register({ providerId: "acme", authRef: ref });
    const record = reg.get("acme");
    assert.ok(record);
    assert.equal(record.authRef?.kind, "env");
    assert.equal(record.authRef?.key, "ACME_API_KEY");
    const serialised = JSON.stringify(record);
    assert.equal(serialised.includes("sk-"), false, "no secret-shaped value may be serialised");
  });

  it("advances the lifecycle only along declared edges", () => {
    const { reg } = registry();
    reg.register({ providerId: "acme" });
    const steps = [
      "verified",
      "probed",
      "classified",
      "awaiting_approval",
      "approved",
      "registered",
      "health_monitored",
      "production_pool",
    ] as const;
    for (const step of steps) {
      const result = reg.transition("acme", step);
      assert.equal(result.ok, true, `transition to ${step} should succeed`);
    }
    assert.equal(reg.lifecycleOf("acme")?.state, "production_pool");
  });

  it("rejects an illegal lifecycle jump", () => {
    const { reg } = registry();
    reg.register({ providerId: "acme" });
    const result = reg.transition("acme", "production_pool");
    assert.equal(result.ok, false, "discovered -> production_pool must be rejected");
  });

  it("reports approval status after the approval transition", () => {
    const { reg } = registry();
    reg.register({ providerId: "acme" });
    reg.transition("acme", "verified");
    reg.transition("acme", "probed");
    reg.transition("acme", "classified");
    reg.transition("acme", "awaiting_approval");
    reg.transition("acme", "approved");
    assert.equal(reg.get("acme")?.approvalStatus, "approved");
  });

  it("only lists a fully approved, enabled, production-pool provider in the pool", () => {
    const { reg } = registry();
    reg.register({ providerId: "acme" });
    for (const step of ["verified", "probed", "classified", "awaiting_approval", "approved", "registered", "health_monitored", "production_pool"] as const) {
      reg.transition("acme", step);
    }
    assert.equal(reg.productionPool().length, 0, "disabled provider must be excluded");
    reg.enable("acme");
    assert.equal(reg.productionPool().length, 1);

    reg.disable("acme");
    assert.equal(reg.productionPool().length, 0);
  });

  it("retires and removes a provider", () => {
    const { reg } = registry();
    reg.register({ providerId: "acme" });
    const retired = reg.retire("acme");
    assert.equal(retired.ok, true);
    assert.equal(reg.has("acme"), false);
    assert.equal(reg.size, 0);
  });

  it("exposes lifecycle transition rules as pure functions", () => {
    assert.equal(canTransition("discovered", "verified"), true);
    assert.equal(canTransition("retired", "discovered"), false);
    assert.equal(canTransition("approved", "verified"), false);
  });

  it("reports production eligibility from all three required conditions", () => {
    assert.equal(isProductionEligible("production_pool", true, "approved"), true);
    assert.equal(isProductionEligible("production_pool", false, "approved"), false);
    assert.equal(isProductionEligible("production_pool", true, "pending"), false);
    assert.equal(isProductionEligible("registered", true, "approved"), false);
  });

  it("surfaces a non-throwing lifecycle transition", () => {
    const lifecycle = new ProviderLifecycle("discovered");
    const bad = lifecycle.tryTransitionTo("production_pool");
    assert.equal(bad.ok, false);
    const good = lifecycle.tryTransitionTo("verified");
    assert.equal(good.ok, true);
    assert.equal(lifecycle.state, "verified");
  });

  it("exposes the named provider traits derived from capabilities", () => {
    const { reg } = registry();
    reg.register({
      providerId: "acme",
      capabilities: CapabilitySet.supporting("tool_calling", "vision"),
    });
    const record = reg.get("acme");
    assert.ok(record);
    const traits = deriveProviderTraits(record.capabilities);
    assert.equal(traits.toolSupport, true);
    assert.equal(traits.visionSupport, true);
    assert.equal(traits.codingCapability, null, "undeclared must be null, not false");
  });
});
