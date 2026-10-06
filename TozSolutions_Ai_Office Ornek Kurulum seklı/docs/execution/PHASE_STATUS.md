# PHASE STATUS

> Single source of truth for phase state. A phase may only be marked PASS when
> every exit criterion below is satisfied and verified by execution.

---

## Summary

| Phase | Title | Status |
|---|---|---|
| 00 | Baseline / Discovery | **PASS** |
| 01 | Critical Security Fixes (C-1..C-4) | **PASS** |
| 02 | Composition Root for Orchestration | **PASS** |
| 03 | Governance & QA Separation | **PASS** |
| 04 | Approval / Execution Boundary | **PASS** |
| 05 | Provider / Tool Boundary | **PASS** |
| 06 | Workspace / Brand Isolation | **PASS** |
| 07 | Memory Architecture | **PASS** |
| 08 | Agent Architecture | **PASS** |
| 09 | Skill Architecture | **PASS** |
| 10 | Knowledge / RAG Boundary | **PASS** |
| 11 | Audit / Observability Hardening | NOT STARTED |
| 12 | Durable State & Recovery | NOT STARTED |
| 13 | External Tool Boundaries | NOT STARTED |
| 14 | MVP Business Workflow | NOT STARTED |
| 15 | Production Hardening | NOT STARTED |
| 16 | Final Certification | NOT STARTED |

Historical note: the previous project used PHASE 00-10 for different work. That
history lives in `PROJECT_STATE.md` and `docs/PHASE*.md` and is **not** this
plan. Do not read a "PHASE 07 PASS" in `PROJECT_STATE.md` as Phase 07 of this
plan.

---

## PHASE 00 — Baseline / Discovery

**Status: PASS**
**Date:** Phase 00
**Baseline commit:** `0898464`, branch `master`, working tree clean
**Rule observed:** read-only. No source file was created, modified, moved or
deleted. The only writes in this phase are the seven files in `docs/execution/`.

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Repository verified | PASS |
| 2 | Git state recorded (branch, tree, history) | PASS |
| 3 | Current architecture inspected | PASS |
| 4 | `PROJECT_STATE.md` inspected | PASS |
| 5 | `ARCHITECTURE.md` inspected | PASS |
| 6 | `README.md` inspected | PASS |
| 7 | `src/` inspected | PASS — 130 files |
| 8 | `tests/` inspected | PASS — 47 files |
| 9 | `scripts/` inspected | PASS — 3 files |
| 10 | `docs/` inspected | PASS — 13 files |
| 11 | Baseline executed (typecheck, lint, build, tests) | PASS — 1598/1598 |
| 12 | Prior critical findings verified | PASS — 4/4 CONFIRMED |
| 13 | Agent structure extracted | PASS |
| 14 | Skill structure extracted | PASS — **ABSENT** |
| 15 | Governance structure extracted | PASS |
| 16 | Memory structure extracted | PASS |
| 17 | Audit / logging structure extracted | PASS |
| 18 | Provider / tool structure extracted | PASS |
| 19 | Current vs. target compared | PASS — `DECISIONS.md` |
| 20 | KEEP/FIX/REFACTOR/ADD/REMOVE/DEFER analysis | PASS — `DECISIONS.md` §6 |
| 21 | Real TODO list for later phases produced | PASS — `TODO.md` |
| 22 | Blockers recorded | PASS — `BLOCKERS.md` |
| 23 | Decisions recorded | PASS — `DECISIONS.md` |
| 24 | Execution state files created | PASS — 7 files |

### Findings carried forward

- **4 live authorization defects**, each reproduced by execution against the
  built `dist/`: C-1 (denied provider list discarded), C-2 (executor can
  self-approve), C-3 (`approvalRequired` not enforced as a precondition),
  C-4 (empty capability list disables enforcement, two layers).
- **1 systemic anti-pattern** behind three of them: absent value treated as
  "nothing to enforce" rather than "nothing is permitted".
- **No composition root** for the orchestration layer. `TozOrchestrator` is
  never constructed in `src/`.
- **No skill subsystem** exists.
- **No `workspace_id` / `brand_id`** exists anywhere in `src/`.
- Baseline is green; the defects are insufficiency of tests, not test failures.

### Verification method used

Probes were written to `%TEMP%\opencode\` and run against `dist/`. The mutation
test was run against a **copy** of `dist/` in `%TEMP%`. The repository working
tree was clean before and after, confirmed with `git status --porcelain`.

---

## PHASE 01 — Critical Security Fixes

**Status: PASS**

Decisions applied: `DECISIONS.md` §5 (B-01..B-06).

Scope held to C-1, C-2, C-3, C-4. No refactor beyond what the four fixes
required, no new capability, no composition root.

### Method, in the required order

1. **Failing test first.** `tests/criticalSecurity.phase01.test.ts` was written
   against the defective behaviour. **11 of 15 failed** against unfixed `HEAD`;
   the 4 that passed were deliberate positive controls.
2. **Then the fix**, one defect at a time.
3. **Then mutation proof**, granular — each individual code change reverted
   separately, on throwaway copies of `dist/` outside the repository.
4. **Then regression**, plus an independent probe that shares no code with the
   test file.

### Results

| Gate | Result |
|---|---|
| Typecheck | **PASS** — 0 errors |
| Lint | **PASS** — 0 problems |
| Build (`tsc` + assets) | **PASS** |
| Tests | **PASS — 1614/1614**, 244 suites, 0 skipped, 0 todo, 0 cancelled |
| Clean rebuild (`npm run clean && npm test`) | **PASS** |
| New tests | **+17**, all in `tests/criticalSecurity.phase01.test.ts` |
| Mutation battery | **9/9 individual reverts CAUGHT**, control GREEN |
| Independent probe | **21/21 checks PASS** |

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | C-1 closed: a denied provider is not selectable with ≥2 eligible providers, denied one ranking first | PASS |
| 2 | C-1's fallback chain honours the same restriction | PASS |
| 3 | C-2 closed: self-approval refused without the caller supplying `workerId` | PASS |
| 4 | C-3 closed: `approvalRequired` blocks with no gate; absence never means permission | PASS |
| 5 | C-4 closed: an empty declared list no longer switches enforcement off | PASS |
| 6 | Each fix has a test that **fails** when it is reverted | PASS — 9/9, see below |
| 7 | `npm run validate` green, count strictly greater, each new test's purpose recorded | PASS |
| 8 | State files updated | PASS |

### Mutation matrix

Every individual change, reverted alone:

| ID | Defect | Reverted change | Verdict |
|---|---|---|---|
| M1a | C-1 | `DefaultRouter` stops applying the caller's exclusion | CAUGHT (2 tests) |
| M1b | C-1 | `FallbackPlanner` stops applying the exclusion | CAUGHT (1 test) |
| M2a | C-2 | `assertDecidable` stops using the gate's own `taskId` | CAUGHT (1 test) |
| M2b | C-2 | coordinator stops deriving the worker from the live claim | CAUGHT (1 test) |
| M2c | C-2 | coordinator stops deriving the worker entirely | CAUGHT |
| M3a | C-3 | `mayRelease` stops blocking on a required-but-missing gate | CAUGHT (3 tests) |
| M3b | C-3 | `createJob` stops opening the declared gate | CAUGHT (1 test) |
| M3c | C-3 | `flattenWorkflow` stops carrying the declared question | CAUGHT (1 test) |
| M4a | C-4 | `authorizeSubtask` stops authorizing the agent's capabilities | CAUGHT (2 tests) |
| — | control | nothing | GREEN, 17/17 |

### Three things that went wrong during this phase, and what they produced

Recorded because each was a false-confidence trap, which is the failure mode
this whole phase exists to remove.

**1. A syntax error was initially scored as "mutation caught."** The first
mutation patch for C-3 produced a JavaScript `SyntaxError`, which `node --test`
reports as one file-level failure. A naive "did anything fail?" check read that
as a successful catch. It proved nothing. The probe was rewritten to classify a
load error separately and never count it as a catch. **D-03 reproduced itself in
a new form, two phases later.**

**2. One reversion SURVIVED, and the survivor was right.** The coordinator's
`taskId` derivation for `decideApproval` was proved not to be load-bearing —
removing it left every test green, because `assertDecidable` uses the gate's own
recorded `taskId`. Rather than keep a defence-in-depth line that no test could
distinguish, **it was deleted from the source** and the reason recorded in place.
Every line that remains is now demonstrably load-bearing.

**3. `npm run validate` runs tests against a STALE `dist/`.** The script is
`typecheck && lint && test:unit`, and `test:unit` is
`node --test "dist/tests/*.test.js"` — with **no build step**. One of my
verification runs reported green against a build that predated my latest source
edits. `npm test` does build; `validate` does not. This is a latent trap in the
project's own tooling and is now recorded as a TODO. It is the same shape of
error as the four defects: a check that appears to run against the code and
does not.

### Files changed (12 modified, 1 added)

```
src/routing/router.ts                              + CandidateExclusion, exclusion helpers
src/routing/defaultRouter.ts                       apply the exclusion where candidates enter
src/routing/fallback.ts                            apply the exclusion to the fallback chain
src/orchestration/governance/policy.ts             toCandidateExclusion (pure, type-only import)
src/orchestration/model/modelRouter.ts             HAND the exclusion to route() and plan()
src/orchestration/workflow/gates.ts                gate-derived taskId; mayRelease precondition
src/orchestration/workflow/coordinator.ts          derive worker from claim; auto-open gate
src/orchestration/workflow/model.ts                carry the declared question through flattening
src/orchestration/authority.ts                     correct the false security comment; pass denied to plan()
tests/criticalSecurity.phase01.test.ts             NEW — 17 tests
tests/workflow.jobscope.test.ts                    mayRelease arity
tests/workflow.model.test.ts                       mayRelease arity
```

### Residual limitations, stated rather than hidden

- **`decidedBy` is a self-asserted string.** C-2 refuses the *executor* from
  approving, because execution implies a live claim and the claim is
  coordinator-owned. But nothing authenticates the approver. That is B-05,
  deferred to Phase 04, and it is not closed by this phase.
- **An approval decided while no claim is live, by a party whose id coincides
  with a worker's id, is not refused.** There is no execution in flight in that
  state, so there is no self-approval to prevent. The Phase 00 probe labelled
  this a fail-open; on inspection its scenario held no claim, so the label was
  wrong. The corrected threat model is stated in the verification probe.
- **`Grant.capabilities: []` still means "no capability restriction."** Not a
  defect — a deliberate, coherent contract applied across grants. Escalated as
  **B-07** rather than changed unilaterally.

---

## PHASE 02 — Composition Root for Orchestration

**Status: PASS**

B-03 answered: **current state = library core, target state = AI Office product.**
Phase 02 therefore produced a **library composition root with a runnable entry
point** — a factory that assembles the real components, a `describe()` that reports
only measurements, a `bootstrapRuntime()` that reads the environment and refuses a
rejected configuration, and one read-only CLI that boots the runtime outside a test
harness. No transport, no persistence, no tenancy, no external integration.

### The finding that decided the phase's shape

Executed, not inferred: scanning all 149 `src/*.ts` files for `new X(` showed that
**every orchestration class was constructed nowhere.** `src/core/composition.ts`
was the only file that constructed anything at all beyond one `PolicyEngine`.
`TozOrchestrator` had never been built in `src/`. The only assembly of the
orchestration layer in existence was `tests/helpers/orchestrationHarness.ts`.

### A defect composing the system exposed — C-5

Composing the workflow path for the first time produced an immediate, real failure:
**a background task that required no verification could never complete.**
`VerificationRunner` answers `needs_review` for an empty required-kind list, the
orchestrator had already decided no verification was required, and it then handed
that verdict to every consumer. `OrchestratorTaskExecutor` reads a non-`pass`
verdict as "executed but unverified" and fails the task — while the same run driven
directly reported `succeeded` with a reason of "Completed with no verification
required". **The payload contradicted the sentence beside it.** Closed: a verdict is
reported only when a check was actually required, so `null` means "not measured" and
"no verification required" is distinguishable from "verification failed".

This is the strongest argument for the phase: a component that is never assembled
cannot fail, and four authorization defects lived in exactly that condition.

### Method, in the required order

1. **Failing test first.** `tests/compositionRoot.phase02.test.ts` written against
   the required behaviour. The decisive failure was
   `TS2307: Cannot find module '../src/orchestration/composition.js'` — the
   composition root did not exist.
2. **Then the implementation.**
3. **Then mutation proof**, 25 individual reverts, on throwaway copies of `dist/`.
4. **Then regression**, plus an independent probe sharing no code with the tests.

### Results

| Gate | Result |
|---|---|
| Typecheck | **PASS** — 0 errors |
| Lint | **PASS** — 0 problems |
| Build (`tsc` + assets) | **PASS** |
| Tests | **PASS — 1688/1688**, 256 suites, 0 skipped, 0 todo, 0 cancelled |
| Clean rebuild (`clean` + `test`) | **PASS** |
| New tests | **+74**, all in `tests/compositionRoot.phase02.test.ts` |
| Mutation battery | **25/25 individual reverts CAUGHT**, control GREEN, 0 survived |
| Independent probe | **20/20 checks PASS**, clean exit |
| Runtime boot (`npm run runtime:describe`) | **PASS** — exits 0, reports its own absences |

Test delta over Phase 01 is exactly **+74**, the new file. `git diff -- tests` shows
zero added or removed `it(`/`describe(` in any pre-existing file.

### The fail-closed contract, each entry mutation-verified

| Absent | What the runtime does |
|---|---|
| governance | **Installed by default.** `enforced: false` is the explicit opt-out, and it records itself as advisory in the one audit history. |
| identity resolver | Every run is refused. No actor is ever guessed. |
| service identity | The background workflow path is refused. |
| agent backend | `UnavailableAgentAdapter`, which answers with a classified `configuration_error`. |
| provider adapter | A provider-backed run fails rather than claiming a provider served it. |
| memory backend (disabled) | `DisabledMemoryProvider` — grants nothing, rather than being unconfigured and therefore empty. |
| recall scopes | Empty by default = **no recall**, never "everything readable". |
| ingestion promotion | Off unless configured. Promotion is a trust decision. |
| config issue | `bootstrapRuntime` refuses and names every offending field. |

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Every subsystem Phase 00 recorded as absent is reachable from one place | PASS — 28 subsystems asserted |
| 2 | The real `TozOrchestrator` is constructed in `src/` | PASS |
| 3 | `ExecutionCoordinator` → `OrchestratorTaskExecutor` → `TozOrchestrator` runs a real job through a real agent backend | PASS |
| 4 | Governance is on the execution path **by default** | PASS — 4 tests fail without it |
| 5 | One policy engine, one gate, one recorder, one audit history | PASS |
| 6 | The twelve previously inert orchestration config sections are read | PASS — 8 asserted end to end |
| 7 | A runtime can be started outside the test harness | PASS — `npm run runtime:describe` |
| 8 | `describe()` reports measurements, including its own absences | PASS |
| 9 | Exactly one file in `src/` may assemble the system | PASS — structural, enforced on every class in the list |
| 10 | No tenancy, persistence, network or external system added | PASS — source scan, comments stripped |
| 11 | Every mutation CAUGHT, none SURVIVED | PASS — 25/25 |
| 12 | Each fix has a test that fails when it is reverted | PASS |

### Residual limitations, stated rather than hidden

- **The runtime cannot execute anything yet.** With the shipped defaults it boots,
  reports that it has no identity resolver, no agent, no provider adapter and no
  durable state, and says so. That is the honest state, not a failure of the phase.
- **`OrchestratorExecutionPort` has no field for a caller.** A background task
  therefore cannot carry an identity of its own, and the runtime must declare the
  principal its worker acts as. This is an API gap, not a preference; it is B-05's
  natural home.
- **`orchestration.routing.defaultPolicy` orders the FALLBACK chain only.**
  `DefaultRouter` orders the primary selection with a verified-facts scorer that has
  no policy concept. Making primary selection policy-aware is a routing decision and
  is deferred to Phase 05. Both facts are reported by `describe()` so the setting
  cannot be read as governing routing as a whole.
- **`MemorySubject` is still derived from a caller-supplied `taskId`.** Unchanged
  and still a Phase 06 prerequisite (B-04).
- **`GovernanceGateOptions.engine` is now required.** One call site changed. A
  deliberate API break: the alternative was a runtime holding two policy engines,
  one of them authoritative for nothing.

### Six mutations survived the first battery, and what happened

M5, M6, M9, M14, M21 and M23 initially survived. In every case the wiring line was
genuinely load-bearing and the **test was insufficient**, so the tests were written
rather than the lines deleted — the opposite of Phase 01's outcome, where the
surviving line was redundant and was removed. Recorded because the difference is the
point: Phase 01 proved a survivor can mean "not load-bearing"; Phase 02 shows a
survivor can equally mean "not yet measured".

### Files changed

**Added (4)**

```
src/orchestration/composition.ts             the composition root
src/orchestration/cli/bootstrap-runtime.ts   read-only boot check
tests/compositionRoot.phase02.test.ts        NEW — 74 tests
scripts/mutation-phase02.mjs                 the mutation harness
```

**Modified (13)**

```
src/orchestration/authority.ts                  C-5: report a verdict only when a check ran
src/orchestration/governance/gate.ts            one engine, supplied not constructed
src/orchestration/model/modelRouter.ts         deployment policy reaches the fallback planner
src/orchestration/observability/trace.ts        + "runtime_started"
src/orchestration/tools/invoker.ts              + registry / defaultTimeoutMs getters
src/orchestration/workflow/coordinator.ts       + maxConcurrency getter
src/orchestration/index.ts                      export the composition root
src/core/composition.ts                         + clock, so one clock is provable
eslint.config.mjs                               entry-point console allowance
package.json                                    + runtime:describe
tests/governance.enforcement.test.ts            the one GovernanceGate call site
tests/workflow.jobscope.test.ts, workflow.model.test.ts   (Phase 01 carry-over)
```

---

## PHASE 03 — Governance & QA Separation

**Status: PASS**

B-08 resolved and B-05's mechanism closed together, because they are one
decision: the identity a background task runs AS is exactly the identity whose
work an approval would be accepting. Without a caller on the job nobody knows who
executed; without knowing who executed, the approver refusal has nothing to
compare `decidedBy` against.

**The phase's shape was set by an independent probe.** The first 19 mutation
reverts and 25 tests were green, and the probe — written from the claims, sharing
no code with the test file — still found **8 failures across 46 sub-checks**, three
of them caller-attestable holes in guarantees this phase had just asserted:

- `createSecurityContext` accepted `provenance` as input, so a caller could build
  a context declaring itself `"resolved"`.
- `ApprovalRule` read `context.approvalState`, a field on the context being
  checked — so the only way to satisfy a configured approval was to assert that
  you had.
- `ApprovalRegistry.get/all` returned the live record, so flipping `state` on it
  released a task "granted by null".

All three were fixed, re-probed (44/49, no regressions), and added to the
mutation battery as M20–M23. The remaining 5 probe failures are B-10, B-11 and
B-12 — recorded rather than fixed, each failing closed.

### Method, in the required order

1. **Failing test first.** `tests/governanceQaSeparation.phase03.test.ts` written
   against the required behaviour. The evidence of failure was the compiler:
   exactly six genuine errors (`SecurityContext.provenance` ×3,
   `CreateJobInput.caller` / `Job.caller` ×3) after three harness-fixture bugs of
   my own were corrected — refusals arrive as a settled result, not `ok === false`;
   `delegate` refuses a parent that lacks the operation; a source scan must strip
   comments before it counts identifiers as code.
2. **Then the implementation.**
3. **Then mutation proof**, 23 individual reverts, on throwaway copies of `dist/`.
4. **Then regression**, plus an independent probe sharing no code with the tests,
   run twice — before and after the amendments.

### Results

| Gate | Result |
|---|---|
| Typecheck | **PASS** — 0 errors |
| Lint | **PASS** — 0 problems |
| Build (`tsc` + assets) | **PASS** |
| Tests | **PASS — 1718/1718**, 263 suites, 0 skipped, 0 todo, 0 cancelled |
| New tests | **+30**, all in `tests/governanceQaSeparation.phase03.test.ts` |
| Pre-existing test files touched | 2 — fixture corrections, **0 tests added or removed** (delta is exactly the new file) |
| Mutation battery | **23/23 individual reverts CAUGHT**, control GREEN, 0 survived, 0 load errors |
| Independent probe, first run | 38/46 — **8 FAILED** |
| Independent probe, after amendment | **44/49**, no regressions; 5 remaining = B-10, B-11, B-12 |
| Runtime boot (`npm run runtime:describe`) | **PASS** — exits 0, reports `approval` among its rules |

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | B-08 closed: a background task carries the identity it runs as | PASS |
| 2 | The runtime's identity resolver is consulted, and only when no context was supplied | PASS — `resolvedCalls` 1/0/0/0 |
| 3 | Identity is established **before** authorization | PASS — an unidentified refusal records **0** policy decisions |
| 4 | Provenance distinguishes asserted / resolved / delegated at the point of decision | PASS — and no caller can manufacture one |
| 5 | B-05's mechanism: the approver is derived from records, never asserted | PASS — caller, service principal and worker all refused; a stranger permitted |
| 6 | A forged `executedBy` cannot blank the derived parties | PASS — `executedBy: []` still refuses |
| 7 | An approved job actually completes | PASS — both directions: `needs_review` waits, `null` completes |
| 8 | A verification never releases an approval gate | PASS |
| 9 | Only `ApprovalRegistry.decide` moves a gate to a decided state | PASS — structural **and** behavioural (frozen records) |
| 10 | Governance is the sole approval policy authority; `ApprovalRule` constructed in the composition root only | PASS |
| 11 | Governance may not decide an approval; the coordinator may not authorize | PASS — both source-level, comments stripped |
| 12 | The workflow layer cannot reach anything in governance but the type | PASS — 0 `governance/` strings in all 8 emitted workflow files |
| 13 | TOZ remains the sole orchestrator; `authority.ts` imports no approval machinery | PASS |
| 14 | Every mutation CAUGHT, none SURVIVED | PASS — 23/23 |
| 15 | Each fix has a test that fails when it is reverted | PASS |
| 16 | The independent probe's findings were triaged, not dismissed | PASS — 3 fixed, 3 raised as blockers |

### Mutation matrix

Every individual change, reverted alone:

| ID | Decision | Reverted change | Verdict |
|---|---|---|---|
| M1 | resolver on the execution path | `establishRequestIdentity(...)` → `submitted` | CAUGHT (2) |
| M2 | a supplied context is never replaced | the `securityContext !== undefined` guard removed | CAUGHT (2) |
| M3 | root contexts are `asserted` | default provenance → `resolved` | CAUGHT (1) |
| M4 | delegation stamps `delegated` | `provenance: "delegated"` removed | CAUGHT (1) |
| M5 | `withProvenance` stamps | `Object.freeze({...context, provenance})` → `context` | CAUGHT (2) |
| M6 | composition stamps `resolved` | `withProvenance(resolved, "resolved")` → `resolved` | CAUGHT (2) |
| M7 | the job records its caller | `caller: input.caller ?? null` → `null` | CAUGHT (3) |
| M8 | the caller reaches the task request | the `securityContext` spread removed | CAUGHT (1) |
| M9 | the approver refuses the job's caller | its two `executedBy` entries removed | CAUGHT (2) |
| M10 | the approver refuses the service principal | its two `executedBy` entries removed | CAUGHT (1) |
| M11 | the service principal is wired | `servicePrincipal: serviceContext` removed | CAUGHT (1) |
| M12 | the bridge prefers the job's caller | `?? this.#serviceContext` → `this.#serviceContext` | CAUGHT (1) |
| M13 | the port forwards the identity | the `securityContext` spread removed | CAUGHT (1) |
| M14 | the approval rule is constructed | `new ApprovalRule(configured)` removed | CAUGHT (3) |
| M15 | configured operations are what it names | `approvalRequired.filter(isOperation)` → `[]` | CAUGHT (2) |
| M16 | config reaches `referenceGovernanceRules` | the second argument dropped | CAUGHT (2) |
| M17 | the verdict is recorded | `outcome.verificationVerdict ?? null` → `null` | CAUGHT (1) |
| M18 | `null` does not block completion | the `verdict !== null` term removed | CAUGHT (1) |
| M19 | the executor passes the verdict out | `verificationVerdict` → `null` | CAUGHT (1) |
| M20 | provenance is not caller-settable | `input.provenance ?? "asserted"` restored | CAUGHT (1) |
| M21 | the approval rule ignores a self-attested claim | the `approvalState` short-circuit restored | CAUGHT (1) |
| M22 | a gate is frozen before it is handed out | `Object.freeze` → `Object.assign` | CAUGHT (1) |
| M23 | a decided gate is frozen | `Object.freeze` → `Object.assign` | CAUGHT (1) |
| — | control | nothing | **GREEN, 1718/1718** |

### Two things that went wrong during this phase, and what they produced

**1. My own test suite was wrong about its own premise three times.** The
composition-root fixtures asserted that a request with no `securityContext` is
refused — which was true only because the resolver had no caller. Once B-08 gave
it one, those fixtures were asserting that a runtime which knows exactly who is
asking must still turn them away. Each was corrected by pointing it at a runtime
whose identity source genuinely answers `null`, so the *guarantee* is unchanged
and the *premise* is now honest, plus one new positive control: a job with no
caller running under a resolved identity. Changing a failing test is only
defensible when the test was measuring the defect; that is recorded here so the
change cannot be read as a weakening.

**2. The mutation harness contradicted its own summary.** M1–M19 printed
`CAUGHT 19/19, SURVIVED 0, NOT-A-CATCH 1: CONTROL=GREEN` and exited 2: the
unclassified-results filter matched on the literal `"CONTROL"` while the control's
verdict is `"GREEN"`, so the control counted against itself. The Phase 02 script
had the same latent bug, unnoticed. Both fixed (D-28) — a harness whose summary is
wrong about its own result is precisely what this method exists to catch.

### Files changed

**Added (2)**

```
tests/governanceQaSeparation.phase03.test.ts    NEW — 30 tests
scripts/mutation-phase03.mjs                    the mutation harness
```

**Modified (13)**

```
src/orchestration/governance/context.ts          IdentityProvenance, withProvenance, provenance not an input
src/orchestration/governance/index.ts            export the above
src/orchestration/governance/gate.ts             + OrchestratorGovernancePort.resolve
src/orchestration/governance/enforcement.ts      + establishRequestIdentity; B-10 honesty note
src/orchestration/governance/policy.ts           ApprovalRule no longer trusts context.approvalState
src/orchestration/authority.ts                   establish identity once, before every enforcement check
src/orchestration/composition.ts                 resolveContext stamping, ApprovalRule wiring, servicePrincipal, caller-first bridge
src/orchestration/workflow/model.ts              + Job.caller (type-only governance import)
src/orchestration/workflow/coordinator.ts        caller handling, #servicePrincipal, executedBy derivation, #verdicts, settle rule
src/orchestration/workflow/gates.ts              executedBy on assertDecidable/decide; frozen gate records
src/orchestration/workflow/worker.ts             + securityContext on the port; verdict passed through
tests/compositionRoot.phase02.test.ts            fixture corrections (see above) + "approval" in ruleNames
tests/workflow.execution.test.ts                 port() now reports the verdict it declared
.gitignore                                       + .mutation-*
```

### Residual limitations, stated rather than hidden

- **A governance-configured approval cannot be satisfied. B-10.** `ApprovalRule`
  now always requires approval for a configured operation and nothing can waive
  it: `bridgeApproval` has no call sites, no gate is opened, and a genuine
  approval never feeds back. The setting therefore fails every job that uses it,
  closed rather than open. This is Phase 04's core problem.
- **`needs_review` has no escalation path. B-11.** QA and approval are correctly
  unable to produce each other's answer, which makes the handoff between them
  undefined. The related TODO item — "QA needs an evidence channel that is not the
  executor's self-report" — was **not attempted**; what "independent" means is a
  design decision.
- **`decidedBy` is still a self-asserted string.** What changed is that the
  identities a decision may not come from are now derived from records. *Whose*
  string counts as an approval, and how that person is evidenced, is B-05 and
  remains open for Phase 04.
- **`settle()` throws when already `waiting`; a missing verifier reports
  `errorClass: "unknown"`. B-12.** Robustness, not security; recorded rather than
  fixed mid-phase.
- **`approvalState` remains caller-writable and is read by nothing.** Kept
  because a delegated context must be shown *not* to inherit it, which is only
  testable from an approved parent. Documented as non-authoritative at the input;
  any future rule that reads it reintroduces D-23's hole.
- **The workflow layer imports one governance file.** Type-only, erased at emit,
  and enforced on the emitted JavaScript rather than on the import statement —
  because an import statement is a convention and emitted code is a fact.

---

## PHASE 03, SECOND PASS - a configured approval is answerable

**Status: PASS**

**What changed.** B-10 and nothing else. The three findings behind it — C7.3a
(a configured approval was unsatisfiable), C7.3c (a resolution never fed back
into governance) and C7.4b (`bridgeApproval` had no real call site) — were one
defect: the governance verdict and the approval registry had never met, and the
composition root is the only place in `src/` that can see both.

The flow the brief requires now exists end to end, and each step is enforced by
the authority that owns it:

| Step | Who decides | Proof |
|---|---|---|
| `REQUIRE_APPROVAL` | `ApprovalRule`, from configuration | a configured operation is refused, not permitted |
| a gate is opened | the PHASE 07 `ApprovalRegistry` the coordinator owns | `approvals.all().length === 1`; exactly one authority |
| a human decides | `coordinator.decideApproval` | the job's caller, the service principal and the live claim's worker are all refused |
| the decision is observed | `ApprovalRule` through a read-only `ApprovalGateObserver` | exactly one `REQUIRE_APPROVAL` and one `ALLOW` for `workflow.execute` across the run |
| execution continues | the release path, on every release | the job completes and the backend ran once |

`ApprovalRule` remains fail-closed and never reads `approvalState`: it requires an
observer, a job, a task, a real gate for that job and task, `approved`, a named
decider and a timestamp. Anything absent is `REQUIRE_APPROVAL`. QA is untouched
and still cannot approve or be approved by.

### Results

| Gate | Result |
|---|---|
| Typecheck | **PASS** - 0 errors |
| Lint | **PASS** - 0 problems |
| Build (`tsc` + assets) | **PASS** |
| Clean rebuild | **PASS** |
| Tests | **PASS - 1729/1729**, 264 suites, 0 skipped, 0 todo, 0 cancelled |
| New tests | **+11**, all in `tests/governanceQaSeparation.phase03.test.ts` |
| Pre-existing test files touched | **0** |
| Mutation battery, Phase 03 | **34/34 individual reverts CAUGHT**, control GREEN, 0 survived, 0 load errors |
| Mutation battery, Phase 02 | **25/25 CAUGHT** - two stale anchors re-pointed, one re-scoped |
| Independent probe | **49/49 PASS** |
| Probe self-test (false-positive check) | **8/8 reverts detected**, 0 false positives |
| Architecture / isolation checks | **PASS** - 208 tests across the six isolation and architecture files |
| `npm run runtime:describe` | **PASS** - exits 0, reports `configured approvals  answerable` |
| `npm run config:validate` | **PASS** |

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | C7.3a: a governance-configured approval can be satisfied | PASS - a human decision releases the task and the job completes |
| 2 | C7.3c: the resolution feeds back into governance | PASS - exactly one `REQUIRE_APPROVAL`, then one `ALLOW`, for the same task |
| 3 | C7.4b: `bridgeApproval` has exactly one real call site | PASS - source scan, and it is the composition root |
| 4 | Exactly one approval authority; no second gate record | PASS - `approvals.all().length === 1` |
| 5 | Governance still cannot DECIDE an approval | PASS - the observer has no `open` / `decide` / `expire` verb; the gate port has no `decide` |
| 6 | `ApprovalRule` remains fail-closed | PASS - eight independent preconditions, each a mutation |
| 7 | `ApprovalRule` never trusts caller-supplied `approvalState` | PASS - behavioural, plus a source scan of `governance/` |
| 8 | The decision bridged is the one governance actually recorded | PASS - M33 |
| 9 | The approval lookup is bound to the job, not the task name | PASS - two jobs, one approved, one still held |
| 10 | The executor cannot approve the gate governance opened | PASS - caller and service principal both refused |
| 11 | A rejected gate does not release the work | PASS |
| 12 | An undecided gate HOLDS the task rather than failing it | PASS - `waiting_approval`, `failure: null`, attempt not consumed |
| 13 | QA remains separate from approval | PASS - unchanged, and re-asserted |
| 14 | The workflow layer's import surface is unchanged | PASS - 0 `governance/` strings in all 8 emitted files |
| 15 | Every mutation CAUGHT, none SURVIVED, none a harness error | PASS - 34/34 and 25/25 |
| 16 | The probe was inspected for false positives and false negatives | PASS - 8/8 reverts detected; three probe bugs found and fixed |
| 17 | C6.6 / C6.7 fixed only where directly coupled | PASS - neither is; both re-assessed and recorded as LOW limitations |
| 18 | Jarvis not implemented | PASS - no reference anywhere in `src/` |

### Mutation matrix, second pass

| ID | Decision | Reverted change | Verdict |
|---|---|---|---|
| M24 | governance's `REQUIRE_APPROVAL` is bridged into a gate at all | the `approval_required` branch removed | CAUGHT (6) |
| M25 | a recorded approval answers a configured requirement | the rule always requires approval | CAUGHT (2) |
| M26 | the hold is read from the coordinator's OWN registry | the lookup replaced by `null` | CAUGHT (3) |
| M27 | only an UNDECIDED gate holds a task | `waiting` becomes `approved` | CAUGHT (3) |
| M28 | the rule's observer is bound to the one registry | `recordedApprovals.bind(...)` removed | CAUGHT (3) |
| M29 | the gate port is bound to the coordinator | `jobApprovalGates.bind(...)` removed | CAUGHT (7) |
| M30 | the identity reaching governance carries its job | `inJobScope(...)` bypassed | CAUGHT (6) |
| M31 | the job scope is actually stamped | `inJobScope` returns its input | CAUGHT (6) |
| M32 | the task port forwards the job | the `jobId` spread removed | CAUGHT (6) |
| M33 | the bridged decision is the one governance recorded | `approvalRequiringFor` never matches | CAUGHT (6) |
| M34 | the rule is given the observer at all | `new ApprovalRule(configured)` | CAUGHT (2) |

M12, M14, M16 and M21 were re-pointed at the lines that now carry their decisions
after the refactor; the properties they prove are unchanged.

### Residual limitations, second pass

- **An approval is bound to a (job, task) pair, not to a content hash.** A caller
  holding a `SecurityContext` directly could name another job's approved pair and
  be permitted. This is B-05 question 3 and the pre-existing PHASE 07 gate has the
  same property - `mayRelease` has never looked at content - so the class is not
  new. Recorded, not hidden.
- **`needs_review` still has no escalation target. B-11, now LOW.** Unchanged and
  reachable only where it was: through an approval-required task.
- **`settle()` still throws on an already-waiting job. B-12, LOW.** Reachable more
  often now, because a held task leaves its job `waiting` rather than `failed`.
  Recorded; the fix is a product answer about a public method's failure mode, not a
  coupled change.
- **A missing verifier is still classed `unknown`. B-12, LOW.** `unknown` is a
  class the default retry policy does not retry, so the behaviour is safe; the
  classification is uninformative to metrics. Adding a class is a change to a
  closed taxonomy shared with PHASE 06 routing.
- **A gate is resolved by the caller re-driving with `runJob`.** No auto-runner.
  Inventing a scheduler is a Phase 04 decision, and the contract is the one the
  PHASE 07 gate already had.
- **B-05 is untouched.** `decidedBy` is still a self-asserted string. What an
  approval is *bound to* is now a record; *whose* string counts is still open.

> **Superseded by PHASE 04.** The content half of the first bullet is closed: an
> approval is now bound to a SHA-256 digest of the execution intent, re-derived on
> every release, so naming another pair's content no longer helps a caller. B-05
> question 3 is answered; question 2 - whose string may approve - is unchanged.

---

## PHASE 04 - Approval / Execution Boundary

**Status: PASS**

**What changed.** Three things the brief asked for and one it implied.

1. **An approval is bound to what it approves.** `ApprovalGate.binding` is a SHA-256
   digest of objective, input, required capabilities and minimum trust. Both
   `ApprovalRegistry.open` and `ApprovalRegistry.mayRelease` take an *intent* and
   each derive the digest themselves; `openApproval` takes no intent at all and
   derives from the record the coordinator holds. There is no field through which a
   caller could assert that two contents match - the class of defect D-23 and D-30
   were about.
2. **The record has a container and an honest durability claim.**
   `ApprovalRecordStore` is a port, `InProcessApprovalRecordStore` is the only
   implementation and declares `durability: "process-local"`, and
   `describe().approvalDurability` reads that value from the store rather than from
   a constant. A real provider is Phase 12 work; B-02 is still open.
3. **The brief's six categories are mapped onto real operations** - seven
   operations, and a classification rather than a second switch, so
   `governance.approvalRequired` stays the only thing that demands a human. The gap
   between the two is now a number: `classified as needing one 7, configured to
   need one 2`.
4. **Re-drive is stated and made detectable.** `ExecutionCoordinator.redriveRequired`
   reports tasks holding an approved gate in state `ready`; nothing schedules
   anything, and the one `setTimeout` in the workflow layer is the pre-existing
   per-task timeout — a bound on work in flight, not a schedule. Before this, a
   decision that made a task runnable produced no signal at all.

And one deletion: `authoriseExecution` / `AuthorisedExecution` were exported,
documented as authoritative and called by **nothing**. They are removed, because
wiring them meant either duplicating `executeTask`'s checks or reversing the PHASE 01
(C-3) order so a claim is taken before approval is consulted. Their five
specification tests now assert the same four conditions through
`ExecutionCoordinator`, with a positive control so a refusal cannot be a blanket
refusal.

### Results

| Gate | Result |
|---|---|
| Typecheck | **PASS** - 0 errors |
| Lint | **PASS** - 0 problems |
| Build (`tsc` + assets) | **PASS** |
| Clean rebuild | **PASS** |
| Tests | **PASS - 1754/1754**, 268 suites, 0 skipped, 0 todo, 0 cancelled |
| New tests | **+30**, all in `tests/approvalExecutionBoundary.phase04.test.ts` (30 tests, 5 suites) |
| Pre-existing test files touched | **6**, all mechanically - new required `intent` arguments; no assertion weakened |
| Tests deleted | **5** (`authoriseExecution` specification tests) - replaced, not left green against dead code |
| Mutation battery, Phase 04 (new) | **21/21 individual reverts CAUGHT**, control GREEN, 0 survived, 0 load errors |
| Mutation battery, Phase 03 | **34/34 CAUGHT** |
| Mutation battery, Phase 02 | **25/25 CAUGHT** |
| Independent probe | **70/70 PASS** (49 from Phase 03, 21 new) |
| Probe self-test (false-positive check) | **16/16 reverts detected**, 0 false positives |
| Architecture / isolation checks | **PASS** - 238 tests across the seven architecture, isolation and phase files |
| `npm run runtime:describe` | **PASS** - exits 0, reports the re-drive owner, the record durability and the classification gap |
| `npm run config:validate` | **PASS** |
| Runtime dependencies | **0**, unchanged |

### Exit criteria

| Criterion | Verdict | Evidence |
|---|---|---|
| An approval is bound to the content it was granted for | **MET** | mismatch refused naming both digests; each digest field removed in turn (M3-M5) |
| The binding cannot be forged by a caller | **MET** | no such field; `openApproval` takes no intent; caller holds the only object |
| The composed path cannot drift | **MET (structurally)** | `TaskRecord.task` is never patched after `createJob`; the guard is enforced at the authority, not the composition path |
| The record is attributable | **MET** | the decided gate names its digest; no re-derivation needed to audit it |
| An approval record has a container that can be made durable | **MET** | 5-member port; registry reads and writes through it; durability read from the store |
| Durability is not overclaimed | **MET** | `process-local`; printed at boot; B-02 open |
| The brief's six categories map onto real operations | **MET** | 6 categories, 7 operations, every one satisfiable end to end (H15) |
| The map is not a second authority | **MET** | `ApprovalRule` reads no classification; config is the only switch; the gap is a printed number |
| Internal mechanics and safety actions are not gated | **MET** | `workflow.cancel`, `workflow.execute`, `approval.request` are FALSE, each with a stated reason |
| Re-drive ownership is stated | **MET** | `describe().approvalRedrive === "caller-owned"` |
| Nothing re-drives itself | **MET** | no setInterval / setImmediate / 
ode:timers in the workflow layer; asserted. The pre-existing setTimeout is the per-task timeout - a bound, not a schedule |
| A re-drive obligation is detectable | **MET** | `redriveRequired`; two non-redundant conditions, each independently provable (M12, M13) |
| No dead authority API remains | **MET** | source scan over `src/`; comments stripped, because a docblock is not an enforcement point |
| Exactly one approval authority | **MET** | one `ApprovalRegistry`, one store, one composed port factory |
| The tool boundary is not a second authority | **MET (as a boundary)** | `ToolExecutionHost` is called from nowhere; asserted, and the unsatisfiable approval it states is **B-13** |

### Residual limitations, Phase 04

- **The content guarantee is structural, not exercised.** A `TaskRecord.task` is
  never patched after `createJob`, so in the composed path the binding cannot drift
  today. The check is proved at the authority against a deliberate mismatch; what
  the change buys today is mostly **attributability**, and drift protection becomes
  live the moment anything can edit a task.
- **Approval records are lost on restart. B-02.** The failure direction is
  fail-closed - an approved gate becomes unknown and the task is held again - which
  is the right direction to fail in and is still not durability.
- **Who may approve is unchanged. B-05 question 2.** The binding says *what* was
  approved; `decidedBy` is still a self-asserted string. Question 3 is answered.
- **A caller holding a `SecurityContext` directly can still name another job's
  content.** It can no longer name different content and have it match, which
  reduces this to the honest statement: the pre-existing PHASE 07 gate has the same
  property, and the coordinator's own record remains the only place the authority
  reads from.
- **`needs_review` still has no escalation target. B-11, LOW.** Unchanged and still
  reachable only through the pre-existing `approval()` step.
- **`settle()` still throws on an already-waiting job, and a missing verifier is
  still `unknown`. B-12, LOW.** Re-verified this phase, unchanged. A held task
  leaves its job `waiting` rather than `failed`, so the first is now reachable more
  often.
- **The tool boundary states an approval it cannot satisfy. B-13, MEDIUM, new.**
  `authorizeToolCall` refuses a side-effecting tool and offers no way to obtain the
  approval - B-10's shape, in a second subsystem. Not live: `ToolExecutionHost` is
  called from nowhere, and a test keeps it that way. It fails closed by accident
  rather than by design the day it is wired, which is why it is recorded as a
  blocker for Phase 05 rather than a note.
- **Two classification inputs are caller-asserted.** `TaskRecord.approvalRequired`
  and `ToolPermission.requiresApprovalForSideEffects` are declarations. For a task
  that is defensible, because the workflow author owns it; for a tool it is not,
  because nothing independently confirms a tool's effect. Phase 05 decision.
- **No auto-runner exists.** A decision that makes a task runnable is now visible,
  but re-driving is still the caller's job. Inventing a scheduler needs Phase 12's
  recovery semantics to be right first, and is recorded in `TODO.md` rather than
  taken here.
---

## PHASE 05 - Provider / Tool Boundary

**Status: PASS**

**What the phase was told to do, and what it actually found.** The `TODO.md` list was
five items, and all five are closed or decided. But the item that produced the real
work was not on that list: reading the tool boundary end to end turned up a
**security defect on the live execution path**.

### The defect

`authority.ts` turned an agent adapter's self-reported tool call into run evidence
like this:

```ts
for (const toolCall of execution.value.toolCalls ?? []) {
  collector.toolCall({ toolId: toolCall, durationMs: null, sideEffecting: false });
}
```

Three fields, three copies of the same mistake - a caller asserting a fact the system
owns:

1. **`sideEffecting: false` is a literal.** A tool registered `sideEffecting: true` is
   recorded as harmless. The one record that exists to say what a run did says the
   irreversible thing was not. The registry knew; the adapter's silence won.
2. **Nothing checked the call was ever allowed.** An adapter could name any tool -
   one the agent never declared, one the caller is denied, one requiring a higher
   trust floor - and the claim became evidence. This is "a caller-supplied field
   becomes authoritative because it claims a state", which this project forbids
   everywhere else.
3. **Nothing was traced.** All three `tool_*` event kinds existed and none could ever
   be emitted, because the only code path producing tool evidence emitted no event.

**Reachable through the library API** - `AgentExecutionResult.toolCalls` is a field
any deployment's adapter may populate. Same bar Phase 01 used.

### What replaced it

One method, in the one tool authority, and it is the only way a claim becomes
evidence:

| Claim | Old | New |
|---|---|---|
| tool the agent never declared | recorded | **refused** |
| tool not registered / retired / unavailable | recorded | **refused** |
| trust floor above the agent's | recorded | **refused** |
| side-effecting, no approval | recorded as harmless | **refused** |
| `sideEffecting` value | `false`, literal | the **registry's** value |
| `durationMs` | `null` | `null` (the host performed nothing, so it measured nothing) |
| no tool authority configured | recorded | **refused** |
| any refusal | none - a warning could not exist | **fails the subtask**, `configuration_error` |
| trace | none | `tool_invoked` / `tool_refused`, carrying the registry's fact |

`ToolExecutionHost.verifyReported` performs no call. Verification and execution stay
separate verbs, so checking a claim can never become performing it.

### B-09, closed: the configured policy governs the PRIMARY

`orchestration.routing.defaultPolicy` ordered the **fallback chain only**; the primary
was hardcoded to a verified-facts scorer and the selection reason said so in as many
words. A deployment's most-read routing setting governed its second choice.

`RoutingRequest.policy` now carries it to the one router, which orders the primaries
with the `orderByPolicy` engine that already existed and already explained itself.
`RoutingDecision.ordering` reports `decidingFacts` **and** `uninformedFacts`, so
"routed by latency" is distinguishable from "nothing has ever been measured, so it
ordered by capability instead". An unknown name **rejects the promise** - and that
required a fix, because `DefaultRouter.select` previously threw synchronously out of a
promise-returning method, so `select(...).catch(...)` saw nothing.

No policy named means `verified-facts`, unchanged, so no existing caller moves.
`evaluateCandidate` is untouched: a policy orders, it cannot add eligibility, and
governance's narrowing is still applied first.

### B-13, half-closed and honestly reported

`authorizeToolCall` used to refuse a side-effecting tool with a requirement **nothing
could satisfy** - a fail-closed setting that no input could ever meet, which is a
permanently closed door wearing a control's name. `ToolCallApproval` is now the
ordinary value the one approval authority issues, bound to a tool, a subject, a named
approver and an instant; all four are load-bearing and each has a test.

**The residual, stated rather than hidden:** no flow yet issues one during an
execution, because the approval authority is the coordinator's gate and a tool call
happens *inside* the execution that gate already approved. So the orchestrator always
sets `requiresApprovalForSideEffects: true` - with **no configuration that turns it
off**, because a flag that could be set to false is a way to switch off the project's
definition of done - and an irreversible tool is **refused**, with a message naming
what would satisfy it. `describe().toolApproval === "required-and-unobtained"` and the
boot check prints it. Issuing a tool approval mid-execution is Phase 13 work.

### The five `TODO.md` items

| Item | Verdict |
|---|---|
| `applyRoutingRestriction` surface | **CLOSED** - every entry point passes a denial (both `authority.ts` call sites); drift proofs added |
| `ToolExecutionHost` not wired, no trace, kinds never emitted | **CLOSED** - wired, one registry enforced at construction, kinds emitted |
| `AgentAdapter.isAvailable` zero callers | **CALLED** - `runtime.probe()` asks each adapter; the CLI prints the answer |
| `AgentAdapter.describe` zero callers | **KEPT, recorded** - a library-contract method; the product composes no external adapter |
| `AgencyAgentAdapter.describe` unreachable | **DECIDED: not composed** - Agency is a capability source, not a runtime authority; reported at boot |
| MCP position | **KEPT ABSENT** - no client, no transport, no dependency; asserted |

### A tooling defect this phase ran into

Running a mutation battery made `npm run lint` fail with ~410 "file not found by the
project service" errors, because the harness's working copy is a directory of compiled
JavaScript inside the repository and eslint did not ignore it. That is the same shape
of defect D-03 records from Phase 01: a check that appears to run against the code and
does not. Fixed twice over - the four harnesses now delete their control copy, and
`eslint.config.mjs` ignores `.mutation-*` and `.probe-selftest`.

### Results

| Gate | Result |
|---|---|
| Typecheck | **PASS** - 0 errors |
| Lint | **PASS** - 0 problems |
| Build / clean rebuild | **PASS** |
| Tests | **PASS - 1795/1795**, 274 suites, 0 skipped, 0 todo, 0 cancelled |
| New tests | **+41**, all in `tests/providerToolBoundary.phase05.test.ts` |
| Pre-existing test files touched | **4** - 3 amended with the reason inline, 1 helper extended; **no assertion weakened** |
| Mutation battery, Phase 05 (new) | **21/21 individual reverts CAUGHT**, control GREEN, 0 survived, 0 load errors |
| Mutation battery, Phase 04 | **21/21 CAUGHT** |
| Mutation battery, Phase 03 | **34/34 CAUGHT** |
| Mutation battery, Phase 02 | **25/25 CAUGHT** |
| Independent probe | **91/91 PASS** (49 + 21 + 21) |
| Probe self-test | **24/24 reverts detected**, 0 false positives |
| Architecture / isolation | **PASS** - 279 tests across the eight architecture, isolation and phase files |
| `npm run runtime:describe` | **PASS** - reports adapter availability, the side-effect approval closure, the Agency absence and the MCP absence |
| `npm run config:validate` | **PASS** |
| Runtime dependencies | **0**, unchanged |

### Two tests were amended, and the reason is the point

- `compositionRoot.phase02.test.ts` asserted that the primary selection was
  **not** policy-ordered, in as many words, as "Phase 05's decision to make". PHASE 05
  made that decision, so the assertion now asserts the **stronger** property. Deleting
  it silently would have left the suite claiming a narrower guarantee than the code
  makes.
- `approvalExecutionBoundary.phase04.test.ts` asserted that no execution path may
  touch the tool host at all. That is now **false** - the host is the verifier - and
  the test would have kept passing for the wrong reason, because it scanned for
  `toolHost.invoke` on a `toolHost.` receiver while the real call goes through a local.
  It now asserts `verifyReported` is called from **exactly one file** and that nothing
  `invoke`s a tool.

### The mutation battery found a real gap in my own work

M8 - "the tool host and the orchestrator must share one registry" - **SURVIVED**. The
constructor guard was correct and completely untested. A guard nobody exercises is a
comment. The test was written; M8 is now CAUGHT.

### Residual limitations, Phase 05

- **A tool call an adapter reports is verified, but nothing PERFORMS one.** An agent
  still cannot ask for a tool; there is no tool-call channel in the agent protocol. The
  system verifies claims and executes nothing, which is the honest current state.
  Issuing an approval for an actual call is **Phase 13**.
- **`ToolCallApproval` is bound to a tool and a subject, not to the call's content.**
  Phase 04 bound workflow approvals to a SHA-256 of the intent. A tool approval is not
  yet bound to the input that would be sent, so an approval for one `web_publish` call
  covers any `web_publish` call by that subject. Recorded, not fixed: content-binding a
  tool call needs the call to exist, which is Phase 13.
- **Both tool-effect inputs are still caller-asserted.** `ToolRecord.sideEffecting` and
  the agent's `toolRequirements` are declarations. The phase closed the *evidence*
  half - the recorded fact now comes from the registry - but nothing independently
  confirms that a tool really publishes, and an agent that declares no tools cannot be
  shown to have used one. Phase 05/13 decision.
- **Cooldown constrains the fallback chain only.** A target that just failed is excluded
  from `plan()` but a **fresh** primary request may still select it, because the
  cooldown registry lives on the planner and `RegistryCandidateSource` cannot see it.
  Recorded as MEDIUM. Threading it into the candidate source would either give
  `core/` a dependency it must not have, or reuse governance's `exclude` channel for a
  non-governance reason - conflating two narrowing authorities to save a field. It was
  not done, and it is not silently claimed as done.
- **The pool's `missing_tool` rejection does not name the tool.** An operator learns
  that a declared tool is absent, not which one. The pool owns that message.
- **`AgentAdapter.describe` still has no production caller.** The product composes no
  external adapter, so there is nothing to describe. Kept as a library contract and
  recorded rather than deleted from a public port.
---

## PHASE 06 - Workspace / Brand Isolation

**Status: PASS.** Commit recorded in `CHANGELOG.md`.

### What the phase decided, and who decided it

Composite-key partitioning. **Hard isolation** - no cross-brand, no cross-workspace
aggregation, no shared read path. **Scale remains an OPEN decision** and no architecture
was invented from it (see *Open decisions* below).

The deployment-scoped / partitioned split was **decided by the user**, not inferred:

| Registry | Scope | Reason |
|---|---|---|
| `core.providers`, `core.models`, `capabilities`, `verifiers`, `providerAdapters` | **deployment** | deployment configuration, not customer data |
| `core.router`, `core.concurrency`, `core.health`, `orchestrationConfig` | **deployment** | telemetry *derived* from the five above - counters about upstreams, not customers |
| memory, audit, feedback, agents, tools, queue, state, jobs, tasks, attempts, results, verdicts, claims, checkpoints, approval gates, orchestrator task state | **partitioned** | customer data |

The derived-telemetry grouping is stated because a per-workspace rate limiter with no
shared view of the upstream it is limiting would be **worse** than the flat version: it
would let one workspace's traffic exhaust a limit the others believe is still available.

### What was built

- **`src/orchestration/workspace/workspace.ts`** - `WorkspaceRef`, validated and frozen;
  `workspaceKey`, length-prefixed so no pair of values can be spelled two ways;
  `workspaceOf` / `tryWorkspaceOf`, which accept a workspace **only** from
  `provenance: "resolved"`.
- **`SecurityContext.workspace`** - asserted, delegated and absent contexts carry no
  authority. Delegation preserves the parent's workspace and refuses a different one.
- **`attachWorkspace` reconciliation** - a resolved context naming no workspace inherits
  the runtime's declaration; a context naming a DIFFERENT one is refused, and every
  authorization path reads that refusal as unidentified.
- **`ModelRecord.metadata` is closed** - `ModelMetadata` is a mapped type over
  `MODEL_METADATA_KEYS` with no index signature, plus a runtime allowlist. It was
  `Record<string, unknown>`, which is the one reason `core.models` could not be listed
  as deployment-scoped without a caveat.
- **Every partitioned store keys through ONE private function** that reads its own
  `#workspace`.

### Four defects found by the phase, none of which were in the plan

1. **The runtime declared a workspace and the identity carried none.** Memory silently
   no-opped with a plausible step string. Caught by a **Phase 02** test, not by review.
2. **`N-1` was worse than "keyed by taskId".** Two `#transition` sites use a ternary, so
   a first rewrite missed them and they kept writing under the bare key - the state
   machine read `created` and refused `created -> escalated`.
3. **`createCore` built the queue, the state store and the audit log with no
   workspace.** A declared runtime reported `"partitioned"` while the audit history it
   then read was **empty**.
4. **The execution id read the JOB's workspace, not the coordinator's.** `Job.workspace`
   is caller-derived, so a job with no caller identity put its executions in the
   unattributed partition *inside a coordinator that had declared one*.

### The unkeyed-access class, and why it is now a test

Nine mutations survived the first battery run. The reason was not that the decisions were
wrong: **each store instance already belongs to exactly one workspace, so two instances
never share a Map and the key is not observable through behaviour.** For those stores the
partition is enforced by the *instance*, and the workspace inside the key is
defence-in-depth - real, load-bearing the moment one instance serves two workspaces, and
invisible today.

Two things followed, and both are recorded because the method changed:

- `tests/workspaceRegistryBoundaries.p06-evidence.test.ts` now asserts the key **wiring**
  from source: every key function must reach its own `#workspace`, and a class may not
  define a key-composing method that is not listed.
- The harness gained a **second mode**. Nine of the decisions are detectable only by a
  source-reading structural test, which cannot see a mutation of `dist/`; they are patched
  in **source** and run with a scratch `cwd`, with their own **structural control** that
  must be green first. A run where the control was not green would have reported every
  structural mutation as "caught" for an unrelated reason - the worst kind of false green.

### Gate evidence

| Gate | Result |
|---|---|
| typecheck / lint / build / clean rebuild | PASS |
| full regression (PHASE 01-05 suites included) | **1864/1864**, 279 suites |
| architecture / isolation | **261/261**, 42 suites |
| PHASE 06 evidence suites | 61 tests across 5 files |
| mutation battery | **21/21 caught, 0 survivors, 0 harness errors** (10 behavioural + 11 structural) |
| prior batteries, re-run | 25/25, 34/34, 21/21, 21/21 - no regression |
| deliberate bad-mutation control | **CAUGHT** (brand removed from the partition head) |
| mutation harness self-test | **PASS 9/9** |
| independent probe | **PASS 8/8** |
| probe self-test | **PASS 6/6** |
| `config:validate` | VALID (`TOZ_ENV=test`; the variable is **required**) |
| `runtime:describe` | PASS - reports `workspaceIsolation: unasserted` truthfully for a runtime that declares none |

### Residual limitations, Phase 06

- **Scale is an OPEN decision.** How many workspaces and brands this serves in the next
  twelve months has not been decided, and no architecture was invented from it. It is
  recorded because it has consequences: the per-instance model composes **one store per
  workspace**, which is correct and unbounded in workspaces but not free in instances. A
  decided scale could justify a shared-instance design; an undecided one must not.
- **No authentication.** A workspace comes from a resolver the deployment supplies, and
  the system trusts it. B-05 remains **open**.
- **Per-instance stores rely on the INSTANCE for isolation, not the key.** Proven above,
  and asserted structurally - but it is a real property of the design, not an accident.
- **`displayName` on a model record is still an unbounded free string.** It is not
  metadata and it is operator-supplied configuration, like a provider's endpoint; it was
  left alone rather than scoped in silently. Recorded, not fixed.
- **Memory scope BREADTH is untouched and two of its defects are still live** -
  `MEMORY_SCOPES` declaration order disagrees with `SCOPE_BREADTH` with nothing asserting
  they agree, and `importanceCeilingFor` normalises by 20 while breadth maxes at 10, so
  the `Math.max(0.2, ...)` floor beside it is unreachable. Both are **Phase 07** and are
  pinned by tests so the deferral cannot go stale. Recorded, not fixed.
- **`OrchestrationEvent.step` carries the event KIND, not a step name.** A caller's own
  `step` lands in `metadata.step`. Found by the probe while writing it, pre-existing, and
  outside this phase's scope. Recorded, not fixed.
---

## PHASE 07 - Memory Architecture

**Status: PASS.** Commit recorded in `CHANGELOG.md`.

### What the phase decided

One memory authority, unchanged from Phase 05 and re-asserted rather than replaced:

| Component | Owns |
|---|---|
| `MemoryAccessPolicy` | grants: which scope, which trust floor, until when |
| `MemoryStore` | possession: partition, expiry, status, history |
| `DefaultWritePolicy` | whether a draft is worth keeping, and at what weight |
| `RetrievalEngine` | ranking, and an honest report of which strategies ran |

Three separations the phase made explicit, because the plan asked for them by name:

- **Breadth (reach) is settled ONCE, at grant time.** `withinBreadth` is the only
  function in the subsystem that consults `SCOPE_BREADTH`; `canRead` and `canWrite
  consult the grant alone. An over-broad scope is not recorded and then filtered at
  read - it is stripped from the grant and reported in `refusedScopes`. A policy with two
  places that decide can eventually disagree, and then the system holds a memory it both
  granted and refused.
- **A ceiling is not a partition.** Breadth limits REACH; the Phase 06 composite key
  limits POSSESSION. Two subjects at the same operating scope in different
  workspaces stay separate, and two in different scopes in one workspace still collide.
- **Retention is not durability.** See the residual limitations below - the distinction was
  load-bearing, because the first draft of the scope table claimed durability that
  no code provides.

### The two Phase 06 defers this phase closed

Phase 06 recorded both as live defects belonging here, and both were real:

1. **`MEMORY_SCOPES` declaration order disagreed with `SCOPE_BREADTH`, with nothing
   asserting they agree.** `SCOPE_BREADTH` was a second hand-written table. It is now
   DERIVED from `MEMORY_SCOPES` in declaration order, so the enum is the single
   ordering fact and there is no second copy to drift.
2. **`importanceCeilingFor` normalised by 20 while breadth maxed at 10**, so the
   `Math.max(0.2, ...)` floor beside it was **unreachable** and every ceiling
   computed above 0.95 - the ceiling never bit. It now normalises by
   `MAX_SCOPE_BREADTH`, and the floor is reachable and tested at its boundary.


### Defects found by the phase, none of which were in the plan

1. **`invalidate()` wrote by KEY into a map keyed by ID.** It typechecked, and `get` and
   `listScope` never showed it - both filter on status, and `#findById` matches `item.id`
   across VALUES, so the real record was still found. It surfaced in the two views that
   report on the store as a whole: `historyFor(key)` returned the item twice and `size()`
   counted two. Worse, the phantom's map key was the memory KEY, so it survived the
   original memory's deletion and collided with whatever was written next at that address.

2. **`listScope()` ignored expiry.** `get()` honoured `expiresAt`; the list did not. An
   expired memory was simultaneously absent and listed.

3. **`liveCount()` counted ADDRESSES, not beliefs.** It summed the `#current` index by
   size, so an expired memory still counted - and its own doc claimed "how many keys hold
   a current, retrievable belief", which was false. All three read paths now agree.

4. **`RetrievalEngine` reported `"semantic"` while discarding the vector it had just
   computed.** There is no vector index, so the strategy could not run. The provider WAS
   consulted; the answer said otherwise. It now returns `strategies: []` and names the
   missing capability in `unavailableReason`. Actual semantic retrieval is Phase 10.

5. **Two policy rules had been declared since Phase 05 with no implementation:**
   `ephemeral_content` and `duplicate_of_recent`. A name in `POLICY_RULES` is a claim that
   the policy CAN state that rule, and `PolicyEvaluation.rules` reports it in every
   decision - so a name nothing can emit is a fabricated capability in the same shape
   D-46 rejected for MCP, only quieter because nothing ever called it. Both REMOVED, and
   the reason each was not implemented in this phase either is recorded beside them.
   `duplicate_of_recent` needs a window of recent writes and `evaluate()` is stateless, so
   implementing it is a design change nobody asked for.

6. **`MemoryService.learning()` had zero callers** - not in `src/`, not in any test -
   while the other six methods `TODO.md` listed as dead had 1 to 7 test callers each. The
   accessor was REMOVED; `#learning` is still written by `learn()`, still counted by
   `metrics()`, and still part of what the service does.

7. **The Phase 07 scope table claimed durability no code provides.** Nine scopes were
   labelled `durable` under a column documented as "whether a memory in this scope survives
   a restart", in a build whose only provider is process-local and loses all of them on
   exit. The column now states the retention class a scope is INTENDED to carry, and a
   separate test asserts the honest physical fact, so the intent cannot drift back into
   a promise.

### The trust floor, and why absence is not privilege

`MemoryGrant.minimumTrust` is now **required**, and is enforced against the EXISTING
ranking in `agent/trust.ts` rather than a second one invented here. The decision that
matters is the default: an absent `subject.trustLevel` is read as **`untrusted`**.

The fail-open alternative (`subject.trustLevel ?? "privileged"`) would make omitting a
field the most privileged thing a caller could do, which inverts the intent of having a
floor at all. Fail-closed also means a caller that forgets the field gets a refusal rather
than a surprise grant.

`MemorySubject.operatingScope` is likewise required. It is **not** sufficient on its own:
a caller can still name `global` in a subject it constructs, so the guarantee is not "the
field cannot lie". It is that production has exactly ONE place that fills it -
`TozOrchestrator.#memorySubject` - and that place does not take an argument. That is
asserted from source, counting EVERY `operatingScope:` in `authority.ts` rather than the
one expected, so a second construction site is a failure.

### Gate evidence

| Gate | Result |
|---|---|
| typecheck / lint / build / clean rebuild | PASS |
| full regression (PHASE 01-06 suites included) | **1900/1900**, 286 suites |
| PHASE 07 evidence suites | 32 tests across 3 files |
| mutation battery | **14/14 caught, 0 survivors, 0 harness errors** (13 behavioural + 1 structural) |
| deliberate bad-mutation control | **CAUGHT** (brand removed from the partition head) |
| mutation harness self-test | **PASS 25/25** |
| independent probe | **PASS 11/11** |
| probe self-test | **PASS 12/12** |
| `config:validate` | VALID (`TOZ_ENV=test`; the variable is **required**) |
| `runtime:describe` | PASS - reports `durable state: false` truthfully |

### Two things the harness got wrong first, recorded because the method changed

**The structural suite list was Phase 06's.** The first battery run reported S1, S2 and
S3 **SURVIVED** with `CONTROL` sitting green at 1898. Only the actor's `operatingScope`
needed a structural detector; the other two were already covered behaviourally by
`memoryScopeModel`, which simply was not in the list. Those two were then PROMOTED to
behavioural after surviving a second time - because structural runs load the suite from
`dist/`, whose IMPORTS also come from `dist/`, so a source mutation is invisible to them
and only assertions that read files from disk can see it. Their invariants are exported
behaviour, so the honest experiment mutates the compiled model where the suite's own
imports notice.

**The self-test did not check its own anchors until it had to.** The first run reported 5
HARNESS_ERRORs from stale anchors - the classifier working correctly - but a stale anchor
also silently REMOVES a mutation from the battery. `--selftest` now re-checks every
anchor against the real source and reports it as `unique`, `absent`, `ambiguous` or
`missing`, and it caught S3's wrong indentation immediately.

### Residual limitations, Phase 07

- **No memory survives a restart.** Every store is process-local; `InMemoryMemoryProvider`
  is the only provider. `runtime:describe` says `durable state: false` and the scope table
  now says the same thing in words. Durable providers are **Phase 12**.
- **Semantic retrieval does not exist.** The engine reports it as unavailable and names
  why, because there is no vector index to search. A query vector alone matches nothing,
  so computing one and calling it a strategy would be a fabricated capability. **Phase 10**.
- **No authentication.** Trust comes from a verified security context the deployment
  supplies; the system trusts it. B-05 remains **open**.
- **`MemorySubject.operatingScope` and `trustLevel` are ordinary fields.** Production has
  one construction site, asserted from source, but the TYPE does not prevent a caller from
  constructing a wider subject. Closing that properly needs an opaque subject token from
  the identity layer, which is an interface change this phase did not make.
- **The importance floor refuses the whole default `conversational` class.** The default
  importance for that type is 0.30 and the floor is 0.35. This is deliberate - the
  constructor says so - and both halves are now tested: the floor bites, AND a
  conversational memory that states a weight is storable. It is recorded because it reads
  like a bug and is not one.
- **Every write without an explicit `sensitivity` is adjusted**, because
  `defaultSensitivity` is `restricted`. Fail-closed and intentional; noted so a future
  change to that default is recognised as a policy change.
- **`OrchestrationEvent.step` carries the event KIND, not a step name.** Pre-existing,
  found by the Phase 06 probe, still outside scope.


---

## PHASE 08 - Agent Architecture

**Status: PASS.** Commit recorded in `CHANGELOG.md`.

### What the phase decided

The existing agent architecture was **kept**. `MASTER_PLAN.md` 5 already called it adequate —
registry with an explicit lifecycle, a leaf-shaped adapter port, deterministic two-stage
selection with a reason for every selected *and* rejected candidate — and the audit found that
description accurate. What the phase changed was the set of claims made about it.

**The orchestrator is the agent-execution authority, not the system authority.** `authority.ts`
said "the single system authority" and "this class is the only place a task advances through its
lifecycle". Both were FALSE: `ExecutionCoordinator` is a second, fully-enforced state machine
that creates jobs, transitions tasks, opens gates, and whose `decideApproval` moves a task to
`ready` or `skipped` directly. The claim was narrowed to the part that is exactly true and is now
asserted from source — the only production site that selects an agent, invokes an adapter, or runs
a subtask wave — and the coordinator is stated as the owner of workflow state and approvals. They
are layered, not parallel: the coordinator reaches execution only through `TaskExecutionPort`,
whose sole production implementation forwards to `orchestrator.execute`.

### Defects found by the phase, none of which were in the plan

1. **The configured trust policy reached neither place it belongs.**
   `agent.defaultMinimumTrust` is documented as "Default trust floor when a task does not state
   one" and was implemented NOWHERE: its only read in `src/` fed
   `SpecialistPool.maximumTrustFloor`, which is a different question. Because that guard refuses a
   request whose floor is ABOVE it, the shipped default of `"low"` meant **every task asking for
   `standard` or more was refused outright**, with the reason `Requested trust floor "standard"
   exceeds the configured maximum "low"`. Meanwhile the behaviour the field does document was
   hardcoded as the literal `"low"` at three sites in `authority.ts`. Two similar names, two
   different questions, wired to each other. `agent.maximumTrustFloor` is new, and
   `OrchestratorOptions.defaultMinimumTrust` now carries the default to the three sites.
   The option's own doc also said "Rejects a task whose trust floor is BELOW this" while the code
   refuses one that is above.
2. **An agent that reached a provider anyway was recorded as having used no provider.**
   `AgentExecutionResult` has always carried `providerId`/`modelId` — "Provider/model the adapter
   actually used, when it can report them" — and nothing in `src/` read them. On the self-hosted
   path the orchestrator routed nothing, recorded `provider: null`, and discarded the only account
   of where the work went. The new `agent_reported_route` event records the adapter's claim as a
   claim, stays silent when it agrees with the route, and records a **mismatch** when a routed
   agent reports something else — a run billed and audited as one route and executed as another.
3. **`DEFAULT_TRUST_REQUIREMENT` and `AgentTrustRequirement` were declared and called by nothing.**
   A constant named "the default" that no default uses. `requireFreshHealth` was unimplemented
   because nobody has decided what counts as stale over what window — implementable is not the
   same as decided, which is why `duplicate_of_recent` was removed in Phase 07 for the same reason.
4. **`"unhealthy"` in `REJECTION_REASONS` was unreachable, not merely unused.**
   `HEALTH_STATUSES` is `unknown | healthy | degraded | unavailable | disabled`, so no input can
   produce an unhealthy agent. `unavailable` and `disabled` health are both already reported as
   `agent_health_not_routable`, so the fiction went and the report stayed.
5. **`tools.grantUndeclaredTools` was a validated, env-mappable switch that read NOWHERE.**
   Removed rather than wired: wiring it would make "an agent may call a tool it never declared" a
   configuration switch with no approval, no audit, and no operator identity behind it, while B-05
   is still open. Two assertions in `tests/orchestration.fabric.test.ts` were CHANGED to match
   rather than deleted, so the removal is visible.
6. **The agent catalogue was empty.** No `agentId` literal anywhere in `src/`, no caller of
   `AgentRegistry.register` outside `AgentIngestor`, and no `Hermes` string in `src/` at all.
7. **Three of this phase's own mutations and one probe check were wrong about their own
   sensitivity** — see *Two things the harness got wrong*, below.

### The roster, and why it is nine rather than ten

`src/orchestration/agent/catalogue.ts` declares the MVP four and the production core five. The
plan's tenth is Hermes, and **Hermes is deliberately not an agent**: in this repository that role
is held structurally by `TozOrchestrator`, which is not an `AgentRecord`. A record for it would be
selectable by the pool, subject to a trust floor, and disableable by an operator — so the system's
single orchestration authority would be something the agent registry could switch off.

Every entry registers `disabled` and unpromoted, names the honest `UnavailableAgentAdapter`, and
keeps its memory reach inside what a task-scoped actor holds. The roster is DATA: a deployment
reviews a role's trust level, capability profile and memory reach before anything runs, rather
than discovering them while something is already executing. A test asserts none of the nine is
selectable, so the catalogue cannot be mistaken for a working fleet.

### The executive layer's extension point, and no implementation

`src/orchestration/executive/index.ts` defines `ExecutiveControlPort` with exactly three
members — `describe`, `observe`, `submit` — and the phase ships **no** executive implementation.
The brief requires that a future Jarvis cannot advance task state, approve, govern or execute, and
a component's capabilities are its type, so each of those is a **missing method** rather than a
prohibition in prose. The suite asserts the absence against the declaration: the method count, and
the absence of any import of the approval, governance, agent, adapter, pool, router or team types.
`submit` returns the orchestrator's own verdict, refusals included, so an executive layer can
request work and cannot skip identity, governance, approval, capability or tool authority.

### Gate evidence

| Gate | Result |
|---|---|
| typecheck / lint / build / clean rebuild | PASS |
| full regression (PHASE 01-07 suites included) | **1949/1949**, 293 suites |
| PHASE 08 evidence suites | 49 tests across 7 files |
| mutation battery | **16/16 caught, 0 survivors, 0 harness errors** (11 behavioural + 5 structural) |
| deliberate bad-mutation control | **CAUGHT** |
| mutation harness self-test | **PASS 27/27** |
| independent probe | **PASS 12/12** |
| probe self-test | **PASS 10/10** |
| prior batteries, re-run | PHASE 06 **21/21**, PHASE 07 **14/14** - no regression |
| prior probes, re-run | PHASE 06 **8/8**, PHASE 07 **11/11** - no regression |
| `config:validate` | VALID (`TOZ_ENV=test`; the variable is **required**) |
| `runtime:describe` | PASS |

### Two things the harness got wrong, recorded because the method changed

**The structural stage copied `src` but not `tests`.** `agentSurface.p08-evidence.test.ts` scans
both for uses of the names it expects to be unused, so with only `src` staged it died with
`ENOENT: scandir '<stage>/tests'` and the harness reported a **BROKEN structural control** —
which would have invalidated every verdict for a reason unrelated to the architecture. Both
directories are staged now, and the test tolerates an absent one rather than dying.

**One mutation survived because a test was missing, not because the harness was wrong.** The
orchestrator reading its configured default trust floor was caught by nothing, because every
assertion about it read SOURCE and no test RAN a task with no stated floor against a configured
default. That was a real gap in the Phase 08 fix: the wiring could have been reverted silently. A
behavioural test now configures a `high` default and asserts a `low`-trust agent becomes
unreachable, with a permissive control so it cannot pass by refusing everything. The lesson is
narrower than it looks: **a structural assertion proves a wiring, never that the wiring is used.**

Two mutations also changed mode rather than being removed, in both directions; and one probe check
is kept but is **absent from the self-test** because it cannot discriminate. All four are recorded
in `DECISIONS.md` D-64.

### Residual limitations, Phase 08

- **No agent can execute.** The catalogue names `UnavailableAgentAdapter`, so a promoted
  catalogue agent fails with a configuration error naming the adapter. That is the Phase 05
  behaviour, not a gap in this phase: a real adapter is Phase 13's external boundary work.
- **No agent has ever been registered in production.** The catalogue is exported and
  deliberately NOT composed by `createRuntime()`. Registration is a deployment's explicit act.
- **An ingested external agent is still disabled by default** and `promoteToAvailable` is still
  off. Unchanged and re-asserted; the default is correct and was not relaxed.
- **The adapter's reported route is a CLAIM.** On the self-hosted path there is nothing to verify
  it against, because TOZ chose no route. It is recorded as a claim under a kind that says so.
  Verifying it needs a destination allowlist, which is Phase 13.
- **`ToolExecutionHost.invoke` still has no caller.** An agent can only *report* a tool call, and
  the report is verified after the fact. The declared-tool boundary is what makes that honest, and
  Phase 08 made it unconditional rather than optional.
- **An undeclared capability is `unknown`, not a refusal.** Fail-open on purpose; see D-61. Both
  halves are asserted.
- **No authentication.** An agent's trust level and an actor's identity come from a
  deployment-supplied context the system trusts. **B-05 stays open.** **B-07** — whether an empty
  capability list in a grant means "any" or "none" — also stays open and did **not** block this
  phase: the pool matches an agent's declared capabilities against a request's requirements,
  which is a different question from how `Grant.capabilities: []` is interpreted by governance.
- **`authority.ts` and `coordinator.ts` were deliberately NOT split.** See `FINAL_ARCHITECTURE.md`
  §24.16: each holds one cohesive state machine, the seams that exist are already seams, and a
  split performed before the sole-sequencer assertion existed would have changed an unmeasured
  property.
- **`OrchestrationEvent.step` carries the event KIND, not a step name.** Pre-existing, found by
  the Phase 06 probe, still outside scope.


---

## PHASE 09 - Skill Architecture

**Status: PASS.** Commit recorded in `CHANGELOG.md`.

### What the phase decided

Greenfield, as `DECISIONS.md` D-09 recorded: nothing existed, and the brief's "keep the existing
on-demand skill architecture" rested on a false premise. So the phase's first deliverable was the
answer to `TODO.md` item 1 — **what a skill is** — and the answer is a table rather than a mode of
an existing registry:

| Concept | Cardinality | Can reach authority | Runs things |
|---|---|---|---|
| Capability | an atom (a name) | no — it is a label | no |
| Tool | ONE invokable call | **YES** — `authorizeToolCall` | yes |
| Agent | an executor | **YES** — selectable, gets grants | yes |
| **Skill** | a bundle of REQUIREMENTS | **no — it can only ever refuse** | no |

So a skill is a **validated, versioned bundle of requirements**: the capabilities it needs, the
tools it needs, and a summary a human can review before installing it. Loading it checks those
requirements against a real caller and records the attempt. That is the whole of it, and
`src/orchestration/skill/skill.ts` is a new file rather than a mode of `ToolRegistry` — which
`D-09` explicitly forbade and which the table justifies.

### The two prohibitions, made structural

`TODO.md` says "Skills must not become a way to grant authority. A skill declares capabilities;
it does not confer them", and "On-demand loading only. Never bulk-load per task." Both are
prohibitions, and a prohibition kept only in prose is a convention. So:

- `SkillRegistry` has **no method** that grants, confers, elevates or widens anything.
- There is **no bulk-load path** — one loader, taking one skill. A `loadAll()` would satisfy
  every word of that requirement while violating it.
- The capability check runs in one direction only: the **caller's** capabilities against the
  skill's **requirements**. Loading can REFUSE; it can never confer.

This is the third time this repository has had to write that rule down (Phase 07's memory trust
floor, Phase 08's executive port, and now here), which is itself the finding: prohibitions kept
in prose keep turning into capabilities in code.

### What was built

- **`src/orchestration/skill/skill.ts`** — `SkillRegistry`, `SkillDeclaration`, `SkillCaller`,
  `validateSkillDeclaration`, `SkillLoadRecord`, and two typed errors. Validation happens at
  **registration**, and an invalid declaration is not stored at all: a registry that stored one
  and checked at load time would have a window in which an invalid skill exists and appears in
  `names()` — exactly the window a reviewer would be looking at.
- **Every load attempt is recorded**, refusals included, with the reason and the list of what
  was missing. The sink is a function, so the registry depends on nothing; the composition root
  wires it into the runtime's audit trail, which is where "who loaded what, in which workspace"
  belongs rather than in a private in-registry log.
- **`RuntimeDescription.skills` and `skillAuthority: "declares-only"`**, and a boot-report line
  that reads `skills  0 (declares-only: a skill declares what a caller must already hold)`.
  A count alone would leave open the only question that matters about this subsystem.
- **Two event kinds, `skill_loaded` and `skill_load_refused`** — declared AND emitted.
  `TODO.md` PHASE 11 already records 15 orchestration kinds that are never emitted and calls
  that "a fabricated capability"; adding two more would have made this phase part of that
  problem rather than a correction of it. A refusal is recorded under its own kind, so a log
  where refusals and successes look alike is not a log you can investigate with.

### Gate evidence

| Gate | Result |
|---|---|
| typecheck / lint / build / clean rebuild | PASS |
| full regression (PHASE 01-08 suites included) | **1962/1962**, 295 suites |
| PHASE 09 evidence suite | 13 tests |
| mutation battery | **12/12 caught, 0 survivors, 0 harness errors** (7 behavioural + 5 structural) |
| deliberate bad-mutation control | **SURVIVED** (a harmless `description()` accessor) — the stronger demonstration: the harness can print SURVIVED, so "0 survivors" above means something |
| mutation harness self-test | **PASS 23/23** |
| independent probe | **PASS 8/8** |
| probe self-test | **PASS 9/9** |
| prior batteries, re-run | PHASE 08 **16/16**, PHASE 07 **14/14** - no regression |
| prior probes, re-run | PHASE 08 **12/12**, PHASE 07 **11/11** - no regression |
| `config:validate` | VALID (`TOZ_ENV=test`) |
| `runtime:describe` | PASS |

### Three mutations were wrong before the battery was, and the battery said so

**Two of them were inert rather than broken** — syntactically valid mutations that changed no
behaviour, and both survived. One widened the *type* of `skillAuthority` to
`"declares-only" | "may-confer"` while leaving the reported value alone, so the boot report said
exactly what it always said. Another added a **comment** about a second skill registry without
adding one. And a third returned early from the refusal path only when no sink was configured —
a condition no test ever creates — so it too survived while appearing to disable the audit
trail.

**And the survivors were partly a missing test, not a bad mutation.** Every assertion about the
sink wiring and the boot report read SOURCE, and a source-reading test cannot see a
behavioural change. That is PHASE 08's lesson restated, and it means the Phase 09 fix could
have been reverted silently. Two end-to-end tests were added — load through a real
`createRuntime()` and read the events back, and assert `describe().skillAuthority` where it is
produced — and both mutations were then rewritten to change behaviour rather than declarations.

One mutation was also **misfiled**: a `dist/` path sat in the structural list, whose staging
copies `src/`, and the harness reported HARNESS_ERROR "missing composition.js". That is the
classifier doing its job on a mistake of mine, and it is the third time a mutation changed mode
in one phase (D-56, D-64, and now this).

### Residual limitations, Phase 09

- **A skill does not EXECUTE.** It is a declaration plus an audited load. There is no runtime for
  it to execute in, and inventing one would be the fabricated-capability shape `D-53` and `D-09`
  both exist to prevent. A business workflow that actually runs skills is **PHASE 14**.
- **The load log is process-local**, like every other store in this build. A skill load does not
  survive a restart. **Phase 12**, and it is why the load records go to the audit trail rather
  than into the registry: the trail is partitioned and already scheduled for durability.
- **The registry is platform-scoped, deliberately.** A skill DECLARATION is deployment
  configuration — "this bundle needs these things" — not customer data, so it joins
  `CapabilityRegistry` and `AdapterRegistry` in being unpartitioned. The ACTIVITY is partitioned,
  because it goes to the runtime's own audit trail.
- **No skill is installed by default**, and nothing composes one. `createRuntime()` reports
  `skills 0`.
- **An undeclared capability is `unknown`, not a refusal** (`D-61`), and that applies to a
  skill's requirements too: a caller whose capability is `unknown` rather than `supported` will
  be refused here, because `matchCapabilities` treats a gap as a gap. Recorded so the difference
  from agent selection is deliberate and not an oversight.
- **`B-05` and `B-07` both remain open** and were not touched. Neither blocks this phase: the
  skill registry has no grant of its own to interpret, and a caller's capabilities reach it
  already resolved.
- **Documentation drift items remain open** under `TODO.md` Cross-cutting — `README.md` still
  says "Current phase: PHASE 04.1", nine phases stale. Recorded, not fixed here: it is not this
  phase's scope, and the authoritative phase state is `PHASE_STATUS.md`.


---

## PHASE 10 - Knowledge / RAG Boundary

**Status: PASS.** Commit recorded in `CHANGELOG.md`.

### Three of the four TODO items were already true. The fourth was not.

That is the honest headline, and it belongs before anything else: a phase that builds nothing is
a phase whose audit did its job. `TODO.md` PHASE 10 asked for four things, and the audit found:

1. **`EmbeddingProvider` is a port with no implementation — TRUE.** Verified by scanning
   `src/`: no class implements it, not even an unavailable one. Pinned by test, because "no
   fake ships" is a claim that decays the moment someone adds one.
2. **The three ingestion classes are boundary-only — TRUE.** `IngestionService`,
   `StaticKnowledgeIngestor` and `UnreachableKnowledgeIngestor` live in
   `memory/ingestion.ts` — *not* under `knowledge/`, which the TODO's phrasing did not say —
   are tested, and are constructed **nowhere** in the composition root. Asserted.
3. **The AnythingLLM / RAG relationship — this is where the work was.**
4. **Relevance must remain a gate — TRUE, and worth recording HOW.** The gate is in
   `RetrievalScorer.score` (`retrieval.ts`), which returns `null` for a non-matching item.
   `RetrievalEngine.#passesFilters` has **no score floor at all**, which is what the TODO's
   wording implies. An audit reading only the filter would have concluded the gate was missing
   and "fixed" a system that was already correct. It was already tested too. Both halves are now
   asserted behaviourally, including the one a fix would break: an **empty** query still
   recalls, because a query with no terms makes no relevance claim.

### The gap: a knowledge provider could be attached and never consulted, invisibly

`KnowledgeProvider` was accepted by `createRuntime`, threaded through `composition.ts` all
the way into `Core`, and **queried by nothing in `src/`** — `knowledge.query(` appears in
no production file. So `createRuntime({ knowledge })` changed nothing observable: a deployment
could attach a full RAG backend, no run would consult it, and `describe()` said nothing either
way.

That is the fabricated-capability shape `DECISIONS.md` D-53 names, and it is a worse instance
than the ones found before, because the port is not inert — it is **accepted**. A tool registry
with no tools is empty; a knowledge port with a provider attached is a promise.

The fix is **not** to build the integration. AnythingLLM is listed under **PHASE 13**'s external
tool boundaries, and `TODO.md` says "keep it a port until real". So the phase made the boundary
honest instead:

- **`RuntimeDescription.knowledge` is `"unattached"` or `"attached-not-consulted"`.** The
  second half of that string is the whole point, and it is what a deployer reads.
- **`runtime:describe` prints it**, so the boot report says `knowledge  unattached` instead of
  saying nothing.
- **A test asserts no production file calls `knowledge.query(` or `knowledge.isAvailable(`.**
  When Phase 13 wires a real backend, THAT is the assertion that must change — deliberately, in
  a diff — rather than quietly ceasing to be true.
- **The port's own two "invariants this module exists to enforce" were stated in
  `knowledge/port.ts` and tested nowhere.** Both are now asserted: only the port may be
  imported anywhere in `src/`, and `NullKnowledgeProvider` is a working implementation rather
  than a stub.

### Gate evidence

| Gate | Result |
|---|---|
| typecheck / lint / build / clean rebuild | PASS |
| full regression (PHASE 01-09 suites included) | **1971/1971**, 296 suites |
| PHASE 10 evidence suite | 9 tests |
| mutation battery | **7/7 caught, 0 survivors, 0 harness errors** (6 behavioural + 1 structural) |
| deliberate bad-mutation control | **CAUGHT** |
| mutation harness self-test | **PASS 19/19** |
| independent probe | **PASS 7/7** |
| probe self-test | **PASS 7/7** |
| prior batteries, re-run | PHASE 09 **12/12**, PHASE 08 **16/16**, PHASE 07 **14/14** - no regression |
| prior probes, re-run | PHASE 09 **8/8**, PHASE 08 **12/12**, PHASE 07 **11/11** - no regression |
| `config:validate` | VALID (`TOZ_ENV=test`) |
| `runtime:describe` | PASS |

### A mutation was written, survived, and was removed because it COULD NOT fail

The second structural mutation targeted `knowledge/port.ts`'s first claimed invariant — "the
core never imports a concrete knowledge implementation" — and it **SURVIVED**. The reason is
worth more than the mutation: **no mutation of the current source can violate it, because there
is no concrete knowledge implementation to import.** The invariant is true by absence of subject
matter. The first attempt added a second import *from* `knowledge/port.js`, which the check
permits — correctly, since importing the port is exactly what it demands — and expressing a real
violation would require creating a `knowledge/<vendor>.ts` file, which a string-replacement
harness cannot do.

So it was removed rather than left in a battery where its survival would look like a coverage gap
that had been papered over. The underlying **test** stays, because it becomes falsifiable the
moment a vendor module exists. This is the second non-discriminating claim in three phases (after
PHASE 08's cross-workspace check), so it is now a named pattern rather than a surprise.

One probe mutation was also aimed at the wrong half of a condition and had to be corrected:
raising `queryTerms.length > 0` to `> 99` stops the gate firing for short queries, which is
what breaks the "returns nothing for an irrelevant memory" check — not the "an empty query still
recalls" check it was filed under. Two halves of one condition, two different breakages.

### Residual limitations, Phase 10

- **`KnowledgeProvider` is still consulted by nothing.** That is the point of this phase's
  reporting rather than an oversight, and it is **PHASE 13**'s to change.
- **There is no RAG.** No vector index, no embeddings implementation, no document store.
  Retrieval's semantic path reports itself unavailable and names why (Phase 07).
- **The ingestion boundary is not wired**, deliberately. `TODO.md` item 2 says boundary-only,
  and a runtime that quietly instantiates an ingestor has made it an integration.
- **Relevance is lexical.** The gate works on token overlap, so a genuinely relevant memory that
  shares no terms with the query is still refused. That is the honest behaviour of a lexical
  gate, and it is the argument for building a semantic one — which needs an index, so Phase 13.
- **`B-05` and `B-07` remain open** and were not touched. Neither blocks this phase.
