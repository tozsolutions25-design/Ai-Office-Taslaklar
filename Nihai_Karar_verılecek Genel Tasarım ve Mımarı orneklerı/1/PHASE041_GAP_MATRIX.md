# PHASE 04.1 gap matrix

Produced by the PHASE 04.1 audit, before any PHASE 04.1 code was written. Kept so
the reasoning is auditable rather than reconstructed from the diff.

"Exists" means *implemented and tested in this repository*, not *mentioned in a
document*.

## Audit findings that constrain the work

1. **There is no Agency Agent roster in this repository.** The only occurrences
   of "Agency" are forward-looking prose in `ARCHITECTURE.md` (§3, §13, §14).
   There is no manifest, no descriptor, no roster file, and no external source
   material. Rules 16 and 17 therefore forbid inventing one. PHASE 04.1 delivers
   the *source architecture* and the ingestion boundary, and registers zero
   fabricated agents.
2. **There is no Ruflo package and no Ruflo source material.** Only the concept
   list already recorded in `ARCHITECTURE.md` §21 is verifiable. Rule 17 forbids
   claiming capabilities beyond that list, so the compatibility profile is built
   from those concepts and from nothing else.
3. **No provider adapter implementation exists.** `src/providers/provider.ts`
   declares `ProviderAdapter` and documents "PHASE 01 ships no implementation".
   Rule 15 forbids faking an OpenAI/Anthropic integration, so none is added.
4. **The routed provider is never used to execute anything.** `TozOrchestrator`
   routes a provider, records it in evidence, and then executes through the
   *agent* adapter. A model-backed agent therefore has no path to a model. This
   is the single largest architectural gap.
5. **`SubTaskLimits.maxRetries` is declared, validated, drift-checked, and then
   never used.** A failed subtask is never retried.
6. **Tools are filtered on but never invoked.** `ToolRegistry` and
   `authorizeToolCall` exist; nothing calls them during execution.
7. **Every subtask requires a provider route**, which makes a self-hosted
   specialist (one that brings its own inference, such as an agency-hosted agent)
   inexecutable by construction.

## Matrix

| Requirement | Existing | Missing | Needs refactor | Test exists | Test needed |
|---|---|---|---|---|---|
| TozOrchestrator is sole authority | yes, strong | — | no | yes (47) | regression |
| Orchestrator advances state only | yes | — | no | yes | regression |
| Agent Registry | `record.ts`, `registry.ts` | provenance (`source`), `requiresModelRoute`, role/description | additive | yes | yes |
| Capability Registry | index + availability | first-class capability entity, per-source availability | additive | partial | yes |
| Capability names open | yes (`string & {}`) | catalogue as data | additive | yes | — |
| Specialist Pool | filter + deterministic order | specialization match, model compatibility, cost constraint, verification requirement, opt-in learning signal | additive criteria | yes | yes |
| Dynamic selection deterministic | yes | ranking must distinguish on every declared criterion | additive | yes | yes |
| Overlapping candidates per capability | yes | proven with 3 same-capability agents | no | no | yes |
| Agency Agents as capability source | **nothing** | `AgentSource` port, normalizer, roster ingestion, report, adapter | new | no | yes |
| Agency execution boundary | `UnavailableAgentAdapter` only | `AgencyAgentAdapter` + transport port, honest not-configured state | new | no | yes |
| Ruflo integration | prose only | compatibility profile, disabled-by-default boundary, no-authority proof | new | no | yes |
| Toz works without Ruflo | n/a | test | no | no | yes |
| Provider registry | exists (PHASE 01) | — | no | yes | regression |
| Provider adapter registry | **nothing** | registry over the core port, honest no-adapter failure | new | no | yes |
| Model route used for execution | **no** | route-to-execution wiring, or honest failure | refactor | no | yes |
| Model registry | exists (PHASE 01) | — | no | yes | regression |
| Team runtime: 1/2/5-step plans | 1 and 3 tested | 5-step, dependent, all-success | no | partial | yes |
| Team runtime: retry | **missing** | bounded retry using `maxRetries` | refactor | no | yes |
| Team runtime: escalation | state machine only | runtime-visible escalation | additive | partial | yes |
| Memory read/write separate | yes (PHASE 04.1 fix) | — | no | yes | regression |
| Memory denied write as controlled result | yes | — | no | yes | regression |
| Learning separate from memory | feedback store only | `LearningSignalSource` port, opt-in tiebreak | new | partial | yes |
| Evidence provenance | record exists | sequence + execution id | additive | partial | yes |
| Evidence merge + attribution | yes (PHASE 04.1 fix) | — | no | yes | regression |
| Verification pass/fail/needs_review | yes | — | no | yes | regression |
| Unknown kind escalates | yes | — | no | yes | regression |
| Model QA | **nothing** | reference `consistency` verifier | new | no | yes |
| Tool registry | exists | invocation wired into execution | refactor | partial | yes |
| Tool authorization / denial | exists | per-agent authorized set, not global | additive | yes | yes |
| Tool result as evidence | **missing** | tool call evidence from a real invocation | new | no | yes |
| Workers | `WorkerHost` | foreground/background/scheduled classification, contract test | additive | partial | yes |
| Observability event kinds | 12 kinds | team/routing/tool/memory/retry/escalation kinds | additive | partial | yes |
| Audit shares one history | yes (PHASE 04.1 fix) | new kinds flow through it | additive | yes | regression |
| Cost/resource tracking | yes | unmeasured stays null | no | yes | regression |
| Config centralised | yes (passthrough) | `agents`, `ruflo`, `tools`, `learning` sections | additive | yes | yes |
| Extensibility ports | `AgentAdapter`, `ProviderAdapter`, `ToolInvoker` | one implementation each where wired | additive | partial | yes |
| One brain (no second path) | `ExtensionRegistry` refuses authority | same guarantee for sources and Ruflo | additive | partial | yes |

## Intentionally not added, and why

- **No Agency agent roster.** Rule 16, and finding 1.
- **No Ruflo dependency, and no `RufloAdapter` claiming a live integration.**
  Rule 3 and 17, and finding 2. The boundary is defined; nothing pretends to call
  a framework that is not installed.
- **No OpenAI/Anthropic/Google/Qwen/DeepSeek/OpenRouter adapter.** Rule 15 and
  finding 3. The registry and the port exist; a fabricated wire format would be a
  fabricated integration.
- **No SEO, marketing or content agent**, and no `seo.*` capability. The
  repository's own capability vocabulary is the PHASE 01 built-in list plus the
  names already used in `docs/PHASE04_MAP.md`. Rule 5's examples are explicitly
  "capability examples, NOT permission to invent arbitrary Agency Agents".
- **No second orchestration path**, no global selection, no provider-specific
  logic in the orchestrator. Rules 7, 8, 13.
- **No automatic learning feedback into selection.** The signal is opt-in and
  tiebreak-only, so routing stays explainable.
