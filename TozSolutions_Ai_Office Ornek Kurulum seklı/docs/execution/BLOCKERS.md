# BLOCKERS

> Conditions that prevent automatic progress. Phase 00 encountered none that
> stopped it; Phase 01 and later will.

Format per brief §18: problem · evidence · files · attempted · failing tests ·
why automatic continuation is not possible · decision required.

---

## Status

| ID | Severity | Blocks | State |
|---|---|---|---|
| B-01 | HIGH | Phase 01 start | **RESOLVED** — see `DECISIONS.md` §5 |
| B-02 | HIGH | Phase 12 | OPEN — deferred, not blocking |
| B-03 | HIGH | Phase 02 scope | **RESOLVED** — library core → AI Office product |
| B-04 | HIGH | Phase 06 | **RESOLVED - Phase 06.** The *decision* was the user's: composite-key partitioning, hard isolation, no cross-brand aggregation. Implemented across every customer-data store; `describe()` reports `"unasserted"` or `"partitioned"` and lists the deployment-scoped registries. **SCALE remains OPEN and is deliberately NOT part of this resolution** - see below. |
| B-05 | MEDIUM | Phase 04, Phase 14 | OPEN - **the CONTENT half is closed in Phase 04** (an approval is bound to a digest of what it runs); the *identity* half - whose string is an approval and how it is evidenced - is untouched and still open. **Phase 08 added weight to it rather than progress:** the phase REMOVED `tools.grantUndeclaredTools` rather than wiring it, and refused to register Hermes as an agent, because both would have meant handing authority to something with no evidenced identity behind it. See `DECISIONS.md` D-59, D-60 |
| B-06 | MEDIUM | doc hygiene | **RESOLVED** — see `DECISIONS.md` §5 |
| B-07 | HIGH | capability policy | **OPEN — raised during Phase 01** |
| B-08 | MEDIUM | Phase 03, Phase 04 | **RESOLVED — Phase 03** (`Job.caller`, `OrchestratorExecutionPort.securityContext`, the resolver is consulted) |
| B-09 | MEDIUM | Phase 05 | **RESOLVED — Phase 05.** `RoutingRequest.policy` carries the configured policy to the one router, which orders the primaries with the existing `orderByPolicy` engine. `RoutingDecision.ordering` reports `decidingFacts` and `uninformedFacts`. A policy orders; it cannot add eligibility. |
| B-10 | HIGH | Phase 04 | **RESOLVED — Phase 03, second pass** (`ApprovalGateObserver`, `bridgeApproval` called from the composition-root bridge, the coordinator holds a task instead of failing it) |
| B-11 | LOW | Phase 04, Phase 14 | **OPEN — reclassified MEDIUM → LOW in Phase 03, second pass**: reachable only through the pre-existing `approval()` step, not through the new governance path. `needs_review` still has no escalation target. |
| B-12 | LOW | Phase 12 | **OPEN — re-verified in Phase 03, second pass; both halves unchanged. Re-verified again in Phase 04.** |
| B-13 | MEDIUM | Phase 13 | **HALF-CLOSED in Phase 05, re-scoped.** The *caller-asserted* half is closed: `sideEffecting` now comes from the registry, never from the claimant. The *unobtainable approval* half is narrowed: `ToolCallApproval` is a real, obtainable value with four load-bearing fields, and the refusal names how to satisfy it — but no flow issues one during an execution yet, so an irreversible tool is refused. `describe().toolApproval === "required-and-unobtained"`. **The residue is a mid-execution tool-approval flow, which is Phase 13.** |

---

## B-01 — Hotfix the four live defects now, or wait for Phase 01?

**State: WAITING_FOR_HUMAN**

**Problem.** Four authorization defects are live and reachable through the
library API (C-1..C-4, `CURRENT_STATE.md` §5). Phase 01 is scoped to close them.
The question is whether they warrant an out-of-band hotfix first.

**Evidence.** All four reproduced by execution against the built `dist/`:

- C-1 — governance's denied-provider list is computed at
  `model/modelRouter.ts:153` and discarded; the router re-derives an unrestricted
  candidate set (`routing/router.ts:67-72`, `routing/defaultRouter.ts:50`).
  Probe: `aaa-banned` denied, `aaa-banned` selected.
- C-2 — `workflow/gates.ts:267,273` refuses self-approval only if the caller
  volunteers `workerId`; `workflow/coordinator.ts:517-524` never supplies it.
  Probe: `state="approved"`.
- C-3 — `workflow/gates.ts:337` returns `allowed:true` with no gate;
  `coordinator.ts:839,934` consult only `mayRelease`. Probe: `released=["t1"]`
  for a task declaring `approvalRequired: true`.
- C-4 — `governance/enforcement.ts:148` and `governance/policy.ts:494`. Probes:
  `ALLOW` with an empty grant list; `authorizeSubtask` returns `null` without
  consulting a gate that denies everything.

**Files.** `src/orchestration/model/modelRouter.ts`,
`src/routing/router.ts`, `src/routing/defaultRouter.ts`,
`src/orchestration/workflow/gates.ts`,
`src/orchestration/workflow/coordinator.ts`,
`src/orchestration/workflow/model.ts`,
`src/orchestration/governance/enforcement.ts`,
`src/orchestration/governance/policy.ts`.

**Attempted.** Full read of the call chain; four reproduction probes; a mutation
run against a patched copy of `dist/`.

**Failing tests.** None. This is the crux: **the suite is 1598/1598 green with
all four defects live.** The relevant tests are inadequate, not failing —
`tests/governance.enforcement.test.ts:476-604` and
`tests/workflow.execution.test.ts:511`, `tests/workflow.model.test.ts:576`.

**Why automatic continuation is not possible.** C-2's fix has a genuine design
choice with security consequences: derive the worker identity inside the
coordinator from the live claim, or record the executing worker on the gate at
`open()` time. The second is strictly stronger — it makes self-approval
unforgeable rather than merely refused — but it changes the `ApprovalGate` shape
and therefore the Phase 07 API surface, and it interacts with C-3's
auto-open-gate decision. Choosing wrongly here means either a weaker guarantee
or an API change that Phase 04 then has to work around.

**Decision required.**

1. Hotfix C-1..C-4 immediately as four separate small commits, or run Phase 01
   as a single reviewed phase?
2. For C-2: is the stronger gate-bound worker identity (API change) acceptable
   now, or is the coordinator-derived identity sufficient for MVP?
3. For C-3: should the gate be opened **automatically** from the `approval()`
   step (self-enforcing declaration), or must a caller open it and the absence
   block? The second preserves today's API; the first removes a whole class of
   mistake.

---

## B-02 — Persistence substrate

**State: WAITING_FOR_HUMAN** (blocks Phase 12; not urgent yet)

**Problem.** `FINAL_ARCHITECTURE.md` §22 documents ~38 process-local stores. A
restart loses cancellation flags, budget accounting, the idempotency ledger and
approval gates. Items 1-3 **remove a safety stop** rather than merely losing
history. This cannot be fixed without a persistence substrate.

**Evidence.** Zero `node:fs` writes, no database, no file store, no WAL anywhere
in `src/`. `package.json` has **zero runtime dependencies** — currently a
deliberate, documented property, cited approvingly in
`FINAL_ARCHITECTURE.md` §18 and §22.

**Files.** All of `src/orchestration/workflow/coordinator.ts`,
`gates.ts`, `claims.ts`; `src/state/store.ts`; `src/orchestration/memory/store.ts`.

**Attempted.** None. This is a design decision, not an investigation.

**Failing tests.** None.

**Why automatic continuation is not possible.** Every persistence option reverses
a property the project has explicitly and repeatedly claimed as a strength.
This is a product decision, not an engineering one, and it is expensive to
reverse: it determines deployment, backup, migration and hosting.

**Decision required.**

1. Is "zero runtime dependencies" a hard constraint or a current-state
   description?
2. If it may be relaxed: SQLite (via `node:sqlite`, Node 22+ built-in — keeps the
   dependency count at zero), Postgres, or a file/WAL store?
3. Is single-node deployment acceptable for MVP, or must multi-node be designed
   in from the start? This decides whether `ClaimRegistry` can stay
   single-process and whether `DELIVERY_SEMANTICS.scope` changes.

---

## B-03 — Library or product?

**State: WAITING_FOR_HUMAN** (blocks Phase 02 scope)

**Problem.** `FINAL_ARCHITECTURE.md` §1 and §25 are explicit: this is "a library
and reference architecture, not a shipped service. There is no HTTP server, no
CLI that runs a job, no database, and no provider client." But the target is
"AI destekli sanal ofis sistemi" — a working system with humans approving things.

**Evidence.** No HTTP server, no job-running CLI, no database, no provider
client. `TozOrchestrator` is never constructed in `src/`. Zero runtime
dependencies. No live health probe. No MCP client.

**Files.** `src/core/composition.ts` (the only composition root, PHASE 01 core
only), `src/cli/validate-config.ts` (the only CLI, config validation only).

**Attempted.** None.

**Failing tests.** None.

**Why automatic continuation is not possible.** Phase 02 must build a composition
root, and *what it composes into* depends on this answer. A library composition
root exports a factory. A service composition root additionally needs an
interface, a process lifecycle, configuration loading, health endpoints and a
deployment story. Building the wrong one means Phase 02 is partly wasted, and
Phase 14 (MVP workflow) inherits the error.

**Decision required.**

1. Does Phase 02 produce a **library factory** (`createOrchestrator(config)`), a
   **runnable service**, or both?
2. If a service: HTTP or CLI first? Who authenticates callers — this is also the
   natural home for the Phase 06 workspace identity.
3. Which external system is the first real provider adapter? Nothing can be
   measured until one exists, and the project has correctly refused to invent
   provider data.

---

## B-03 — Library or product? — ANSWERED

**State: RESOLVED** before Phase 02 started.

**Answer.** CURRENT STATE = **Library Core**. TARGET STATE = **AI Office Product**.

**What that decided.** Phase 02 produced a **library composition root plus a
runnable, read-only entry point** — a factory, a measurement function, an
environment bootstrap that refuses a rejected configuration, and one CLI that boots
the runtime and prints what it composed. It did **not** produce a service, an HTTP
surface, a database or a deployment story, and those remain undecided.

**Why this is the right order.** The product needs a bootable core before it needs a
transport. A transport bolted onto an unassembled library would have produced a
server answering requests through a system that had never been executed — the same
failure the previous project closed itself on.

**Questions 2 and 3 remain open**, and are now the substance of later phases:

| Question | Now belongs to | State |
|---|---|---|
| HTTP or CLI first? Who authenticates callers? | Phase 03/04, with B-05 | OPEN |
| Which external system is the first real provider adapter? | Phase 13 | OPEN — still refused to invent provider data |

The one CLI Phase 02 added executes no work, opens no socket and writes no file. It
is a boot check, not a transport, and it exists so that "the runtime starts" is a
demonstrated fact rather than a promise.

**Answers to the three questions above.**

1. Library factory or runnable service?
   → **A library factory plus a runnable, read-only entry point.** Not a service.
2. HTTP or CLI first? Who authenticates callers?
   → **Deferred to Phase 03/04, together with B-05.**
3. Which external system is the first real provider adapter?
   → **Deferred to Phase 13.** Nothing can be measured until one exists, and the
   project has correctly refused to invent provider data.

---

## B-08 — A background task cannot identify its caller

**State: RESOLVED (Phase 03)** — options 1 and 2 both shipped, plus the resolver.

**What was decided and built.** Shape 2, with shape 1 retained as a fallback and
the runtime's own identity source given a real job:

- `Job.caller` carries the submitting `SecurityContext` (or `null`). It is written
  once by `createJob` and read by the coordinator, never re-derived.
- `OrchestratorExecutionPort.execute` gained `securityContext?`, so the identity
  travels through `OrchestratorTaskExecutor` to the bridge. The bridge prefers the
  job's caller and falls back to the declared service principal; with neither, it
  attaches nothing and the gate refuses.
- `RuntimeOptions.identity.resolve` is now actually called. `establishRequestIdentity`
  runs once at the top of `TozOrchestrator.execute` and consults the resolver only
  when the request carries no context of its own — a supplied context is never
  replaced behind the caller's back. Establishing identity happens **before**
  authorization, so an unidentified caller is refused and recorded nowhere.
- The identity that reaches governance is stamped `"resolved"` by
  `withProvenance` at the composition seam, so a resolved context and an asserted
  one are distinguishable at the point of decision.

Option 3 (delegation from the requesting human) is available as a mechanism —
`delegate` exists, is bounded, and never inherits the parent's approval — but it is
not the default path, because B-05's answer to "who is the human" is still open.

**Verified by:** `tests/governanceQaSeparation.phase03.test.ts` (B-08 block),
mutation reverts M1, M2, M6, M7, M8, M12, M13 — each individually CAUGHT — and an
independent probe reporting 5/5 on the job-identity claim.

**Residue handed on.** The *policy* half of the original question — "should a job
submitted by one actor be permitted to run as another?" — is now answerable (the
caller is carried and refused when ungranted) but the decision about *whose*
approval binds to it is B-05, and B-05 remains open for Phase 04.

**Originally raised.**

**Problem.** `OrchestratorExecutionPort.execute` has no field for a caller, so a
task driven by `ExecutionCoordinator` reaches `TozOrchestrator` with nothing
identifying who asked for it. With governance composed — which it now is, by default
— every background task is refused, correctly but uselessly.

**Evidence.** `workflow/worker.ts:278-305` (the port shape) and
`workflow/model.ts` `WorkflowTask` (no caller field). The composition root's bridge
therefore takes the principal from `RuntimeOptions.identity.serviceContext`; with
none supplied, `describe().workflowExecution` is `"refused"` and the task fails
visibly.

**Why automatic continuation is not possible.** There are three shapes and they have
different security properties:

- **A service principal declared at composition time** (what Phase 02 ships). Every
  background task runs as one named identity. Simple, auditable, and it means one
  compromise reaches every job.
- **A caller field on the port and the task.** Each job carries its own identity.
  Correct, and it changes `OrchestratorExecutionPort`, `WorkflowTask` and every
  workflow test.
- **Delegation from the requesting human**, so a background task runs under
  authority a named person granted. Strongest, and it needs B-05 answered first.

**Decision required.**

1. Which of the three for the MVP?
2. If a service principal: what constrains it, and does an approval recorded by one
   approver bind to work run under it?
3. Should a job submitted by one actor be permitted to run as another?

---

## B-09 — The configured routing policy does not govern routing

**State: WAITING_FOR_HUMAN** (raised in Phase 02; Phase 05 decision)

**Problem.** `orchestration.routing.defaultPolicy` is validated, documented and now
reaches `FallbackPlanner` — so it orders the **fallback chain**. It does **not**
order the **primary selection**: `DefaultRouter` orders candidates with a
deterministic verified-facts `Scorer` that has no policy concept, and
`WorkloadRequirements.policy` is never read there.

**Evidence.** `routing/defaultRouter.ts:71-74` (`this.#scorer.order(...)`) and
`routing/router.ts:298-311` (the `Scorer` port). Passing `policy` into
`router.select()` changes nothing — verified by a test fixture on which
`capability-first` and `latency-sensitive` genuinely disagree, which
`tests/compositionRoot.phase02.test.ts` asserts.

**Why automatic continuation is not possible.** This is a routing-design decision
inside the core's one hard authority, not wiring. Two defensible answers:

- **Leave it.** The verified-facts scorer is deliberate and documented: it refuses
  to invent weights without measured data. The policy then honestly governs only
  ordering *among* acceptable candidates. The cost is that a setting named
  `defaultPolicy` reads as governing routing as a whole.
- **Make selection policy-aware**, so the primary route and its fallback chain are
  ranked by one ordering. The cost is that `capability-first`, which leads with
  declared capability breadth, would no longer always lead — and a deployment that
  believes it is routing by verified facts would not be.

Phase 02 mitigated rather than decided: `describe()` now reports both facts
separately (`selectionOrder: "verified-facts"`, `fallbackPolicy: <name>`), so the
setting cannot be misread as governing more than it does.

**Decision required.**

1. Which of the two answers.
2. If policy-aware: does a policy ever *override* verified-facts ordering, or only
   break ties within it?
3. Should the setting be renamed to `fallbackPolicy` so its scope is not a matter of
   interpretation?

---

## B-04 — Workspace / brand isolation model

**State: RESOLVED - Phase 06** (the isolation model; **scale remains an open decision**,
recorded at the end of this section and deliberately not resolved by it)

**Problem.** Multi-workspace / multi-brand is a stated goal. The system was
classified **D - unsafe for multi-tenant deployment**: unpartitioned *and*
undeclared, so the failure was silent.

**Evidence (before Phase 06).** No tenant/workspace/brand identifier anywhere in `src/`. The only
hit is `knowledge/port.ts:5,21` (`readonly workspace: string | null`), read by
nothing. All nine registries are flat process-global `Map`s. `SecurityContext`
has no tenant field. `AuditSink.read()` takes no filter and returns the whole
buffer. `MemoryScope` is a closed 11-value enum with no tenant member, and 5 of
those scopes are cross-tenant by construction. `MemoryAccessPolicy` keys grants
by bare subject id, and the subject id is derived from a **caller-supplied
`taskId`**.

**Files.** `src/orchestration/memory/memory.ts`, `model.ts`, `policy.ts`,
`store.ts`; `src/audit/events.ts`; `src/orchestration/governance/context.ts`;
`src/providers/registry.ts`, `src/models/registry.ts`,
`src/orchestration/agent/registry.ts`, `src/orchestration/capabilities/registry.ts`.

**Attempted.** Resolved in Phase 06. The three options below were the analysis that
produced it; they are kept because a reader comparing the shipped design against the
alternatives needs the alternatives, not just the verdict.

**Failing tests.** None.

**Why automatic continuation was not possible.** Three structurally different
answers, with very different cost and very different failure modes:

- **Hard partition** — compose per-workspace instances. Strongest isolation;
  no cross-workspace query is even expressible. Multiplies memory and makes
  cross-brand aggregate reporting impossible without a separate system.
- **Row-level scoping** — add `workspaceId` to every record and filter. Cheaper;
  but every query becomes a chance to forget the filter, and this codebase has
  already demonstrated that "the filter is applied somewhere" is not the same as
  "the filter is applied on the path" (C-1).
- **Instance per brand** — simplest and safest operationally; does not scale
  past a handful of brands and pushes isolation to deployment.

Additionally: whether `MemoryScope` becomes an open string or a
`(scope, workspaceId)` pair is a breaking type change, and a **closed enum
cannot express tenancy** — this is not a detail.

**Decision taken (Phase 06, by the user).**

1. **Which isolation model?** → **Hard partition**, with composite keys
   `(workspace, brand, …)`. Questions 1 and 3 were answered together: cross-brand
   and cross-workspace aggregation is **not required**, so nothing needs a separate
   governed aggregation path — and that is why the hard partition is affordable
   rather than costly.
2. **How many brands/workspaces in the first 12 months?** → **UNDECIDED.** This is
   the one question that was deliberately left open, and it is not resolved by this
   section. See *Scale* at the end of B-04.
3. **Is cross-brand aggregate reporting required?** → **No.**

`MemoryScope` did **not** become an open string. The closed enum is intact and
tenancy is carried beside it, not inside it — which is the cheaper of the two
breaking options and the one that keeps an invalid scope a type error.
4. Confirm the `taskId`-derived memory identity bug is fixed **before**
   partitioning, not with it.

---

## B-05 — Who approves, in the MVP?

**State: WAITING_FOR_HUMAN** (blocks Phase 04 detail, Phase 14)

**Phase 03 closed the MECHANISM, not the decision.** `decidedBy` is still a
free-text string, but it is no longer the *only* thing standing between a job and
its own approval: the coordinator now derives the identities a decision may not
come from (the job's caller, the runtime's declared service principal, the live
claim's worker) from its own records and passes them to
`ApprovalRegistry.assertDecidable`, which refuses them whatever `decidedBy` says.
What remains open is the original question — *whose* string is an approval, and
how is that person's identity established and evidenced.

**Problem.** The brief requires explicit human approval for publishing, ad spend,
spend, sending proposals, irreversible external change, binding acts and
privilege escalation. The system has no RBAC — `roles` is a non-authoritative
label and resolution is entirely the caller's.

**Evidence.** `FINAL_ARCHITECTURE.md` §25: "No RBAC. `roles` is a label."
`governance/context.ts` accepts `roles` and freezes it; nothing consumes it.
`ApprovalGate.decidedBy` is a free-text string. The only real identity in the
system is `SecurityContext.actor`, and the orchestrator **refuses** any run whose
actor cannot be identified (`enforcement.ts:89-95`).

**Files.** `src/orchestration/workflow/gates.ts`,
`src/orchestration/governance/context.ts`, `policy.ts`, `operations.ts`.

**Attempted.** None.

**Failing tests.** None.

**Why automatic continuation is not possible.** "Named individuals" and "roles"
are different systems with different security properties. Named individuals give
a real audit trail today. Roles need an identity provider, a role store, a
review process for role assignment, and account deprovisioning — and a role
system with a stale role store is *worse* than named individuals, because it
looks authoritative.

**Decision required.**

1. MVP: named human approvers, or roles?
2. How is a human's identity established and evidenced? Today `decidedBy` is a
   free-text string, which is auditable but not verifiable.
3. ~~Must an approval be bound to the specific content hash approved?~~ →
   **ANSWERED IN PHASE 04.** An approval is now bound to a SHA-256 digest of the
   execution intent — objective, input, required capabilities and minimum trust —
   derived by the authority itself and re-derived on every release. An approval
   recorded for one piece of content no longer releases materially different
   content, and the gate record names the digest so the decision is attributable.
   What remains open is question 2, and only question 2: the binding says WHAT was
   approved, not WHO may approve it.
4. What is the escalation path when the required approver is unavailable?

---

## B-13 — The tool boundary states an approval requirement it cannot satisfy

**State: OPEN — raised during Phase 04.** Not a Phase 04 blocker: Phase 04 closed
its own three items, and this is reachable only through a path that does not exist
yet. Recorded because it is the same defect B-10 was, in a second subsystem, and
because the *next* phase is the one that will complete it.

**Problem.** `authorizeToolCall`
(`src/orchestration/tools/tool.ts:245`) refuses a side-effecting tool with

> `the tool has side effects and requires explicit approval`

and offers **no way to obtain that approval**. There is no gate, no bridge, no
registry, no record. Setting `requiresApprovalForSideEffects: true` therefore does
not mean "ask a human" — it means "this call can never succeed", which is B-10's
exact shape and would be its exact severity if the call were reachable.

**Why it is not live.** Nothing in `src/` calls `ToolExecutionHost.invoke` or
`authorisedTools`. The host is constructed by the composition root and exposed as
`runtime.toolHost`, and that is the end of it. This is already known and recorded
as a PHASE 05 item ("`ToolExecutionHost` holds no `TraceRecorder` and is not wired
into the orchestrator, so no tool call appears in any orchestration trace").

**Why it is still a blocker rather than a note.** Because it is one wiring mistake
away from being live, and when it becomes live it will be fail-*closed* by accident
rather than fail-closed by design — which reads, in an incident, exactly like a
system that works. PHASE 04's obligation here was to keep it unreachable, and that
is asserted (`tests/approvalExecutionBoundary.phase04.test.ts`, "keeps the tool host
off every execution path, so it cannot become a second authority") rather than
promised in a docblock.

**The second half, which is a tool-boundary decision rather than an approval one.**
Both inputs to the refusal are **caller-asserted**: `ToolRecord.sideEffecting` and
`ToolPermission.requiresApprovalForSideEffects`. A tool that really does publish
and is registered with `sideEffecting: false` is never gated. That is the same
"the declaration is the authority" shape as `task.approvalRequired` — defensible
there because the workflow author declares it, and not defensible here, because
nothing independently confirms a tool's effect. Closing it means either verifying
tool effects from a source the caller does not control, or treating every
non-`local` tool as outbound by default. Both are PHASE 05 decisions.

**Decision required.**

1. Does `ToolExecutionHost` reach the orchestrator in Phase 05, or are the `tool_*`
   event kinds and the host removed as declared-but-unused?
2. If it is wired: does the side-effect refusal go through governance and the one
   registry, exactly as `workflow.execute` does now?
3. What makes `sideEffecting` a fact rather than a declaration?

---

**UPDATE — PHASE 05. Both questions are now answered, and the answer changed the
shape of the blocker.**

- **Q1: the host is wired, and the kinds are live.** `ToolExecutionHost` is now the
  ONE tool authority on the execution path, and `tool_invoked` / `tool_refused` are
  emitted from verified facts. The composition root hands the orchestrator the same
  host it exposes, and the orchestrator **refuses at construction** a host built over a
  different registry.
- **Q2: yes, through the one authority — and this exposed a larger defect.** Reading
  the tool boundary end to end found that `authority.ts` wrote an adapter's reported
  tool call straight into the run's evidence with `sideEffecting: false` hardcoded and
  **no authorisation check at all**. The side-effect refusal was never the worst of
  it: an irreversible action was being recorded as harmless, and an unauthorised one
  was being recorded as having happened. Fixed fail-closed, with the registry as the
  only source of the fact.
- **Q3: partially answered, and the remainder is why this stays open.** The *evidence*
  now takes `sideEffecting` from the registry rather than from the claimant, so the
  record cannot lie. But `ToolRecord.sideEffecting` is still a **declaration at
  registration time**: nothing independently confirms that a tool publishes. An agent
  that declares no tools cannot be shown to have used one either. Verification of tool
  effects from a source the caller does not control is a Phase 13 decision.
- **And the approval half became obtainable rather than absolute.**
  `authorizeToolCall` used to refuse with a requirement no input could ever satisfy.
  `ToolCallApproval` is now a real value the one approval authority issues. No flow
  issues one during an execution yet, so the orchestrator refuses an irreversible tool
  and says what would satisfy it — and `describe().toolApproval` reports
  `required-and-unobtained` at boot. A mid-execution approval is **Phase 13**.

---

## B-07 — Does an empty capability list in a grant mean "any" or "none"?

**State: WAITING_FOR_HUMAN** (policy decision; does not block Phases 02-06)

**Problem.** `Grant.capabilities: []` currently means **"no capability
restriction"** — a blanket grant over every capability. The target architecture's
first principle is the opposite: an absent value is never "permitted". Phase 01
found this is a deliberate, coherent contract rather than an oversight, and
therefore did **not** change it unilaterally.

**Evidence.**

- `src/orchestration/governance/context.ts` — `Grant.capabilities` is documented
  as *"Capabilities this grant permits. Empty means 'no capability
  restriction'."*
- `Grant.resources` uses the identical convention deliberately: *"Empty means
  'this operation, any resource', which is only ever produced deliberately by a
  role definition - a grant built from a delegation is never empty."*
- `src/orchestration/governance/policy.ts` `CapabilityRule` implements exactly
  that: an empty permitted list makes the rule **abstain** rather than deny.
  Verified by execution — a grant with `capabilities: []` exercising `research`
  returns `ALLOW` / `permission_granted`.
- `delegate()` propagates it faithfully (`context.ts` ~306-311): a child of a
  blanket grant is blanket. That is **not** an escalation, because the child is
  never broader than its parent, and the escalation guard is correctly skipped
  when the parent holds everything.
- The repository applies the **opposite** rule elsewhere: `ScopeRule` treats an
  empty scope list as DENY (`policy.ts:512-516`), and memory recall treats
  `recallScopes: []` as *no recall* (`authority.ts:1311`).

So grants use "empty = broad" and scopes/recall use "empty = nothing". Both are
defensible in isolation; together they are inconsistent.

**Files.** `src/orchestration/governance/context.ts` (`Grant`),
`src/orchestration/governance/policy.ts` (`CapabilityRule`),
`src/orchestration/governance/policy.ts` (`ScopeRule`).

**Attempted.** Phase 01 wrote the test that would have asserted "empty = DENY",
observed that it would have silently redefined the documented role path, and
removed the assertion. The half of C-4 that was a genuine defect — the
enforcement *trigger* — was fixed instead.

**Failing tests.** None.

**Why automatic continuation is not possible.** This is a security-boundary
policy decision with a real cost on both sides, and it is exactly the category
the brief lists under `WAITING_FOR_HUMAN` ("güvenlik sınırı belirsizliği").

- **Keep "empty = any capability"**: a role definition can grant
  `capability.execute` broadly with one line, and existing role-shaped code
  keeps working. The cost is that a caller who *forgets* to list capabilities
  gets a blanket grant instead of a refusal — and forgetting is the common case
  that the fail-closed principle exists to catch.
- **Change to "empty = no capability"**: forgetting becomes safe, and it matches
  `ScopeRule` and the recall default. The cost is that every existing broad role
  definition silently stops working, and `delegate()` would need re-examination,
  because a parent holding everything would derive a child holding nothing —
  which is safe but surprising.

**Decision required.**

1. Which reading is correct for a TOZ role definition?
2. If "empty = none": should `delegate()` be special-cased so a blanket parent
   derives a blanket child explicitly rather than accidentally?
3. Should `CapabilityRule` be aligned with `ScopeRule`, or should the two be
   deliberately different and documented as such? Right now neither file says so.
4. Does the same question apply to `Grant.resources`, which uses the same
   convention? If yes, that widens the change and should be decided together.

**Not blocking anything.** Phases 02-06 do not depend on it. Phase 01 closed the
part that was unambiguously a defect.

---

## B-06 — Is the previous architecture document superseded or amended?

**State: WAITING_FOR_HUMAN** (documentation hygiene; not blocking code)

**Problem.** `docs/FINAL_ARCHITECTURE.md` is declared "the canonical architecture
document" and is **excellent** — it self-reports weaknesses that most audits
would hide. But it is now **materially wrong in the project's favour** on the
single most important claim, and it omits four live defects.

**Evidence.**

- `PROJECT_STATE.md` §22.1: governance is "**enforced** on the execution path".
  Contradicted by C-1..C-4.
- `FINAL_ARCHITECTURE.md` §6 describes governance narrowing as effective. It is
  not (C-1).
- §24 "16 known limitations" does not include C-1..C-4.
- §26 "1,537 / 1,537 passing" — actual 1,598.
- §11 "`errorClass` and `durationMs` ... **never supplied** by any of the four
  producers" — `errorClass` **is** supplied at `authority.ts:959,995` and
  `coordinator.ts:1176,1191,1197`. Overstated in the safe direction, but wrong.
- §26 "1,527 tests" vs "1,537 passing" in the same section reads as
  self-contradictory.
- `README.md:6` "Current phase: PHASE 04.1"; `package.json:6` "(PHASE 01)".

**Files.** `docs/FINAL_ARCHITECTURE.md`, `PROJECT_STATE.md`, `README.md`,
`package.json`.

**Attempted.** All claims checked against code and against execution.

**Failing tests.** None.

**Why automatic continuation is not possible.** Three defensible answers with
different consequences: amend in place (preserves the audit trail, but leaves a
document whose central claim was wrong); mark superseded and add a Phase 00
addendum (cleanest separation, but a reader may not see the addendum); delete and
regenerate at Phase 16 (**loses the audit history that makes this codebase
valuable** — strongly not recommended).

**Recommendation (for approval, not decided):** mark it superseded *as a
statement of current behaviour*, retain it in full as the Phase 10 audit record,
and add a Phase 00 addendum listing C-1..C-4 with reproduction evidence. Do not
edit its Phase 10 findings — the record of what was known then is itself
valuable, and D-03 is only possible because the original claim was written down
confidently.

**Decision required.** Which of the three, and who owns the correction.

**Phase 08 revisited this and did NOT decide it — recorded so the next reader knows the
question was met rather than missed.** Phase 08 is the agent/capability phase, so the
blocker was examined directly, and it does not in fact reach it:

- The pool matches an **agent's declared capabilities** against a **request's required
  capabilities** (`matchCapabilities`), and that comparison has no "empty means broad"
  branch. A request with no required capabilities and an agent with no declared ones
  simply match on nothing, which is a different question from how `Grant.capabilities: []`
  is read by `CapabilityRule`.
- What Phase 08 *did* settle in this area is adjacent and unambiguous: an agent's
  capability profile that omits a capability is `unknown`, **not** a refusal, and
  `requireVerifiedCapabilities` is what turns `unknown` into a disqualification
  (`DECISIONS.md` D-61). That is about an agent's honesty, not about a grant's breadth,
  and it does not touch `CapabilityRule`.
- The reason the blocker now bites harder than it did is worth stating: **Phase 08 removed
  `tools.grantUndeclaredTools` rather than wiring it** (D-60), because wiring it would have
  meant widening an authority boundary with no approval and no operator identity behind it.
  That decision leans on B-05 remaining open, and B-07 is the same question one layer over —
  both are "what does an absent value in an authority grant mean", and both are answered
  the same way when it finally is: **not "permitted"**.

So B-07 is unchanged, still `WAITING_FOR_HUMAN`, and now has a Phase 08 decision resting on
it staying that way until a human settles it.

---

## B-10 — A governance-configured approval cannot be satisfied

**State: RESOLVED (Phase 03, second pass)** — the setting is answerable end to end,
and the answer comes from the one authority that already existed.

**What was wrong.** `governance.approvalRequired` was read and `ApprovalRule` was
constructed, so an operation named by configuration was refused with
`approval_required` — but **nothing could ever satisfy it**. `bridgeApproval`, the
function written to turn exactly that verdict into an open gate, had **zero call
sites**. No gate was opened, no decision could be recorded, and the setting failed
every job that used it. Three findings, one defect:

| Finding | Closed by |
|---|---|
| C7.3a — the requirement is unsatisfiable | `ApprovalRule` now consults a read-only `ApprovalGateObserver`; the composition root backs it with the coordinator's own `ApprovalRegistry` |
| C7.3c — the resolution does not feed back into governance | the same observer: the re-drive re-runs governance's `workflow.execute` check and the recorded `approved` gate answers it |
| C7.4b — `bridgeApproval` has no real call site | `RuntimeExecutionBridge.execute` is the one call site, in the composition root, which is the only place that can see both authorities |

**The flow, in the order the brief requires it.**

```
governance REQUIRE_APPROVAL
  -> the composition-root bridge reads the decision the engine ACTUALLY recorded
     (PolicyEngine.decisions(), through GovernanceGate.approvalRequiringFor)
  -> bridgeApproval opens a gate on the PHASE 07 ApprovalRegistry - the same one
     an `approval()` step would have opened, owned by the same coordinator
  -> the coordinator finds that gate in its OWN registry and HOLDS the task
     (`waiting_approval`, no failure recorded, no attempt consumed)
  -> a human or an authorised system decides through `coordinator.decideApproval`,
     which still refuses the job's caller, the runtime's service principal and
     the live claim's worker whatever `decidedBy` says
  -> on the re-drive, `ApprovalRule` observes the recorded `approved` gate and
     abstains, and the engine's remaining rules have no objection
  -> execution continues
```

**No second approval authority was created.** `coordinator.approvals.all().length`
is asserted to be exactly 1 after a governance-held run. Governance still cannot
DECIDE: the observer it reads through has no `open`, `decide` or `expire` verb, and
the gate port it opens through still has no verb beyond `openApproval` and
`forTask`.

**Fail-closed at every step**, which is the direction that matters. `ApprovalRule`
requires *all* of: an observer wired, a job, a task, a gate in that registry for
that job and task, `state === "approved"`, a non-empty `decidedBy`, and a non-null
`decidedAt`. Anything absent is `REQUIRE_APPROVAL`. The lookup is keyed on the JOB
as well as the task, because a task id is unique only within a job — keyed on the
task alone, one job's approval would release another job's identically-named task,
which is the PHASE 10 bypass reproduced in a new place.

**Where the job binding comes from, and its residual.** `inJobScope` stamps the
(job, task) pair onto the identity at the composition seam, from the port request
the coordinator fills from the job record it owns, **overwriting** whatever the
submitter wrote. The residual: the lookup is (jobId, taskId) and both must name a
gate that really exists, so a caller holding a `SecurityContext` directly could
name another job's approved pair and be permitted. That is B-05 question 3 — *must
an approval be bound to the content hash approved?* — which this repository has
already answered "no" for the pre-existing PHASE 07 gate, because `mayRelease` has
never looked at content. The class is therefore not new, and closing it is B-05's
decision rather than this phase's. Recorded here rather than papered over.

**Verified by** `tests/governanceQaSeparation.phase03.test.ts` (ten new cases),
mutations M24–M34 (eleven individual reverts, each CAUGHT), and the independent
49-part probe (parts F39–F46, whose own self-test detects 8/8 reverts).

**Originally raised.**

**Problem.** `governance.approvalRequired` is now read and `ApprovalRule` is now
constructed, so an operation named by configuration is refused with
`approval_required` — but **nothing can ever satisfy it**. No gate is opened, no
decision is recorded, and a genuine `ApprovalRegistry.decide` approval never
feeds back into governance. Enabling the setting on an operation permanently
fails every job that uses it.

**Evidence.** Executed, three ways:

- A plain caller job with `approvalRequired = ["workflow.execute"]` →
  `job.state = failed`, `task.state = failed`,
  `failure.errorClass = approval_required`, `retryable = false`,
  **`approval registry gates = []`**. There is nothing a human could approve.
- `bridgeApproval` (`governance/integration.ts:70`), the function written to turn
  exactly this verdict into an open gate, has **zero call sites** anywhere in
  `dist/src` outside its own definition and export. It is dead code whose own
  docblock describes wiring that does not exist.
- `ApprovalRule.evaluate` consults no recorded decision (it cannot: governance
  may not import the workflow layer, and the registry lives there).

**Why it fails closed rather than open.** The alternative that was removed in
Phase 03 — letting the rule read `context.approvalState` — *was* satisfiable, by
the caller writing the field themselves. Closed by D-23. A rule that states a
requirement nothing can meet is a defect; a rule anyone can waive is a hole.
Phase 03 shipped the second-worst option on purpose, because it is the safe
direction, and raised this rather than widening scope into the workflow layer.

**Files.** `src/orchestration/governance/integration.ts` (`bridgeApproval`,
`ApprovalGatePort`), `src/orchestration/governance/policy.ts` (`ApprovalRule`),
`src/orchestration/composition.ts` (the bridge that would have to call it),
`src/orchestration/workflow/coordinator.ts` (which would have to hold the task
pending instead of recording a permanent failure).

**Failing tests.** None — every current test asserts the fail-closed behaviour.
The gap is the absence of a test that an approved configured-operation ever runs.

**Why automatic continuation is not possible.** Three things have to agree and
only one design can make them: governance's verdict (which may not write a
decision), the coordinator's gate (which may not authorize), and the task state
(which today has no "waiting for approval" outcome distinct from "failed").
Deciding that shape — who opens the gate, what the coordinator does with
`REQUIRE_APPROVAL`, and whether a permanent `approval_required` error class
survives — is a Phase 04 architectural decision, not a fix.

**The three questions, answered by the implementation.**

1. **`RuntimeExecutionBridge` calls `bridgeApproval`.** Not the coordinator: the
   coordinator may not ask permission (`source.includes("PolicyEngine") === false`
   is a test), and it may not import `governance/` at all. The composition root is
   the only place in `src/` that can see both the verdict and the registry, and it
   is also the only place permitted to assemble the system.
2. **Neither.** `TaskExecutionOutcome` did not gain a new state, and
   `approval_required` was not reclassified as retryable — which would have spent
   the attempt budget on a question only a human can answer. The coordinator
   intercepts on the *failure* path and asks its **own** registry whether a human
   is currently being asked; an open, undecided gate means the task waits
   (`waiting_approval`, `failure: null`, attempt not consumed), and anything else
   falls through to the ordinary failure path. A rejected, expired or cancelled
   gate is terminal and still fails, because a refused approval is a real answer
   and must not be retried into a different one.
3. **The caller re-drives, by the contract the PHASE 07 gate already had.**
   `decideApproval` moves the task to `ready`; `runJob` releases it. This was not
   invented here and no auto-runner was added — inventing a scheduler is a Phase 04
   decision with a mandate this pass does not have. What changed is that the
   re-drive now *succeeds*: governance observes the recorded decision and permits.

---

## B-11 — `needs_review` has no escalation path

**State: OPEN — RE-ASSESSED in Phase 03, second pass, and reclassified MEDIUM → LOW**

**Why the severity changed.** The second pass made a governance-configured
approval answerable, which is the only new thing that could plausibly have made
this worse. It did not. Re-measured:

- A task that requires no verification still COMPLETES on a `needs_review` verdict,
  because `settle` only consults one where the workflow asked for it. Verified, and
  the independent probe asserts the known behaviour rather than assuming it (part
  G47 — which is how the over-broad version of this claim was caught).
- The blocking case — a `needs_review` on an **approval-required** task — was
  already reachable before this pass, through the pre-existing PHASE 07
  `approval()` step, and `tests/governanceQaSeparation.phase03.test.ts` has
  asserted it since the first pass of the phase ("still withholds completion when
  the reported verdict is not a pass"). The new path is not a second route to it.
- So the gap is real, unchanged, and reachable exactly where it was. LOW rather
  than MEDIUM because nothing about it is new, and because it is a *missing*
  capability (an escalation target) rather than a *wrong* one.

**Fixing it would be a design decision, not a code change**, and this pass was
explicitly scoped not to take it. The minimal production change that would couple
to it does not exist: nothing in the new approval path produces a verification
verdict, and nothing in the verification path produces a gate.

**Problem.** A verification that answers `needs_review` blocks completion of an
approval-required task (`settle()` says the job "did not verify"), but nothing in
the system says who resolves a `needs_review`, by what route, or whether that
resolution *is* an approval. The two subsystems are correctly kept separate —
neither can produce the other's answer — and the handoff between them is
therefore undefined.

**Evidence.** `ApprovalRegistry` has no `needs_review` state;
`ApprovalState = waiting | approved | rejected | expired | cancelled`. The
verification verdict is `"pass" | "fail" | "needs_review" | null` and is recorded
by the coordinator in `#verdicts`, read only by `settle()`. TODO Phase 03 item
"Decide the `needs_review` escalation path" is the same gap, written earlier.

**Also in scope:** the related TODO Phase 03 item *"Give QA an independent
evidence channel; it must not read the executor's self-report as its only input"*
was **not attempted** in Phase 03. QA currently verifies the `Evidence` record the
run produced. What "independent" would mean — a second observer, a signed
artifact, an out-of-band source — is a design decision, not a code change, and
answering it unilaterally would be a silent scope change.

**Decision required.**

1. Does `needs_review` become a human decision (an approval) or a human *task*
   (an assignment)? They have different audit records.
2. Who is the escalation target, and does that answer change B-05?
3. What is QA's second source, and who produces it?

---

## B-12 — `settle()` is not idempotent, and a missing verifier is classed `unknown`

**State: OPEN — RE-VERIFIED in Phase 03, second pass; both halves unchanged.**

Both halves are re-measured by the independent probe (parts G48 and G49) and
asserted against the CURRENT behaviour, so a change to either would fail the
probe rather than pass silently.

**Re-assessment of the coupling question.** Half 1 is now reachable *more* often:
a governance-held task leaves its job `waiting` where it previously left it
`failed`. That is a genuine increase in exposure and it is recorded here rather
than dismissed. It is still not fixed in this pass, for two reasons. The fix is a
one-line answer to a product question — does `settle()` report or throw when
already settled — and changing the failure mode of a public method for a
robustness defect is a wider blast radius than the three blockers this pass was
scoped to. And the coupling test it was given says "only if the minimal production
change is directly coupled": nothing in the new approval path calls `settle()`,
and the hold changes nothing about what `settle()` would say. Adjacent, not
coupled.

**Problem.** Two robustness defects found by the Phase 03 probe that are real but
not security-relevant, so they were recorded rather than fixed mid-phase.

1. `ExecutionCoordinator.settle(jobId)` **throws** `JobStateError` when the job is
   already `waiting` with an active waiting-approval task — observed on both a
   first and a second call. Any caller that settles twice gets an exception
   instead of an answer.
2. A task that requests `verificationKinds: ["evidence"]` with no verifier
   registered fails with `errorClass: "unknown"` rather than a class that names
   the missing verifier. `unknown` is what the default retry policy does *not*
   retry, so the behaviour is safe; the classification is uninformative to
   metrics and retry logic.

**Decision required.** Whether `settle()` reports or throws when already settled,
and whether a missing verifier deserves its own `ErrorClass` — which is a change
to a closed taxonomy shared with PHASE 06 routing, so it is not a local edit.

### B-04, Phase 06 resolution - what was decided, and what was deliberately left open

**Decided by the user, not inferred:** composite-key partitioning with **hard
isolation**. No cross-workspace read, no cross-brand aggregation, and no shared read
path - not a filter that could be forgotten, but a partition.

**Decided by the user, for the shared registries:** `core.providers`, `core.models`,
`capabilities`, `verifiers` and `providerAdapters` stay **deployment-scoped**, because
they hold deployment configuration rather than customer data. Three conditions were
attached and are enforced, not merely documented:

1. `describe().platformScopedRegistries` lists each one **with what it holds** and a
   required `customerData: false` assertion - a registry cannot be shared without someone
   writing down why.
2. A structural test proves **no customer-data registry is deployment-scoped**, and
   proves it *positively*: each customer-data store's constructor must accept a
   workspace. Absence from the shared list alone would also be satisfied by a store that
   was simply forgotten.
3. No platform record type may declare a workspace, a brand, or a customer identity,
   read from source. `ModelRecord.metadata` was the one hole and it is **closed**, not
   caveated.

**Deliberately left OPEN: scale.** How many workspaces and brands this serves in the
next twelve months has not been decided. No architecture was invented from it, and none
should be until it is.

The consequence is recorded so the next reader does not mistake the absence of a plan for
the absence of a consequence: the implemented model composes **one store instance per
workspace**. That is correct, simple, and unbounded in *workspaces* - but it costs one
instance of each partitioned store per workspace, so a decided scale could justify a
shared-instance design with in-instance partitioning. An undecided scale must not buy
that refactor by assumption.
