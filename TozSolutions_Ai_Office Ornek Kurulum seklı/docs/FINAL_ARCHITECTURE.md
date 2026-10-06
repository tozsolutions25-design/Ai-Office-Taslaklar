# TOZ AI OFFICE — FINAL ARCHITECTURE

> The canonical architecture document. Produced by the PHASE 10 certification
> audit (2026-09-29) against commit `b9409f1` and its follow-up fixes.
>
> **This document describes what the code does, not what it intends to do.**
> Where the implementation is weaker than the design, the implementation is
> reported. Every claim marked ⚠️ is a known deficiency, not a caveat about
> wording.
>
> Read §23 (Deployment scope), §24 (Known limitations) and §25 (Explicit
> non-guarantees) before deploying anything. They are the sections that will
> matter.

---

## 1. System purpose

Toz AI Office is a multi-agent orchestration system. It accepts an objective,
decides which specialist agents should work on it, routes each unit of work to a
provider and model, executes through adapters, verifies the output, and records
what happened.

It is also a **library and reference architecture**, not a shipped service. There
is no HTTP server, no CLI that runs a job, no database, and no provider client in
this repository. What exists is a set of authorities, the seams between them, and
tests that prove the seams hold.

That distinction governs everything below. A guarantee that can only be
demonstrated with a real provider, a real database and a real network is not
claimed here.

---

## 2. Authority matrix

Exactly one authority per concern. Verified by architecture tests, not by
convention.

| Concern | Authority | Module | How exclusivity is enforced |
|---|---|---|---|
| Orchestration, delegation, execution coordination | **TOZ Orchestrator** | `orchestration/authority.ts` | Owns the plan → select → route → execute → verify sequence. **The agent-execution authority** — the only component that selects an agent, invokes an adapter, or runs a subtask wave. Workflow/job state and approvals belong to `ExecutionCoordinator`; the two are layered, not parallel. Narrowed from "no other component sequences work" in PHASE 08, because the coordinator is a real second state machine that the earlier wording denied. |
| Job state, dependency release, claims, budgets | **ExecutionCoordinator** | `orchestration/workflow/coordinator.ts` | Owns `#jobs`, `#tasks`, `#claims`, `#idempotency`, `#approvals`. |
| Task-scoped state (in-run) | Task state machine | `orchestration/task/state.ts` | `OrchestrationTaskState` + `canCompleteFrom`. |
| Job-scoped state (durable-job) | Job state machine | `orchestration/workflow/jobState.ts` | `JobState` + `canTransitionJob`. |
| Workflow execution semantics | Workflow composition | `orchestration/workflow/model.ts` | Builders (`sequential`, `parallel`, `retry`, `conditional`, `approval`, `handoff`) are the only way to shape a job. |
| Authorization, policy, delegation, approval requirement | **Governance** | `orchestration/governance/` | `PolicyEngine` is the only producer of a verdict. No other module may. |
| Provider/model eligibility and ordering | **PHASE 06 routing** | `routing/router.ts` | `evaluateCandidate` is the single hard filter. |
| Memory access, recall, capture | **PHASE 05** | `orchestration/memory/` | `MemoryAccessPolicy` decides every read and write. |
| Verification | **VerificationRunner** | `orchestration/verification/verifier.ts` | The only thing that may mark a result verified. |
| Registration | Registries | `orchestration/agent/registry.ts`, `providers/registry.ts`, `models/registry.ts`, `orchestration/capabilities/registry.ts` | Instance-scoped maps; customer-data ones partitioned by `(workspace, brand)`, deployment ones listed in `describe()` (§23). |
| Execution | Worker | `orchestration/workflow/worker.ts`, `orchestration/workers/worker.ts` | `TaskExecutionPort`. A worker receives work; it never decides what work exists. |
| Evidence, events, audit | Observability | `orchestration/observability/trace.ts`, `audit/events.ts` | One `TraceRecorder`, one `AuditLog`. |
| Integration boundaries | Adapters | `orchestration/agent/adapter.ts`, `orchestration/provider/providerAdapterRegistry.ts` | Interfaces only. No authority. |
| Knowledge / RAG | **KnowledgeProvider** (a port) | knowledge/port.ts | **PHASE 10.** A BOUNDARY with one honest implementation: NullKnowledgeProvider, which reports knowledge_unavailable and invents nothing. **No production path consults it** — a provider may be attached, and describe() says ttached-not-consulted. AnythingLLM is Phase 13. Retrieval relevance is a **gate** in RetrievalScorer.score, not in the engine's filter (§24.18). |
| Skills | **SkillRegistry** | `orchestration/skill/skill.ts` | **PHASE 09.** A validated, versioned bundle of REQUIREMENTS. Declares what a caller must already hold; confers nothing, structurally — there is no method that grants, and no bulk-load. Every load attempt is audited. It does not execute (§24.17). |

### The one authority PHASE 10 had to fix

⚠️ **Before this phase, job-scoped stores were keyed by `taskId` alone.** A
`taskId` is unique only *within* a job, so two jobs containing a task called
`"step-1"` collided, and last write won. In `ApprovalRegistry` this produced a
genuine **fail-open approval bypass**, demonstrated against the pre-fix build and
closed here. See §4 and `tests/workflow.jobscope.test.ts`.

---

## 3. Request lifecycle

```
OrchestrationRequest
  ↓
1  identified the task                    state → created
2  passed the input policy                InputPolicy.screenInput
2b GOVERNANCE (PHASE 09, optional)       authorizeExecution   ← AUTHORIZATION BOUNDARY
3  classified the task
4  rejected an invalid plan               / 5 passed anti-drift
6  plan validated and within limits
4a memory recall (PHASE 05, optional)    MemoryService.recall
5  topology chosen                        TeamPlan.choose
7+ per subtask:
     agent selected                       SpecialistPool
     model routed (if required)          ModelRouter  ← narrowed by governance first
     ADAPTER EXECUTED                     AgentAdapter.execute
     evidence recorded
8  verification                           VerificationRunner
9  feedback + memory capture (verification-gated)
10 settled result
```

Step **2b** is the authorization boundary and is placed deliberately: after input
screening and before the request is used for anything. A denied request never
becomes a plan, never reaches routing, never recalls memory, and never reaches a
worker.

**Governance is opt-in.** With no `governance` option on `TozOrchestrator`, step
2b is skipped and a run behaves exactly as it did in PHASE 08. That path is
tested, not assumed.

---

## 4. Governance lifecycle

### The port

`OrchestratorGovernancePort` (`orchestration/governance/gate.ts`) has exactly two
capabilities:

```ts
authorize(input): AuthorizationOutcome
narrowRouting?(context, { taskId }): RoutingRestriction | null
```

It has **no** method to select a provider, choose a model, plan, mutate topology,
write memory, or verify. Those are absent rather than forbidden — a gate holding
this interface has no way to perform them.

### The three outcomes a caller must handle

| Verdict | Becomes | Effect |
|---|---|---|
| `ALLOW` | — | proceed |
| `DENY` | `authorization_error` | final refusal. Not retried. |
| `REQUIRE_APPROVAL` | `approval_required` | blocked, pending a decision at the PHASE 07 gate. |
| `NOT_APPLICABLE` | — | treated as permitted; a distinct state from `ALLOW`, deliberately. |

There is no fifth state and no boolean collapse. `NOT_APPLICABLE` is
distinguishable from `ALLOW` because "a subsystem decided this is not its
concern" and "you have permission" are different facts, and conflating them
would make a deferral look like a grant.

### Determinism

`PolicyEngine` evaluates rules in order. The first rule to return a non-`null`
verdict wins. If every rule declines to opine, the engine **default-denies** with
`permission_not_granted`. Escalation attempts are **refused**, not silently
clamped.

### ⚠️ The undocumented-caller default-deny

With governance configured and no `securityContext` on the request, the run is
**DENIED**. The orchestrator cannot infer an actor from a `taskId`, and an
unidentified caller is not an authorised one. This is the one place the wiring is
stricter than "opt in", and it is deliberate.

### ⚠️ `governance_decided` is not emitted on the enforced path

`GovernanceRecorder` is the only producer of the `governance_decided` event, and
`GovernanceGate` uses it **only if one was supplied**. No production code
constructs a recorder. A refused run therefore records a `subtask_failed` with a
reason string and a step log line, but **no structured verdict/reason-code
event**. An operator cannot `byKind("governance_decided")` a real refused run.

Fixing this means constructing a recorder in a composition root — composition
work, deliberately out of scope for a certification phase.

---

## 5. Approval lifecycle

**There is exactly one approval authority: the PHASE 07 `ApprovalRegistry`,
reached through `ExecutionCoordinator`.**

```
Governance: REQUIRE_APPROVAL
      ↓
authorization refused; errorClass = "approval_required"
      ↓
reason names the ExecutionCoordinator as the gate owner
      ↓
caller re-drives the work through the coordinator
      ↓
ApprovalRegistry.open → waiting → decide → approved | rejected | expired | cancelled
      ↓
mayRelease consulted on EVERY release, so a retry cannot slip past
```

The orchestrator **does not** own a gate and does not create one. Building a
second would have produced two authorities for one decision.

### 🔴 A fail-open bypass existed here and was fixed in PHASE 10

`ApprovalRegistry` kept one gate per `taskId`. Two jobs each containing a task
named `"shared"` shared a single gate mapping, last write winning. Empirically
demonstrated against the pre-fix build:

| Gate open order | Job A (approved) | Job B (never approved) | Outcome |
|---|---|---|---|
| A opens last | released | **released** | 🔴 **fail-open bypass** |
| A opens first | **blocked** | blocked | fail-closed |

So an operator approving job A released job B's identically-named task without
anyone approving it. Now every job-scoped store is keyed by `taskKey(jobId,
taskId)`, both orderings behave correctly, and
`tests/workflow.jobscope.test.ts` asserts it.

---

## 6. Routing lifecycle

```
subtask.requiredCapabilities
      ↓
[governance narrows]              applyRoutingRestriction(candidates, denied)
      ↓
[PHASE 06 hard filter]            evaluateCandidate
      ↓
[PHASE 06 ordering]               DefaultRouter / weight-free lexicographic policy
      ↓
fallback hops (bounded, never widening)
      ↓
providerId + modelId, or null — and null means "no route", never a guess
```

Governance can **deny, restrict, narrow**. It **cannot select, score, prefer,
rank, or assign a provider/model**. This is structural, not behavioural:
`RoutingRestriction` has `deniedProviders`, `deniedModels`,
`deniedProviderTypes`, `reason` and `decidedBy` — and **no field capable of
expressing a preference**, so it cannot select even if written to try.

`evaluateCandidate` remains the hard eligibility filter, and PHASE 06 ordering
remains the ordering authority. Fallback never widens the candidate set.

### ⚠️ A throwing `narrowRouting` hook fails open

Contained and tested: an exception in the hook degrades to *no narrowing* rather
than failing the run, and the hard filter still applies. This is a conscious
trade (a policy-store blip should not fail healthy work) and it is a **real
limitation**. Revisit if a restriction ever becomes a security boundary rather
than a cost/control one.

---

## 7. Memory lifecycle

PHASE 05 is the sole authority. Governance is explicitly **not** wired into
memory: `deferToSubsystem: ["memory.read"]` yields `NOT_APPLICABLE`, and
`MemoryAccessPolicy` decides.

- `MemoryAccessPolicy.assertRead/assertWrite` gate every operation.
- Recall is **default-deny**: `recallScopes` ships `[]`, and empty means *no
  recall*, never *all scopes*.
- Capture is **verification-gated** — nothing is learned from an unverified run.
- Relevance is a gate on retrieval, not a ranking nicety.

### ⚠️ Memory is scoped by identity and a closed enum — and by workspace since PHASE 06

`MemoryScope` is a fixed enum (`conversation`, `task`, `agent`, `team`,
`project`, `provider`, `pattern`, `knowledge`, `system`, `organization`, `global`).
**PHASE 06 partitioned the other axis rather than widening this one**: tenancy is
carried *beside* the scope — `MemorySubject` and `MemoryStore` both carry a workspace,
and `MemoryAccessPolicy` keys grants by `(workspace, subjectId)`.

So the five scopes that were "cross-tenant by construction" are no longer cross-tenant.
`global` means **wide within one workspace**, never readable across one — proved at all
eleven scopes. The closed enum is deliberately intact, so an invalid scope is still a
type error; a `(scope, workspaceId)` pair was the alternative and was a breaking change
bought for nothing.

What PHASE 06 did **not** do is define what any scope may *read*. Breadth semantics and
two defects in `importanceCeilingFor` are **PHASE 07**. See §23 and `TODO.md`.

---

## 8. Verification lifecycle

`VerificationRunner` is the only thing that may mark a result verified. An
unverified result is reported as `needs_review`, and the documentation is explicit
that this **is not a pass**.

A verification failure escalates the task; it does not silently downgrade to a
partial success.

---

## 9. Worker lifecycle

Worker is **execution-only**. Structurally, not by convention:

- A worker receives a `TaskExecutionPort` request. It is never told what other
  work exists.
- `OrchestratorTaskExecutor` delegates to TOZ. It does not select a provider or
  model, does not plan, and does not mutate topology.
- `TaskWorkerRegistry` holds no provider inventory.
- Architecture tests assert that no worker module imports a router, an
  orchestrator, or a memory service.

### ⚠️ Cancellation does not abort in-flight work

`cancelJob` reports that in-flight attempts are "asked to abort cooperatively".
**Nothing asks them.** The `AbortController` is a local variable, not registered
anywhere, and `cancelJob` holds no reference to it. A cancelled task runs to
completion against the provider — incurring full cost — and only then has its
result refused. The refusal is correct; the cost is not avoided.

---

## 10. Adapter lifecycle

Adapters are **integration boundaries only**. They translate a request, perform
work, and return a classified result. They hold no authority, are not consulted
about routing, and cannot grant permission.

No provider client ships in this repository. `ProviderAdapterRegistry` exists and
is empty; a real `ProviderAdapter` is a deployment responsibility.

---

## 11. Observability lifecycle

61 event kinds are declared: 12 core audit kinds and 49 orchestration kinds.

Redaction is applied on the `AuditLog.append` path and in the governance decision
constructor (`redactWithReport`, which also *reports* that redaction occurred).

### ⚠️ Observability is materially weaker than the type suggests

| Finding | Detail |
|---|---|
| `errorClass` | **CORRECTED IN PHASE 11 — the old entry was false.** It used to read "never supplied by any of the four producers, always `null` on every event ever written." Re-verified by execution (four real scenarios through the composition root, 49 events), 5 events carry a non-null `errorClass` (`timeout`, `configuration_error`), and it is supplied at 5 `#record` sites in `authority.ts`. It works. |
| `durationMs` | The old entry claimed this alongside `errorClass` and was half right: it is passed at exactly **one** `#record` site (`provider_usage_recorded`) and still arrives `null` in practice. Measured cause: `authority.ts` guards the entire cost write on `inputTokens !== undefined \|\| outputTokens !== undefined`, so an adapter that reports a duration but no token counts never reaches `collector.cost` and the duration is dropped. Open item in `TODO.md`. |
| `jobId` | Not a field on `OrchestrationBase` — buried in `metadata`, so joining job events to tasks requires reaching into metadata. |
| `attempt` | Present in coordinator metadata and evidence, absent from orchestration events, so a retried subtask's events cannot be ordered from the trace alone. |
| `traceId` across the workflow boundary | The coordinator sets `traceId: jobId`; the orchestrator mints its own; `worker.ts` discards the connecting context. **`byTrace()` on one side cannot reach the other.** |
| Unredacted local trace store | `TraceRecorder.#events` stores raw metadata **before** the redacting sink call, so `events()`/`byKind()` return unredacted events while the audit log is redacted. The "one history" claim holds for the sink only. |
| Step log / free text | `OrchestrationResult.steps` and `reason` are returned verbatim; the governance actor name is interpolated without redaction. |
| ~12 of 49 orchestration kinds | ~~15 of 49, including every `tool_*` kind.~~ **PARTLY RESOLVED in PHASE 05**: `tool_invoked` and `tool_refused` are now emitted, from **verified** facts rather than a claimant's word — a tool the agent never declared, one above its trust floor, or one that is side-effecting with no approval is refused, produces no evidence, and fails the subtask. `tool_failed` is still unemitted because nothing **performs** a tool call: there is no tool-call channel in the agent protocol, so an adapter can only report one after the fact. That is Phase 13. |
| Caller-asserted tool facts | **RESOLVED in PHASE 05.** `authority.ts` wrote an adapter's reported tool call into the run's evidence as `{ toolId, durationMs: null, sideEffecting: false }` — the side-effect flag as a **literal**, and no authorisation check at all. An irreversible action was recorded as harmless and an unauthorised one as having happened. `sideEffecting` now comes from the registry; `durationMs` is `null` because the host performed nothing; `ToolCallApproval` makes the side-effect requirement satisfiable rather than absolute. See `BLOCKERS.md` B-13 for what remains. |
| Primary selection ignores the policy | **RESOLVED in PHASE 05** (B-09). `orchestration.routing.defaultPolicy` ordered the fallback chain only. `RoutingRequest.policy` now carries it to the one router, and `RoutingDecision.ordering` reports `decidingFacts` and `uninformedFacts`. |
| No `worker_*` kind | Background `WorkerHost` emits nothing. |
| No `adapter_invoked` kind | Adapter calls are bracketed by `subtask_started`/`subtask_completed` but leave no event of their own. |

---

## 12. State machines

Four, each with one scope, none overlapping:

| Machine | Scope | States |
|---|---|---|
| `OrchestrationTaskState` (`task/state.ts`) | one in-run task | created → classifying → planning → ready → executing → verifying → completed/failed/cancelled/escalated |
| `JobState` (`workflow/jobState.ts`) | one durable job | pending → ready → running → … → completed/failed/cancelled |
| `ApprovalState` | one gate | waiting → approved/rejected/expired/cancelled. **A decided gate is final.** |
| `TaskRecord.state` | one task in a job | mirrors release/claim lifecycle |

---

## 13. Idempotency

`IdempotencyLedger` dedupes on **`${jobId}:${taskId}:${attempts}`**.

| Category | Covered | Detail |
|---|---|---|
| Task | ✅ | in the key |
| Job | ✅ | in the key |
| Attempt | ✅ | in the key, so each retry is a distinct unit |
| Completion | ✅ | `complete(key, …)`, replayed on re-delivery |
| Worker delivery | ◐ | via `ClaimRegistry`, not the ledger — a separate mechanism with a separate lifetime |
| Retry | ❌ | deliberately not deduped; a retry is meant to re-run |
| Cancellation | ❌ | deliberately; cancel abandons the key so the work can be redone |
| Callback | ❌ | no callback concept exists |

⚠️ The ledger is bounded at 5,000 records with oldest-first eviction, and drops
are counted but **not prevented** — an evicted key that reappears re-executes.
`#inFlight` is unbounded.

---

## 14. Concurrency

| Race | Handling | Mechanism |
|---|---|---|
| Claim lease | ✅ | in-process map + token + TTL (default 30 s) |
| Competing claims | ✅ | second claim **refused**, not queued |
| Stale result | ✅ | token verified before any mutation; failure emits `task_result_refused` |
| Approval race | ✅ | decided gates are final; `mayRelease` consulted on every release |
| Cancellation race | ◐ | checked pre-claim, post-acquire, post-result — but no abort (§9) |
| Budget race | ◐ | recomputed at release; **no reservation taken before dispatch**, so a wave can collectively exceed the ceiling |
| Retry race | ◐ | each attempt is a distinct key; no in-flight retry dedup |
| Parallel waves | ◐ | **sequential, not parallel** — `runJob` awaits each task in turn |

`ConcurrencyManager` itself is well built (strict layer ordering, partial-release
rollback, idempotent lease release) but has one caller, so those properties are
mostly untested in situ.

`DELIVERY_SEMANTICS` is pinned by a regression test:

```ts
export const DELIVERY_SEMANTICS = {
  claim: "effectively-once",   // at-least-once delivery, at-most-once execution
  scope: "single-process",
} as const;
```

---

## 15. Resource governance

**The invariant: unknown cost ≠ zero cost.** Unpriced usage is refused with
`resource_cost_unknown` or blocks the budget, never passes as free. This holds in
PHASE 07 (`budgetStatus`) and in the governance resource path.

### ⚠️ But the governance resource path is not wired

`GovernanceGate` consults `checkResourceLimits` **only through a recorder**, and
no production code constructs a recorder. The orchestration test harness builds
its gate without one. So the governance half of resource governance is inert in
practice, and `governance.blockOnUnknownCost` — validated, defaulted `true`,
documented as "the safe direction" — is read by nothing.

The PHASE 07 budget path is real and does hold the invariant.

---

## 16. Security model

| Property | Status |
|---|---|
| Default-deny in `PolicyEngine` | ✅ holds |
| All 16 operations security-sensitive | ✅ none exempt |
| Unidentified caller refused | ✅ |
| Delegation cannot escalate | ✅ **refused, not clamped** |
| Delegation intersects resources, allow-lists, capabilities, scopes | ✅ |
| Delegation raises the trust floor to the parent's | ✅ |
| `SecurityContext` frozen | ✅ |
| Secrets never stored in records | ✅ only `{kind, key}` handles |
| Redaction on the audit path | ✅ |

### 🔴 Fixed in PHASE 10

- **Cross-job approval bypass** (§5). The most serious defect found in this
  audit.
- **Redaction gaps.** `connectionString`, `connection_string`, `connstr`, `dsn`
  and `bearer` were absent from the key denylist; `bearer` was covered only as a
  *value* shape, so a field named `bearer` holding a raw token was recorded
  verbatim.
- **A drifted duplicate denylist.** `state/store.ts` kept its own copy of the
  sensitive-key list, already missing six entries. It now defers entirely to
  `isSensitiveKey` — one list, one owner.
- **An unredacted value in a CLI-visible message.** `validate.ts` interpolated
  `JSON.stringify(value)` into a validation issue printed to a terminal. Now
  passed through `redactString`.

### ⚠️ Residual

- `TraceRecorder.#events` is unredacted (§11). Redaction applies to the audit
  sink, not the local store the `events()` API returns.
- No persistent policy store, so a denial is evidenced only for the life of the
  process.
- No cryptographic tamper-evidence on the audit log.
- No RBAC: `roles` is a non-authoritative label; resolution is the caller's.

---

## 17. Configuration model

### ✅ Strict where it matters most

The orchestration layer rejects unknown sections and unknown keys per section, so
a misspelled limit fails loudly rather than silently reverting to a default.
`governance`, `workflow`, `routing`, `memory` and `observability` are all in the
allow-list, and a regression test asserts a valid empty section yields zero issues
for all twelve.

### 🔴 All twelve orchestration sections are INERT

**This is the largest gap between documentation and behaviour.**

Every `OrchestrationConfig` section — all twelve — is validated, defaulted,
normalised, re-exported, and then **read by no production code**. There is no
composition root for orchestration: `orchestrationConfigFromApp` is called only
from tests.

Concretely, ~30 documented environment variables validate correctly and do
nothing:

| Setting | Documented behaviour | Actual |
|---|---|---|
| `TOZ_GOVERNANCE_ENFORCED` | enables governance enforcement | read into config, consulted by nothing. Governance is present only if a `GovernanceGate` is constructed by hand. |
| `TOZ_GOVERNANCE_BLOCK_ON_UNKNOWN_COST` | "unknown cost is not zero cost" | read by nothing |
| `TOZ_ROUTING_POLICY` | selects a routing policy | no runtime effect |
| `TOZ_WORKFLOW_*` (7 vars) | workflow behaviour | coordinator uses constructor options with hard-coded fallbacks |
| `TOZ_SECURITY_INPUT_POLICY=deny_all` | reject all input | only constructor wiring changes it |
| `TOZ_MEMORY_*`, `TOZ_WORKER_*`, `TOZ_LEARNING_*`, `TOZ_RUFLO_ENABLED` | — | inert |

The tests that appear to cover these assert only that the config **object** is
produced correctly — never that any component observes it.

Per §22's requirement, these are therefore documented here as **inactive**. This
is a wiring gap, not a validation gap, and closing it is composition work
deliberately not performed in a certification phase.

### ⚠️ The core layer is the strictness outlier

`src/config/validate.ts` has no known-section list and no per-key allow-list, so
an unrecognised top-level section or key is **silently accepted**. The
orchestration layer in the same repository rejects them. `ARCHITECTURE.md`'s
claim that "unknown keys inside a section are reported rather than ignored" is
true only for `orchestration.*`.

---

## 18. Ruflo relationship

**Optional. Reference architecture. Adapter possibility. Not a dependency.**

Zero runtime dependencies exist in `package.json`; `dependencies` is empty. Ruflo
is represented by a boundary module that records non-integration **as
unimplemented rather than as coverage** — a fail-closed choice. `ruflo.enabled`
is inert (§17).

---

## 19. Agency relationship

**Specialist and capability source only.** Agency-sourced agents enter through the
`AgentSource` port and are registered into the ordinary `AgentRegistry`, then
indexed by `CapabilityRegistry` and selected by `SpecialistPool` like any other
agent. An agency agent cannot orchestrate, route, govern, authorise, decide memory
or decide verification — it is a candidate, nothing more.

---

## 20. MCP status

**MCP client not implemented.** No MCP abstraction, no transport, no client. None
was created, because a stub shaped like MCP would be a fabricated capability. Tool
execution exists (`ToolExecutionHost`) and is not MCP.

---

## 21. Health model

PHASE 06 health semantics are authoritative. **Unknown ≠ healthy.**

`UNKNOWN_HEALTH` is a distinct status, health is observed rather than assumed, and
`isRoutableStatus` excludes unknown from routing. No live health probe exists; no
provider health is fabricated.

---

## 22. Persistence model

**None. Every store is process-local.**

`package.json` has zero runtime dependencies. There is no `node:fs` write, no
database, no file store, no WAL anywhere in `src/`. The only shipped memory
provider is explicitly non-durable, and the write path is fire-and-forget with no
flush or shutdown hook.

### What a process restart loses

Roughly 38 in-memory stores, including — and this ordering matters:

1. **Cancellation flags.** A cancelled job may execute again after restart.
2. **Budget accounting.** Measured spend resets to zero, so an exhausted budget
   stops constraining.
3. **The idempotency ledger.** Previously-completed keys become re-runnable.
4. **Approval gates.** Tasks requiring approval block forever, and an approval
   that *was* granted is indistinguishable from one never opened.
5. **All job/task/workflow state.** `runJob` on a new process finds no job.
6. **All authorization history.** A denial that happened is only evidenced for the
   life of the process.
7. Queued work, memory, agent/provider/model health and lifecycle, and all
   trust state.

Items 1–3 are the dangerous ones because their loss **removes a safety stop**
rather than merely losing history.

---

### ✅ Multi-tenant classification (PHASE 06): **B — PARTITIONED AND DECLARED**

**Changed from D (unsafe: unpartitioned *and* undeclared) in PHASE 06.** The dangerous
half of D was not the absence of partitioning alone — it was that the absence was
**silent**. Both are now closed:

- **Declared.** `describe().workspaceIsolation` reports `"partitioned"` or
  `"unasserted"`, names the workspace and brand, and lists every registry that stays
  deployment-scoped together with what it holds. A runtime that declares no workspace
  composes **no** partitioned subsystem rather than composing them and serving everyone.
- **Partitioned.** Every customer-data store is partitioned by `(workspace, brand)`, and
  a workspace comes **only** from an identity with `provenance: "resolved"`. Asserted,
  delegated and absent contexts are refused — including ones that name a perfectly valid
  workspace.

**Not A.** A multi-tenant deployment still requires an identity provider, and **scale is
undeclared**; see the non-guarantees below. The correct reading of B is "the isolation
mechanism is real and proven", not "multi-tenancy is production-ready".

Evidence, and what answered each item of the old D finding:

| Old evidence (PHASE 10) | Now (PHASE 06) |
|---|---|
| No tenant identifier exists in `src/` | `WorkspaceRef`, validated and frozen, on `SecurityContext`, `MemorySubject`, `AuditEventBase` and `Job`. Two hits that were comments are now the implementation. |
| `Job.owner` is write-only | Still not a partition, and no longer claimed to be. `Job.workspace` **is** one — it keys the job, its tasks, its transitions and its attempts. |
| Every registry is a flat process-global `Map` | Customer-data stores are partitioned; the five deployment registries are listed in `describe()` with a machine-checked no-customer-data assertion. |
| `SecurityContext` has no tenant field | It has `workspace`, which carries **no authority** unless the provenance is `"resolved"`. `policyContext` remains non-authoritative. |
| `AuditSink.read()` takes no filter | `read(scope)` is **mandatory** and filters on workspace and brand; the sink stamps every event. |
| Memory cannot express tenancy | It need not. Tenancy is carried **beside** the scope, not inside it, so the closed enum survives and `global` means *wide within one workspace*, never *shared*. |
| `MemoryAccessPolicy` keyed by bare subject id | Keyed by `(workspace, subjectId)`, and `grant()` reports `{ replaced }`. |
| Subject id derived from a caller-supplied `taskId` | **Eliminated.** No key derives from a `taskId`; the memory authority derives its subject from the verified actor. |

#### What remains a non-guarantee, stated rather than implied

- **No authentication.** The resolver is deployment-supplied and **trusted**. B-05 is
  open. A caller able to influence the resolver is outside this guarantee.
- **Scale is undeclared.** The model composes **one store instance per workspace**:
  correct and unbounded in workspaces, but one instance of each partitioned store per
  workspace. **Do not refactor to a shared-instance design on an assumption.**
- **Isolation is enforced by the INSTANCE for the per-instance stores.** The workspace
  inside their keys is defence-in-depth, load-bearing the day one instance serves two
  workspaces. The wiring is asserted from source; it is not observable behaviour today,
  and this says so rather than claiming otherwise.
- **Memory scope breadth is untouched.** `SCOPE_BREADTH` is still inconsistent with the
  declaration order, and `importanceCeilingFor`'s `Math.max(0.2, ...)` floor is still
  unreachable. Both are **PHASE 07**, and both are pinned by tests so the deferral cannot
  go stale.
- **`ModelRecord.metadata` is closed** — a mapped type with no index signature plus a
  runtime allowlist. A cast does not get past the runtime half, which is why it exists.

---

## 24. Known limitations

1. No durable persistence; ~38 process-local stores; restart loses
   cancellations, budget accounting, idempotency memory and approvals.
2. Not multi-tenant safe (§23). Unpartitioned and undeclared.
3. All twelve orchestration config sections are inert (§17).
4. `errorClass`/`durationMs` are never populated on any event; 15 of 49 event
   kinds are never emitted; `traceId` does not cross the workflow boundary.
5. `TraceRecorder.#events` is unredacted.
6. `governance_decided` is unreachable on the enforced path without a recorder.
7. The governance resource/budget path is unreachable for the same reason.
8. A throwing `narrowRouting` hook fails open to no-narrowing.
9. Cancellation does not abort in-flight work; cancelled work incurs full cost.
10. Budgets are checked but not reserved; a wave can collectively exceed a ceiling.
11. "Parallel" waves execute sequentially.
12. No live provider client, no MCP client, no live health probe.
13. Idempotency ledger is bounded at 5,000 with eviction.
14. The core config layer accepts unknown sections and keys silently.
15. ~~`authoriseExecution` (`workflow/worker.ts`) is exported and unit-tested but
    **called by nothing**; the coordinator performs its own inline checks. It is
    a specification, not the enforcement point, and is now labelled as such.~~
    **RESOLVED in PHASE 04 — removed rather than wired.** Wiring it meant either
    duplicating `executeTask`'s checks, which its own docblock warned would drift
    ("the authoritative one will be the untested one"), or reversing the PHASE 01
    (C-3) order so a claim is a precondition of authorisation — which would let a
    gate-blocked task consume and release a claim on every attempt and report
    "duplicate delivery" to any worker that legitimately arrived second. Its five
    specification tests now assert the same four conditions through
    `ExecutionCoordinator`, plus a positive control so a refusal cannot be a blanket
    refusal. A source scan over `src/` (comments stripped — a docblock is not an
    enforcement point) keeps the identifier from returning. **B-13 is the same
    shape, in the tool boundary, and is open.**
16. `authority.ts` (~1,965 lines) and `coordinator.ts` (~1,800 lines) remain large
    — see §26 of `PROJECT_STATE.md`.
    **DECIDED IN PHASE 08, deliberately not acted on: NOT SPLIT.** `TODO.md` PHASE 08
    item 4 asked for the composition of these two files to be decided, with the
    instruction "split only along real seams, and only after Phase 01-02". Both
    conditions are now met and the seams were examined, so the decision is recorded
    rather than left open:

    - They are large because each holds one *state machine*, and both are cohesive.
      `authority.ts` is the agent-execution lifecycle; `coordinator.ts` is the
      workflow/job lifecycle. Splitting either by concern would put half a state
      machine in each file, and a state machine whose transition table is in one
      module and its transitions in another is harder to verify than one long file.
    - The seams that *do* exist are already seams: `#fallbackAvailability`,
      `#recordReportedRoute` and `#verifyReportedTools` are self-contained reporting
      helpers with no state, and `#record` is the single trace writer. The Phase 08
      work added one of these (`#recordReportedRoute`, 50 lines) rather than growing
      the class body, which is the direction further extraction should take.
    - The real risk in these files is not length but *unbounded authority*, and PHASE 08
      attacked that directly instead: the sole-sequencer claim is now asserted from
      source (`tests/agentAuthority.p08-evidence.test.js`), so a future split that
      accidentally created a second entry point would fail a test rather than pass a
      review. A split performed before that assertion existed would have been a change
      to an unmeasured property.
    - Recorded as a limitation that stands, not as work that is scheduled. A split is
      justified when a second component needs one of these lifecycles independently,
      and nothing needs that today.
17. **A skill does not execute.** `SkillRegistry` (PHASE 09) validates, registers and
    audits *loads* of a skill; there is no runtime that runs one. This is stated
    because the subsystem otherwise looks like a missing feature rather than a
    boundary: a skill is a bundle of requirements, and a workflow that actually
    runs skills is **PHASE 14**. What is real now is the part that has to be right
    before a runtime exists — the contract, the validation at registration, the
    direction of the authority check, and the audit record. The load log is
    **process-local** (§24.16, Phase 12), which is why load records go to the
    partitioned audit trail rather than into the registry.

18. **The knowledge layer is a port no path consults.** `KnowledgeProvider`
    (PHASE 10) may be attached to a runtime and is then queried by nothing in
    `src/`; `describe().knowledge` reports `attached-not-consulted` so that a
    deployer is not misled. There is **no RAG** — no vector index, no embeddings
    implementation, no document store — and retrieval relevance is **lexical**, so
    a genuinely relevant memory that shares no query terms is refused by the gate.
    Both are the honest state of a boundary phase: AnythingLLM is **PHASE 13**, and
    the semantic path already reports itself unavailable and names why (Phase 07).
---

## 25. Explicit non-guarantees

Stated plainly so that no reader has to infer them:

- ❌ **Not exactly-once.** At-least-once delivery with at-most-once execution
  *within one process*. A crash between applying an external effect and recording
  the key repeats the effect. The code says this at the class, in the constant, and
  in a regression test.
- ❌ **No distributed lock.** `ClaimRegistry` is single-process exclusion with an
  expiry. It does not become a distributed lock by being called a lease.
- ❌ **No recovery.** A restart is not a recovery mechanism. There is no
  persistence to recover from.
- ❌ **No multi-tenant isolation.** (§23)
- ❌ **No live health.** Unknown is not healthy.
- ❌ **No MCP.**
- ❌ **No provider client.** No wire protocol is implemented or faked.
- ❌ **No tamper-evident audit.** Redacting and in-process, not signed.
- ❌ **No RBAC.** `roles` is a label.
- ❌ **No price table or cost model.** Costs are whatever a provider adapter
  reports; unmeasured is never assumed to be zero.
- ❌ **No quality benchmark** and no measured provider quality data.
- ❌ **Not a service.** No HTTP server, no job-running CLI, no database.

---

## 26. Verification of this document

Every claim above was checked against the code at commit `b9409f1` plus the
PHASE 10 fixes. Where this document says "verified", the check was executed:

- Cross-job approval bypass: **demonstrated against the pre-fix build** in both
  orderings (fail-open and fail-closed), then shown closed.
- Routing-narrowing and capability-boundary tests: **mutation-verified**. With
  `applyRoutingRestriction` neutered, and separately with `authorizeSubtask`
  neutered, each mutation now fails at least one test. Before PHASE 10 both
  mutations left all 1,527 tests green.
- Suite: **1,537 / 1,537 passing**, 230 suites, 0 skipped, 0 todo.
