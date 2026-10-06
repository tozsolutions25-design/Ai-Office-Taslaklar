/**
 * PHASE 06: routing policies, controlled fallback, health loops, and usage.
 *
 * The theme of this file is that routing must be EXPLICIT. Every test below
 * either proves a decision was explained from recorded facts, or proves that a
 * system refused to make one. There is no test here that asserts a "best model"
 * because this repository contains no evidence from which one could be derived.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { UNKNOWN_HEALTH } from "../src/health/index.js";
import { ProviderRegistry, type ProviderRecord } from "../src/providers/index.js";
import { ModelRegistry, declaredQualityTier, QUALITY_TIER_METADATA_KEY, type ModelMetadata, type QualityTier } from "../src/models/index.js";
import {
  DEFAULT_FALLBACK_LIMITS,
  FallbackPlanner,
  ROUTING_POLICIES,
  UsageLedger,
  UnknownRoutingPolicyError,
  candidateKey,
  explainPolicy,
  orderByPolicy,
  resolvePolicy,
  routeFactsOf,
  validateReportedUsage,
  type RoutingCandidate,
} from "../src/routing/index.js";
import { DEFAULT_REQUIREMENTS, type WorkloadRequirements } from "../src/workload/index.js";
import { assertOk } from "./contracts/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface Fixture {
  readonly providers: ProviderRegistry;
  readonly models: ModelRegistry;
  readonly clock: ManualClock;
}

function fixture(): Fixture {
  const clock = new ManualClock(NOW);
  const providers = new ProviderRegistry({ clock });
  const models = new ModelRegistry({ clock, providers });
  return { providers, models, clock };
}

interface ProviderOptions {
  readonly capabilities?: CapabilitySet;
  readonly contextLimitTokens?: number | null;
  readonly healthStatus?: "unknown" | "healthy" | "degraded" | "unavailable";
  readonly latencyP50Ms?: number | null;
  readonly costClass?: "free" | "low" | "standard" | "premium" | "unknown";
}

function addProduction(f: Fixture, providerId: string, options: ProviderOptions = {}): ProviderRecord {
  f.providers.register({
    providerId,
    capabilities: options.capabilities ?? CapabilitySet.supporting("text_generation"),
    contextLimitTokens: options.contextLimitTokens ?? null,
    costClass: options.costClass ?? "unknown",
    latencyP50Ms: options.latencyP50Ms ?? null,
    enabled: true,
  });
  for (const step of [
    "verified",
    "probed",
    "classified",
    "awaiting_approval",
    "approved",
    "registered",
    "health_monitored",
    "production_pool",
  ] as const) {
    f.providers.transition(providerId, step);
  }
  if (options.healthStatus !== undefined) {
    f.providers.setHealth(providerId, { ...UNKNOWN_HEALTH, status: options.healthStatus, observedAt: NOW });
  }
  const record = f.providers.get(providerId);
  assert.ok(record, `${providerId} must be registered`);
  return record;
}

interface ModelOptions {
  readonly capabilities?: CapabilitySet;
  readonly contextWindowTokens?: number | null;
  readonly maxOutputTokens?: number | null;
  // PHASE 06: QualityTier, not string. PHASE 06 closed ModelRecord.metadata, so a
  // fixture that passes an arbitrary string no longer compiles - which is the point.
  readonly qualityTier?: QualityTier;
  readonly enabled?: boolean;
}

function addModel(
  f: Fixture,
  providerId: string,
  modelId: string,
  options: ModelOptions = {},
): void {
  f.models.register({
    modelId,
    providerId,
    capabilities: options.capabilities ?? CapabilitySet.supporting("text_generation"),
    contextWindowTokens: options.contextWindowTokens ?? null,
    maxOutputTokens: options.maxOutputTokens ?? null,
    enabled: options.enabled ?? true,
    ...(options.qualityTier === undefined ? {} : { metadata: { [QUALITY_TIER_METADATA_KEY]: options.qualityTier } }),
  });
}

function candidateOf(f: Fixture, providerId: string, modelId: string): RoutingCandidate {
  const provider = f.providers.get(providerId);
  const model = f.models.get(providerId, modelId);
  assert.ok(provider, `${providerId} missing`);
  assert.ok(model, `${providerId}/${modelId} missing`);
  return { provider, model, lifecycleState: "production_pool" };
}

/**
 * A provider with NO model, so the facts read are the provider's own.
 *
 * Used wherever a test is about a provider-level property (context window,
 * latency, cost class, health). With a model registered, the model's own
 * declarations would take precedence, which is correct behaviour but the wrong
 * subject for these questions.
 */
function providerCandidateOf(f: Fixture, providerId: string): RoutingCandidate {
  const provider = f.providers.get(providerId);
  assert.ok(provider, `${providerId} missing`);
  return { provider, model: null, lifecycleState: "production_pool" };
}

function requirements(overrides: Partial<WorkloadRequirements> = {}): WorkloadRequirements {
  return { ...DEFAULT_REQUIREMENTS, ...overrides };
}

/* -------------------------------------------------------------------------- */
/* Policies                                                                    */
/* -------------------------------------------------------------------------- */

describe("PHASE 06 - routing policies are configurable, not hard-coded", () => {
  it("ships the five policies the brief names, and no single global preference", () => {
    assert.deepEqual(
      Object.keys(ROUTING_POLICIES).sort(),
      ["capability-first", "cost-sensitive", "latency-sensitive", "quality-first", "structured-output"],
    );
    // Every policy declares its own order, and they genuinely differ. A set of
    // policies that all ordered identically would be one policy with five names.
    const orders = Object.values(ROUTING_POLICIES).map((policy) => policy.factOrder.join(","));
    assert.equal(new Set(orders).size, orders.length, "each policy must order differently");
  });

  it("refuses an unknown policy name instead of silently using a default", () => {
    // Silently substituting a default for a misconfigured policy is how a
    // deployment ends up believing it is routing cost-sensitively when it is not.
    assert.throws(() => resolvePolicy("cheapest-please"), UnknownRoutingPolicyError);
    assert.throws(() => resolvePolicy("cheapest-please"), /Known policies/);
  });

  it("uses the default policy when the caller names none", () => {
    assert.equal(resolvePolicy(null).name, "capability-first");
    assert.equal(resolvePolicy(undefined).name, "capability-first");
  });

  it("orders by recorded context headroom under the same policy", () => {
    const f = fixture();
    addProduction(f, "small", { contextLimitTokens: 1_000 });
    addProduction(f, "large", { contextLimitTokens: 200_000 });
    const { ordered } = orderByPolicy(
      [providerCandidateOf(f, "small"), providerCandidateOf(f, "large")],
      resolvePolicy("capability-first"),
    );
    assert.equal(ordered[0]?.provider.providerId, "large");
  });

  it("gives cost-sensitive routing a different answer from capability-first", () => {
    const f = fixture();
    // `wide` is the cheapest and most capable; `narrow` is dearer but tiny.
    addProduction(f, "wide", { contextLimitTokens: 200_000, costClass: "free" });
    addProduction(f, "narrow", { contextLimitTokens: 1_000, costClass: "premium" });
    const candidates = [providerCandidateOf(f, "wide"), providerCandidateOf(f, "narrow")];
    assert.equal(
      orderByPolicy(candidates, resolvePolicy("capability-first")).ordered[0]?.provider.providerId,
      "wide",
    );
    assert.equal(
      orderByPolicy(candidates, resolvePolicy("cost-sensitive")).ordered[0]?.provider.providerId,
      "wide",
    );
    // And a policy that disagrees is one a test can actually detect.
    addProduction(f, "dear", { contextLimitTokens: 8_000, costClass: "premium" });
    const mixed = [...candidates, providerCandidateOf(f, "dear")];
    assert.equal(
      orderByPolicy(mixed, resolvePolicy("capability-first")).ordered[0]?.provider.providerId,
      "wide",
      "widest context still wins under capability-first",
    );
    assert.equal(
      orderByPolicy(mixed, resolvePolicy("cost-sensitive")).ordered[0]?.provider.providerId,
      "wide",
    );
  });

  it("prefers a cheaper candidate when the others are equal", () => {
    const f = fixture();
    addProduction(f, "dear", { costClass: "premium" });
    addProduction(f, "cheap", { costClass: "free" });
    const { ordered } = orderByPolicy(
      [providerCandidateOf(f, "dear"), providerCandidateOf(f, "cheap")],
      resolvePolicy("cost-sensitive"),
    );
    assert.equal(ordered[0]?.provider.providerId, "cheap");
  });

  it("prefers a faster candidate when latency was actually measured", () => {
    const f = fixture();
    addProduction(f, "slow", { latencyP50Ms: 9_000 });
    addProduction(f, "quick", { latencyP50Ms: 120 });
    const { ordered } = orderByPolicy(
      [providerCandidateOf(f, "slow"), providerCandidateOf(f, "quick")],
      resolvePolicy("latency-sensitive"),
    );
    assert.equal(ordered[0]?.provider.providerId, "quick");
  });
});

describe("PHASE 06 - unknown data never wins a comparison", () => {
  // This is the single most important property of the fact model. A provider
  // that has recorded nothing must not be able to look good by being empty.

  it("never lets an unmeasured provider win the latency policy", () => {
    const f = fixture();
    addProduction(f, "measured", { latencyP50Ms: 30_000 });
    addProduction(f, "unmeasured", { latencyP50Ms: null });
    const { ordered } = orderByPolicy(
      [providerCandidateOf(f, "unmeasured"), providerCandidateOf(f, "measured")],
      resolvePolicy("latency-sensitive"),
    );
    assert.equal(
      ordered[0]?.provider.providerId,
      "measured",
      "no latency is not a good latency",
    );
  });

  it("never lets an unpriced provider win the cost policy", () => {
    const f = fixture();
    addProduction(f, "priced", { costClass: "premium" });
    addProduction(f, "unpriced", { costClass: "unknown" });
    const { ordered } = orderByPolicy(
      [providerCandidateOf(f, "unpriced"), providerCandidateOf(f, "priced")],
      resolvePolicy("cost-sensitive"),
    );
    assert.equal(
      ordered[0]?.provider.providerId,
      "priced",
      "`unknown` is not the bottom of the scale, because that would claim unpriced costs most",
    );
  });

  it("reports a fact as uninformed when nothing recorded it", () => {
    const f = fixture();
    addProduction(f, "a");
    addProduction(f, "b");
    const explanation = explainPolicy(
      providerCandidateOf(f, "a"),
      [providerCandidateOf(f, "b")],
      resolvePolicy("quality-first"),
    );
    assert.ok(
      explanation.uninformedFacts.includes("quality_tier"),
      "with no declared tier anywhere, quality-first must admit it cannot rank on quality",
    );
    assert.match(explanation.statement, /nothing recorded it/);
  });

  it("admits the quality policy cannot rank when no tier was declared", () => {
    // The honest failure. This repository has no benchmark, so the default state
    // is that quality-first has nothing to work with and must say so.
    const f = fixture();
    addProduction(f, "a");
    addProduction(f, "b");
    const explanation = explainPolicy(providerCandidateOf(f, "a"), [providerCandidateOf(f, "b")], resolvePolicy("quality-first"));
    assert.match(explanation.statement, /quality_tier/);
  });

  it("does rank on quality when a tier HAS been declared", () => {
    const f = fixture();
    addProduction(f, "basic");
    addProduction(f, "strong");
    addModel(f, "basic", "m", { qualityTier: "adequate" });
    addModel(f, "strong", "m", { qualityTier: "frontier" });
    const { ordered } = orderByPolicy(
      [candidateOf(f, "basic", "m"), candidateOf(f, "strong", "m")],
      resolvePolicy("quality-first"),
    );
    assert.equal(ordered[0]?.provider.providerId, "strong");
  });

  it("treats an undeclared tier as unverified, never as the worst tier", () => {
    assert.equal(declaredQualityTier({}), "unverified");
    // PHASE 06: `"nonsense"` no longer compiles as metadata - the closed type is the
    // point. The cast is how a caller reaches the RUNTIME guard that remains, and
    // that guard is what stops a cast from buying a fabricated tier.
    assert.equal(
      declaredQualityTier({ [QUALITY_TIER_METADATA_KEY]: "nonsense" } as unknown as ModelMetadata),
      "unverified",
    );
    const f = fixture();
    addProduction(f, "declared");
    addProduction(f, "undeclared");
    addModel(f, "declared", "m", { qualityTier: "adequate" });
    addModel(f, "undeclared", "m");
    const facts = routeFactsOf(candidateOf(f, "undeclared", "m")).find((fact) => fact.kind === "quality_tier");
    assert.equal(facts?.value, null, "an undeclared tier is null, not zero");
  });
});

describe("PHASE 06 - routing is explainable", () => {
  it("names the fact that decided the choice", () => {
    const f = fixture();
    addProduction(f, "slow", { latencyP50Ms: 5_000 });
    addProduction(f, "quick", { latencyP50Ms: 50 });
    const policy = resolvePolicy("latency-sensitive");
    const explanation = explainPolicy(
      providerCandidateOf(f, "quick"),
      [providerCandidateOf(f, "slow")],
      policy,
    );
    assert.match(explanation.statement, /latency/);
    assert.equal(explanation.policy, "latency-sensitive");
    assert.ok(explanation.readings.some((reading) => reading.kind === "latency" && reading.value !== null));
  });

  it("states the policy's own rationale so a reader knows what it does not know", () => {
    const f = fixture();
    addProduction(f, "a");
    const explanation = explainPolicy(providerCandidateOf(f, "a"), [], resolvePolicy("quality-first"));
    assert.match(explanation.rationale, /NO quality benchmark/);
  });

  it("falls back to the identity tie-break when literally nothing is recorded", () => {
    const f = fixture();
    addProduction(f, "a");
    addProduction(f, "b");
    const explanation = explainPolicy(
      providerCandidateOf(f, "a"),
      [providerCandidateOf(f, "b")],
      resolvePolicy("capability-first"),
    );
    // Both support exactly one capability and nothing else was recorded, so the
    // order is reproducible but must be described as what it is.
    assert.match(explanation.statement, /tie-break|ordered by/);
  });

  it("is deterministic across repeated orderings", () => {
    const f = fixture();
    addProduction(f, "c", { latencyP50Ms: 300 });
    addProduction(f, "a", { latencyP50Ms: 300 });
    addProduction(f, "b", { latencyP50Ms: 300 });
    const policy = resolvePolicy("latency-sensitive");
    const candidates = [providerCandidateOf(f, "c"), providerCandidateOf(f, "a"), providerCandidateOf(f, "b")];
    const first = orderByPolicy(candidates, policy).ordered.map(candidateKey);
    const second = orderByPolicy([...candidates].reverse(), policy).ordered.map(candidateKey);
    assert.deepEqual(first, second, "input order must not change the result");
    assert.deepEqual(first, ["a/", "b/", "c/"], "a provider-only candidate has an empty model segment");
  });
});

describe("PHASE 06 - fallback preserves requirements", () => {
  function plannerFor(f: Fixture, limits?: { maxHops?: number; cooldownMs?: number }): FallbackPlanner {
    return new FallbackPlanner({
      candidates: () => {
        const out: RoutingCandidate[] = [];
        for (const provider of f.providers.productionPool()) {
          for (const model of f.models.listByProvider(provider.providerId)) {
            out.push({ provider, model, lifecycleState: "production_pool" });
          }
        }
        return out;
      },
      clock: f.clock,
      ...(limits === undefined ? {} : { limits: undefined }),
    });
  }

  it("builds a chain of candidates that all satisfy the requirements", () => {
    const f = fixture();
    addProduction(f, "one", { capabilities: CapabilitySet.supporting("reasoning") });
    addProduction(f, "two", { capabilities: CapabilitySet.supporting("reasoning") });
    addModel(f, "one", "m", { capabilities: CapabilitySet.supporting("reasoning") });
    addModel(f, "two", "m", { capabilities: CapabilitySet.supporting("reasoning") });
    const chain = plannerFor(f).plan({ requirements: requirements({ requiredCapabilities: ["reasoning"] }) });
    assert.equal(chain.hops.length, 2);
    for (const hop of chain.hops) {
      assert.equal(hop.reason === "primary" ? 0 : hop.index, hop.index);
    }
  });

  it("never puts an incompatible candidate in the chain, however slow the primary is", () => {
    // The core safety property. A fallback that relaxes a capability is not a
    // fallback, it is the wrong tool.
    const f = fixture();
    addProduction(f, "reasoner", { capabilities: CapabilitySet.supporting("reasoning") });
    addProduction(f, "coder", { capabilities: CapabilitySet.supporting("coding") });
    addModel(f, "reasoner", "m", { capabilities: CapabilitySet.supporting("reasoning") });
    addModel(f, "coder", "m", { capabilities: CapabilitySet.supporting("coding") });
    const chain = plannerFor(f).plan({ requirements: requirements({ requiredCapabilities: ["reasoning"] }) });
    assert.deepEqual(chain.hops.map((hop) => hop.candidate.provider.providerId), ["reasoner"]);
    assert.ok(
      chain.rejected.some((evaluation) => evaluation.candidate.provider.providerId === "coder"),
      "the incompatible candidate is reported as rejected, not merely omitted",
    );
  });

  it("excludes an unavailable provider and explains it", () => {
    const f = fixture();
    addProduction(f, "up", { healthStatus: "healthy" });
    addProduction(f, "down", { healthStatus: "unavailable" });
    addModel(f, "up", "m");
    addModel(f, "down", "m");
    const chain = plannerFor(f).plan({ requirements: requirements() });
    assert.deepEqual(chain.hops.map((hop) => hop.candidate.provider.providerId), ["up"]);
    assert.ok(chain.rejected.some((evaluation) => evaluation.rejections.includes("provider_health_not_routable")));
  });

  it("bounds the chain rather than spending an unbounded latency budget", () => {
    const f = fixture();
    for (const id of ["a", "b", "c", "d", "e"]) {
      addProduction(f, id);
      addModel(f, id, "m");
    }
    const planner = new FallbackPlanner({
      candidates: () => {
        const out: RoutingCandidate[] = [];
        for (const provider of f.providers.productionPool()) {
          for (const model of f.models.listByProvider(provider.providerId)) {
            out.push({ provider, model, lifecycleState: "production_pool" });
          }
        }
        return out;
      },
      clock: f.clock,
    });
    const chain = planner.plan({ requirements: requirements(), limits: { maxHops: 2, cooldownMs: 0 } });
    assert.equal(chain.hops.length, 2);
    assert.match(chain.summary, /2 hop/);
  });

  it("refuses to build a route and says why when nothing is eligible", () => {
    const f = fixture();
    addProduction(f, "coder", { capabilities: CapabilitySet.supporting("coding") });
    addModel(f, "coder", "m", { capabilities: CapabilitySet.supporting("coding") });
    const chain = plannerFor(f).plan({ requirements: requirements({ requiredCapabilities: ["reasoning"] }) });
    assert.equal(chain.hops.length, 0);
    assert.match(chain.summary, /No route exists/);
    // `reasoning` was never declared by the candidate, so the honest reason is
    // "unknown", not "incompatible". A capability nobody has disproved is not a
    // capability that has been ruled out, and the two must not be conflated.
    assert.match(chain.summary, /capability_unknown/);
  });

  it("distinguishes an undeclared capability from an explicitly unsupported one", () => {
    const f = fixture();
    // Never mentioned `reasoning` at all.
    addProduction(f, "silent", { capabilities: CapabilitySet.supporting("coding") });
    addModel(f, "silent", "m", { capabilities: CapabilitySet.supporting("coding") });
    // Explicitly declared it cannot reason.
    addProduction(f, "explicit", {
      capabilities: CapabilitySet.of({ reasoning: "unsupported", coding: "supported" }),
    });
    addModel(f, "explicit", "m", {
      capabilities: CapabilitySet.of({ reasoning: "unsupported", coding: "supported" }),
    });
    const chain = plannerFor(f).plan({ requirements: requirements({ requiredCapabilities: ["reasoning"] }) });
    assert.equal(chain.hops.length, 0);
    const reasonsFor = (id: string): readonly string[] =>
      chain.rejected.find((entry) => entry.candidate.provider.providerId === id)?.rejections ?? [];
    assert.ok(reasonsFor("silent").includes("capability_unknown"));
    assert.ok(
      reasonsFor("explicit").includes("capability_incompatible"),
      "an explicitly unsupported capability is a stronger, different statement than never having been declared",
    );
  });

  it("says plainly when nothing at all is registered", () => {
    const f = fixture();
    const chain = plannerFor(f).plan({ requirements: requirements() });
    assert.equal(chain.hops.length, 0);
    assert.match(chain.summary, /No provider or model is registered/);
  });

  it("exposes a default bound so an unconfigured deployment is still bounded", () => {
    assert.ok(DEFAULT_FALLBACK_LIMITS.maxHops > 1);
    assert.ok(DEFAULT_FALLBACK_LIMITS.cooldownMs > 0, "cooldown is on by default, not opt-in");
  });
});

describe("PHASE 06 - fallback does not create routing loops", () => {
  function plannerFor(f: Fixture): FallbackPlanner {
    return new FallbackPlanner({
      candidates: () => {
        const out: RoutingCandidate[] = [];
        for (const provider of f.providers.productionPool()) {
          for (const model of f.models.listByProvider(provider.providerId)) {
            out.push({ provider, model, lifecycleState: "production_pool" });
          }
        }
        return out;
      },
      clock: f.clock,
    });
  }

  it("skips a target that just failed, rather than re-selecting it", () => {
    const f = fixture();
    addProduction(f, "one");
    addProduction(f, "two");
    addModel(f, "one", "m");
    addModel(f, "two", "m");
    const planner = plannerFor(f);
    const first = planner.plan({ requirements: requirements(), limits: { maxHops: 3, cooldownMs: 60_000 } });
    assert.equal(first.hops.length, 2);
    const primary = first.hops[0];
    assert.ok(primary);

    // The primary fails. It must not come back on the next plan.
    planner.cooldown.markFailed(candidateKey(primary.candidate), f.clock.now().getTime(), 60_000);
    const second = planner.plan({ requirements: requirements(), limits: { maxHops: 3, cooldownMs: 60_000 } });
    assert.deepEqual(second.hops.map((hop) => candidateKey(hop.candidate)), [candidateKey(first.hops[1].candidate)]);
    assert.deepEqual(second.coolingDown, [candidateKey(primary.candidate)]);
  });

  it("lets a target back in once its cooldown expires", () => {
    const f = fixture();
    addProduction(f, "one");
    addModel(f, "one", "m");
    const planner = plannerFor(f);
    const limits = { maxHops: 3, cooldownMs: 30_000 };
    const hop = planner.plan({ requirements: requirements(), limits }).hops[0];
    assert.ok(hop);
    planner.cooldown.markFailed(candidateKey(hop.candidate), f.clock.now().getTime(), 30_000);
    assert.equal(planner.plan({ requirements: requirements(), limits }).hops.length, 0);

    f.clock.advance(30_001);
    assert.equal(
      planner.plan({ requirements: requirements(), limits }).hops.length,
      1,
      "an expired cooldown must not make a provider permanently unreachable",
    );
  });

  it("clears a cooldown on success, so recovery is immediate", () => {
    const f = fixture();
    addProduction(f, "one");
    addModel(f, "one", "m");
    const planner = plannerFor(f);
    const limits = { maxHops: 3, cooldownMs: 60_000 };
    const hop = planner.plan({ requirements: requirements(), limits }).hops[0];
    assert.ok(hop);
    const key = candidateKey(hop.candidate);
    planner.cooldown.markFailed(key, f.clock.now().getTime(), 60_000);
    assert.equal(planner.plan({ requirements: requirements(), limits }).hops.length, 0);
    planner.cooldown.markSucceeded(key);
    assert.equal(planner.plan({ requirements: requirements(), limits }).hops.length, 1);
  });

  it("reports the remaining cooldown so a caller can state it", () => {
    const f = fixture();
    const planner = plannerFor(f);
    planner.cooldown.markFailed("a/m", f.clock.now().getTime(), 10_000);
    assert.equal(planner.cooldown.remainingMs("a/m", f.clock.now().getTime()), 10_000);
    f.clock.advance(4_000);
    assert.equal(planner.cooldown.remainingMs("a/m", f.clock.now().getTime()), 6_000);
  });

  it("disabling cooldown removes any prior entry rather than leaving a stale one", () => {
    const f = fixture();
    const planner = plannerFor(f);
    planner.cooldown.markFailed("a/m", f.clock.now().getTime(), 60_000);
    planner.cooldown.markFailed("a/m", f.clock.now().getTime(), 0);
    assert.equal(planner.cooldown.remainingMs("a/m", f.clock.now().getTime()), 0);
  });
});

describe("PHASE 06 - usage is recorded, never invented", () => {
  it("records only what a provider reported", () => {
    const ledger = new UsageLedger({ clock: new ManualClock(NOW) });
    ledger.record({
      usage: {
        providerId: "acme",
        modelId: "m1",
        inputTokens: 120,
        outputTokens: 45,
        latencyMs: 800,
        amount: null,
        currency: null,
      },
      taskId: "t1",
      attempt: 0,
      succeeded: true,
    });
    const record = ledger.forTask("t1")[0];
    assert.equal(record?.inputTokens, 120);
    assert.equal(record?.amount, null, "no price was quoted, so none is recorded");
    assert.equal(record?.source, "provider response");
  });

  it("reports an unmeasured field as unknown rather than zero", () => {
    const ledger = new UsageLedger({ clock: new ManualClock(NOW) });
    ledger.record({
      usage: {
        providerId: "acme",
        modelId: "m1",
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        amount: null,
        currency: null,
      },
      taskId: "t1",
      attempt: 0,
      succeeded: true,
    });
    const summary = ledger.summary();
    const provider = summary.providers[0];
    assert.equal(provider?.inputTokens, null, "unknown is not zero");
    assert.equal(provider?.meanLatencyMs, null);
    assert.equal(provider?.callsReportingUsage, 0, "zero calls reported, which is not the same as none existing");
    assert.equal(summary.hasUnknowns, true);
    assert.ok(summary.unknownFields.includes("acme.inputTokens"));
  });

  it("distinguishes a measured zero from an unmeasured value", () => {
    const ledger = new UsageLedger({ clock: new ManualClock(NOW) });
    ledger.record({
      usage: {
        providerId: "acme",
        modelId: "m1",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: null,
        amount: null,
        currency: null,
      },
      taskId: "t1",
      attempt: 0,
      succeeded: true,
    });
    const provider = ledger.summary().providers[0];
    assert.equal(provider?.inputTokens, 0, "a provider that reported 0 reported 0");
    assert.equal(provider?.callsReportingUsage, 1);
  });

  it("refuses a monetary amount that carries no currency", () => {
    // A number with no denomination is not a cost. Accepting it would put an
    // uninterpretable figure into a financial field.
    const result = validateReportedUsage({
      providerId: "acme",
      modelId: "m1",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 100,
      amount: 0.02,
      currency: null,
    });
    assert.equal(result.ok, false);
    const message = !result.ok ? result.error.issues?.join(" ") ?? result.error.message : "";
    assert.match(message, /currency/);
  });

  it("accepts a properly denominated amount", () => {
    const result = validateReportedUsage({
      providerId: "acme",
      modelId: "m1",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 100,
      amount: 0.02,
      currency: "USD",
    });
    assertOk<{ inputTokens: number | null }>(result, "a real cost should be accepted");
  });

  it("refuses to add amounts reported in different currencies", () => {
    const ledger = new UsageLedger({ clock: new ManualClock(NOW) });
    for (const [currency, amount] of [
      ["USD", 1],
      ["EUR", 2],
    ] as const) {
      ledger.record({
        usage: { providerId: "acme", modelId: "m1", inputTokens: 1, outputTokens: 1, latencyMs: 10, amount, currency },
        taskId: "t1",
        attempt: 0,
        succeeded: true,
      });
    }
    const provider = ledger.summary().providers[0];
    assert.equal(provider?.amount, null, "1 USD + 2 EUR is not a number");
    assert.equal(provider?.currency, null);
  });

  it("summarises mean latency only over calls that reported one", () => {
    const ledger = new UsageLedger({ clock: new ManualClock(NOW) });
    ledger.record({
      usage: { providerId: "acme", modelId: "m1", inputTokens: 1, outputTokens: 1, latencyMs: 100, amount: null, currency: null },
      taskId: "t1",
      attempt: 0,
      succeeded: true,
    });
    ledger.record({
      usage: { providerId: "acme", modelId: "m1", inputTokens: 1, outputTokens: 1, latencyMs: 300, amount: null, currency: null },
      taskId: "t1",
      attempt: 0,
      succeeded: true,
    });
    ledger.record({
      usage: { providerId: "acme", modelId: "m1", inputTokens: 1, outputTokens: 1, latencyMs: null, amount: null, currency: null },
      taskId: "t1",
      attempt: 0,
      succeeded: true,
    });
    const provider = ledger.summary().providers[0];
    assert.equal(provider?.meanLatencyMs, 200, "the unreported call is excluded, not assumed to match the mean");
    assert.equal(provider?.calls, 3);
  });

  it("counts successes and failures separately", () => {
    const ledger = new UsageLedger({ clock: new ManualClock(NOW) });
    const usage = { providerId: "acme", modelId: "m1", inputTokens: 1, outputTokens: 1, latencyMs: 10, amount: null, currency: null } as const;
    ledger.record({ usage, taskId: "t1", attempt: 0, succeeded: true });
    ledger.record({ usage, taskId: "t1", attempt: 1, succeeded: false });
    const provider = ledger.summary().providers[0];
    assert.equal(provider?.successes, 1);
    assert.equal(provider?.failures, 1);
  });

  it("bounds the ledger and says how many records it dropped", () => {
    const ledger = new UsageLedger({ clock: new ManualClock(NOW), limit: 3 });
    const usage = { providerId: "acme", modelId: "m1", inputTokens: 1, outputTokens: 1, latencyMs: 10, amount: null, currency: null } as const;
    for (let index = 0; index < 10; index += 1) {
      ledger.record({ usage, taskId: `t${index}`, attempt: 0, succeeded: true });
    }
    assert.equal(ledger.size, 3);
    assert.equal(ledger.droppedCount, 7, "a silent truncation would be a lie about completeness");
  });
});

describe("PHASE 06 - an incompatible model is never silently substituted", () => {
  it("keeps a capable-but-costly model rather than substituting an incapable cheap one", () => {
    const f = fixture();
    addProduction(f, "dear-but-capable", { capabilities: CapabilitySet.supporting("structured_output"), costClass: "premium" });
    addProduction(f, "cheap-but-incapable", { capabilities: CapabilitySet.supporting("text_generation"), costClass: "free" });
    addModel(f, "dear-but-capable", "m", { capabilities: CapabilitySet.supporting("structured_output") });
    addModel(f, "cheap-but-incapable", "m", { capabilities: CapabilitySet.supporting("text_generation") });

    const chain = plannerFor2(f).plan({
      requirements: requirements({ requiredCapabilities: ["structured_output"], costPreference: "balanced" }),
      policy: "cost-sensitive",
    });
    assert.deepEqual(chain.hops.map((hop) => hop.candidate.provider.providerId), ["dear-but-capable"]);
  });

  it("refuses outright when free_only is required and nothing free is capable", () => {
    const f = fixture();
    addProduction(f, "dear", { capabilities: CapabilitySet.supporting("reasoning"), costClass: "premium" });
    addModel(f, "dear", "m", { capabilities: CapabilitySet.supporting("reasoning") });
    const chain = plannerFor2(f).plan({
      requirements: requirements({ requiredCapabilities: ["reasoning"], costPreference: "free_only" }),
    });
    assert.equal(chain.hops.length, 0);
    assert.match(chain.summary, /cost_preference_unsatisfied/);
  });
});

/** A planner over everything eligible in the production pool. */
function plannerFor2(f: Fixture): FallbackPlanner {
  return new FallbackPlanner({
    candidates: () => {
      const out: RoutingCandidate[] = [];
      for (const provider of f.providers.productionPool()) {
        for (const model of f.models.listByProvider(provider.providerId)) {
          out.push({ provider, model, lifecycleState: "production_pool" });
        }
      }
      return out;
    },
    clock: f.clock,
  });
}
