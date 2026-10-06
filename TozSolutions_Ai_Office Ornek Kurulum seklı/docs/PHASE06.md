# PHASE 06: Provider / Model Routing and Intelligent Model Selection

Status: **delivered and green**. 1322/1322 tests, typecheck, lint and build clean.
No new runtime dependency. See `docs/PHASE06_MAP.md` for the pre-implementation
audit this was built from.

## The most important thing about this phase

**Most of what PHASE 06 asks for already existed, built in PHASE 01 and never
wired to the orchestrator.** The provider and model registries, the record models
with their "null means not verified" discipline, the filter-then-score routing
pipeline with twelve named rejection reasons, the health model with its four
states, and the workload requirements all shipped years-of-phases ago and are
tested.

So this phase adds very little new machinery and does the integration work. The
discipline that mattered was resisting the temptation to build a *second* routing
authority: `evaluateCandidate` remains the only hard eligibility filter, and a
policy can only order candidates that already survived it. A second filter would
have been the same class of defect PHASE 04 and PHASE 05 were written to prevent.

## Architecture

```
TOZ Orchestrator
        ↓  ModelRoutingPort (route + optional plan)
ModelRouter ──→ FallbackPlanner ──→ policy ordering ──→ explainPolicy
        ↓                                          ↓
ProviderAdapterRegistry                    evaluateCandidate  ← the ONLY filter
        ↓                                          ↓
ProviderAdapter (port; no client ships)    Provider/Model records
```

`ModelRoutingPort.plan()` is **optional**. A deployment supplying its own routing
policy is not forced to implement fallback planning to use the port, and when the
capability is absent the orchestrator omits the fallback fields rather than
reporting `false` — an absent field means "unknown", which is a different
statement from "there is no fallback".

## Routing policies: ordered facts, not weights

A policy is an **ordered list of recorded facts**, compared lexicographically. This
is the central design decision, and it is deliberately not a weighted score:

- **No weights means no invented trade-off.** "Latency matters 0.4 as much as
  context" is a claim about the world that nobody here has evidence for. An order
  is a claim only about what the operator asked to prioritise.
- **Lexicographic order makes the explanation exact.** The first fact that differs
  decides, so the system can say *which* fact decided it. "Chosen because it has
  more context headroom" is checkable; "chosen because it scored 0.87" is not.
- **A `null` fact wins nothing, in either direction.** An unmeasured provider
  cannot beat a measured one on latency, and an unpriced one cannot beat a priced
  one on cost. This is the rule that stops "no data" from reading as "best".

The five shipped policies are `capability-first` (the default, because it assumes
the least), `quality-first`, `latency-sensitive`, `cost-sensitive` and
`structured-output`. An unknown name is a **configuration error**, not a silent
substitution of the default.

### On the quality policy specifically

This repository contains **no quality benchmark**. So `quality-first` reads an
*operator-declared* quality tier from namespaced model metadata
(`toz.qualityTier`), and when none has been declared — the normal state here — it
has nothing to rank on and **says so**:

> Selected acme/m1 under the "quality-first" policy: ordered by capability_breadth,
> then health. Not used, because nothing recorded it: quality_tier.

An earlier draft of the cost scale ranked `premium` as the *cheapest* option in the
system, because the scale ran as goodness while the comparator ran as
`lower_is_better`. That inversion is now held by a named test.

## Fallback preserves requirements

`FallbackChain` is an ordered list of candidates that **all passed the same hard
filter**. The invariant:

> Fallback can never widen eligibility.

A relaxed capability is not a fallback, it is a different task executed with the
wrong tool. When the chain is exhausted the route fails visibly, with every
rejection reason listed.

Chains are **bounded** (`maxHops`, default 3). An unbounded chain over a slow
provider is a latency budget nobody agreed to, and a chain of fifty is a sign that
eligibility is too loose rather than that fallback is working.

## No routing loops

A system that re-routes to a provider which just failed will ping-pong until
something else breaks. `CooldownRegistry` puts a failed target in cooldown, and
`FallbackPlanner` applies cooldown **after filtering and before ordering**, so a
cooling target is never counted as eligible and never influences the order of the
rest. The cooldown is driven by an explicit `nowMs` rather than a hidden clock, so
it is reproducible in a test, and it expires — a provider that recovers is
reachable again immediately.

`background` priority does not spend fallback hops. Priority governs *how much*
fallback is spent and never *what is eligible*, because urgency is not a capability.

## Cost and resource: recorded, never invented

`UsageLedger` records only what a provider actually reported. Where a provider
reports no figure the field is `null` and the summary reports it as unknown.

- A measured `0` is stored as `0`; an unmeasured field is `null`. `callsReportingUsage`
  keeps those distinguishable.
- **A monetary amount with no currency is refused.** A number with no denomination
  is not a cost, and accepting it would put an uninterpretable figure into a
  financial field.
- Amounts in different currencies are **not** added. `1 USD + 2 EUR` is not a
  number, so the summary reports unknown.
- Mean latency is taken only over calls that reported one, and the count of
  reporting calls makes the gap visible rather than assuming the rest matched.
- There is **no price table** anywhere. Relative preference is handled by the
  pre-existing `costClass`, which is a declaration, not a price.

## Integration

| Surface | What PHASE 06 added |
|---|---|
| Orchestrator | Records `fallbackAvailable` and `fallbackChain` on `model_routed`. Planning is optional and its failure can never fail a decided route. |
| Agent registry | Unchanged. An agent still cannot select a provider; the orchestrator routes and the record carries no provider field. |
| Capability registry | Unchanged. The existing three-valued matcher is what the filter uses. |
| Memory | Unchanged, and independent. |
| Verification | Unchanged. |
| Tools / MCP | Unchanged. `requiredTools` remains a requirement; tool execution is the tool layer's business. |
| Observability | Four new kinds in the **one** shared history: `model_route_refused`, `model_route_fell_back`, `provider_usage_recorded`, `provider_health_changed`. |
| Workers | Unchanged. |
| Config | New `routing` section: `defaultPolicy`, `maxFallbackHops`, `fallbackCooldownMs`, `allowUnprotectedRoutes`, with env allow-list entries. Validated by `validateOrchestrationConfig` and surfaced through `orchestrationConfigFromApp`, which returns `{ config, issues }`. |

### On where routing config is validated

An attempt was made to also validate the orchestration section from the
`validate-config` CLI, and it was **reverted**. `src/cli` is core-layer, and a
`designSystem.phase01Isolation` architectural test correctly failed: core must not
import the orchestration layer, because that would let an orchestration decision
reach in and change core behaviour. Making the CLI aware of orchestration
config would have bought one convenience and broken the layering that the whole
phase depends on.

The correct seam already exists inside the orchestration layer:
`orchestrationConfigFromApp(app)` returns `{ config, issues }`, and
`validateOrchestrationConfig(raw)` is exported for direct use. What does *not*
exist yet is an application composition root that calls them — this repository has
no assembled application entry point, so there is nowhere for that check to live
without breaking the layering. The guarantee is therefore at the library boundary
rather than at a command line, and the missing piece is recorded as a limitation
rather than papered over by reaching across layers.

## Deliberately not added

- **No provider client, and no provider named.** No OpenAI, Anthropic, Google, Qwen,
  DeepSeek or OpenRouter adapter; no default endpoint; no API key read. A wire
  format invented from memory is a fabricated integration that could not be
  exercised without credentials. The adapters used in tests are doubles that live
  in the tests and say so.
- **No price table** and **no quality benchmark**, as above.
- **No second routing authority** and no second audit history.
- **No new runtime dependency.**

## Known limitations

1. **No provider client is integrated.** `ProviderAdapter` is a port; the
   orchestrator will refuse a route with no adapter behind it (a PHASE 04.1 rule
   that still holds), so nothing has ever actually called a model through this
   path.
2. **No quality or cost data exists**, so `quality-first` and `cost-sensitive`
   have nothing real to work with in the shipped state, and both report that fact
   rather than pretending otherwise.
3. **No live health probe.** `HealthProbe` is a port and `InMemoryHealthMonitor`
   records observations; no scheduler runs one. Health changes only when a caller
   reports a result.
4. **No streaming implementation.** No `stream` surface was added; nothing in the
   repository streams.
5. **No real MCP client** (`ToolInvoker` is a port with one local implementation),
   and no browser or E2E tests (K-07, K-11) — both unchanged since PHASE 03.
6. **No `format` script exists** in `package.json`. The brief asked for one; adding
   a formatter would be a new dev dependency and a toolchain change, so `lint` is
   the enforcing gate and the absence is reported rather than papered over.
7. **No application composition root exists**, so orchestration config validation
   is reachable at the library boundary (`orchestrationConfigFromApp`) but is not
   invoked by any command-line tool. Wiring it into `validate-config` was tried and
   reverted: it would make the core layer import the orchestration layer, which the
   `phase01Isolation` test correctly forbids.
8. **Inner pages remain outstanding.**

Each is the absence of an external integration this repository does not have,
reported rather than faked.
