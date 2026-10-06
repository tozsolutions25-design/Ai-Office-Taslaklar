import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { ValidationError } from "../src/core/errors.js";
import { ProviderRegistry } from "../src/providers/index.js";
import {
  DuplicateModelError,
  ModelRegistry,
  OrphanModelError,
  UnknownModelError,
  modelKey,
} from "../src/models/index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function registries(): {
  providers: ProviderRegistry;
  models: ModelRegistry;
  clock: ManualClock;
} {
  const clock = new ManualClock(NOW);
  const providers = new ProviderRegistry({ clock });
  const models = new ModelRegistry({ clock, providers });
  return { providers, models, clock };
}

describe("model registry", () => {
  it("registers and looks up a model", () => {
    const { providers, models } = registries();
    providers.register({ providerId: "acme" });
    const result = models.register({ modelId: "acme-1", providerId: "acme" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.modelId, "acme-1");
    assert.equal(result.value.providerId, "acme");
    const found = models.get("acme", "acme-1");
    assert.ok(found);
    assert.equal(found.modelId, "acme-1");
  });

  it("keeps models independently addressable while owned by a provider", () => {
    const { providers, models } = registries();
    providers.register({ providerId: "acme" });
    models.register({ modelId: "shared-name", providerId: "acme" });
    const found = models.get("acme", "shared-name");
    assert.ok(found);
    assert.equal(found.providerId, "acme");
    assert.equal(models.has("other", "shared-name"), false);
  });

  it("refuses a model for an unregistered provider", () => {
    const { models } = registries();
    const result = models.register({ modelId: "m1", providerId: "ghost" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error instanceof OrphanModelError);
    assert.equal(models.size, 0);
  });

  it("rejects a duplicate model for the same provider", () => {
    const { providers, models } = registries();
    providers.register({ providerId: "acme" });
    models.register({ modelId: "acme-1", providerId: "acme" });
    const duplicate = models.register({ modelId: "acme-1", providerId: "acme" });
    assert.equal(duplicate.ok, false);
    if (duplicate.ok) return;
    assert.ok(duplicate.error instanceof DuplicateModelError);
    assert.equal(models.size, 1);
  });

  it("allows the same model id under different providers", () => {
    const { providers, models } = registries();
    providers.register({ providerId: "acme" });
    providers.register({ providerId: "globex" });
    assert.equal(models.register({ modelId: "shared", providerId: "acme" }).ok, true);
    assert.equal(models.register({ modelId: "shared", providerId: "globex" }).ok, true);
    assert.equal(models.size, 2);
  });

  it("rejects invalid model data", () => {
    const { providers, models } = registries();
    providers.register({ providerId: "acme" });
    const bad = models.register({ modelId: "", providerId: "acme" });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.ok(bad.error instanceof ValidationError);
  });

  it("rejects a fabricated negative context window", () => {
    const { providers, models } = registries();
    providers.register({ providerId: "acme" });
    const result = models.register({ modelId: "m", providerId: "acme", contextWindowTokens: -1 });
    assert.equal(result.ok, false);
  });

  it("leaves unknown specifications unknown", () => {
    const { providers, models } = registries();
    providers.register({ providerId: "acme" });
    models.register({ modelId: "m", providerId: "acme" });
    const record = models.get("acme", "m");
    assert.ok(record);
    assert.equal(record.contextWindowTokens, null);
    assert.equal(record.maxOutputTokens, null);
    assert.equal(record.availability, "unknown");
    assert.equal(record.costClass, "unknown");
    assert.equal(record.health.status, "unknown");
    assert.equal(record.capabilities.isUnknown("vision"), true);
  });

  it("lists models by provider", () => {
    const { providers, models } = registries();
    providers.register({ providerId: "acme" });
    providers.register({ providerId: "globex" });
    models.register({ modelId: "a1", providerId: "acme" });
    models.register({ modelId: "a2", providerId: "acme" });
    models.register({ modelId: "g1", providerId: "globex" });
    assert.equal(models.listByProvider("acme").length, 2);
    assert.equal(models.listByProvider("globex").length, 1);
    assert.equal(models.listByProvider("unknown-provider").length, 0);
  });

  it("enables and disables a model", () => {
    const { providers, models } = registries();
    providers.register({ providerId: "acme" });
    models.register({ modelId: "m", providerId: "acme" });
    const enabled = models.setEnabled("acme", "m", true);
    assert.equal(enabled.ok, true);
    if (!enabled.ok) return;
    assert.equal(enabled.value.enabled, true);
    const disabled = models.setEnabled("acme", "m", false);
    assert.equal(disabled.ok, true);
    if (!disabled.ok) return;
    assert.equal(disabled.value.enabled, false);
  });

  it("fails to mutate an unknown model", () => {
    const { models } = registries();
    const result = models.setEnabled("acme", "ghost", true);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error instanceof UnknownModelError);
  });

  it("removes a model and frees its provider bucket", () => {
    const { providers, models } = registries();
    providers.register({ providerId: "acme" });
    models.register({ modelId: "m", providerId: "acme" });
    const removed = models.remove("acme", "m");
    assert.equal(removed.ok, true);
    assert.equal(models.size, 0);
    assert.equal(models.listByProvider("acme").length, 0);
  });

  it("builds a canonical cross-registry key", () => {
    assert.equal(modelKey("acme", "m1"), "acme::m1");
  });
});
