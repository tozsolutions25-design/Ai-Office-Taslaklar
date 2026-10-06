# TODO

> Real, verified TODO list. Every item cites the evidence that made it a TODO.
> Items are not aspirations — each one is either a reproduced defect, an
> absent-but-required capability, or a verified dead/wired gap.

Legend: **[P01]** Phase 01 · **[Pnn]** phase number · **[DEF]** defect ·
**[GAP]** missing capability · **[DOC]** documentation

---

## PHASE 01 — Critical Security Fixes — ORIGINAL PLAN, ALL ITEMS CLOSED

These four were reproduced, not suspected. Full evidence in
`CURRENT_STATE.md` §5; the closing record, the mutation matrix and three
false-confidence traps caught during the work are in `PHASE_STATUS.md` under
PHASE 01. The item lists below are preserved as written, so the original
diagnosis stays auditable against what was actually changed.

### [DEF][P01] C-1 — Governance's denied-provider list never reaches the router

**STATUS: CLOSED.** `RoutingRequest.exclude` / `FallbackChainRequest.exclude`
carry the denylist; `DefaultRouter` applies it where candidates enter, and
`FallbackPlanner` applies it before the hard filter. `toCandidateExclusion` maps
`RoutingRestriction` onto the core shape as a pure function with a type-only
import, because governance must not call the router.

**Where:** `src/orchestration/model/modelRouter.ts:153` computes
`applyRoutingRestriction(this.#candidates(), requirements.denied)`; line 164 then
calls `this.#router.select({ requirements })` **without passing the filtered
candidates**. `RoutingRequest` (`src/routing/router.ts:67-72`) has no candidate
field, so `DefaultRouter.#selectSync` (`src/routing/defaultRouter.ts:50`) calls
`this.#candidates.candidates()` and re-derives the **full unrestricted** set.
`ModelRouter.plan()` (line 205-222) never applies `denied` at all — the
`FallbackPlanner` is built over `() => this.#candidates()` at line 130.

**Reproduced:** two eligible providers, `aaa-banned` denied →
`selected provider = aaa-banned`. Also `plan()` hop 1 = `aaa-banned`.

**Contradicted claim:** `authority.ts:827-831` states "`ModelRouter` applies this
subtraction ahead of `evaluateCandidate`, so a denied provider cannot be
selected". That is false. A false security claim at the point of use is itself
a finding.

**Todo**
- [ ] Decide the mechanism: extend `RoutingRequest` with a candidate override,
      **or** give `ModelRouter` its own filtered `CandidateSource` per call,
      **or** make `DefaultRouter` accept a restriction. Record the choice and
      its blast radius in `DECISIONS.md`.
- [ ] Apply the same restriction inside `plan()` / `FallbackPlanner`.
- [ ] Decide and document whether the `candidates.length === 0` short-circuit
      (line 155) is retained as defence-in-depth or removed as a duplicate.
- [ ] Add a test with **two or more** eligible providers where the denied one
      ranks first, asserting the selected provider is not the denied one.
- [ ] Add a test asserting the fallback chain excludes denied providers.
- [ ] Mutation-verify: neuter the filter, confirm the new tests fail.
- [ ] Correct the false comment at `authority.ts:827-831`.
- [ ] Correct `authority.ts` line 78 / `FINAL_ARCHITECTURE.md` §6 if they
      describe the mechanism.

### [DEF][P01] C-2 — The executor can approve its own work

**STATUS: CLOSED.** `assertDecidable` now compares against the gate's own
recorded `taskId`, and `decideApproval` derives the executing worker from the
live claim rather than from anything the caller says. The coordinator's own
`taskId` derivation was proved **not** load-bearing by mutation (M2c survived)
and was deleted rather than kept as decoration.

**Where (as found):** `ApprovalRegistry.assertDecidable` (`src/orchestration/workflow/gates.ts:259-276`)
refuses self-approval only when the caller supplies `workerId` (line 267) or
`taskId` (line 273). `ExecutionCoordinator.decideApproval`
(`src/orchestration/workflow/coordinator.ts:517-524`) forwards an **optional**
`workerId` and **never** supplies `taskId`, so the guard depends entirely on
caller cooperation.

**Reproduced:** `decideApproval({ gateId, decision:"approved", decidedBy:"worker-7" })`
→ `state="approved"`. Adding `workerId:"worker-7"` → correctly refused.

**Test gap:** both existing self-approval tests volunteer the argument —
`tests/workflow.execution.test.ts:511` and `tests/workflow.model.test.ts:576`.
No test covers the omitted case.

**Todo**
- [ ] Derive worker identity inside the coordinator from the live claim/task
      record, so it cannot be omitted by a caller.
- [ ] Pass `taskId` from `decideApproval` (the gate already carries it) so the
      "task may not approve itself" rule is reachable from production code.
- [ ] Decide whether `ApprovalGate` should record the executing worker at
      `open()` time, making the comparison structural rather than a runtime
      argument. **Preferred** — it makes the check unforgeable.
- [ ] Add a test that omits `workerId` and asserts refusal.
- [ ] Add a test where `decidedBy` equals the `taskId` and asserts refusal.
- [ ] Mutation-verify.

### [DEF][P01] C-3 — `approvalRequired: true` is not an enforcement precondition

**STATUS: CLOSED.** `mayRelease` now takes the requirement as a required
argument with **no default**, both coordinator paths pass it, and an
`approval()` step opens its gate at job creation with its declared `question`
and `expiresAtMs` carried through `flattenWorkflow`.

**Where (as found):** `ApprovalRegistry.mayRelease` (`gates.ts:334-338`) returns
`{ allowed: true, detail: "Task X has no approval gate" }` when no gate exists.
`ExecutionCoordinator.planRelease` (`coordinator.ts:839`) and `executeTask`
(`coordinator.ts:934`) consult **only** `mayRelease`; neither reads
`record.task.approvalRequired` as a precondition. The `approval()` builder
(`model/model.ts:553-560`) sets the flag, and `flattenWorkflow`
(`model.ts:618`) flattens the step to a plain task — **discarding `question` and
`expiresAtMs`**, so the declared question never reaches the coordinator at all.

**Reproduced:** task with `approvalRequired: true`, no gate opened →
`released = ["t1"]`, `"1 task(s) released, 0 waiting, 0 skipped."`

**Test gap:** every existing test that sets `approvalRequired: true` also calls
`openApproval` (`tests/workflow.execution.test.ts:480,497,509,523,604`;
`tests/workflow.jobscope.test.ts:75`). The ungated case is untested.

**Todo**
- [ ] Make `planRelease` treat `approvalRequired: true` + no gate as
      **blocked**, with a detail string naming the missing gate.
- [ ] Make `executeTask` (line 934) enforce the same precondition, so a direct
      call cannot bypass `planRelease`.
- [ ] Decide whether the gate is opened **automatically** at job creation from
      the `approval()` step (preferred — it makes the declaration
      self-enforcing) or must be opened manually. If manual, the missing gate
      must block, not permit.
- [ ] Carry `question` and `expiresAtMs` through `flattenWorkflow` so the
      declared question and expiry are not silently lost.
- [ ] Add a test: `approvalRequired: true`, no gate → not released.
- [ ] Add a test: the question declared in an `approval()` step reaches the
      gate.
- [ ] Mutation-verify.

### [DEF][P01] C-4 — Empty capability list disables capability enforcement

**STATUS: PARTIALLY CLOSED, and the Phase 00 finding was itself corrected.**

The enforcement **trigger** was the defect and is fixed: the enforced set is
now the union of the subtask's declared capabilities and the agent's registered
ones, so a plan can require more than the agent declares but can no longer
require less and thereby narrow enforcement to nothing.

The empty **grant** list was found on inspection to be a **deliberate,
documented contract** rather than a defect — `Grant.capabilities` is documented
as *"Empty means 'no capability restriction'"*, `Grant.resources` uses the same
convention deliberately, and `delegate()` propagates it faithfully. Flipping it
would silently redefine a documented role path, so it is escalated as **B-07**
rather than changed unilaterally.

**Where (as found), two layers:**
- `enforcement.authorizeSubtask` (`src/orchestration/governance/enforcement.ts:148`)
  iterates `subtask.requiredCapabilities`. Empty → loop body never runs →
  returns `null` (permitted). The function also **never reads
  `agent.capabilities`** — the `AgentRecord` argument is used only for
  `agent.agentId` in the message (line 160). So the authoritative statement of
  what an agent may do is never the thing being authorized.
- `policy.CapabilityRule` (`src/orchestration/governance/policy.ts:494-496`):
  `if (permitted.length === 0) return null;` — the rule **abstains** when the
  grant lists no capabilities, so capability enforcement is inert.

**Reproduced:** (a) grant `capabilities: []`, exercising `research` → `ALLOW`,
`reasonCode=permission_granted`. (b) `authorizeSubtask` with
`requiredCapabilities: []` against a gate that denies everything → `null`, gate
never called.

**Todo**
- [ ] Decide the deny direction: an empty list must mean **no capability is
      permitted**, not "no opinion". Record in `DECISIONS.md`.
- [ ] Make `authorizeSubtask` authorize the **agent's registered
      capabilities**, not only the subtask's caller-supplied list — or check
      both and take the union. The subtask list is plan-author-controlled and
      must not be the sole basis.
- [ ] Make `CapabilityRule` return `DENY` (or an explicit abstention that the
      engine treats as deny) when the grant lists no capabilities.
- [ ] Consider a `requiredCapabilities: []` **planner-time** rejection: a subtask
      that declares nothing and drives a real agent is a plan defect.
- [ ] Add tests for both layers, including the empty-list case.
- [ ] Mutation-verify both layers independently.

### [P01] Process requirements

- [ ] For each of C-1..C-4, add the regression test **and** demonstrate it fails
      against a mutated build (the method used in Phase 00, §`CURRENT_STATE.md`).
- [ ] Re-run `npm run validate`; record the new test count and each added test's
      purpose.
- [ ] Run the full suite against a build with **all four** fixes reverted
      individually — one mutation at a time, not all together.
- [ ] Update `CURRENT_STATE.md` §5 and `PHASE_STATUS.md`.
- [ ] Do **not** mark Phase 01 PASS on the basis of green tests alone. A green
      suite is what Phase 00 already had.

---

## PHASE 01 — Critical Security Fixes — **DONE (PASS)**

All four defects closed. Full record, including the mutation matrix and three
false-confidence traps caught during the work, is in `PHASE_STATUS.md`. Summary:

- Failing tests written first: **11 of 15 failed** against unfixed `HEAD`
  (the 4 passing were deliberate positive controls).
- Fixes applied one defect at a time.
- **9/9 individual reverts CAUGHT** by an assertion; control green. A load error
  is never counted as a catch.
- Full suite **1614/1614**, 244 suites. Delta over HEAD is exactly **+17**, the
  new test file; `git diff` confirms zero tests added or removed elsewhere.

### Carried forward from Phase 01

- [ ] **B-07** — decide whether an empty capability list in a `Grant` means "any"
      or "none". Raised, not decided. Not blocking Phases 02-06.
- [x] **`npm run validate` runs tests against a stale `dist/`.** The script is
      `typecheck && lint && test:unit`, and `test:unit` is
      `node --test "dist/tests/*.test.js"` with **no build**. `npm test` does
      build; `validate` does not. One Phase 01 verification run reported green
      against a build that predated the latest source edit, and it was caught only
      by noticing the numbers did not move. Either add `build` to `validate` or
      rename it to make the staleness obvious. **Same shape as the four defects:
      a check that appears to run against the code and does not.**
      → Still open, and Phase 02 hit it again: every verification in Phase 02 used
      `npm test` (which builds) or an explicit `tsc` first. **STILL WORTH FIXING** —
      the trap is unchanged and the next phase will meet it.
- [ ] Residual on C-2: `decidedBy` is a self-asserted string. Refusing the
      *executor* works because execution implies a coordinator-owned claim, but
      nothing authenticates an approver. B-05, Phase 04.

### Carried forward from Phase 02

- [ ] **B-08** — a background task cannot identify its caller; the runtime must
      declare the principal its worker acts as. Feeds B-05.
- [ ] **B-09** — `orchestration.routing.defaultPolicy` orders the fallback chain
      but not the primary selection. Phase 05.
- [ ] **`scripts/mutation-phase02.mjs` is not wired into any npm script.** It is
      run by hand. That is acceptable for now — it takes minutes — but the next
      phase with a comparable number of wiring decisions should decide whether it
      becomes `npm run mutation`.
      → **Strengthened in Phase 03, second pass.** It is now known that two of its
      mutations had been silently `HARNESS_ERROR` while the summary reported
      25/25: a harness error is not a catch, and nothing surfaced the difference.
      An anchor that no longer matches must fail the run loudly, the way a load
      error already does.
- [ ] **`README.md` and `package.json:6` still describe the previous project's
      phases.** Carried from Phase 01 and still untouched; B-06 owns it.

---

## PHASE 02 — Composition Root for Orchestration

**Status: DONE (PASS).** B-03 answered: library core → AI Office product. Original
plan below, with each item closed or restated.

**Why it existed:** `TozOrchestrator` was never constructed in `src/`, so every
governance test built its own gate. That is *why* C-1 survived 1,598 green tests.
Measured: **zero** construction sites for every orchestration class, across all 149
`src/*.ts` files.

- [x] Define a single composition root that assembles `AgentRegistry`,
      `SpecialistPool`, `AdapterRegistry`, `MemoryService` + `MemoryStore` +
      provider, `RetrievalEngine`, `DefaultWritePolicy`, `TraceRecorder`,
      `ResourceTracker`, `GovernanceGate` + `PolicyEngine`, `ToolExecutionHost`.
      → `src/orchestration/composition.ts`, 28 subsystems asserted.
- [x] Wire the twelve `OrchestrationConfig` sections into it.
      → **8 sections live, 2 partial, 2 inert.** Per-section table in
      `CURRENT_STATE.md` §0.3. Residue below.
- [x] Build `GovernanceRecorder` in the root.
      → Done, and with one engine rather than two (D-16). `governance_decided` is
      now emitted and asserted.
- [x] Fail loudly when governance is configured but cannot be composed.
      → Governance is **installed by default**; `enforced: false` is the explicit
      opt-out and records itself as advisory in the one audit history.
- [x] Add an in-situ test: assemble the real system and prove C-1's fix holds
      through the composed path.
      → Done, with the two-eligible-providers fixture D-03 said was missing, plus
      the fallback-chain variant. Also re-proved C-3 across the new seam.
- [x] Decide the entry-point story.
      → **Library factory + a runnable read-only boot check.** No transport.

### Phase 02 residue, restated

- [ ] **`orchestration.routing.defaultPolicy` does not order the primary
      selection** — only the fallback chain. `DefaultRouter` has no policy concept.
      **B-09, Phase 05.** Mitigated in Phase 02 by reporting `selectionOrder` and
      `fallbackPolicy` separately.
- [ ] **`governance.blockOnUnknownCost` is still read by nothing.** It is a
      `GovernanceRecorder` input and no composed call site passes a budget, because
      there is no budget on the composed path. Phase 12/13.
- [ ] **`tools.grantUndeclaredTools`, `observability.enabled`, `worker.*` still
      inert.** Each needs a call site that exists to read it, or the section should
      be marked not-yet-wired in `.env.example`.
- [ ] **`OrchestratorExecutionPort` has no caller field.** A background task cannot
      identify itself, so the runtime must declare the principal its worker acts as.
      **B-08, feeds B-05 in Phase 04.**
- [ ] **The runtime cannot execute anything with the shipped defaults.** No identity
      resolver, no agent backend, no provider adapter. Correct, and reported by
      `npm run runtime:describe`, but it means the composition root is exercised by
      tests supplying those three and by nothing else.
- [ ] **`KnownActorRule`'s predicate defaults to "any named actor".** No identity
      provider ships; the grant is the real authority. A deployment with a real
      directory supplies `knownActors`. Documented as the weakest honest answer, and
      it is B-05's home.

**Closed during Phase 03:**

- [x] **`OrchestratorExecutionPort` has no caller field.** → `securityContext?`
      added to the port and `Job.caller` to the workflow model; B-08 **RESOLVED**.
      The identity travels job → task request → port → bridge, and the bridge
      prefers it over the runtime's declared service principal.

---

## PHASE 03 — Governance & QA Separation

**Status: DONE (PASS).** Original plan below, with each item closed or restated.

- [x] Structural separation: the QA reviewer must be unable to approve its own
      work by construction, not by argument. C-2's fix is a prerequisite.
      → Closed. `gates.ts` cannot name `VerificationRunner` or `verificationVerdict`;
      `verifier.ts` cannot name `ApprovalRegistry` or `governance/`; a passing
      verification does not release a waiting gate (asserted behaviourally, not
      just by scan); `ApprovalRegistry` is the single writer of a decided state
      and now hands out frozen records, so the alias through `get`/`all` is closed.
- [x] Give QA an independent evidence channel; it must not read the executor's
      self-report as its only input.
      → **NOT ATTEMPTED — restated under B-11.** QA verifies the `Evidence` record
      the run produced. What "independent" would mean — a second observer, a
      signed artifact, an out-of-band source — is a design decision, and answering
      it unilaterally would be a silent scope change.
- [x] `VerificationRunner` stays the only thing that may mark a result verified
      (`verification/verifier.ts`). Keep.
      → Kept, and asserted. The coordinator records the verdict it is *given*; it
      has no verifier of its own and the gate has no access to a verdict at all.
- [ ] Decide the `needs_review` escalation path: who resolves it, and whether
      resolution is itself an approval.
      → **OPEN — B-11, reclassified MEDIUM → LOW in Phase 03, second pass.**
      Re-measured: a task that required no verification still completes on a
      `needs_review` verdict, and the blocking case was already reachable through
      the pre-existing `approval()` step. The new governance path is not a second
      route to it. Nothing in the approval path produces a verdict and nothing in
      the verification path produces a gate, so no minimal coupled production
      change exists.

### Phase 03 residue, restated

- [x] **A governance-configured approval cannot be satisfied. B-10, HIGH.**
      → **RESOLVED in Phase 03, second pass.** `ApprovalRule` consults a read-only
      `ApprovalGateObserver` backed by the coordinator's own `ApprovalRegistry`;
      `bridgeApproval` is called from the composition root's bridge with the
      decision the engine actually recorded; the coordinator HOLDS the task
      (`waiting_approval`, no failure, attempt not consumed) when its own registry
      says a human is being asked. 34/34 mutations CAUGHT, probe 49/49, and
      `describe()` now reports `approvalBridge` so a deployment can read whether
      the setting is answerable. **Residual, recorded not hidden:** the lookup is
      (job, task) and not a content hash — see the PHASE 04 item below.
- [ ] **`ExecutionCoordinator.settle()` throws when the job is already
      `waiting`.** Not idempotent; any caller that settles twice gets
      `JobStateError` instead of an answer. **B-12, LOW.** Re-verified in the
      second pass and reachable *more* often now (a held task leaves its job
      `waiting` where it used to leave it `failed`). Adjacent to that pass, not
      coupled to it: nothing in the approval path calls `settle()`.
- [ ] **A task requesting a verifier that is not registered fails with
      `errorClass: "unknown"`.** Safe (the default retry policy does not retry
      `unknown`) but uninformative; `ErrorClass` is a closed taxonomy shared with
      Phase 06 routing, so it is not a local edit. **B-12, LOW.**
- [x] **`SecurityContext.approvalState` is caller-writable and read by nothing.**
      → Kept, and now **explicitly de-authorized**: documented as INERT, with a
      test that fails if any code under `governance/` reads it and a second that
      fails if any production code treats it as an approval. Not deleted, because
      `tests/governance.test.ts` proves a delegated context never inherits its
      parent's approval, which is only testable from an approved parent. The
      docblock now also says why the distinction matters: the rule consults a real
      record, so a context *claiming* `"approved"` and a context carrying a real
      approved gate look identical from that field.
- [ ] **Provenance is established but not consumed.** `asserted` / `resolved` /
      `delegated` are recorded and distinguishable at the point of decision, and
      no policy rule yet behaves differently on them. Wiring provenance into a
      trust decision needs B-05's answer to who is allowed to assert what.
- [ ] **An approval is bound to a (job, task) pair, not to what was approved.**
      `ApprovalRule`'s lookup is keyed on both, and both must name a real gate in
      the one registry — which is what stops the PHASE 10 cross-job bypass. It
      does not stop a *replay*: a caller holding a `SecurityContext` directly can
      name another job's approved pair. The pre-existing PHASE 07 gate has the
      same property (`mayRelease` has never looked at content), so the class is
      not new. This is the PHASE 04 content-hash item below, and B-05 question 3.

---

## PHASE 04 — Approval / Execution Boundary

Phase 03, second pass, closed B-10. What remained here was the part that was never a
wiring problem: what an approval is *bound to*, and *who* may give one.

- [x] One approval authority, reachable and answerable end to end.
      → **True since Phase 03, second pass**: `governance.approvalRequired` opens a
      gate on the one `ApprovalRegistry`, a human decides through
      `coordinator.decideApproval`, and the recorded decision is observed back by
      `ApprovalRule`. `describe().approvalAuthority` states which authority it is,
      and a test asserts `approvals.all().length === 1`.
- [x] Make the authority **forgery-proof** in the remaining respect: an approval
      was bound to a (job, task) pair, not to the material approved.
      → **CLOSED IN PHASE 04.** `ApprovalGate.binding` is a SHA-256 digest of the
      execution intent — objective, input, required capabilities, minimum trust —
      and `mayRelease` re-derives it on every release. Neither side is a value a
      caller supplies: `open` and `mayRelease` each derive from an intent, and
      `openApproval` takes no intent at all and reads the coordinator's own record.
      A caller holding a `SecurityContext` can still name another job's content; it
      can no longer make that content match. Capabilities are sorted, because the
      requirement is a set and a reordering is not a change of material.
      **B-05 question 3 is answered; question 2 is not.**
- [x] Bind approval to a **content hash** of what is being approved, so an
      approval cannot be replayed against changed material.
      → **CLOSED IN PHASE 04**, and the digest is stored on the record rather than
      only checked, so a decided gate names its material and an auditor needs to
      re-derive nothing. M3–M5 in the Phase 04 battery remove the sort, the
      objective and the input in turn, so each field is provably load-bearing.
- [ ] Bind approval to a **durable** record.
      → **PORT LANDED IN PHASE 04; the provider is still Phase 12.**
      `ApprovalRecordStore` is a five-member port, `InProcessApprovalRecordStore` is
      the only implementation and declares `durability: "process-local"`, and
      `describe().approvalDurability` reads that value from the store rather than
      from a constant. Losing a gate on restart fails **closed** — the task is held
      again — which is the right direction and is still not durability. B-02 is
      open, and `package.json` still has zero runtime dependencies. No provider was
      invented to satisfy a phase that is not this one.
- [x] Enumerate the human-approval-required operations from the brief:
      publishing, ad spend, money, sending proposals, irreversible external
      change, binding acts, privilege escalation. Map each to an `Operation` in
      `governance/operations.ts` and an `ApprovalRule` entry.
      → **MAPPED IN PHASE 04**, six categories onto seven real operations
      (`HUMAN_APPROVAL_CATEGORIES` / `HUMAN_APPROVAL_OPERATIONS`), beside the two
      existing classifications, with the catalogue-drift test now covering all
      three. `workflow.cancel` and `approval.request` are deliberately **false**:
      demanding a human in order to stop work, or in order to ask a human, is
      perverse rather than safe.
      → **The remaining half is a naming decision, not an architecture one**, and
      it is *policy*, so it was escalated rather than taken:
      `governance.approvalRequired` is still the only switch, the shipped default
      is still `["approval.resolve", "admin.configure"]`, and the gap is now a
      number a reader can see — `classified as needing one 7, configured to need
      one 2` — rather than a fact nobody can check. **Decide which of the seven a
      deployment must require (B-07-shaped).**
- [x] Decide who re-drives a released approval.
      → **CALLER-OWNED, and now detectable.** `ExecutionCoordinator.redriveRequired`
      reports tasks holding an approved gate in state `ready`;
      `describe().approvalRedrive` states `"caller-owned"`. Nothing schedules
      anything — no `setInterval`, no `setImmediate`, no `node:timers` in the
      workflow layer, and a test says so. (The pre-existing `setTimeout` is the
      per-task **timeout**: a bound on work already in flight, not a schedule.)
      The
      reason the phase owes a *signal* even though it adds no runner: before this, a
      decision that made a task runnable produced no observable event at all, so a
      service that forgot to re-drive could not tell that from a slow system.
      **Still open: whether a production service gets a runner.** An auto-runner is
      an unbounded loop next to a human decision and needs Phase 12's recovery
      semantics to be right first; it is Phase 12, not Phase 04.
- [x] `authoriseExecution` (`workflow/worker.ts`) is exported, unit-tested and
      **called by nothing** (confirmed `FINAL_ARCHITECTURE.md` §24.15). Either
      wire it or remove it. Do not leave a specification masquerading as an
      enforcement point.
      → **REMOVED, not wired.** Wiring meant either duplicating `executeTask`'s
      checks — which its own docblock warned would drift, naming the outcome "the
      authoritative one will be the untested one" — or reversing the PHASE 01 (C-3)
      order so a claim is taken before approval is consulted, which would let a
      gate-blocked task consume and release a claim on every attempt. The five
      specification tests now assert the same four conditions through
      `ExecutionCoordinator`, plus a positive control so a refusal cannot be a
      blanket refusal. A source scan over `src/` keeps it gone, with comments
      stripped: the removal is documented in a docblock that has to name what it
      removed, and a docblock is not an enforcement point.
- [x] Keep the tool boundary from becoming a second approval authority.
      → **NOT LIVE, AND NOW ASSERTED.** `authorizeToolCall` refuses a side-effecting
      tool and offers **no way to obtain that approval** — B-10's shape in a second
      subsystem. Nothing calls `ToolExecutionHost.invoke`, and a test now keeps it
      that way. Recorded as **B-13, MEDIUM, Phase 05** rather than fixed, because
      completing it means wiring the tool host into the orchestrator, and doing it
      to a path nothing reaches would be untested code. It fails closed by
      **accident**, which in an incident reads exactly like a system that works.
      The second half is a tool decision rather than an approval one: both inputs
      are caller-asserted, so a tool that really does publish and is registered
      `sideEffecting: false` is never gated.

---

## PHASE 05 - Provider / Tool Boundary

All five items closed or decided. One was not the real problem: reading the tool
boundary end to end found a **security defect on the live execution path** that no
item on this list described.

- [x] Close the `applyRoutingRestriction` remaining surface: confirm every
      routing entry point (select, plan, fallback, direct `DefaultRouter` use)
      honours governance.
      → **CLOSED.** Both `authority.ts` entry points pass `denied`, and
      `ModelRouter` passes the exclusion to `select()` and `plan()`. `new
      DefaultRouter` / `new FallbackPlanner` appear in exactly two files, both
      composition, asserted. Governance constructs neither, asserted.
- [x] `ToolExecutionHost` holds no `TraceRecorder` and is not wired into the
      orchestrator, so **no tool call appears in any orchestration trace** and
      all four `tool_*` event kinds are never emitted. Wire it or drop the
      kinds.
      → **WIRED.** The composition root hands the orchestrator the same host it
      exposes, and the orchestrator refuses a host over a different registry.
      `tool_invoked` and `tool_refused` are now emitted — from **verified facts**,
      not from a claimant's word. (Two of the four kinds are still unemitted:
      nothing performs a tool call yet, so there is no `tool_failed`. Recorded,
      not dropped.)
- [x] `AgentAdapter.describe` and `isAvailable` have **zero** callers in `src/`.
      Decide: call them, or remove them from the port.
      → **`isAvailable()` is now CALLED.** `runtime.probe()` asks every registered
      adapter and the boot check prints `unavailable (NOT available)` — replacing
      a line that printed the adapter's *name* where a reader reads an
      availability, which was correct only by coincidence.
      → **`describe()` is KEPT** as a library-contract method. The product composes
      no external adapter, so there is nothing to describe. Removing it from a
      public port would be an API break to fix a cosmetic problem; the phase's job
      was to stop it being invisible. Wiring it is PHASE 08's subject.
- [x] `AgencyAgentAdapter.describe()` is unreachable by construction: the
      ingest path never consumes a descriptor, so its roster is never populated.
      → **DECIDED: NOT COMPOSED.** Stronger than the item claimed — the adapter
      is never constructed in `src/` at all. Agency is a specialist/capability
      source; composing it would make it a second system authority.
      `describe().agencyAdapterComposed === false` and the boot check says so, so
      the absence is a decision rather than an oversight. **PHASE 08** decides
      whether it is ever wired.
- [x] Decide the MCP position honestly. `FINAL_ARCHITECTURE.md` §20 is correct
      that a stub shaped like MCP would be a fabricated capability. Keep it
      absent until a real client exists.
      → **KEPT ABSENT, and now stated.** No client, no transport, no dependency;
      `"mcp"` survives only as a `ToolKind` a future real client would register.
      The boot check prints `MCP client  none`, so a reader does not have to
      infer it from silence. Asserted three ways (no dependency, no `McpClient`
      in `src/`, kind present).

### The defect that was not on this list

`authority.ts` wrote an adapter's self-reported tool call into the run's evidence as
`{ toolId, durationMs: null, sideEffecting: false }` — **no authorisation check, and
the side-effect flag written in as a literal.** An irreversible action was recorded as
harmless, and an unauthorised one was recorded as having happened.

Now: the **one** tool authority decides. A tool the agent never declared, one that is
not registered, one above the agent's trust floor, or one that is side-effecting with
no approval is **refused**, produces **no evidence**, and **fails the subtask**.
`sideEffecting` comes from the registry. `durationMs` stays `null` because the host
measured nothing. 21 mutations, 0 survivors.

### B-13, half-closed — and the residue is a Phase 13 item

`authorizeToolCall` used to refuse a side-effecting tool with a requirement **nothing
could satisfy**. `ToolCallApproval` (`toolId`, `subject`, `approvedBy`, `approvedAt` —
all four load-bearing, each with a test) makes it obtainable, and the refusal now names
how to satisfy it.

**No flow issues one during an execution**, so an irreversible tool is refused and
`describe().toolApproval === "required-and-unobtained"`. Two things remain, and both
belong to the phase that makes tool calls real:

- [ ] **An agent cannot ask for a tool at all.** There is no tool-call channel in the
      agent protocol; an adapter can only *report* one after the fact. **PHASE 13.**
- [ ] **A `ToolCallApproval` is not content-bound.** Phase 04 bound a workflow approval
      to a SHA-256 of the intent. A tool approval is bound to a tool and a subject, so
      one approval covers any call of that tool by that subject. Binding it to the input
      that would be sent needs the call to exist. **PHASE 13.**
- [ ] **`ToolRecord.sideEffecting` is still a declaration.** The *evidence* now takes it
      from the registry, so the record cannot lie — but nothing independently confirms
      a tool really publishes. **PHASE 13.**

### B-09, closed

`orchestration.routing.defaultPolicy` ordered the **fallback chain only**; the primary
was hardcoded to a verified-facts scorer, and the most-read routing setting in the
product governed its second choice. `RoutingRequest.policy` now carries it to the one
router, `orderByPolicy` orders the primaries, and `RoutingDecision.ordering` reports
`decidingFacts` **and** `uninformedFacts` — so "routed by latency" is distinguishable
from "nothing has been measured". A policy orders; it cannot add eligibility.

Also fixed on the way: `DefaultRouter.select` **threw synchronously** out of a
promise-returning method, so a refused policy name was invisible to `.catch(...)`.

### Carried forward

- [ ] **Cooldown constrains the fallback chain only** — **MEDIUM.** A target that just
      failed is excluded from `plan()`, but a *fresh* primary request may still select
      it, because the cooldown registry lives on the planner and
      `RegistryCandidateSource` cannot see it. Not done, and not silently claimed as
      done: threading it in would either give `core/` a dependency it must not have, or
      reuse governance's `exclude` channel for a non-governance reason, conflating two
      narrowing authorities to save one field. **Phase 05/13 decision.**
- [ ] **The pool's `missing_tool` rejection does not name the tool.** An operator learns
      a declared tool is absent, not which one. The pool owns that message.
- [ ] **Tool authorisation is part of the operation map, not the switch.**
      `tool.invoke` is classified as needing a human (Phase 04), and the tool boundary
      now refuses an unapproved irreversible call — but the two are independent
      mechanisms. Wiring `governance.approvalRequired: ["tool.invoke"]` end to end is
      **Phase 13**.

---

## PHASE 06 — Workspace / Brand Isolation

**Highest structural risk in the project.** `FINAL_ARCHITECTURE.md` §23
classifies the system **D — unsafe for multi-tenant deployment**: unpartitioned
*and* undeclared. Phase 00 confirmed no `workspace_id`, `brand_id`,
`tenant`, `orgId` or `accountId` exists in `src/` — the only hits are
`knowledge/port.ts:5,21` (`readonly workspace: string | null`), a field nothing
reads.

- [x] Add a **verified** principal/workspace identity to `SecurityContext`,
      `MemorySubject`, `AuditEventBase` and `Job` — verified at construction,
      not inferred or free-form.
      **DONE.** `src/orchestration/workspace/workspace.ts` holds `WorkspaceRef`
      (validated, frozen) and `workspaceOf`, which accepts a workspace **only**
      from `provenance: "resolved"`. `asserted`, `delegated`, absent and
      hand-rolled shapes are all refused — and refused *even when they name a
      valid workspace*, because a caller that states where it is has stated
      nothing about where it is allowed to be.
- [x] Repartition the nine flat registries, or compose per-workspace instances
      at the boundary. `core/composition.ts` is the natural seam and Phase 02
      will have just made it real.
      **DONE, by both.** Customer-data stores are partitioned *and* composed
      per-workspace. Five registries stay deployment-scoped **by the user's
      decision** (`providers`, `models`, `capabilities`, `verifiers`,
      `providerAdapters`), with four derived-telemetry entries alongside;
      `describe().platformScopedRegistries` lists each with what it holds and a
      required `customerData: false`, and a test proves no customer-data registry
      is in that list.
- [x] `SecurityContext.policyContext` is explicitly non-authoritative — a
      workspace id parked there is ignored by design. Do not use it.
      **CONFIRMED and still true.** `workspaceOf` reads `context.workspace` and
      has no path to `policyContext`.
- [ ] `MemoryScope` is a closed 11-value enum with no tenant member. Five scopes
      (`system`, `organization`, `global`, `pattern`, `provider`) are
      cross-tenant by construction. A closed enum cannot express tenancy.
      **DELIBERATELY NOT DONE, and this is the important entry in this section.**
      Tenancy is carried **beside** the scope, never inside it — a subject and a
      store are workspace-scoped, so all eleven scopes are partitioned equally and
      `global` means *wide within one workspace*, not *readable by everyone*. The
      closed enum survives, so an invalid scope remains a type error. The
      alternative — a `(scope, workspaceId)` pair or an open string — was a
      breaking type change bought for nothing. Breadth semantics remain
      **PHASE 07**; see the two defects pinned there.
- [x] `MemoryAccessPolicy` keys grants by **bare subject id**, and the subject
      id is derived from a **caller-supplied `taskId`**
      (`MemorySubject = { id: string }`). Presenting another task's id yields
      that task's grants. This is an identity-confusion bug independent of
      tenancy. Fix before, not with, partitioning.
      **DONE, and it was worse than described.** No key derived from a `taskId`
      at all — the memory authority derives its subject from the **verified
      actor**, and `MemorySubject` now carries a workspace. The same subject id
      in two workspaces does not share a grant, and two brands of one workspace
      do not either. The PHASE 05 fixture that granted memory to `task:task-1`
      *was* this bug written down; it now grants the resolved actor, and a new
      test asserts a caller-chosen `taskId` reaches nothing.
- [x] `MemoryAccessPolicy.grant()` overwrites per subject
      (`memory.ts:173-175`) — last write wins, grants do not accumulate. Decide
      if that is intended.
      **DONE.** Intended, and now **visible**: `grant()` returns `{ replaced }`.
      A caller that unknowingly replaced an existing grant was previously unable
      to tell. `revoke()` now requires the subject, so a revoke cannot leak
      across one.
- [x] Give `AuditSink.read()` a filter, or partition the log. It currently takes
      no filter and every caller reads the whole buffer.
      **DONE.** `read(scope)` is **mandatory** on the interface and filters on
      both workspace and brand; the sink stamps every event from the workspace it
      was constructed with. Two PHASE 02 tests that read the whole buffer were
      migrated to a scope, and their helper's scope became a required argument
      precisely so they could not silently widen again.
- [x] Add a startup assertion: single-workspace, or fully partitioned. Never
      silent.
      **DONE.** `describe()` reports `workspaceIsolation: "unasserted"` or
      `"partitioned"` and names the workspace and brand. A runtime that declares
      none composes **no** partitioned subsystem — it does not compose them and
      then serve everyone, which is the failure this line exists to prevent.

### Defects found while doing the above, none of which were on this list

- **`N-1` was worse than "keyed by `taskId`".** Two `#transition` sites use a ternary,
  so a first rewrite missed them and they kept writing under the bare key.
- **`ToolRegistry.setStatus` read through the key function and wrote through the bare
  id** — typechecks, reads correctly, makes the record unreachable afterwards.
- **`ToolRegistry.ids()` returned raw Map keys**, so `SpecialistPool` matched
  requirements against prefixed strings.
- **`createJob`'s duplicate check used `has(input.jobId)`, unpartitioned**, so a second
  workspace's `createJob` would have **overwritten** the first's job.
- **`idempotencyKey` was a bare `${jobId}:${taskId}:${attempts}`** — unpartitioned, and
  ambiguous: job `a:b` + task `c` collides with job `a` + task `b:c`.
- **`StateStore` keyed by bare namespace**, so one workspace's `set` overwrote
  another's value *and* bumped its version — a cross-tenant write that looked like a
  normal concurrent update.
- **`InMemoryFeedbackStore`'s ring buffer was shared**, so a busy workspace evicted a
  quiet one's history and the evicted workspace's `droppedCount` stayed zero.
- **`createCore` built the queue, state store and audit log with no workspace**, so a
  declared runtime reported `"partitioned"` while the audit history it read was empty.
- **The execution id read the JOB's workspace, not the coordinator's**, so an
  unattributed job's executions landed in the unattributed partition *inside a
  coordinator that had declared one*.

### Left open, deliberately

- [ ] **SCALE — how many workspaces and brands in the next 12 months?**
      Undecided, and no architecture was invented from it. Consequence recorded:
      the implemented model composes **one store instance per workspace**, which is
      correct and unbounded in workspaces but costs one instance of each
      partitioned store per workspace. A decided scale could justify a
      shared-instance design with in-instance partitioning. **Do not refactor on an
      assumption.**
- [ ] **`displayName` on a model record is an unbounded free string.** Not metadata, and
      operator-supplied configuration like a provider's endpoint. Left alone rather
      than scoped in silently.
- [ ] **`OrchestrationEvent.step` carries the event KIND, not a step name.** The
      caller's own `step` lands in `metadata.step`. Found by the Phase 06 probe while
      writing it; pre-existing and outside this phase.

---

## PHASE 07 — Memory Architecture

**CLOSED IN PHASE 07.** Every item below is now either implemented and tested, or
explicitly deferred to a named later phase with a reason. See `PHASE_STATUS.md` for the
gate evidence.

The brief asked for four separations: system / workspace+brand / task+run / episodic
history. The mapping is now proven lossless across all eleven scopes, and the two
separation questions it conflated are answered separately rather than by one mechanism:

- **breadth** limits REACH — settled once, at grant time, by `withinBreadth`;
- **the composite key** limits POSSESSION — Phase 06, unchanged.

- [x] Map the four required separations onto `MemoryScope` and prove the mapping is
      lossless, or extend the enum honestly.
      **CLOSED.** The enum was extended honestly rather than remapped: eleven scopes,
      densely ranked 0..10, `SCOPE_BREADTH` **derived** from `MEMORY_SCOPES` in
      declaration order so the ordering has one source and no second copy to drift. Both
      Phase 06 defects are fixed and pinned:
        1. declaration order and breadth order now agree by construction;
        2. `importanceCeilingFor` normalises by `MAX_SCOPE_BREADTH`, so the 0.2 floor is
           reachable and tested at its boundary.
      `global` remains wide **within** a workspace and never readable across one — that
      is Phase 06's partition, and the two mechanisms are asserted to be independent.
- [x] `MemorySubject.trustLevel` is declared and never read.
      **CLOSED — enforced.** `MemoryGrant.minimumTrust` is now required and checked in
      `#isCurrent`, beside grant expiry, using the **existing** ranking in
      `agent/trust.ts` rather than a second one. An absent `trustLevel` reads as
      **`untrusted`**: the fail-open default would make omitting a field the most
      privileged thing a caller could do.
      `trustLevel` still comes from the deployment's verified security context, which the
      system trusts — **B-05 stays open** and the trust decision still depends on its
      answer to who may assert what.
- [ ] `MemorySubject.operatingScope` and `trustLevel` are ordinary fields, so a caller
      can construct a wider subject than production ever does.
      **OPEN — and it is a different claim from the one above.** Production has exactly one
      construction site (`TozOrchestrator.#memorySubject`, which takes no scope argument)
      and that is asserted from source by counting every `operatingScope:` in
      `authority.ts`. What is NOT closed is the type: closing it needs an opaque subject
      token minted by the identity layer, which is an interface change this phase did not
      make. Recorded rather than quietly claimed.
- [ ] Episodic history: `MEMORY_TYPES` already has `episodic`. Decide what distinguishes
      it from `semantic` in practice.
      **STILL OPEN — deferred, not overlooked.** The write policy now gives the two
      different treatment where it can: an `episodic` memory whose work **failed** is
      classified through `isRetryableSubtaskFailure` and a *transient* failure is given a
      7-day TTL rather than remembered as a lesson, while a permanent one keeps its weight.
      That is the practical distinction for the `failed` case. The general question — what
      makes a memory episodic rather than semantic — is a modelling decision and was not
      answered here.
- [ ] Durable memory backend. Currently zero `node:fs`/sqlite/db writes in `src/` and
      `package.json` has zero runtime dependencies. This is Phase 12 work; record the
      dependency decision in `BLOCKERS.md` B-02.
      **CONFIRMED, still Phase 12.** Unchanged and now stated in three places that agree:
      the scope semantics table (renamed from a durability claim), a test that asserts a
      fresh provider starts empty, and `runtime:describe`'s `durable state: false`.
- [x] Seven `MemoryService` methods are dead in `src/`: `correct`, `invalidate`,
      `markStale`, `metrics`, `learning`, `recallForAgent`, `queryFor`. Decide per
      method: wire or remove.
      **CLOSED with source evidence per method.** Six have 1–7 test callers each and are
      KEPT as the library contract (`correct` 7, `invalidate` 4, `queryFor` 4,
      `recallForAgent` 3, `markStale` 1, `metrics` 1). `learning()` had **zero**
      callers in `src/` and zero in tests and was REMOVED — a public accessor for an
      internal store that nobody can call is API surface a reader must still reason about.
      `#learning` is untouched: `learn()` writes it and `metrics()` counts it.
- [x] `MemoryStore.invalidate()` writes to the key map instead of the id map.
      **CLOSED — confirmed a real bug and fixed.** It typechecked and was invisible on every
      read path (`get`/`listScope` filter on status; `#findById` matches across VALUES),
      so it surfaced only in `historyFor(key)` and `size()`. The phantom's map key was
      the memory KEY, so it survived deletion of the original and collided with the next
      write at that address — each reuse of a key added one permanent entry. Now
      `set(next.id, next)`, with a mutation (`M4`) and a probe check holding it.
- [x] `RetrievalEngine`'s semantic path computes a `queryVector` and discards it.
      **CLOSED — declared-but-dead is now honestly declared-dead.** There is no vector
      index, so the strategy cannot run; a query vector alone matches nothing. The engine
      now returns `strategies: []` and names the missing capability in
      `unavailableReason`, and a test asserts the provider **was** consulted — so the
      honesty is not achieved by skipping the work. Actual semantic retrieval is
      **Phase 10** (Knowledge / RAG).
- [x] `DefaultWritePolicy` declares rules it can never push; `ephemeral_content` and
      `duplicate_of_recent` are unreachable; the `minimumImportance` doc says `0.3`
      against a code value of `0.35`; `importanceCeilingFor` was called nowhere.
      **CLOSED.** Both unreachable names REMOVED, with the reason each was not implemented
      here recorded beside them (`duplicate_of_recent` needs write history and
      `evaluate()` is stateless). The doc now matches the code. `importanceCeilingFor` is
      load-bearing: `DefaultWritePolicy` applies the per-scope ceiling after the floor and
      cites `importance_ceiling` **only when a clamp actually happened**.
      An independent probe check now proves every declared rule is reachable by evaluating
      one draft per rule, so a new fabricated name fails rather than accumulating.
- [x] Expiry was inconsistent across read paths: `get()` honoured `expiresAt`,
      `listScope()` did not, and `liveCount()` counted addresses rather than beliefs.
      **Not in the original list; found by the audit.** All three now agree, and the
      `includeExpired` opt-in is preserved for a caller that explicitly asks — including
      inside retrieval, which passes it through and lets the *query* decide rather than
      teaching the store about queries.

## PHASE 08 — Agent Architecture

**CLOSED IN PHASE 08.** Every item below is implemented and tested, or explicitly decided
against with a reason. See `PHASE_STATUS.md` for gate evidence and `DECISIONS.md` D-58..D-64
for the decisions.

The audit that preceded the work found the architecture itself **sound and accurately
described by `MASTER_PLAN.md` 5**: registry with an enforced lifecycle, a leaf-shaped adapter
port, deterministic two-stage selection, a reason for every selected and rejected candidate.
What needed work was the set of *claims* made about it, and seven defects that were in none of
the items below.

- [x] Add the 5 MVP agents, then the 5 production-core agents, per `MASTER_PLAN.md` §5.
      **DONE — as NINE, not ten, and the difference is the point.** Hermes is not an
      agent here: that role is held structurally by `TozOrchestrator`, which is not an
      `AgentRecord`. Registering it would put the single orchestration authority inside the
      agent registry, where a trust floor could reject it and an operator could disable it.
      See `DECISIONS.md` D-59. `src/orchestration/agent/catalogue.ts` declares the MVP four
      and the production core five; each registers `disabled` and unpromoted, names the
      honest `UnavailableAgentAdapter`, and keeps its memory reach inside what a
      task-scoped actor holds. A test asserts none of the nine is selectable, so the roster
      cannot be read as a working fleet.
      **Still open, and not closed by this:** no catalogue agent can *execute*. A real
      adapter is Phase 13.
- [x] Hermes Coordinator must be the **only** authority that sequences work.
      `authority.ts` already claims this; make it structural and tested.
      **DONE — after correcting the claim, because it was FALSE as written.**
      `ExecutionCoordinator` is a second, fully-enforced state machine that creates jobs,
      transitions tasks, opens gates, and whose `decideApproval` moves a task to `ready` or
      `skipped`. So the header''s "the only place a task advances through its lifecycle" was
      untrue, and untested besides.
      The corrected claim is narrower and exactly true: `TozOrchestrator` is **the
      agent-execution authority** — the only production site that selects an agent, invokes an
      adapter, or runs a subtask wave. `tests/agentAuthority.p08-evidence.test.js` asserts all
      three by counting call sites in `src/`, and asserts that no production component
      outside the coordinator drives a job, and that the coordinator states it does not
      re-drive itself. The two authorities are layered, not parallel.
- [x] Keep ingested external agents **disabled** by default
      (`agentsource/source.ts:275`, `ingest.ts:67-73`). Do not relax.
      **UNCHANGED AND RE-ASSERTED.** Ingestion still produces `status: "disabled"`, trust
      clamped to the source ceiling, and promotion gated on an explicit `promoteToAvailable`.
      The Phase 08 catalogue follows the same rule rather than inventing a different one for
      native agents.
- [x] Decide the composition of the two large files. `authority.ts` is 1,513
      lines and `coordinator.ts` is 1,357. `FINAL_ARCHITECTURE.md` §24.16 flags
      this. Split only along real seams, and only after Phase 01-02.
      **DECIDED: DO NOT SPLIT, and the reasoning is recorded rather than the work
      deferred silently.** Both files are large because each holds ONE cohesive state
      machine, and splitting by concern would put half of each machine in two files. The
      seams that exist are already seams: `#record`, `#fallbackAvailability`,
      `#recordReportedRoute` and `#verifyReportedTools` are stateless reporting helpers, and
      Phase 08 added one of those rather than growing the class body. The real risk is
      unbounded authority rather than length, and that is now measured — a future split that
      created a second entry point would fail a test, not pass a review. Full reasoning in
      `FINAL_ARCHITECTURE.md` §24.16. The files are now ~1,965 and ~1,800 lines.
- [x] Cleanups: `meetsTrustFloor` and `DEFAULT_TRUST_REQUIREMENT`
      (`agent/trust.ts`) are dead - `specialistPool.ts:144` inlines the
      comparison. `REJECTION_REASONS` lists 9 but `"unhealthy"` is never pushed
      (`pool/specialistPool.ts:138-140` pushes `agent_health_not_routable`).
      `agent.maxSelectedAgents: 4` in config is never plumbed into
      `PoolOptions.maximumSelectedAgents`.
      **THREE CLAIMS, THREE DIFFERENT ANSWERS — and the item was wrong about two of them.**
        - `meetsTrustFloor` is **NOT dead**. It has two `src/` callers today:
          `memory.ts:409` (Phase 07''s memory trust floor) and `governance/policy.ts:455`
          (`TrustFloorRule`). The inlining at `specialistPool.ts` is a third call site
          avoided, not evidence of disuse — and it is the only one of the three that does
          not use the helper, so the cleanup is still worth doing on consistency grounds
          rather than on reachability grounds.
        - `DEFAULT_TRUST_REQUIREMENT` and `AgentTrustRequirement` **were** dead, and are
          **REMOVED**. `requireFreshHealth` was unimplemented because no one has decided what
          counts as stale over what window (D-61 reasoning): implementable is not decided.
        - `"unhealthy"` was **unreachable**, not merely unused — there is no such
          `HealthStatus`. **REMOVED**; `unavailable` and `disabled` health are both already
          reported as `agent_health_not_routable`, so no report was lost.
        - `agent.maxSelectedAgents` **was already plumbed**, at `composition.ts`, since the
          composition root was first written. The TODO was stale.
      Two further items of the same shape were found by the audit and closed:
      `tools.grantUndeclaredTools` (a validated switch that read nothing — REMOVED, D-60)
      and `OrchestratorEvent.step` (pre-existing, still open, outside scope).
- [x] `authority.ts:823` — an agent with `requiresModelRoute: false` skips
      routing entirely. Confirm this cannot become an unmanaged egress path once
      a real adapter exists.
      **CONFIRMED, with one real gap found and closed.** The line number had moved; the
      logic is at `authority.ts:1205`. Governance **is** consulted on that path —
      `#authorizeSubtask` authorises `capability.execute` before the adapter is called, and
      `workflow.execute` ran earlier — so a self-hosted agent is not unmanaged.
      What was genuinely missing: the adapter''s own account of what it used was DISCARDED.
      `AgentExecutionResult` has always carried `providerId`/`modelId` and nothing in `src/`
      read them, so a self-hosted agent that reached a provider anyway was recorded as having
      used no provider. Now recorded as `agent_reported_route` — a claim, labelled as one,
      with a mismatch recorded when a routed agent reports something else (D-62).
      **Still open, and honestly so:** the *destination* an adapter reaches is still outside
      TOZ''s visibility, and there is no rule, operation or port method for "this agent may
      make an outbound call". A destination allowlist is **Phase 13**.

## Defects found by the Phase 08 audit that were not on this list

Recorded because the list is not the whole job — see `PHASE_STATUS.md` for the full set.

- [x] The configured trust policy reached neither place it belongs: `defaultMinimumTrust` fed
      the pool''s *maximum* guard, so the shipped default refused every task asking for
      `standard` or more, while the behaviour the field documents was hardcoded as `"low"` at
      three sites. `agent.maximumTrustFloor` added; the default is now wired to the orchestrator.
- [x] `"an agent in one workspace is not merely hidden from another"` is true but NOT
      observable through behaviour, because each registry instance already belongs to exactly
      one workspace and two instances never share a `Map`. Same class as Phase 06''s nine
      survivors; covered structurally instead, by mutation `S4`.

## PHASE 09 — Skill Architecture

Greenfield. **Nothing existed** (see `DECISIONS.md` D-09).

**CLOSED IN PHASE 09.** Every item below is implemented and tested. See `PHASE_STATUS.md` for
gate evidence and `DECISIONS.md` D-65..D-70 for the decisions.

- [x] Decide the skill contract: what a skill *is*, versus a capability, a tool
      and an agent. Do not retrofit onto `ToolRegistry`.
      **DECIDED, and the answer is a table (D-65).**

      | Concept | Cardinality | Can reach authority | Runs things |
      |---|---|---|---|
      | Capability | an atom (a name) | no | no |
      | Tool | ONE invokable call | YES | yes |
      | Agent | an executor | YES | yes |
      | **Skill** | a bundle of REQUIREMENTS | **no** | no |

      A skill is a validated, versioned bundle of requirements: the capabilities it needs, the
      tools it needs, and a summary a human can review before installing it. Loading it checks
      those requirements against a real caller and records the attempt. It shares no cardinality
      with a tool and no lifecycle with an agent, which is why it is a new file rather than a
      mode of `ToolRegistry` — the retrofit `D-09` forbade.
- [x] Single registry as the source of truth.
      **DONE.** `SkillRegistry`, composed once by the composition root and exposed as
      `runtime.skills`. A probe check counts the skill-shaped members on the runtime so a
      second registry — two answers to "which skills exist" — fails rather than passes review.
- [x] On-demand loading only. Never bulk-load per task.
      **DONE, structurally.** There is exactly one loading method and it takes one skill. No
      `loadAll`, `preload` or `loadForTask` exists, and the absence is asserted against the
      declaration: a `loadAll()` would satisfy every word of the requirement while violating it.
- [x] Validation before registration: a skill that fails validation must not be
      loadable.
      **DONE, and stronger than asked (D-67).** Validation happens at REGISTRATION and an
      invalid declaration is not stored at all. Validating at load time would leave a window in
      which an invalid skill exists in the registry and appears in `names()` — the window a
      reviewer would be inspecting. A duplicate `skillId`@`version` is refused rather than
      replacing, because a silent replace lets an installed skill change under a caller who
      already reviewed the old one.
- [x] Skills must not become a way to grant authority. A skill declares
      capabilities; it does not confer them.
      **DONE, structurally (D-66).** `SkillRegistry` has no method that grants, confers,
      elevates or widens anything. The capability check runs in ONE direction — the caller''s
      capabilities against the skill''s requirements — so loading can REFUSE and can never
      confer. The loaded handle echoes the requirements and carries no field that could be
      merged into anything.
      This is the third such rule in this repository (Phase 07''s absent-trust-means-`untrusted`,
      Phase 08''s executive port, and this one). Each time the enforcement had to be missing
      vocabulary rather than a documented intention.
- [x] Explicit loading path and an audit record for every load.
      **DONE (D-68).** One explicit path, `load(skillId, version, caller)`. Every ATTEMPT is
      recorded — success and refusal alike — with the refusal kind and the list of what was
      missing, because a log of successful loads is a log of what worked.
      The records go to the runtime''s audit trail under two distinct event kinds,
      `skill_loaded` and `skill_load_refused`, both declared AND emitted. `TODO.md` PHASE 11
      already records 15 orchestration kinds that are never emitted and calls that "a fabricated
      capability"; adding two more would have made this phase part of that problem rather than a
      correction of it.

**Still open, and deliberately:**

- A skill does not **execute**. It is a declaration plus an audited load; there is no runtime for
  it to run in, and inventing one would be the fabricated-capability shape D-53 and D-09 both
  exist to prevent. A workflow that actually runs skills is **PHASE 14**.
- The load log is **process-local**, like every store in this build. **Phase 12** — and it is
  why the records go to the partitioned audit trail rather than into the registry.
- The registry is **platform-scoped**: a declaration is deployment configuration, not customer
  data, so it joins `CapabilityRegistry` and `AdapterRegistry`. The ACTIVITY is partitioned.

## PHASE 10 - Knowledge / RAG Boundary

**CLOSED IN PHASE 10.** Three of the four items were already true and are now pinned; the
fourth was the work. See `PHASE_STATUS.md` for gate evidence and `DECISIONS.md` D-71..D-73.

- [x] `EmbeddingProvider` is a port with **no implementation**
      (`memory/retrieval.ts`). Keep it a port; do not ship a fake.
      **CONFIRMED AND NOW PINNED.** No class in `src/` implements it — not even an unavailable
      one, which is stricter than the Phase 05 `UnavailableAgentAdapter` precedent and
      deliberate: retrieval already reports the missing capability in
      `unavailableReason` on its own, so an unavailable embedding provider would be a second
      place saying so. A test scans `src/` for any `implements *Embedding*`, because "no fake
      ships" decays the moment someone adds one.
- [x] `IngestionService` / `StaticKnowledgeIngestor` /
      `UnreachableKnowledgeIngestor` are boundary-only, zero `src/` references.
      **CONFIRMED, with one correction to this item's wording.** The classes live in
      `memory/ingestion.ts`, **not** under `knowledge/` — this item did not say where, and a
      reader could reasonably have looked in the wrong place. They are tested, and the
      composition root constructs **none** of them, which is asserted: a runtime that quietly
      instantiates an ingestor has made a boundary an integration.
- [x] Decide the AnythingLLM / RAG relationship. `knowledge/port.ts` already
      names it as the intended counterpart. Keep it a port until real.
      **DECIDED, and the decision was not the one this item expected (D-71).** The port stays a
      port — AnythingLLM is **PHASE 13**'s external boundary, and D-10 moved n8n to 13 precisely
      to keep external dependencies behind a sound governance path.
      What the audit found instead is worse than "undecided": `KnowledgeProvider` was accepted
      by `createRuntime`, threaded all the way into `Core`, and **queried by nothing in
      `src/`**. Attaching a RAG backend changed nothing observable and `describe()` said
      nothing either way. An empty registry is empty; an *accepted* port is a promise.
      So the phase made the boundary honest rather than integrated: `describe().knowledge` is
      `"unattached"` or **`"attached-not-consulted"`**, the boot report prints it, and a test
      asserts no production file calls the provider. **Phase 13 changes that test, deliberately.**
      The port's own two claimed invariants — which nothing tested — are now asserted too.
- [x] Retrieval relevance must remain a **gate**, not a ranking nicety.
      **CONFIRMED, AND CORRECTED IN PLACE (D-72).** It is a gate — in
      `RetrievalScorer.score`, where a non-matching item is returned as `null`. **This item's
      wording points at the wrong place**: `RetrievalEngine.#passesFilters` has no score floor
      at all, and an audit reading only the filter would have "fixed" a correct system by adding
      a second gate — the defect D-51 removed from the access policy.
      Both halves are now asserted behaviourally: a query naming terms returns nothing for a
      non-matching memory however recent, important and verified it is; and an **empty** query
      still recalls, because a query with no terms makes no relevance claim.

**One claim in this phase could not be made to fail, and is recorded rather than papered over
(D-73).** `knowledge/port.ts` claims "the core never imports a concrete knowledge
implementation" — true by *absence of subject matter*, since no concrete implementation exists
to import. A mutation expressing a violation would need to create a file. The mutation was
removed; the test stays, and becomes falsifiable the moment a vendor module exists.

## PHASE 11 — Audit / Observability Hardening

Verified in Phase 00:

- [ ] `TraceRecorder.#events` stores **raw, un-redacted** metadata
      (`observability/trace.ts:148`) while the sink copy is redacted
      (`:156-170`). `events()`, `byTrace()`, `byTask()`, `byKind()` all read the
      un-redacted array. Redaction must apply on the way **in**.
- [ ] `TraceRecorder.#events` is unbounded — no `maxEvents`, no `droppedCount`,
      unlike `AuditLog` and `LearningEventStore`.
- [ ] `provider_health_changed` exists in **both** event vocabularies with
      different payload shapes (`audit/events.ts:28`,
      `observability/trace.ts:51`). A consumer switching on `kind` cannot
      disambiguate. Resolve the collision.
- [ ] 15 of 49 orchestration event kinds are never emitted anywhere in `src/`,
      including every `tool_*` kind, all four PHASE 06 routing kinds, and every
      background-worker milestone. Either emit them or delete them. Declared-but-
      never-emitted is a fabricated capability.
- [x] `adapter_invoked` **ADDED (Phase 11).** Verified: no event anywhere carried the
      adapter registry key, so the record said "agent X ran" without saying through which
      adapter. Emitted at the boundary only - not on the unregistered-adapter or
      capability-refusal paths, which are already `subtask_failed`. Payload:
      `{ agentId, adapter, attempt }`. `tests/adapterBoundary.p11-evidence.test.ts`
      counts events against the adapter's OWN call count, so a crossing that did not
      happen cannot pass.
- [x] `errorClass` claim **CORRECTED (Phase 11) - the doc claim was FALSE.**
      Re-verified by execution (4 real scenarios, 49 events): 5 events carry a non-null
      `errorClass` (`timeout`, `configuration_error`), supplied at 5 `#record` sites in
      `authority.ts`. `FINAL_ARCHITECTURE.md` §11 corrected.
      `durationMs` survives at exactly one site and IS still always null - measured cause:
      `authority.ts` guards the whole cost write on `inputTokens !== undefined ||
      outputTokens !== undefined`, so an adapter reporting a duration but no token counts
      never reaches `collector.cost`. Pinned by `tests/errorClassClaim.p11-evidence.test.ts`
      (with a control proving the guard is the mechanism). **Left open below.**
- [x] `traceId` **FIXED (Phase 11).** Claim was half stale: the coordinator sets
      `job.correlationId`, not `jobId`. But the conclusion held - `authority.ts` minted
      `newId("trace")` unconditionally and `worker.ts` ended in `void context;`, discarding
      the connecting context. `OrchestrationRequest.traceId` is now optional and ADOPTED;
      the worker forwards `context.traceId`. Minted only when the caller supplies none.
      `tests/traceBoundary.p11-evidence.test.ts` (4).
- [x] `jobId` **FIRST-CLASS FIELD (Phase 11).** Two producers wrote it two ways
      (`parentTaskId` in the per-task context, `metadata.jobId` in the workflow emitter),
      so no single field could answer the question. `OrchestrationBase.jobId` is derived at
      record time from either, and `byJob()` matches it. `coordinator.#event` also stopped
      writing `traceId: jobId`, which had put workflow events on a different trace from the
      orchestration events they caused.
- [x] `AuditSink.read()` **FILTERED (Phase 11).** Optional `AuditReadFilter`
      (`kind`, `since`) applied on top of the scope. Withdrawn while fixing it: the
      stronger claim that `byKind` "ignores scope entirely" and crosses tenants was FALSE -
      `AuditLog` takes its workspace in the constructor and stamps it on every append.
      `tests/auditReadFilter.p11-evidence.test.ts` (4).
      `sessionId` and `conversation` are redacted while a field like
      `secretariatName` would be too. Review the substring semantics.
- [ ] No tamper-evidence on the audit log. No persistent policy store, so a
      denial is evidenced only for the life of the process.

---

## PHASE 12 — Durable State & Recovery

`FINAL_ARCHITECTURE.md` §22: **~38 process-local stores.** A restart loses:

1. **Cancellation flags** — a cancelled job may execute again.
2. **Budget accounting** — measured spend resets, so an exhausted budget stops
   constraining.
3. **The idempotency ledger** — completed keys become re-runnable.
4. **Approval gates** — tasks requiring approval block forever, and a granted
   approval is indistinguishable from one never opened.
5. All job/task/workflow state.
6. All authorization history.

Items 1-3 **remove a safety stop** rather than merely losing history. They are
the reason this phase is not optional.

- [ ] Choose a persistence substrate. Zero runtime dependencies is currently a
      feature; this decision reverses it. See `BLOCKERS.md` B-02.
- [ ] Persist before, not after: cancellation, budget, idempotency, approvals.
- [ ] Make `cancelJob` actually abort in-flight work. `AbortController` is a
      local variable in `executeTask` and is registered nowhere; a cancelled task
      runs to completion against the provider and **incurs full cost** before its
      result is refused. The refusal is correct; the cost is not avoided.
- [ ] Reserve budget **before** dispatch. It is currently recomputed at release,
      so a wave can collectively exceed the ceiling.
- [ ] Idempotency ledger is bounded at 5,000 with oldest-first eviction, and
      drops are counted but not prevented — an evicted key that reappears
      re-executes. `#inFlight` is unbounded.
- [ ] "Parallel" waves execute sequentially (`runJob` awaits each task in turn).
      Either parallelise honestly or stop calling it parallel.
- [ ] `DELIVERY_SEMANTICS` says `scope: "single-process"`. Keep the claim and
      the code in agreement as multi-process support is added.

---

## PHASE 13 — External Tool Boundaries

Nothing here is a dependency yet, and nothing should be until this phase.

- [ ] n8n, Twenty CRM, AnythingLLM, Firecrawl, browser automation, Postiz,
      Pipecat — each as an **adapter behind a port**, none as a library
  dependency in the core.
- [ ] Each integration declares the `Operation`s it needs so governance can
      gate it without knowing the vendor.
- [ ] Anything side-effecting or outbound is approval-gated by Phase 04's
      operation map.
- [ ] Credentials referenced by `SecretRef` only, resolved at the adapter
      boundary. Never in records, state or audit.
- [ ] Per-integration failure isolation: an external outage must not read as
      "not applicable" and proceed.

---

## PHASE 14 — MVP Business Workflow

- [ ] One real end-to-end business workflow across the 5 MVP agents.
- [ ] Every irreversible step behind a durable, attributable human approval.
- [ ] Measured, not asserted: real cost, real latency, real failure modes.
- [ ] Honest documentation of what remains unproven.

---

## PHASE 15 — Production Hardening

- [ ] Load/concurrency behaviour under real contention, not a single process.
- [ ] Recovery drill: kill mid-job, restart, confirm no double-execution and no
      lost approval.
- [ ] Browser verification of the site (gap **K-11**, the previous project's
      own weakest point, still open).
- [ ] Re-run the full mutation battery over the governance path.

---

## PHASE 16 — Final Certification

- [ ] Every phase PASS with evidence.
- [ ] `FINAL_ARCHITECTURE.md` regenerated from the code, with every claim
      mutation-verified. The Phase 10 lesson: a claim that says "verified" must
      have been verified **end to end**, not at the function boundary.
- [ ] Non-guarantees restated and re-checked, not inherited.

---

## Cross-cutting

### [DOC] Documentation drift — fix early, cheap, and it is currently misleading

- [ ] `README.md:6` says "Current phase: PHASE 04.1". HEAD is post-PHASE 10.
- [ ] `package.json:6` description says "(PHASE 01)".
- [ ] `docs/FINAL_ARCHITECTURE.md:676` says 1,537 tests. Actual: 1,598.
- [ ] `PROJECT_STATE.md` §22.1 claims governance is "**enforced** on the
      execution path". C-1..C-4 contradict this. Must be corrected before it
      misleads anyone into deploying.
- [ ] `ARCHITECTURE.md` claims unknown keys inside a section are reported. True
      only for `orchestration.*`; `src/config/validate.ts` accepts unknown
      sections silently.
- [ ] `FINAL_ARCHITECTURE.md` §24 "16 limitations" — should read "16 **known**
      limitations"; C-1..C-4 are not in the list.
- [ ] `FINAL_ARCHITECTURE.md` §11 "errorClass and durationMs ... never supplied
      by any of the four producers" — `errorClass` **is** supplied at 5 sites.
      Overstated.
- [ ] `FINAL_ARCHITECTURE.md` §26 "1,527 tests" vs §26 "1,537 passing" — the
      mutation was run at 1,527, the suite reported at 1,537. Both are historical
      but read as contradictory.

### [P00] Process improvements to adopt from Phase 01 onward

- [ ] Every security test must be **mutation-verified**: revert the fix, confirm
      the test fails. A test that passes with and without the protection is worse
      than no test.
      → **Phase 03, second pass, found the inverse case**: a mutation that had
      been silently not running (`HARNESS_ERROR`) while the summary counted it as
      a catch. A green harness is not the same as a proven harness, and both
      failure directions have to be reported.
- [ ] Prefer end-to-end assertions through the real object over assertions on a
      helper. D-03 is the worked example of this failing.
- [ ] **An independent probe must be validated by breaking the thing it checks.**
      49 green results are indistinguishable from 49 correct results. Phase 03's
      probe carries a `--selftest` that reverts 8 wiring decisions and requires the
      probe to fail on each; it detects 8/8, and it found three bugs in the probe
      itself, one of which had overstated a limitation. Adopt the mode for every
      subsequent probe.
- [ ] No claim of "verified" in a comment or doc without the command that
      verifies it.
- [ ] Fixtures must make the answer unambiguous. A test whose fixture cannot
      distinguish "the restriction worked" from "the router happened to prefer
      something else" is a test that will pass for the wrong reason.

## PHASE 11 - findings recorded but NOT fixed here

- [ ] **`durationMs` is discarded when an adapter reports a duration but no token
      counts.** `authority.ts` guards the whole cost write on
      `inputTokens !== undefined || outputTokens !== undefined`, so `collector.cost` is
      never reached and `evidence.cost.durationMs` stays null. Measured: an adapter
      reporting `durationMs: 42` with no token counts yields `null` on
      `provider_usage_recorded`; the same adapter WITH token counts yields 42. Belongs with
      the Phase 13 work that gives adapters real token accounting. Pinned by
      `tests/errorClassClaim.p11-evidence.test.ts`.
- [ ] **A run reports SUCCESS while its only subtask recorded `subtask_failed`.** Observed
      through the real composition root on both the no-eligible-agent and the
      adapter-not-registered paths: `orchestrator.execute` returns `ok: true`. Outside
      Phase 11 (which owns observability, not run semantics) and NOT fixed here, because
      changing what counts as a failure would alter what every existing caller treats as an
      error. Recorded rather than absorbed. `tests/adapterBoundary.p11-evidence.test.ts`
      deliberately asserts on events, not on `ok: false`, so it does not pin this behaviour
      either way.
- [ ] **`TraceRecorder.byJob` was promised in a comment that described an API which did
      not exist.** `coordinator.ts` said "`byTask(jobId)`'s sibling, `byJob`, added below".
      It is now a real method, so the comment became true - noted because the alternative
      (softening the comment) would have left the intent unimplemented.