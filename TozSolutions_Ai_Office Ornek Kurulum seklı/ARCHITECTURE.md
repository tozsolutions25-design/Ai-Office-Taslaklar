# TOZ AI OFFICE — ARCHITECTURE

Reference for the orchestration fabric established in PHASE 04, and the layering
rules that earlier phases established.

Each entry states **why** the component exists, **what** it is, **how** it works,
where its **boundaries** lie, and how it can be **extended** later.

---

## 1. Layering

```
core  ←  design-system  ←  site
core  ←  orchestration
```

| Tree | May import | Status |
|---|---|---|
| `src/orchestration` | core, design-system | PHASE 04 |
| `src/core` (provider, model, queue, retry, health, audit, state, config) | nothing internal | PHASE 01 |
| `src/design-system` | nothing internal | PHASE 02 |
| `src/site` | design-system only | PHASE 03 |

The direction is enforced by tests that resolve every import, not by convention.

`orchestration` sits above `core`. It is the only layer permitted to compose
registries, the queue, the router and the retry executor into an execution. It
never re-implements them.

---

## 2. The single authority: TOZ Orchestrator

**WHY.** Multi-agent systems fail most often not because an agent is weak, but
because two components each believe they decide what runs. PHASE 04 therefore has
exactly one component with authority over an execution: `TozOrchestrator`.

**WHAT.** `src/orchestration/authority.ts` exposes `TozOrchestrator`. It is the
only type permitted to move a task from `created` to `completed`.

**HOW.** Every execution follows the fixed sequence in §14. Each step reads from a
subordinate service; none of them can start work on their own. The orchestrator
constructs the `TeamRuntime` itself and supplies the executor, because selection,
routing and adapter invocation are decisions only it may make: a runtime handed
in from outside would need an executor that already knew all of that, which is a
second way in.

Selection, routing and adapter execution happen PER SUBTASK, not once per task. A
plan whose second step needs different capabilities gets a different agent, and a
multi-agent task records every participant (`agents`) rather than only the one
that produced the final output.

**BOUNDARIES.** Subordinate services are `Planner`, `AgentRegistry`,
`CapabilityRegistry`, `SpecialistPool`, `ModelRouter`, `ToolRegistry`, `MemoryProvider`,
`Verifier`, `WorkerHost`, `FeedbackStore`. None of them implements
`orchestrate()`. An agent adapter cannot call the orchestrator; it can only be
called by it.

**FUTURE EXTENSION.** A Ruflo, Agency, or remote agent integrates through
`AgentAdapter`. It receives a normalised agent and returns a normalised result.
It never becomes a second control plane.

---

## 3. Domain separation

The following are separate types with no structural overlap. Conflating any of
them is the defect this section exists to prevent.

```
Agent        != Capability    an agent HAS capabilities; neither is the other
Agent        != Provider      an agent RUNS ON a provider
Agent        != Model         an agent USES a model
Agent        != Tool          an agent CALLS tools
Agent        != Memory        an agent READS memory under policy
Agent        != Orchestrator  an agent executes; the orchestrator decides
Provider     != Model         a provider SERVES models
Tool         != Agent         a tool is callable; an agent is not
Verification != Generation    a claim is not a verified fact (see §9)
Evidence     != Output        evidence is what supports the output
Memory       != Learning      memory stores; learning derives (see §11)
```

`AgentRegistry` holds agents. `CapabilityRegistry` holds capability names and
their meaning. `ProviderRegistry` holds providers. `ModelRegistry` holds models.
`ToolRegistry` holds tools. Asking "which agents can perform `web_research`?" is
a capability question; "which agent should I call?" is a selection question, and
is the wrong question.

---

## 4. Agent Registry

**WHY.** The system needs a machine-readable inventory of who can do what, with
enough metadata to select between candidates and to trust the result.

**WHAT.** `src/orchestration/agent/registry.ts` — `AgentRegistry`, over
`AgentRecord` (`src/orchestration/agent/record.ts`).

A record carries: `agentId`, `name`, `version`, `status`, `type`, `capabilities`,
`specializations`, `providerRequirements`, `toolRequirements`, `memoryScopes`,
`trustLevel`, `costClass`, `latencyClass`, `executionMode`, `inputContract`,
`outputContract`, `verificationRequirements`, `availability`, `health`,
`adapter`, `source`, `requiresModelRoute`, `metadata`.

**`source` — provenance.** `native`, `agency`, `ruflo`, `remote`, or `custom`,
with a `ref` inside the source. It is on the record rather than inferred from the
adapter name, so "which agents did an external agency give us?" is answerable
from the registry without auditing adapter implementations. PHASE 04.1.

**`requiresModelRoute` — how the agent is executed.** `true` means the agent is a
prompt plus capabilities and inference must come from a provider TOZ routes to.
`false` means it is self-hosted: it brings its own inference, or it is not a model
call at all. An agency-hosted specialist is the motivating case — before this
field existed, every subtask demanded a provider route, which made the entire
class of self-hosted specialists inexecutable by construction. Defaults to `true`,
the stricter answer. PHASE 04.1.

**HOW.** Registration is keyed by `agentId@version`. Re-registering the same
version is REJECTED as a duplicate, not silently merged: replacing a record would
change the meaning of every decision already made about it. `registerOrGet` is the
idempotent entry for callers that must not fail on a repeat. A new version
registers as a new key, so an upgrade does not erase history. Lifecycle is an
explicit transition table (`discovered → verified → registered → available →
draining → retired`), so an agent cannot reach `available` by accident.

Selectability needs BOTH a lifecycle of `available` and a record status that is
selectable (`active`). One alone is not enough: an agent can be
lifecycle-available while its record is `disabled`.

**BOUNDARIES.** The registry stores records. It does not execute agents, score
them, or choose them. Those belong to `SpecialistPool`.

**FUTURE EXTENSION.** A new agent source is a new `AgentAdapter`, not a new
registry.

---

## 5. Capability Registry

**WHY.** Capability names must be extensible — an agent can declare
`web_research` or `entity_extraction` without a code change — while the
pre-existing matcher keeps its tri-state `unknown` semantics.

**WHAT.** `src/orchestration/capabilities/registry.ts` — `CapabilityRegistry`,
which indexes agents by capability and explains why a capability is or is not
available.

**HOW.** Built on the PHASE 01 `CapabilitySet` and `matchCapabilities`. The
registry does not re-implement matching; it indexes and explains.

**BOUNDARIES.** A capability is a *name with meaning*, not a callable. It has no
execution. `unknown` is never promoted to `supported`.

**FUTURE EXTENSION.** Capability names are open. PHASE 01 ships twelve built-ins
and the `Capability` type is now open, so agents may declare their own.

---

## 6. Specialist Pool

**WHY.** Selection must not be "first in the list" or "round robin". It must be
deterministic, explainable, and able to say why a candidate was rejected.

**WHAT.** `src/orchestration/pool/specialistPool.ts` — `SpecialistPool`.

**HOW.** Two stages, mirroring the existing `DefaultRouter`:

1. **Filter** — hard, recorded-fact eligibility: status, availability, health,
   capability verdict, trust floor, required tools, required memory scope.
2. **Order** — deterministic ranking over recorded facts only: capability coverage,
   trust level, health, measured latency, cost class, then `agentId` for total
   ordering.

No numeric weights are invented. Where no measurement exists, the fact is
`unknown` and contributes nothing, rather than a favourable guess. Capability
coverage is ranked by the ABSOLUTE number of satisfied requirements, not a ratio:
every candidate is assessed against the same required set, so a ratio is identical
for all of them and cannot break a tie. The final term is the agent key, which
makes the order total and therefore reproducible.

The lifecycle state travels on the candidate rather than being looked up by agent
id, because lifecycle is per VERSION: `researcher@1.0.0` can be `available` while
`researcher@2.0.0` is still only `registered`.

**BOUNDARIES.** The pool answers "which agents could take this task, and why
these". It does not execute, and it does not choose a model.

**FUTURE EXTENSION.** A learned ranker replaces the deterministic comparator as
a `Scorer` implementation. The filter is unchanged, so a learned component could
never route an ineligible agent.

---

## 7. Model Router

**WHY.** Agent and model are separate concerns. An agent declares what it needs;
the router decides which provider and model serve it.

**WHAT.** `src/orchestration/model/modelRouter.ts` — `ModelRouter`, over the
existing `ProviderRegistry` and `ModelRegistry`, behind the `ModelRoutingPort`
interface the orchestrator depends on.

**HOW.** Converts agent requirements into a `RoutingRequest`, delegates to the
existing `ProviderRouter`, and returns the decision with its rejection list.

**BOUNDARIES.** Reuses the PHASE 01 router. Does not create a second routing
authority. If no eligible model exists it returns `null` with reasons; it never
falls back to an arbitrary provider. The orchestrator treats a `null` route as a
subtask failure and executes nothing: running without a provider would mean
pretending the work happened somewhere.

**Provider adapter registry.** `src/orchestration/provider/providerAdapterRegistry.ts`
holds adapters behind the PHASE 01 `ProviderAdapter` port. **It ships empty**, and
so does the port: no OpenAI, Anthropic, Google, Qwen, DeepSeek or OpenRouter
client exists in this repository, and fabricating a wire format would be
fabricating an integration. The registry exists because the port alone was half a
contract — there was nowhere to ask "can anything actually serve this route?"

**A route with nothing behind it is a failure, not a claim.** When a
`ProviderAdapterRegistry` is supplied and the routed provider has no adapter, the
subtask fails with a classified `configuration_error` and executes nothing.
Recording a provider in evidence that has no adapter behind it is exactly the
defect this closes. When no registry is supplied the check is skipped, which is
correct for a deployment where no provider is involved. PHASE 04.1.

**FUTURE EXTENSION.** Cost-, latency- or quality-weighted scoring is a
`ScoreFactor` addition inside the existing router.

---

## 8. Team / Swarm

**WHY.** Some tasks genuinely need several specialists. The abstraction must
exist before it is needed, and must not force a swarm onto a task one agent can
finish.

**WHAT.** `src/orchestration/team/` — `TeamPlan`, `Topology`, `TeamRuntime`.

Topologies: `single`, `sequential`, `parallel`, `hierarchical`,
`hierarchical-mesh`, `adaptive`.

**HOW.** A validated `ExecutionPlan` declares a topology, its subtasks, their
dependencies, and a terminal subtask. `TeamPlan.choose` picks the SMALLEST
sufficient topology: a plan whose subtasks are strictly ordered gets
`sequential`, a plan of one gets `single`, and only genuinely independent work
gets `parallel`. A requested topology that contradicts the plan size is refused.
`TeamRuntime` orders and bounds execution; the orchestrator supplies the executor
that makes every decision inside a subtask. `Team` is a coordination scope with
an id, not a process.

**BOUNDARIES.** The runtime orders and bounds execution; the orchestrator supplies
the executor that makes every decision inside a subtask. `Team` is a coordination
scope with an id, not a process.

**Retry.** `SubTaskLimits.maxRetries` is honoured. Before PHASE 04.1 it was
declared, validated, drift-checked — and then never used, so a failed subtask was
final regardless of what the plan allowed. Retries are bounded by the plan and
limited to transient classes (`timeout`, `transient_provider_failure`,
`rate_limit`, `temporary_outage`). A permanent refusal retried three times costs
three times as much for the same answer.

**Escalation.** `authentication_failure`, `quota_exhausted` and `invalid_model`
are terminal for the plan and reported as `escalated`, because they will fail
identically forever and the remedy is a person, not another attempt. A
`configuration_error` stays a *failure*, which is the PHASE 04 contract — changing
an already-validated outcome on the strength of a new code path rather than a new
requirement would have been wrong. PHASE 04.1.

A failure propagates to everything downstream, and skipped subtasks are reported
as `skipped` rather than silently absent. The first failure's own message is
included in the team reason, because "1 subtask failed" tells a caller nothing
they can act on.

`adaptive` is a recorded topology value and is validated, but PHASE 04 does not
implement a topology-rewriting runtime for it — see K-24.

**FUTURE EXTENSION.** `hierarchical-mesh` and `adaptive` runtimes can be added
without changing `TeamPlan`, because the plan is declarative.

---

## 9. Evidence and Verification

**WHY.** "The agent said it is done" is not the same as "the system verified it
is done". PHASE 04 keeps those two things in different types so they cannot be
confused downstream.

**WHAT.**

- `src/orchestration/evidence/` — `Evidence`, `EvidenceCollector`.
- `src/orchestration/verification/` — `Verifier`, `VerificationVerdict`
  (`pass` / `fail` / `needs_review`).

**HOW.** Execution produces an `Evidence` record: task, agent, provider, model,
input digest, output, tool calls, sources, artifacts, tests, timestamps, cost,
status, error class. A `Verifier` inspects evidence and returns a verdict. A
failed verification is a first-class outcome, not an exception.

A multi-agent task produces one record per subtask, and `mergeEvidence` reduces
them to the single record verification reads. The merge is a UNION: every tool
call, source, artifact and test survives, measured cost is summed, unmeasured cost
stays `null`, and `agents` lists every participant while `agentId` names a
producing agent only when there is exactly one. The output is the terminal
subtask's output, not a concatenation that would read as one agent's answer.

**BOUNDARIES.** Verification is not an optional trailing prompt. A task that
requires verification cannot reach `completed` without a `pass`. `needs_review`
is routed to escalation, never silently treated as success. A requested
verification kind this build does not recognise ESCALATES: silently skipping an
unavailable check would convert a missing capability into a green result.

**Model QA.** `ConsistencyQAVerifier` (kind `consistency`) asks a different
question from the integrity verifier: not "is this record well formed" but "does
the output agree with the record that describes it". It fails an output that cites
a reference the evidence does not hold, fails one that cites anything while the
evidence records no source, and fails an empty output. It notes hedged language,
because a hedge is not a verified claim. PHASE 04.1.

**Provenance.** `EvidenceProvenance` — trace, task, subtask, agent key, attempt,
sequence, timestamps. PHASE 04.1 added `attempt` and `sequence` because a retried
subtask produces several records under one task and they were otherwise
indistinguishable and unordered. `mergeEvidence` keeps the highest sequence seen.

**FUTURE EXTENSION.** Additional verifier kinds (schema, source, test, policy,
consistency) are new `Verifier` implementations.

---

## 10. Memory

**WHY.** The orchestrator must not be coupled to a database, and an agent must
not automatically see everything.

**WHAT.** `src/orchestration/memory/` — `MemoryProvider`, `MemoryScope`,
`MemoryAccessPolicy`, `InMemoryMemoryProvider`.

Scopes: `system`, `project`, `task`, `team`, `agent`, `provider`, `pattern`,
`knowledge`.

**HOW.** Reads and writes name the scope. A grant carries `scopes` (readable) and
`writableScopes` (writable) as separate lists: read access is not write access,
and a grant that quietly implied both would make "this agent may see project
memory" indistinguishable from "this agent may rewrite it". A grant with an empty
`writableScopes` is an observer. Nothing is granted by default. The provider
records which scope a read touched, so an audit can show that an agent saw only
what it was granted. Writes are idempotent by key.

**BOUNDARIES.** Memory is not learning (§11) and not evidence (§9). The in-memory
implementation is a reference implementation, not the architecture; a SQLite,
vector, or hybrid backend implements the same interface. A refused write is
returned as a value and reported in the run's steps, never thrown: the work is
already done, and a bookkeeping failure is not a reason to lose it.

**FUTURE EXTENSION.** New backends implement `MemoryProvider`. No orchestrator
change is required.

---

## 11. Feedback and Learning

**WHY.** Selection should improve from observed outcomes, but an opaque
self-modifying system is not acceptable and is not built.

**WHAT.** `src/orchestration/feedback/` — `FeedbackRecord`, `FeedbackStore`.

Records: task, agent, provider, model, outcome, verification result, latency,
cost, retries, corrections.

**HOW.** Written after every execution. Readable by any ranking component.

**BOUNDARIES.** PHASE 04 persists structured feedback and exposes it. It does
NOT feed it back into selection automatically. Routing remains deterministic, and
the deterministic pool is the default. This is deliberate: a learned ranker must
be opt-in and observable.

**Learning signals (PHASE 04.1).** `src/orchestration/feedback/learningSignal.ts`
— `LearningSignalSource`, `FeedbackLearningSource`, `signalWeight`. Learning is
NOT memory: memory stores facts about the world, learning stores facts about us.
`learningSignal.ts` imports no memory module, and a test enforces that by reading
the source, because a learning signal derived from a memory read would be a claim
about the world mistaken for a claim about our own performance.

The signal is deliberately powerless on purpose. It is off unless a source is
supplied; it is used only inside the ranking and only as a tiebreaker, after every
recorded fact has been compared; it can never make an ineligible agent eligible,
because eligibility is settled before it is consulted; it requires a minimum
sample count, so one lucky run is not a signal; and it reports `null` rather than a
number when nothing has been measured. Its numeric weight is orders of magnitude
below the gap between any two recorded facts, so no arrangement of facts can be
overturned by it. A signal that can explain itself, or that changes eligibility, is
not a learning signal — it is an oracle.

**FUTURE EXTENSION.** A `Scorer` that reads `FeedbackStore` becomes a PHASE 05+
concern, behind the same `Scorer` interface.

---

## 12. Tools and MCP

**WHY.** A tool is callable. An agent is not. Conflating them makes permissions
impossible to express.

**WHAT.** `src/orchestration/tools/` — `ToolRegistry`, `ToolRecord`,
`ToolPermission`.

**HOW.** An agent declares `toolRequirements`. The pool filters on tool
availability. Tool invocation is authorised through an explicit
`ToolPermission`, checked before the call.

**BOUNDARIES.** Tools never select agents. Tool execution lives behind
`ToolInvoker`. PHASE 04 defines the contract and does not implement an MCP client.

**Tool execution.** `src/orchestration/tools/invoker.ts` — `ToolExecutionHost`.
Before PHASE 04.1 tools were filtered on but never *called*: the registry and the
authorisation function existed and nothing invoked them. The host closes that.

An agent's authorised set is the INTERSECTION of what it declared
(`toolRequirements`) and what policy permits for the caller. There is no "give the
agent every registered tool" path — a grant that bypassed the declaration would
make the registry a permission list by accident and the declaration meaningless.
An agent that declares nothing gets nothing.

Order is fixed: policy, then the existence of an implementation, then the call.
A refusal is reported as a refusal (`refused: true`), which is a different fact
from a call that was made and failed, and a different remedy.

The reference invoker, `TextStatInvoker`, is a genuinely local deterministic tool
that needs no network or credential. It is a working tool, not a stand-in
pretending to be an MCP client. PHASE 04.1.

**FUTURE EXTENSION.** Local, MCP, remote, and sandboxed tools are
`ToolInvoker` implementations behind the same registry entry.

---

## 13. Adapters

**WHY.** Agents come from outside — Agency, Ruflo, a remote service, or a
TOZ-native implementation. None may become the hidden master orchestrator.

**WHAT.** `src/orchestration/agent/adapter.ts` — `AgentAdapter`, with
`AgentExecutionRequest` and `AgentExecutionResult`.

The adapter normalises identity, capabilities, input, execution, output, errors,
lifecycle, health, metadata, and cost information where available.

**BOUNDARIES.** An adapter is a leaf. It has no reference to the orchestrator,
the pool, or the router, and cannot enqueue work. Correct:

```
RufloAdapter implements AgentAdapter
```

Incorrect, and structurally impossible here:

```
TozAgent extends RufloAgent
```

**FUTURE EXTENSION.** `AgencyAdapter`, `RufloAdapter`, `RemoteAgentAdapter`,
`CustomAgentAdapter` are all new implementations of one interface. No Ruflo
package is installed and none is required; the adapter for it is optional,
isolated, and disabled by default.

---

## 13a. Agent sources (PHASE 04.1)

**WHY.** Agents arrive from more than one place: declared inside this repository,
supplied by an agency, supplied through the Ruflo boundary, or reached over a
network. All four must arrive through the same normalisation, or an external agent
becomes either a second-class citizen or a special case in the core.

**WHAT.** `src/orchestration/agentsource/`

- `source.ts` — `AgentSource` (a place agents come from), `SourceAgentDescriptor`
  (what a source says about an agent), `CapabilityMapper` with an identity
  implementation and an explicit-alias implementation, and `normaliseSourceAgent`
- `ingest.ts` — `AgentIngestor` (the only path by which an external agent
  enters), `DeclaredAgentSource` (a roster supplied as data), `IngestReport`
- `agencyAdapter.ts` — `AgencyAgentAdapter`, its `AgencyTransport` port, and
  `classifyAgencyError`

**The dependency direction is one way.** An external source supplies descriptors;
TOZ normalises them, registers them, indexes them, and selects them. Nothing flows
back: an agency cannot select an agent, cannot see a pool, and cannot reach the
orchestrator. `AgencyAgentAdapter` implements `AgentAdapter`, which has no
orchestrator reference — so the inverted shape is not merely discouraged, it is
inexpressible.

**Two properties the ingestor guarantees.**

1. *Ingestion is never a decision.* It registers records; it does not enable,
   select or schedule them. An external agent arrives `disabled` and stays that
   way until the same lifecycle promotion any TOZ agent goes through. A source
   that could hand us a live agent would be a source that could choose what runs.
2. *Ingestion is always reported.* Every descriptor is either registered or
   rejected with a reason, and every capability rename is recorded. A source that
   quietly failed to contribute three of its five agents would otherwise look
   exactly like a source that contributed five and lost to selection.

**What normalisation rejects, rather than repairs.** A missing or malformed id; a
capability name the mapper cannot map (dropping it would leave the agent silently
less capable than advertised); a memory scope that is not a real scope; an unknown
cost class, execution mode or agent type; and a trust level above the source's
ceiling, because an external self-description is a claim rather than a
measurement.

A descriptor with NO capabilities is **not** rejected. It normalises to an unknown
capability set, which the pool withholds unless a caller explicitly waives
verification. That is the existing tri-state rule, applied rather than reinvented.

**What is deliberately absent: a roster.** No Agency Agent roster exists in this
repository, and no agency transport is reachable. `AgencyAgentAdapter` therefore
reports itself unavailable and returns a classified `configuration_error` — the
honest state, asserted by test. A stub echoing a plausible answer would make an
integration look real, which is the specific failure this boundary is written to
prevent. An agency integration is a `DeclaredAgentSource` over a real roster plus
an `AgencyTransport` implementation, and nothing else: no change to the
orchestrator, the pool, or the registry.

---

## 14. Execution policy

Every execution follows this order, and the orchestrator is the only component
that can advance it:

```
 1  identify the task                    state: created
 2  screen input                         (InputPolicy)
 3  classify                             state: classifying
 4  plan, and validate it                state: planning
 5  check anti-drift limits              (DriftGuard)
 6  choose the smallest topology         (TeamPlan)
--- per subtask, through TeamRuntime -------------------------------------
 7    select an agent                    (SpecialistPool)   state: running
 8    route to a provider and model      (ModelRouter)
 9    execute through the agent's adapter (AgentAdapter)
10    screen the output                  (OutputPolicy)
11    record evidence and resource use   (per subtask)
--- task level ------------------------------------------------------------
12  merge subtask evidence               (mergeEvidence)
13  verify                               (VerificationRunner) state: verifying
14  record outcome, feedback, memory     (FeedbackStore, MemoryProvider)
15  complete                             state: completed
```

Every early exit — a refused input, an invalid plan, a drift violation, a missing
agent, an unroutable provider, a failed or skipped subtask, a caller abort — ends
in a terminal state with a classified `errorClass`, a reason a caller can act on,
and a feedback record. A `partial` team is reported as a failure: the plan did not
complete, and a partial result must not read as a finished objective.

---

## 15. Anti-drift

**WHY.** In a multi-agent run, an agent can quietly redefine the objective and
the run "succeeds" at something else.

**WHAT.** `src/orchestration/policy/antiDrift.ts` — `DriftGuard`, over
`DriftLimits`.

**HOW.** A plan declares a maximum depth, maximum child tasks, a deadline, a
maximum retry count, and a required verification. `DriftGuard` validates a plan
BEFORE execution and records the check, so a rejected plan is observable rather
than silently corrected.

**BOUNDARIES.** A plan exceeding any limit cannot be executed. This is what
prevents uncontrolled recursive spawning.

---

## 16. Workers

**WHY.** Health checks, memory maintenance, and cost monitoring are periodic
work that must not run inside a request.

**WHAT.** `src/orchestration/workers/` — `Worker`, `WorkerHost`.

**HOW.** `WorkerHost` starts, stops, and cancels workers. Every run is bounded by
a timeout and an attempt ceiling, and every run is recorded. A worker that throws
is recorded as failed; it is never restarted silently.

**BOUNDARIES.** A worker cannot start an execution. It may use the same
registries and services, but it has no authority.

**FUTURE EXTENSION.** Scheduled jobs, knowledge maintenance, and test-gap
detection are new `Worker` implementations.

---

## 17. Observability and cost

**WHY.** Selection must be explainable and resource consumption attributable.

**WHAT.** `src/orchestration/observability/` — `TraceRecorder`, `ResourceTracker`.

Every meaningful operation records: trace, task, parent task, team, agent,
provider, model, step, status, duration, error class, timestamp.

**HOW.** Structured records, not console strings. The existing `AuditLog` is used
as the sink, so orchestration events and provider events share one stream.
Orchestration milestones are written under their own audit kind,
`orchestration_event`, carrying the specific step. They are deliberately NOT
written as `task_transition`: that kind asserts a state change, and recording
every milestone as one would both invent a transition and collapse selection,
topology, evidence and verification into a single indistinguishable record.

**BOUNDARIES.** Cost is attributed to a task, an agent and a provider, so
"where did the resources go?" is answerable. PHASE 04 records token and cost
figures supplied by an adapter; it does not invent a price table.

---

## 18. Security boundary

```
INPUT -> POLICY -> ORCHESTRATOR -> AGENT -> TOOL -> OUTPUT -> VERIFICATION
```

`src/orchestration/policy/security.ts` defines the seam: `InputPolicy` screens
inbound work, `ToolPermission` authorises tool calls, and `trustLevel` on an
agent record gates what it may be selected for.

PHASE 04 implements the architecture needed to add prompt-injection detection,
PII controls, sandboxing, and output policy — and does not implement speculative
security products. The interfaces exist so those can be added without moving the
boundary.

---

## 19. Extension model

**WHY.** New agents, providers, tools, memory backends, verifiers, and workers
should be addable without editing the core.

**WHAT.** `src/orchestration/extensions/` — `Extension`, `ExtensionRegistry`.

**HOW.** An extension registers itself; it does not replace anything. Every
orchestration path still passes through the policy layer, so an extension cannot
bypass it.

**BOUNDARIES.** An extension cannot register a second orchestrator, and the
registry rejects a duplicate extension id.

---

## 20. Configuration

`AppConfig` carries an `orchestration` section, so there is ONE configuration
object for the whole system rather than a second one that can drift. That section
is a raw passthrough: the core cannot validate those fields without importing the
orchestration layer, which would invert the dependency direction, so
`orchestrationConfigFromApp` (`src/orchestration/config/`) validates it with the
schema that does understand it and returns the issues alongside the values.

Environment variables are read only through a fixed allow-list in
`src/orchestration/config/env.ts`, on the same pattern as `src/config/load.ts`. A
`TOZ_` prefix is not sufficient: no module in `src/orchestration` parses
`process.env`, and an unexpected variable cannot change behaviour. Unknown keys
inside a section are reported rather than ignored, because a misspelled limit that
looks configured and is not fails open.

**PHASE 04.1 sections, all shipped switched off.** `agents` (source allow-list,
external trust ceiling, auto-promote), `ruflo` (enabled), `tools` (timeout,
`grantUndeclaredTools`), `learning` (enabled, `minimumSamples`). The defaults are
chosen so that building the code changes nothing until an operator says
otherwise: no source is contacted, ingestion never promotes, the Ruflo boundary is
off, an agent may call only what it declared, and learning is off so selection
stays deterministic. Enabling `ruflo.enabled` changes nothing observable, because
there is still no package to call — which is the honest behaviour, not a bug.

---

## 21. Ruflo

**Architectural reference only.** Ruflo is not installed, is not a dependency, and
is not on any critical path. TOZ runs identically whether or not a
`RufloAdapterBoundary` exists in the process, and that is asserted by test rather
than by a comment.

**What was adopted**, and it is the whole of it: router-driven execution,
capability-based agent selection, specialist agents, swarm and team composition,
hierarchical topology, persistent memory, learning from outcomes, background
workers, the workflow abstraction, MCP integration, observability, cost tracking,
plugin extensibility, agent lifecycle, task decomposition, and verification.

**Deliberately not adopted:** installing Ruflo, making it a dependency,
inheriting its control plane, mirroring its type names, or building federation,
neural routing, vector infrastructure, CRDTs, QUIC, or a large MCP tool surface.

**The boundary.** `src/orchestration/ruflo/boundary.ts`:

- `RUFLO_CONCEPTS` — each adopted concept mapped to the TOZ module that
  implements it, each marked implemented or not. Concepts with no TOZ equivalent
  are listed as unimplemented rather than quietly omitted, so their absence is a
  recorded decision and not an oversight.
- `RufloAdapterBoundary` — disabled by default; `status()` reports `not_enabled`,
  and `not_installed` even when enabled, because no package is present;
  constructing one that `claimsAuthority` throws; `execute()` returns a classified
  failure with a reason rather than a fabricated result.
- `translateRufloOutcome` — total and pure, so the translation is written and
  tested now, against a documented shape, rather than guessed at when a dependency
  finally exists.

**Why no `RufloAdapter` that calls Ruflo ships:** there is nothing to call. The
adapter is written when there is a package behind it.

The reference relationship is inverted: Ruflo would sit behind `AgentAdapter`,
never beneath the core.
