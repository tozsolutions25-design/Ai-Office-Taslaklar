# PHASE 06 gap and reuse map

Produced by the audit that preceded implementation, from the repository as it stood
at `c8648a6` (PHASE 05 PASS, 1258/1258). Kept so the reasoning is auditable rather
than reconstructed from the diff.

The single most important finding of this audit: **most of what PHASE 06 asks for
already exists, built in PHASE 01 and never wired to the orchestrator.** The
registries, the record models, the filter/score routing pipeline, the health model
and the workload requirements all shipped and are tested. PHASE 06 is therefore
mostly an *integration and completion* phase, not a construction phase. Anything
built here that duplicated an existing module would be a second authority, which is
the exact defect PHASE 04 and PHASE 05 were written to prevent.

## What already exists, and is reused rather than replaced

| Existing | Location | Tests | How PHASE 06 uses it |
|---|---|---|---|
| `ProviderRecord`, `createProviderRecord` | `src/providers/provider.ts` | `providerRegistry.test.ts` | The provider definition. `null` means "not verified" for every quantitative field, and `authRef` is a `SecretRef`, never a value. Reused unchanged. |
| `ProviderRegistry` | `src/providers/registry.ts` | `providerRegistry.test.ts` | Registration, duplicate refusal, lifecycle, approval, health, `productionPool()`. Extended with config and adapter binding, not rebuilt. |
| `ProviderAdapter` port | `src/providers/provider.ts` | — | The provider boundary. `execute()` and `classifyError()`. Extended with a usage result carrying real token/cost data, not invented. |
| `ModelRecord`, `createModelRecord` | `src/models/model.ts` | `modelRegistry.test.ts` | The model definition. `contextWindowTokens`, `maxOutputTokens` default to `null`. Reused. |
| `ModelRegistry`, `modelKey` | `src/models/registry.ts` | `modelRegistry.test.ts` | Per-provider model registration, orphan refusal, enable/approve/health. Reused. |
| `ProviderLifecycle`, `isProductionEligible` | `src/providers/lifecycle.ts` | `providerRegistry.test.ts` | Lifecycle and approval gating that already filters routing before it starts. Reused. |
| `evaluateCandidate` | `src/routing/router.ts` | `routing.test.ts` | The hard, deterministic eligibility filter with 12 named rejection reasons. This is the "do not select an incompatible model" guarantee, and it already exists. Reused verbatim. |
| `Scorer`, `ScoreFactor`, `VerifiedFactsScorer` | `src/routing/router.ts` | `routing.test.ts` | The documented ordering extension point, deliberately shipped with no weights. PHASE 06 supplies the first real `Scorer` implementations, built on this interface. |
| `DefaultRouter`, `RegistryCandidateSource` | `src/routing/defaultRouter.ts` | `routing.test.ts` | Filter-then-score pipeline returning the full rejection list. Reused, with a fallback chain layered on top. |
| `HealthObservation`, `deriveHealth`, `isRoutableStatus`, `InMemoryHealthMonitor` | `src/health/` | `routing.test.ts` | `healthy`/`degraded`/`unavailable`/`unknown` already exist, with failure thresholds. Reused. |
| `WorkloadRequirements` | `src/workload/workload.ts` | `workload.test.ts` | Already carries capabilities, `minContextTokens`, `requiredTools`, reliability, latency and cost preference, and `fallbackRequired`. This is the requirement surface PHASE 06 routes against. Extended additively. |
| `matchCapabilities`, `MatchVerdict` | `src/capabilities/match.ts` | `capabilities.test.ts` | Three-valued capability matching where `unknown` is not `supported`. Reused. |
| `ModelRouter`, `ModelRoutingPort` | `src/orchestration/model/modelRouter.ts` | `orchestration.fabric.test.ts` | The orchestrator's routing port. It already refuses to record a route it cannot execute. Extended for fallback, not replaced. |
| `ProviderAdapterRegistry` | `src/orchestration/provider/providerAdapterRegistry.ts` | `orchestration.fabric.test.ts` | Closes the "route recorded but nothing behind it" defect. Reused. |
| `EvidenceCost` | `src/orchestration/evidence/evidence.ts` | — | Already has `inputTokens`, `outputTokens`, `amount`, `currency`, all nullable, with the comment that a fabricated price is a fabricated financial claim. This is where PHASE 06's cost data lands. |
| `RetryPolicy`, `decideRetry`, `isRetryableUnder` | `src/retry/` | `retry.test.ts` | Reused to decide whether a provider failure is worth a retry or a fallback. |
| `ProviderConfig` | `src/config/schema.ts` | `config.test.ts` | Provider configuration, with credentials as a variable NAME. Reused. |
| `SecretRef`, `SecretStore`, `EmptySecretStore` | `src/core/secretRef.ts` | `audit.test.ts` | The credential seam. No key is ever read into a record. |
| `OrchestrationEventKind` | `src/orchestration/observability/trace.ts` | — | One event history. PHASE 06 adds kinds here; no parallel logger. |
| `ToolRegistry`, `ToolInvoker`, `TOOL_KINDS` (incl. `"mcp"`) | `src/orchestration/tools/` | `orchestration.subsystems.test.ts` | The tool/MCP layer. Routed models' `requiredTools` are checked against it. |

## Gaps this phase fills

| Requirement | Existing | Missing | Needs refactor | Test needed |
|---|---|---|---|---|
| Provider definition/registry | yes, from PHASE 01 | bound to a live adapter and a config | no | yes |
| Model definition/registry | yes | model-level adapter selection; per-model overrides | no | yes |
| Routing | filter + verified-facts order | real, configurable policies | no | yes |
| Explainability | `selectionReason` string | a structured, per-requirement explanation of *which* requirement decided it | no | yes |
| Fallback | `fallbackRequired` flag only | an ordered chain, with requirement preservation and a recorded reason per hop | no | yes |
| Health in routing | status filter + a fixed rank nudge | loop prevention, cooldown, and a recorded decision not to re-route to a just-failed target | no | yes |
| Policy configuration | none | named policies, configurable, with no single hard-coded global preference | no | yes |
| Cost/resource | `EvidenceCost`, all nullable | a ledger that records real data and reports `unknown` rather than estimating | no | yes |
| Orchestrator integration | `ModelRouter` port | fallback-aware routing, attempt recording, refusal when no chain survives | additive | yes |
| Observability | `model_routed` kind | route/fallback/health events in the one audit history | additive | yes |
| Streaming | none | a port declaration only, with no implementation claimed | no | yes |
| Structured output | `structured_output` capability exists | route on it as a hard requirement | no | yes |
| Tool calling | `tool_calling` capability + tool registry | cross-check `requiredTools` against registered tools | no | yes |

## Deliberately not added

- **No provider client, and no provider named.** No OpenAI, Anthropic, Google,
  Qwen, DeepSeek or OpenRouter adapter is added, no endpoint is defaulted, and no
  API key is read. A wire format invented from memory is a fabricated integration
  and could not be exercised without credentials. The adapters shipped here are
  test doubles that live in the tests.
- **No price table.** `costClass` is the existing relative classification. Where a
  provider reports a monetary amount it is recorded verbatim; where it does not,
  the value is `null` and reported as unknown. Nothing is estimated.
- **No quality benchmark, and no "best model" score.** There is no measured
  quality data in this repository, so no policy claims to know which model is
  better. Policies order candidates by requirements and *recorded facts*.
- **No second routing authority.** `evaluateCandidate` stays the only eligibility
  filter. Fallback cannot admit a candidate the filter rejected.
- **No automatic re-routing mid-flight** that could change what a subtask means.
  Fallback happens between attempts, on a recorded reason, and each attempt is
  separately auditable.
- **No new runtime dependency.**

## Confirmed absent from the repository

Recorded so these are not silently assumed: no LLM client of any kind, no HTTP
provider call, no streaming implementation, no response-format/JSON-schema layer,
no real MCP client (`ToolInvoker` is a port with one local implementation), and no
cost telemetry from any real provider. The capability names `structured_output`
and `tool_calling` exist as declared facts to be verified, not as features that
have been exercised.
