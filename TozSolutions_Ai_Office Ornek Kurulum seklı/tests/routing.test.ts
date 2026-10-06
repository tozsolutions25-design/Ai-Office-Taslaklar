import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { InMemoryHealthMonitor, UNKNOWN_HEALTH, deriveHealth, isRoutableStatus } from "../src/health/index.js";
import { ProviderRegistry, type ProviderRecord } from "../src/providers/index.js";
import { ModelRegistry } from "../src/models/index.js";
import { DefaultRouter, computeVerifiedFactsRank, evaluateCandidate, type RoutingCandidate } from "../src/routing/index.js";
import { DEFAULT_REQUIREMENTS, type WorkloadRequirements } from "../src/workload/index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

interface Fixture {
  providers: ProviderRegistry;
  models: ModelRegistry;
  router: DefaultRouter;
  clock: ManualClock;
}

function fixture(allowUnknownCapabilities = false): Fixture {
  const clock = new ManualClock(NOW);
  const providers = new ProviderRegistry({ clock });
  const models = new ModelRegistry({ clock, providers });
  return {
    providers,
    models,
    clock,
    router: new DefaultRouter({
      candidates: {
        candidates: (): readonly RoutingCandidate[] =>
          providers.list().flatMap((provider): RoutingCandidate[] => {
            const lifecycleState = providers.lifecycleOf(provider.providerId)?.state ?? "discovered";
            const providerModels = models.listByProvider(provider.providerId);
            if (providerModels.length === 0) {
              return [{ provider, model: null, lifecycleState }];
            }
            return providerModels.map((model) => ({ provider, model, lifecycleState }));
          }),
      },
      allowUnknownCapabilities,
    }),
  };
}

/** Registers a provider taken all the way to the production pool. */
function addProductionProvider(
  f: Fixture,
  providerId: string,
  options: {
    capabilities?: CapabilitySet;
    contextLimitTokens?: number;
    enabled?: boolean;
    healthStatus?: "unknown" | "healthy" | "degraded" | "unavailable";
    costClass?: "free" | "low" | "standard" | "premium" | "unknown";
  } = {},
): ProviderRecord {
  f.providers.register({
    providerId,
    capabilities: options.capabilities ?? CapabilitySet.supporting("text_generation"),
    contextLimitTokens: options.contextLimitTokens ?? null,
    costClass: options.costClass ?? "unknown",
    enabled: options.enabled ?? true,
  });
  for (const step of ["verified", "probed", "classified", "awaiting_approval", "approved", "registered", "health_monitored", "production_pool"] as const) {
    f.providers.transition(providerId, step);
  }
  if (options.healthStatus) {
    f.providers.setHealth(providerId, {
      ...UNKNOWN_HEALTH,
      status: options.healthStatus,
      observedAt: NOW,
    });
  }
  const record = f.providers.get(providerId);
  assert.ok(record);
  return record;
}

describe("health model", () => {
  it("starts as unknown with no observation", () => {
    assert.equal(UNKNOWN_HEALTH.status, "unknown");
    assert.equal(UNKNOWN_HEALTH.observedAt, null);
    assert.equal(UNKNOWN_HEALTH.latencyMs, null);
  });

  it("becomes healthy on the first success", () => {
    const next = deriveHealth(UNKNOWN_HEALTH, { success: true, at: NOW, latencyMs: 120 });
    assert.equal(next.status, "healthy");
    assert.equal(next.consecutiveFailures, 0);
    assert.equal(next.latencyMs, 120);
    assert.ok(next.observedAt, "an observation must be timestamped");
    assert.equal(next.observedAt.getTime(), NOW.getTime());
  });

  it("degrades and then becomes unavailable as failures accumulate", () => {
    let health = UNKNOWN_HEALTH;
    health = deriveHealth(health, { success: false, at: NOW });
    health = deriveHealth(health, { success: false, at: NOW });
    assert.equal(health.status, "degraded");
    for (let i = 0; i < 3; i += 1) {
      health = deriveHealth(health, { success: false, at: NOW });
    }
    assert.equal(health.status, "unavailable");
    assert.equal(health.consecutiveFailures, 5);
    assert.ok(health.observedAt, "an observation must be timestamped");
    assert.equal(health.observedAt.getTime(), NOW.getTime());
  });

  it("resets the failure counter on recovery", () => {
    let health = UNKNOWN_HEALTH;
    health = deriveHealth(health, { success: false, at: NOW });
    health = deriveHealth(health, { success: false, at: NOW });
    health = deriveHealth(health, { success: true, at: NOW });
    assert.equal(health.status, "healthy");
    assert.equal(health.consecutiveFailures, 0);
  });

  it("routes only healthy, degraded and unknown states", () => {
    assert.equal(isRoutableStatus("healthy"), true);
    assert.equal(isRoutableStatus("degraded"), true);
    assert.equal(isRoutableStatus("unknown"), true);
    assert.equal(isRoutableStatus("unavailable"), false);
    assert.equal(isRoutableStatus("disabled"), false);
  });

  it("stores and retrieves observations in the monitor", () => {
    const monitor = new InMemoryHealthMonitor({ clock: new ManualClock(NOW) });
    assert.equal(monitor.current("acme").status, "unknown");
    const updated = monitor.report("acme", { success: true, latencyMs: 42 });
    assert.equal(updated.status, "healthy");
    assert.equal(monitor.current("acme").latencyMs, 42);
    assert.deepEqual(monitor.targets(), ["acme"]);
  });
});

describe("candidate evaluation", () => {
  it("accepts a fully eligible candidate", () => {
    const f = fixture();
    const provider = addProductionProvider(f, "acme", { capabilities: CapabilitySet.supporting("coding") });
    const evaluation = evaluateCandidate(
      { provider, model: null, lifecycleState: "production_pool" },
      { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["coding"] },
    );
    assert.equal(evaluation.eligible, true);
    assert.deepEqual(evaluation.rejections, []);
    assert.equal(evaluation.capabilityMatch.verdict, "compatible");
  });

  it("rejects a disabled provider", () => {
    const f = fixture();
    const provider = addProductionProvider(f, "acme", { enabled: false });
    const evaluation = evaluateCandidate(
      { provider, model: null, lifecycleState: "production_pool" },
      DEFAULT_REQUIREMENTS,
    );
    assert.equal(evaluation.eligible, false);
    assert.ok(evaluation.rejections.includes("provider_disabled"));
  });

  it("rejects a provider that never reached the production pool", () => {
    const f = fixture();
    f.providers.register({ providerId: "acme", enabled: true });
    const provider = f.providers.get("acme");
    assert.ok(provider);
    const evaluation = evaluateCandidate(
      { provider, model: null, lifecycleState: "discovered" },
      DEFAULT_REQUIREMENTS,
    );
    assert.ok(evaluation.rejections.includes("provider_not_in_production_pool"));
    assert.ok(evaluation.rejections.includes("provider_unapproved"));
  });

  it("rejects an unhealthy provider", () => {
    const f = fixture();
    const provider = addProductionProvider(f, "acme", { healthStatus: "unavailable" });
    const evaluation = evaluateCandidate(
      { provider, model: null, lifecycleState: "production_pool" },
      DEFAULT_REQUIREMENTS,
    );
    assert.ok(evaluation.rejections.includes("provider_health_not_routable"));
  });

  it("withholds a candidate whose capability is unknown", () => {
    const f = fixture();
    const provider = addProductionProvider(f, "acme", { capabilities: CapabilitySet.unknown() });
    const evaluation = evaluateCandidate(
      { provider, model: null, lifecycleState: "production_pool" },
      { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["vision"] },
    );
    assert.equal(evaluation.eligible, false);
    assert.ok(evaluation.rejections.includes("capability_unknown"));
    assert.equal(evaluation.capabilityMatch.verdict, "unknown");
  });

  it("rejects a candidate missing a required capability", () => {
    const f = fixture();
    const provider = addProductionProvider(f, "acme", {
      capabilities: CapabilitySet.of({ vision: "unsupported", text_generation: "supported" }),
    });
    const evaluation = evaluateCandidate(
      { provider, model: null, lifecycleState: "production_pool" },
      { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["vision"] },
    );
    assert.ok(evaluation.rejections.includes("capability_incompatible"));
  });

  it("rejects a candidate whose known context window is too small", () => {
    const f = fixture();
    const provider = addProductionProvider(f, "acme", { contextLimitTokens: 4_000 });
    const evaluation = evaluateCandidate(
      { provider, model: null, lifecycleState: "production_pool" },
      { ...DEFAULT_REQUIREMENTS, minContextTokens: 32_000 },
    );
    assert.ok(evaluation.rejections.includes("context_insufficient"));
  });

  it("rejects a candidate with an unknown context window when one is required", () => {
    const f = fixture();
    const provider = addProductionProvider(f, "acme");
    const evaluation = evaluateCandidate(
      { provider, model: null, lifecycleState: "production_pool" },
      { ...DEFAULT_REQUIREMENTS, minContextTokens: 1_000 },
    );
    assert.ok(evaluation.rejections.includes("context_insufficient"));
  });

  it("honours a free-only cost preference", () => {
    const f = fixture();
    const paid = addProductionProvider(f, "paid", { costClass: "premium" });
    const free = addProductionProvider(f, "free", { costClass: "free" });
    const requirements: WorkloadRequirements = { ...DEFAULT_REQUIREMENTS, costPreference: "free_only" };
    assert.ok(evaluateCandidate({ provider: paid, model: null, lifecycleState: "production_pool" }, requirements).rejections.includes("cost_preference_unsatisfied"));
    assert.equal(evaluateCandidate({ provider: free, model: null, lifecycleState: "production_pool" }, requirements).eligible, true);
  });
});

describe("router", () => {
  it("explains that nothing was eligible when there are no candidates at all", async () => {
    const f = fixture();
    const decision = await f.router.select({ requirements: DEFAULT_REQUIREMENTS });
    assert.equal(f.providers.size, 0);
    assert.equal(decision.selected, null);
    assert.equal(decision.evaluated.length, 0);
    assert.match(decision.selectionReason, /No candidates were available/);
  });

  it("reports the rejection reasons when candidates exist but none qualify", async () => {
    const f = fixture();
    f.providers.register({ providerId: "acme", enabled: false });
    const decision = await f.router.select({ requirements: DEFAULT_REQUIREMENTS });
    assert.equal(decision.selected, null);
    assert.equal(decision.evaluated.length, 1);
    assert.match(decision.selectionReason, /No eligible candidate/);
    assert.match(decision.selectionReason, /provider_disabled/);
  });

  it("selects the only eligible candidate", async () => {
    const f = fixture();
    addProductionProvider(f, "acme", { capabilities: CapabilitySet.supporting("coding") });
    const decision = await f.router.select({
      requirements: { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["coding"] },
      workloadLabel: "coding",
    });
    assert.ok(decision.selected);
    assert.equal(decision.selected.provider.providerId, "acme");
    assert.equal(decision.selectionVerdict, "compatible");
    assert.match(decision.selectionReason, /acme/);
  });

  it("excludes an ineligible candidate and explains why", async () => {
    const f = fixture();
    addProductionProvider(f, "acme", { capabilities: CapabilitySet.supporting("coding") });
    addProductionProvider(f, "globex", { capabilities: CapabilitySet.of({ coding: "unsupported" }) });
    const decision = await f.router.select({
      requirements: { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["coding"] },
    });
    assert.ok(decision.selected);
    assert.equal(decision.selected.provider.providerId, "acme");
    const globex = decision.evaluated.find((e) => e.candidate.provider.providerId === "globex");
    assert.ok(globex);
    assert.ok(globex.rejections.includes("capability_incompatible"));
  });

  it("never selects a candidate it cannot verify by default", async () => {
    const f = fixture();
    addProductionProvider(f, "acme", { capabilities: CapabilitySet.unknown() });
    const decision = await f.router.select({
      requirements: { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["reasoning"] },
    });
    assert.equal(decision.selected, null);
    assert.match(decision.selectionReason, /capability_unknown/);
  });

  it("can admit unverified candidates when explicitly configured to", async () => {
    const f = fixture(true);
    addProductionProvider(f, "acme", { capabilities: CapabilitySet.unknown() });
    const decision = await f.router.select({
      requirements: { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["reasoning"] },
    });
    assert.ok(decision.selected, "explicit opt-in must admit an unverified candidate");
  });

  it("is deterministic and not round-robin", async () => {
    const f = fixture();
    addProductionProvider(f, "alpha", {
      capabilities: CapabilitySet.supporting("coding"),
      contextLimitTokens: 100_000,
      healthStatus: "healthy",
    });
    addProductionProvider(f, "beta", {
      capabilities: CapabilitySet.supporting("coding"),
      contextLimitTokens: 8_000,
      healthStatus: "degraded",
    });
    const requirements: WorkloadRequirements = { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["coding"] };
    const first = await f.router.select({ requirements });
    for (let i = 0; i < 10; i += 1) {
      const next = await f.router.select({ requirements });
      assert.equal(next.selected?.provider.providerId, first.selected?.provider.providerId);
    }
    assert.equal(first.selected?.provider.providerId, "alpha");
  });

  it("prefers a healthy provider over a degraded one with equal capabilities", async () => {
    const f = fixture();
    addProductionProvider(f, "aaa-degraded", { capabilities: CapabilitySet.supporting("coding"), healthStatus: "degraded" });
    addProductionProvider(f, "bbb-healthy", { capabilities: CapabilitySet.supporting("coding"), healthStatus: "healthy" });
    const decision = await f.router.select({
      requirements: { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["coding"] },
    });
    assert.equal(decision.selected?.provider.providerId, "bbb-healthy");
  });

  it("reports the number of candidates considered", async () => {
    const f = fixture();
    addProductionProvider(f, "a", { capabilities: CapabilitySet.supporting("coding") });
    addProductionProvider(f, "b", { capabilities: CapabilitySet.supporting("coding") });
    const decision = await f.router.select({
      requirements: { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["coding"] },
    });
    assert.equal(decision.consideredOrder.length, 2);
    assert.match(decision.selectionReason, /from 2 eligible/);
  });

  it("uses a model declaration when present, else the provider profile", () => {
    const f = fixture();
    const provider = addProductionProvider(f, "acme", { capabilities: CapabilitySet.of({ coding: "unsupported" }) });
    const registered = f.models.register({
      modelId: "m1",
      providerId: "acme",
      capabilities: CapabilitySet.supporting("coding"),
    });
    assert.equal(registered.ok, true);
    f.models.setEnabled("acme", "m1", true);
    const model = f.models.get("acme", "m1");
    assert.ok(model);
    const withModel = evaluateCandidate(
      { provider, model, lifecycleState: "production_pool" },
      { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["coding"] },
    );
    assert.equal(withModel.eligible, true, "a model-level declaration must win over the provider profile");

    // With no model attached the provider profile applies, and a model that is
    // not enabled is never routed to.
    const withoutModel = evaluateCandidate(
      { provider, model: null, lifecycleState: "production_pool" },
      { ...DEFAULT_REQUIREMENTS, requiredCapabilities: ["coding"] },
    );
    assert.ok(withoutModel.rejections.includes("capability_incompatible"));
  });

  it("does not invent a latency advantage for an unmeasured provider", () => {
    const f = fixture();
    const measured = addProductionProvider(f, "measured", { capabilities: CapabilitySet.supporting("coding") });
    f.providers.setHealth("measured", UNKNOWN_HEALTH);
    const slow = { ...measured, latencyP50Ms: 9_000 };
    const unknown = { ...measured, latencyP50Ms: null };
    const withSlow = computeVerifiedFactsRank({ provider: slow, model: null, lifecycleState: "production_pool" });
    const withUnknown = computeVerifiedFactsRank({ provider: unknown, model: null, lifecycleState: "production_pool" });
    assert.ok(withSlow > withUnknown, "a known-but-slow provider must not outrank an unmeasured one");
  });

  it("ships no registered providers or models by default", async () => {
    const f = fixture();
    assert.equal(f.providers.size, 0);
    assert.equal(f.models.size, 0);
  });
});
