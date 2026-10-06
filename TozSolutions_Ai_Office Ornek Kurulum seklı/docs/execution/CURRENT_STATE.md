# CURRENT STATE

> Phase 03 baseline. Every claim below was established by direct inspection and
> execution, not by reading a previous record. The Phase 00, 01 and 02 baselines
> are preserved below because their corrections are themselves findings.

Recorded: Phase 03 (second pass), against the working tree described in §0A and
§0B. The Phase 00, 01 and 02 baselines are preserved below.

---

## 0. PHASE 02 RESULT — what changed, and what is now true

| Gate | Result |
|---|---|
| Typecheck / lint / build | **PASS** |
| Tests | **PASS — 1688/1688**, 256 suites, 0 skipped, 0 todo, 0 cancelled |
| Clean rebuild | **PASS** |
| Mutation battery | **25/25 individual reverts CAUGHT**, control GREEN, 0 survived |
| Independent probe | **20/20 PASS** |
| `npm run runtime:describe` | **PASS** — the runtime boots from the real environment |

The five claims below are new. Everything in §1 onwards is the Phase 00/01 record,
kept because §5, §5a and §7 have been amended and the corrections are the point.

### 0.1 §7 is now FALSE, and that is the phase's purpose

> **Was:** "Verified absent from all of `src/`: `AgentRegistry`, `SpecialistPool`,
> `AdapterRegistry`, `MemoryService`, `MemoryStore`, `RetrievalEngine`,
> `DefaultWritePolicy`, `LearningEventStore`, `TraceRecorder`, `ResourceTracker`,
> `AgentIngestor`, `AgencyAgentAdapter`, `IngestionService`, `GovernanceRecorder`,
> `ToolExecutionHost`. `TozOrchestrator` … is itself **never constructed in `src/`**."

> **Now:** `src/orchestration/composition.ts` constructs all of them, and a test
> (`tests/compositionRoot.phase02.test.ts`) asserts that **no other file in `src/`
> may construct any of them**. The measured count of construction sites before the
> phase was **zero** for every orchestration class, across all 149 `src/*.ts` files.

The consequence recorded in §7 — "the governance control plane has never been
composed into a runnable system" — no longer holds. It is composed, governance is on
the execution path **by default**, and an unidentified caller is refused before a
plan exists.

### 0.2 C-5, found by composing rather than by reading

Wiring the workflow path for the first time failed immediately: **a background task
that required no verification could never complete.** `VerificationRunner` answers
`needs_review` for an empty required-kind list; the orchestrator had already decided
no verification was required and then reported that verdict anyway, so
`OrchestratorTaskExecutor` failed the task while the same run driven directly
reported `succeeded` with a reason of "Completed with no verification required".

Closed: a verdict is reported only when a check actually ran. `null` means "not
measured", which is what it means everywhere else in this codebase.

**This is the first defect found by execution that Phase 00's four reproduction
probes could not have found**, because no reproduction existed: the path had never
been assembled.

### 0.3 D-07 is now MOSTLY closed, and the residue is recorded

Eight of the twelve orchestration configuration sections are read by production code
through the composition root and asserted end to end: `memory`, `agent`,
`observability`, `security`, `agents`, `tools`, `workflow`, `governance`. `routing`
is partial and `learning` is inert by default.

| Section | Status after Phase 02 |
|---|---|
| `memory` | **LIVE** — enabled, scope, recall scopes, recall limit, importance floor, ceiling, recency, learning flag |
| `agent` | **LIVE** — max selected agents, trust floor, subtask timeout |
| `security` | **LIVE** — input and output policies |
| `agents` | **LIVE** — trust ceiling, auto-promote |
| `tools` | **LIVE** — per-call ceiling. `grantUndeclaredTools` still inert. |
| `workflow` | **LIVE** — all six bounds, verified on the coordinator |
| `governance` | **LIVE** — `enforced`, `deferToSubsystem`, `approvalRequired` |
| `observability` | **LIVE** — `allowUnverifiedCapabilities` reaches the pool. `enabled` still inert. |
| `ruflo` | still inert (no package; cannot be otherwise) |
| `routing` | **PARTIAL** — orders the fallback chain, NOT the primary selection. **B-09.** |
| `learning` | still inert by default; `MemoryService.recordLearning` is live when enabled |
| `worker` | still inert |

`governance.blockOnUnknownCost` remains unread: it is a `GovernanceRecorder` input
that no production call site passes, because there is no budget on the composed path.
Recorded rather than pretended closed.

### 0.4 Two API changes, both deliberate

| Change | Why |
|---|---|
| `GovernanceGateOptions.engine` is now **required** | A recorder cannot be given an engine the gate has not built yet, so any runtime wiring one held **two** policy engines — and since the gate delegates every decision to the recorder when one is present, one of them was authoritative for nothing. One call site updated. |
| `Core.clock` is now exposed | Otherwise "one clock" is a claim rather than something a test can check. |

### 0.5 The system still cannot execute anything, and says so

`npm run runtime:describe` exits 0 and reports: no identity resolver, no agents, no
provider adapters, no durable state, no tenancy. It prints "This runtime cannot
execute a task yet, and says so rather than trying."

That is the honest state of a repository that now has a bootable core and no
backends. It is not a defect of this phase, and it is not hidden behind a
configuration flag.

---

## 0A. PHASE 03 RESULT — who is asking, and who may say yes

| Gate | Result |
|---|---|
| Typecheck / lint / build | **PASS** |
| Tests | **PASS — 1718/1718**, 263 suites, 0 skipped, 0 todo, 0 cancelled |
| Mutation battery | **23/23 individual reverts CAUGHT**, control GREEN, 0 survived, 0 load errors |
| Independent probe, first run | 38/46 — **8 FAILED** |
| Independent probe, after amendment | **44/49**, no regressions; 5 remaining = B-10, B-11, B-12 |
| `npm run runtime:describe` | **PASS** — exits 0, `approval` listed among its rules |

### 0A.1 The runtime now knows who is asking, and says how it knows

`RuntimeOptions.identity.resolve` was documented as the runtime's identity source
and had no caller anywhere in `src/` — dead code, so identity on the execution path
was caller-asserted only. Now: `establishRequestIdentity` runs **once, before every
enforcement check** at the top of `TozOrchestrator.execute`, and consults the
resolver only when the request carries no context of its own.

- An unidentified refusal records **zero** policy decisions. It is a refusal, not a
  ruling.
- A supplied context is never replaced behind the caller's back
  (`resolvedCalls === 0` when one was given).
- `SecurityContext.provenance` distinguishes `asserted` / `resolved` / `delegated`
  at the point of decision, stamped by the party that is actually in a position to
  know — the composition root stamps `resolved`, `delegate` stamps `delegated`, and
  `createSecurityContext` stamps `asserted` because **`provenance` is no longer an
  input** (D-24; the probe found it was caller-settable).

### 0A.2 A background task runs as itself

`Job.caller` carries the submitting `SecurityContext`; the port carries
`securityContext?`; the bridge prefers the job's caller over the runtime's declared
service principal, and attaches nothing when there is neither — in which case the
gate refuses. B-08 **RESOLVED**.

### 0A.3 The approver is derived from records

`ApprovalRegistry.assertDecidable`/`decide` now take `executedBy`, which the
coordinator derives from **its own** state — the job's caller, the runtime's
declared service principal, the live claim's worker — and never from a caller
argument. A forged `executedBy: []` cannot blank them. The executing worker and the
gate's own task id are refused whether or not `executedBy` is supplied at all.

### 0A.4 Three caller-attestable holes, found by the probe and closed

| Hole | Closed by |
|---|---|
| `createSecurityContext({ provenance: "resolved" })` declared itself established | The field was **removed** from `CreateContextInput` (D-24) |
| `ApprovalRule` read `context.approvalState`, a field on the context being checked | The short-circuit was removed; a configured operation always requires approval (D-23) |
| `ApprovalRegistry.get/all` returned the live record, so flipping `state` released a task "granted by null" | Records are `Object.freeze`d on the way in and on decision (D-26) |

The third is the one a source scan could not see: Phase 03 asserted "only `decide`
moves a gate" as an import-and-identifier property, and the alias through the
returned object made it false.

### 0A.5 What is now true that was not true before

- A job with no caller of its own can still run, under an identity the runtime
  resolves — and the job's `caller` field stays `null`, because resolution happens
  at the boundary rather than by writing an identity back onto the record.
- An approved job **completes**. Before this phase `#verdicts` was written `null`
  on every success and `TaskExecutionOutcome` had no field to carry a verdict, so a
  properly approved, executed task left its job waiting forever for a verification
  nobody had performed.
- `governance.approvalRequired` is read and enforced rather than inert — at the
  cost of being unsatisfiable until B-10 is answered (§0A.6).

### 0A.6 What is newly false, and is recorded rather than hidden

- **A governance-configured approval cannot be satisfied. B-10, HIGH.**
  `bridgeApproval` has no call sites; no gate opens; a recorded approval never
  feeds back into governance. The setting fails every job using it — closed, not
  open, and deliberately so (D-23). **This is Phase 04's core problem.**
- **`needs_review` has no escalation path. B-11.** QA and approval are correctly
  unable to produce each other's answer, which leaves the handoff undefined.
- **`settle()` is not idempotent; a missing verifier reports `unknown`. B-12.**

### 0A.7 The workflow layer's import surface

`workflow/*.ts` may `import type { SecurityContext }` from `governance/context.js`
and nothing else from `governance/`. Type-only imports are erased at emit, so the
enforcement is on the **emitted JavaScript**: zero `governance/` strings across all
eight files under `dist/src/orchestration/workflow/`. Anything that decides —
`policy`, `enforcement`, `gate`, `integration`, `recorder` — is unreachable.

---

## 0B. PHASE 03, SECOND PASS — a configured approval is now answerable

> The first pass of Phase 03 closed the identity half and raised B-10, B-11 and
> B-12. This pass closed B-10 and nothing else. Everything in §0A still stands.

| Gate | Result |
|---|---|
| Typecheck / lint / build | **PASS** — 0 errors, 0 problems |
| Tests | **PASS — 1729/1729**, 264 suites, 0 skipped, 0 todo, 0 cancelled |
| Clean rebuild | **PASS** |
| Mutation battery, Phase 03 | **34/34 individual reverts CAUGHT**, control GREEN, 0 survived, 0 load errors |
| Mutation battery, Phase 02 | **25/25 CAUGHT** — two stale anchors re-pointed, one re-scoped, and one new test added because of it (§0B.5) |
| Independent probe | **49/49 PASS** |
| Probe self-test | **8/8 reverts detected** — 0 false positives (§0B.4) |
| `npm run runtime:describe` | **PASS** — exits 0, reports `configured approvals  answerable (authority: workflow-registry)` |
| `npm run config:validate` | **PASS** — VALID with `TOZ_ENV` set; unset, it reports `app.environment: is required`, which is correct and unchanged |

### 0B.1 B-10 is closed, and it is one fix rather than three

The three findings — C7.3a (unsatisfiable), C7.3c (no feedback into governance),
C7.4b (`bridgeApproval` has no call site) — are one defect with one cause: the
governance verdict and the approval registry had never met, and the composition
root is the only place that can see both. Three pieces, each small:

1. **`ApprovalGateObserver`** (`governance/policy.ts`) — a read-only port with one
   verb, `observedApproval({ jobId, taskId })`. No `open`, no `decide`, no
   `expire`, so a rule that consults it can never produce what it reads.
   `ApprovalRule` abstains only for a gate that is `approved`, names a decider and
   carries a timestamp; every other outcome is `REQUIRE_APPROVAL`.
2. **`RuntimeExecutionBridge` calls `bridgeApproval`** — the composition root's
   own class, on an `approval_required` outcome, with the decision the engine
   *actually recorded* (`GovernanceGate.approvalRequiringFor`, a read of
   `PolicyEngine.decisions()`). Not a re-decision, and not a decision synthesised
   from an error code. Null in three situations, all fail-closed: no job on the
   request, no recorded decision, or `proceed` / `denied`.
3. **The coordinator HOLDS rather than fails** — on the failure path it asks its
   *own* registry whether a human is currently being asked. An open, undecided gate
   means `waiting_approval` with `failure: null` and the attempt not consumed. A
   decided gate is an answer, so a rejection still fails.

### 0B.2 Where the job binding comes from, and what it does not buy

A gate is keyed by (job, task), because a task id is unique only within a job.
`inJobScope` stamps that pair onto the identity at the composition seam, from the
port request the coordinator fills from the job record it owns, **overwriting**
whatever the submitter wrote. `OrchestratorExecutionPort.execute` gained an
optional `jobId` for exactly this; the coordinator already had it, and
`OrchestratorTaskExecutor` forwards it.

**The residual, stated rather than buried.** The lookup is `(jobId, taskId)` and
both must name a gate that really exists in the one registry. A caller holding a
`SecurityContext` directly could name another job's approved (job, task) pair and
be permitted. That is B-05 question 3 — *must an approval be bound to the content
hash approved?* — which this repository has already answered "no" for the
pre-existing PHASE 07 gate, because `mayRelease` has never looked at content. The
class is therefore not new, and closing it is B-05's decision rather than this
phase's. Recorded in `BLOCKERS.md` §B-10 under "Where the job binding comes from,
and its residual".

### 0B.3 The dead caller-writable field, de-authorized and tested

`SecurityContext.approvalState` was already unread, and D-23 had already removed
the short-circuit that read it. It is kept — `delegate` must be shown NOT to
inherit an approval, and that is only observable from a parent that has one — and
it is now **explicitly documented as inert**, with a test that fails if any code
under `governance/` reads it and a second that fails if any production code treats
it as an approval. The docblock says why the distinction now matters: a context
*claiming* `"approved"` and a context carrying a *real* approved gate look
identical from that field, and only one of them is an approval.

### 0B.4 The probe was inspected for false positives, and it found three in itself

Reconstructed as a 49-part probe sharing no code with any test file, then checked
for the failure mode an independent probe inherits from the suite it replaces: a
checker that cannot fail. `--selftest` copies `dist/` and `src/`, reverts one
wiring decision at a time, and requires the probe to report a failure. **8/8
reverts detected** (S1–S8), so no part is a tautology.

It also **found three bugs in the probe itself** on the way, which is the clearest
evidence the self-test earns its keep: a destructured `policy` that was never
returned; a part that asserted the post-approval decisions *before* re-driving the
job, so it was measuring nothing; and a `needs_review` limitation part written
against a task that required no verification, which named a limitation that does
not exist. The third is the interesting one — B-11 is scoped to
approval-required tasks and the probe had generalised it, which is precisely how a
limitation gets overstated in a status document and then inherited by the next
phase.

### 0B.5 Two stale mutation anchors, and one that had been dead all along

`mutation-phase02.mjs` M11 and M12 were **already** `HARNESS_ERROR` at the previous
commit: their anchors named a line the Phase 03 first pass had moved, and a
`HARNESS_ERROR` is not a catch — so the reported "25/25" was resting on two
mutations that had not run at all. Both are re-pointed at the lines that carry the
same decisions today, and both are re-scoped to the full suite, because Phase 03's
B-08 work made "the service principal" a *fallback* and the test that distinguishes
it now lives in the Phase 03 suite. M12 then **SURVIVED**, which was correct and
the most useful result of the pass: no test anywhere in the repository ran a job
that relied on the service principal. A new case was added and M12 is now CAUGHT.
That is the harness earning its keep on its own operator.

### 0B.6 What this pass did NOT do

- **B-11** (`needs_review` has no escalation target) — re-assessed, reclassified
  MEDIUM → LOW, unchanged. Nothing in the new approval path produces a verdict and
  nothing in the verification path produces a gate, so no minimal coupled change
  exists.
- **B-12** (`settle()` not idempotent; a missing verifier classed `unknown`) —
  re-verified, unchanged. Half 1 is reachable *more* often now, which is recorded.
  Adjacent to the fix, not coupled to it.
- **B-05** (who is an approver, and how that is evidenced) — unchanged and still
  open. The mechanism is now exercised by a real gate opened by configuration; the
  identity question is exactly where it was.
- **Jarvis** — not implemented, not designed, not stubbed. It remains a future
  Executive Control Layer above TOZ, and `src/` contains no reference to it.
- **No auto-runner.** A gate is resolved by the caller re-driving with `runJob` —
  the contract the PHASE 07 gate already had. Inventing a scheduler is a Phase 04
  decision.

---

## 0C. PHASE 04 — the approval / execution boundary

| Gate | Result |
|---|---|
| Typecheck / lint / build / clean rebuild | **PASS** — 0 errors, 0 problems |
| Tests | **PASS — 1754/1754**, 268 suites, 0 skipped, 0 todo, 0 cancelled |
| Mutation battery, Phase 04 (new) | **21/21 individual reverts CAUGHT**, control GREEN, 0 survived, 0 load errors |
| Mutation battery, Phase 03 | **34/34 CAUGHT** |
| Mutation battery, Phase 02 | **25/25 CAUGHT** |
| Independent probe | **70/70 PASS** (49 from Phase 03, 21 new) |
| Probe self-test | **16/16 reverts detected** — 0 false positives |
| Architecture / isolation | **PASS** — 238 tests across the seven architecture, isolation and phase files |
| `npm run runtime:describe` | **PASS** — exits 0, reports the re-drive owner, the durability of approval records, and the classification gap |
| `npm run config:validate` | **PASS** |

### 0C.1 Where the acceptance criteria came from

Not from this phase. `MASTER_PLAN.md` §2.6, §8.4 and §8.6, plus the six
`TODO.md` PHASE 04 items, three of which Phase 03 closed. Everything below answers
one of those, and nothing was added because it seemed like a good idea.

### 0C.2 An approval is bound to what it approves

`ApprovalGate.binding` is a SHA-256 digest of the execution intent — objective,
input, required capabilities, minimum trust — computed by
`ApprovalRegistry.approvalBindingOf` from the task the **registry's own caller**
holds. `ApprovalRegistry.mayRelease` re-derives it on **every release** and refuses
when it differs, naming both digests in the refusal.

Why it cannot be forged: neither side is a value a caller supplies. `open` derives
the digest from the intent it is handed, `mayRelease` derives it from the intent it
is handed, and the coordinator hands both the object it stored. There is no field
through which a caller could assert "these two contents match".

### 0C.3 What the composed path can and cannot currently do with it

**Honest statement.** A `TaskRecord.task` is never patched after `createJob` — the
coordinator's only mutators touch state, counters and timestamps. So in the
composed path the binding **cannot drift today**, and the guarantee is structural
rather than exercised. It is proved at the authority, against a deliberate
mismatch, and the mutation battery removes each digest field in turn (M3, M4, M5)
to show each is really in the comparison. The value of the change is therefore
today mostly **attributability** — a decided gate names the material it covers —
and the protection becomes live the moment anything can edit a task, which is the
first thing `executeTask`'s hoisted `executed` object is positioned for.

### 0C.4 The approval record has a container, and an honest durability claim

`ApprovalRecordStore` is a five-member port; `InProcessApprovalRecordStore` is the
only shipped implementation and declares `durability: "process-local"`. The registry
reads and writes every record through it, so Phase 12 swaps one constructor
argument. `describe().approvalDurability` is read **from the store**, not from a
constant in the composition root, and `runtime:describe` prints
`approval records  process-local (a restart loses every gate; an approved gate
becomes unknown and the task is held again)`.

No persistence provider was invented. B-02 is still open and `package.json` still
has zero runtime dependencies.

### 0C.5 The brief's six categories, mapped onto real operations

`HUMAN_APPROVAL_CATEGORIES` and `HUMAN_APPROVAL_OPERATIONS` live beside
`SECURITY_SENSITIVE_OPERATIONS` and `RESOURCE_BEARING_OPERATIONS`, and the
catalogue-drift test now checks all three. **This is a classification, not a
second switch**: `governance.approvalRequired` remains the only thing that turns an
operation into `REQUIRE_APPROVAL`, and `ApprovalRule` reads nothing from the new
map. What the map makes possible is the *other* direction — measuring whether a
deployment has turned on the operations the brief names. `describe()` reports both
sets and `runtime:describe` prints `classified as needing one 7, configured to
need one 2`, so the gap is a number a reader can see.

The shipped default was **not** changed. Which operations a deployment requires a
human for is a policy decision (B-07-shaped), and the phase was asked to *verify
the mechanism*, not to set policy.

### 0C.6 Re-drive is the caller's, and the obligation is visible

`ExecutionCoordinator.redriveRequired(jobId)` reports tasks that hold an approved
gate and are `ready`. Nothing schedules anything: there is no `setInterval`, no
`setImmediate` and no `node:timers` anywhere in the workflow layer, and a test
asserts it. `setTimeout` *is* present — the pre-existing per-task execution
timeout, a bound on work already in flight, cleared and `unref`'d — and the test
says exactly that in a comment rather than pretending the word is absent. Only an
unbounded repeating timer would be an auto-runner.
Before this, a decision that made a task runnable produced **no signal
at all** — the job sat `waiting` with nothing wrong and nothing to do, and a
service that forgot to re-drive had no way to notice. A forgotten re-drive is a
stall, and a stall nobody can see is a deployment defect that looks exactly like a
slow system.

### 0C.7 `authoriseExecution` is gone, and its four conditions are re-asserted where they are enforced

It was exported, looked like the place execution is authorised, and was called by
**nothing**. Removed rather than wired, because wiring would have meant either
duplicating `executeTask`'s checks (and they would drift, which the function's own
docblock warned about) or reordering them so a claim is taken before the approval
is consulted — the reverse of the PHASE 01 (C-3) order, which would let a
gate-blocked task consume and release a claim on every attempt.

Its five specification tests were **not** left green against dead code. They were
replaced by tests of the same four conditions through `ExecutionCoordinator`, plus
one that the ordinary case still runs — a suite that cannot distinguish "refuses
correctly" from "refuses everything" proves nothing.

### 0C.8 A line that was deleted rather than kept

`redriveRequired` originally carried three conditions: the task holds a gate, the
gate is `approved`, and the task is `ready`. The mutation battery proved the
`approved` half unreachable — a waiting gate always leaves the task
`waiting_approval` and a refused one leaves it `skipped`, so the state test already
excludes both — and proved the two remaining halves *mutually* redundant, each
masking the other's mutation. So the `approved` half was deleted, and the two that
remain are each provable on their own (M12, M13). Two extra guards that felt safer
turned out to be two guards no test could distinguish, which is the condition this
repository has already deleted code for once (D-19).

### 0C.9 What the mutation battery found in the tests

Four mutations survived the first run of the battery, and every one was a **weak
test**, not a strong implementation:

| Mutation | What it proved |
|---|---|
| drop `.sort()` from the capability set | the ordering half of the capability test never wrote the set in a different order |
| blank the objective | the content test changed the objective AND the input together, so neither could be shown to be load-bearing |
| blank the input | as above |
| neutralise the re-drive state check | masked by the attempts check, which was then deleted (§0C.8) |

The battery found all four before they could be reported as PASS.

---

## 1. Repository

| | |
|---|---|
| Path | `D:\AI\TozSolutions_Ai_Office` |
| Git repository | yes |
| Branch | `master` |
| Working tree | **clean** — no modified, staged or untracked files |
| HEAD | `0898464` — `docs: close the project - identity table and closure record` |
| Runtime dependencies | **zero** (`dependencies` absent from `package.json`) |
| Node | v24.21.0 (package requires `>=22.0.0`) |

History is 12 commits, linear, no merges:

```
0898464 docs: close the project - identity table and closure record
c17bed2 test(phase-04-inner-pages): add inner page, SEO and accessibility suite
17f2ead feat(phase-04-inner-pages): complete product surface
141db40 PHASE 10: final certification - fix a fail-open approval bypass, classify the rest
b9409f1 PHASE 09: production hardening - enforce governance in the execution path
db05b24 PHASE 08: governance, policy and the control plane
5d0fce0 PHASE 06 and PHASE 07: provider routing, then autonomous workflows
c8648a6 PHASE 05: memory, knowledge and learning
e125867 feat(orchestration): complete phase 04.1 multi-agent fabric
fcafc27 PHASE 04: orchestration fabric
465556e PHASE 03: homepage and primary user experience
b935b99 PHASE 02: design system and core UI
be0b748 PHASE 01: core architecture and infrastructure
```

## 2. Baseline results (executed, not quoted)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS** — 0 errors |
| Lint | `npm run lint` | **PASS** — 0 problems |
| Build | `npm run build` | **PASS** |
| Tests | `npm test` | **PASS — 1598/1598**, 240 suites, 0 skipped, 0 todo, 0 cancelled — see §5a for the corrected figure |

No test category failed. There is no separate integration / regression /
security / architecture npm script; those categories exist only as file-name
groupings inside the single `node --test` run:

- integration — `tests/workflow.integration.test.ts`, `tests/site.render.test.ts`, `tests/designSystem.preview.test.ts`
- regression — `tests/workflow.jobscope.test.ts`, `tests/contracts/contracts.ts`, `tests/designSystem.phase01Isolation.test.ts`
- security/governance — `tests/governance.test.ts`, `tests/governance.enforcement.test.ts`, `tests/governance.architecture.test.ts`
- architecture — `tests/site.architecture.test.ts`, `tests/orchestration.authority*.test.ts`

**Baseline is green. The system is not broken. It is mis-governed.**

## 3. Scale

| | |
|---|---|
| TypeScript source files (`src/`) | 130 |
| Test files (`tests/`) | 47 |
| Build scripts (`scripts/`) | 3 |
| Docs (`docs/` + root) | 14 |
| Largest file | `src/orchestration/authority.ts`, 1,513 lines |
| Second largest | `src/orchestration/workflow/coordinator.ts`, 1,357 lines |

Four published entry points, one-way dependency direction, enforced by tests
(`tests/designSystem.phase01Isolation.test.ts`, `tests/site.architecture.test.ts`):

```
core  <-  design-system  <-  site
core  <-  orchestration
```

## 4. What the previous phase claimed vs. what is true

`PROJECT_STATE.md` §22.2 and `docs/FINAL_ARCHITECTURE.md` are unusually honest and
were largely accurate. Three claims required correction, and one is materially
wrong in the project's favour — which is the most dangerous direction for a
document to be wrong in.

| Claim | Verdict |
|---|---|
| 1,537/1,537 tests (`FINAL_ARCHITECTURE.md` §26) | **STALE** — true at `b9409f1`; HEAD is 1,598 after the inner-pages suite. Internally consistent, out of date. |
| Governance is "**enforced** on the execution path" (`PROJECT_STATE.md` §22.1) | **NOT CONFIRMED — see §5.** Three live fail-open paths remain on that exact path. |
| `orchestrationConfigFromApp` "is called only from tests" (§17) | **CONFIRMED** — the two `src/` hits (`config/schema.ts:82`, `config/validate.ts:285`) are doc comments, not calls. |
| All twelve orchestration config sections are inert (§17) | **CONFIRMED** — see `docs/execution/DECISIONS.md` D-07. |
| Not multi-tenant safe, classification D (§23) | **CONFIRMED** — no tenant/brand/workspace identifier exists in `src/` at all. |
| Routing narrowing is mutation-verified (§26) | **MISLEADING** — the mutation is caught, but only by a case the real code passes for a different reason. See `DECISIONS.md` D-03. |

## 5. Live defects

Four authorization defects were found by the Phase 00 audit. **All four were
reproduced by execution, and all four were closed in Phase 01.** The table is
kept as the record of what was found, with the closing evidence.

| # | Defect (as found) | Location | Phase 00 probe | Phase 01 status |
|---|---|---|---|---|
| **C-1** | Governance's denied-provider list was computed, then discarded; the router re-derived its own unrestricted set. | `modelRouter.ts` computed; `router.ts` had no candidate field; `defaultRouter.ts` re-read its source | Banned provider **was selected**, and was hop 1 of the chain | **CLOSED.** Exclusion now travels in the request and is applied where candidates enter the router, and in the fallback planner. |
| **C-2** | The executor could approve its own work; the guard depended on the caller volunteering `workerId`. | `gates.ts` conditional check; `coordinator.ts` never supplied `taskId` | `state="approved"` | **CLOSED.** The gate's own recorded `taskId` is now used, and the coordinator derives the executing worker from the live claim. |
| **C-3** | `approvalRequired: true` was not an enforcement precondition. | `gates.ts` returned `allowed:true` with no gate; `coordinator.ts` consulted only `mayRelease` | `released=["t1"]` with no gate | **CLOSED.** `mayRelease` now takes the requirement (no default), the coordinator passes it on both paths, and an `approval()` step opens its gate at job creation with its declared question. |
| **C-4** | An empty capability list disabled enforcement. | `enforcement.ts` iterated a caller-supplied list; `policy.ts` `CapabilityRule` abstained on an empty grant list | Gate denying everything was **never consulted** | **PARTIALLY CLOSED — and the correction matters.** The enforcement *trigger* was the defect and is fixed: the enforced set is now the union of the subtask's declared capabilities and the agent's registered ones. The empty **grant** list was **not** a defect — it is a deliberate documented contract. Escalated as B-07. |

### The corrected C-4, in full

Phase 00 reported C-4 as two layers. Writing the test for the second layer
exposed that it was a **policy choice, not a defect**:

- `Grant.capabilities` is documented — *"Capabilities this grant permits. Empty
  means 'no capability restriction'."*
- `Grant.resources` uses the same convention deliberately — *"Empty means 'this
  operation, any resource', which is only ever produced deliberately by a role
  definition."*
- `delegate()` propagates it faithfully: a child of a blanket grant is itself
  blanket, which is correct, because the child is never broader than its parent.

Flipping that to deny would silently redefine a documented, coherent role path.
It is a product decision with a real cost either way, so it is escalated as
**B-07** rather than decided here.

What *was* a defect: `authorizeSubtask` decided **whether to consult policy at
all** from `subtask.requiredCapabilities`, which is plan-author-supplied. Under a
narrow grant, a subtask declaring no capabilities skipped the check entirely.
Policy was never caller-controlled; the decision to consult it was. That is now
fixed, and the direction is: a subtask may require more than the agent declares,
and can no longer require less and thereby narrow enforcement to nothing.

### Verification of the closures

| Evidence | Result |
|---|---|
| `tests/criticalSecurity.phase01.test.ts` | 17/17 pass |
| Mutation battery, 9 individual reverts | **9/9 CAUGHT**, control green |
| Independent probe (shares no code with the test file) | 21/21 pass |
| Full suite | **1614/1614**, 244 suites, 0 skipped |

## 5a. A correction to this document's own baseline figure

Phase 00 recorded the baseline as **1598**. Re-measured against a clean
`git archive` of HEAD, built and run with the same method, the per-file sum is
**1597**. The delta between 1597 and 1598 is a pre-existing artifact of how
`node --test` counts when a test file defines cases inside a loop — for example
`tests/workflow.jobscope.test.ts:82` turns one `it(` into two cases.

What is verified and matters:

- HEAD per-file sum: **1597**
- Working tree per-file sum: **1614**
- Difference: **+17**, exactly the new Phase 01 test file
- `git diff -- tests` shows **zero** added or removed `it(`/`describe(` in any
  pre-existing file

**No test was lost in Phase 01.** The earlier 1598 figure is retained here
rather than quietly rewritten, because a baseline that changes under you is
worth knowing about.

Severity note: these are *authorization* defects, not crashes. Nothing about them
makes the 1,598 tests wrong — it makes the tests **insufficient**, which is why
the suite is green.

## 6. Systemic pattern behind C-2, C-3 and C-4

One anti-pattern appears in all three, and it is the single most important
architectural finding of Phase 00:

> **An absent value is treated as "nothing to enforce", rather than as
> "nothing is permitted".**

Instances: no gate → allowed (`gates.ts:337`); no `workerId` → self-approval
permitted (`gates.ts:267`); no declared capabilities → no capability check
(`enforcement.ts:148`); no capabilities in a grant → rule abstains
(`policy.ts:494`). The codebase gets this **right** elsewhere and says so
itself — `memory` recall treats `recallScopes: []` as *no recall*
(`authority.ts:1311`), and `PolicyEngine` default-denies (`policy.ts:267`).
**The safe idiom already exists in the repository. The four defects are places
where it was not applied.** That is why they are fixable without new architecture.

## 7. Composition status: this WAS the absence of a composition root

> **Phase 00 record, amended by Phase 02. The finding below is now closed.**

`src/core/composition.ts` `createCore()` is the only composition root, and it
wires the PHASE 01 core only. Verified absent from all of `src/`:

`AgentRegistry`, `SpecialistPool`, `AdapterRegistry`, `MemoryService`,
`MemoryStore`, `RetrievalEngine`, `DefaultWritePolicy`, `LearningEventStore`,
`TraceRecorder`, `ResourceTracker`, `AgentIngestor`, `AgencyAgentAdapter`,
`IngestionService`, `GovernanceRecorder`, `ToolExecutionHost`.

`TozOrchestrator` requires many of these as collaborators
(`authority.ts:176-230`) and is itself **never constructed in `src/`**. The only
assembly anywhere is `tests/helpers/orchestrationHarness.ts:137-200`.

Consequence, stated plainly: **the governance control plane had never been composed
into a runnable system.** C-1..C-4 are reachable *through the library API*; they
are not reachable through a shipped binary, because no binary existed. This is the
reason the defects survived: every test that exercises governance builds its own
gate, and none of them noticed the narrowing never lands.

**Closed in Phase 02.** `src/orchestration/composition.ts` is now that root, it is
constructed by `bootstrapRuntime()` and by `npm run runtime:describe`, governance is
installed on the execution path by default, and a test asserts that no second
assembly point may appear. The full composition root in `CURRENT_STATE.md` §0.

## 8. Documentation drift (confirmed)

| Location | Claim | Reality |
|---|---|---|
| `README.md:6` | "Current phase: PHASE 04.1" | HEAD is post-PHASE 10 and closed |
| `package.json:6` | description "...(PHASE 01)" | PHASE 10 |
| `docs/FINAL_ARCHITECTURE.md:676` | 1,537 tests | 1,598 |
| `README.md:39,70,88` | "no provider is integrated or registered" — accurate, but stated as current status rather than as the permanent limitation it is | consistent with §25; wording is the problem, not the fact |
| `ARCHITECTURE.md` | "unknown keys inside a section are reported rather than ignored" | true only for `orchestration.*`; `src/config/validate.ts` has no known-section list and accepts unknown sections silently (correctly reported at `FINAL_ARCHITECTURE.md` §17) |

Also noted, benign: `provider_health_changed` exists in **both**
`AUDIT_EVENT_KINDS` (`audit/events.ts:28`) and `ORCHESTRATION_EVENT_KINDS`
(`observability/trace.ts:51`) with different payload shapes. A consumer
switching on `kind` cannot tell the producers apart.

## 9. What must not be assumed

Carried forward from `FINAL_ARCHITECTURE.md` §25, re-verified in Phase 00 and
still true: no durable persistence (~38 process-local stores); no multi-tenant
isolation; no live provider client; no MCP; no HTTP server; no job-running CLI;
no database; not exactly-once; no distributed lock; no RBAC (`roles` is a label);
no tamper-evident audit; no price table.

One correction of emphasis: `FINAL_ARCHITECTURE.md` §24 lists 16 limitations. It
does **not** list C-1..C-4. The gap list is therefore incomplete, and
"16 limitations" should be read as "16 *known* limitations".
---

## 0D. PHASE 05 — the provider / tool boundary

| Gate | Result |
|---|---|
| Typecheck / lint / build / clean rebuild | **PASS** — 0 errors, 0 problems |
| Tests | **PASS — 1795/1795**, 274 suites, 0 skipped, 0 todo, 0 cancelled |
| Mutation battery, Phase 05 (new) | **21/21 individual reverts CAUGHT**, control GREEN, 0 survived, 0 load errors |
| Mutation battery, Phase 04 / 03 / 02 | **21/21**, **34/34**, **25/25** CAUGHT |
| Independent probe | **91/91 PASS** (49 + 21 + 21) |
| Probe self-test | **24/24 reverts detected** — 0 false positives |
| Architecture / isolation | **PASS** — 279 tests across eight files |
| `npm run runtime:describe` | **PASS** — reports adapter availability, the side-effect approval closure, the Agency absence, the MCP absence |
| `npm run config:validate` | **PASS** |
| Runtime dependencies | **0**, unchanged |

### 0D.1 The defect the phase was not asked to find

`authority.ts` turned an adapter's self-reported tool call into run evidence:

```ts
collector.toolCall({ toolId: toolCall, durationMs: null, sideEffecting: false });
```

A name from the adapter, a null, and a **literal** `false`. Three copies of one
mistake — a caller asserting a fact the system owns:

- a tool registered `sideEffecting: true` was recorded as **harmless**;
- **nothing checked the call was ever allowed** — undeclared, denied, retired,
  above the trust floor, all recorded as having happened;
- **nothing was traced**, so all three `tool_*` kinds were unemittable.

Reachable through the library API: `AgentExecutionResult.toolCalls` is a field any
deployment's adapter may populate. The same bar Phase 01 used.

This was the only place left in the system where a caller's assertion became
authoritative. The approval binding, the provenance stamp and the `approvalState`
de-authorization had each closed the same shape in earlier phases.

### 0D.2 What replaced it

`ToolExecutionHost.verifyReported` is the only path from "an adapter says it called a
tool" to "this run has tool evidence". It performs no call — verification and
execution are separate verbs, and a test asserts it never touches an invoker.

| Claim | Old | New |
|---|---|---|
| undeclared by the agent | recorded | **refused** |
| not registered / retired / unavailable | recorded | **refused** |
| above the agent's trust floor | recorded | **refused** |
| side-effecting, no approval | recorded as harmless | **refused** |
| `sideEffecting` | literal `false` | the **registry's** value |
| `durationMs` | `null` | `null` — nothing was performed, so nothing was measured |
| no tool authority configured | recorded | **refused** |
| any refusal | impossible | **fails the subtask**, `configuration_error` |
| trace | none | `tool_invoked` / `tool_refused` |

The permission is built where it is built, from facts the system holds: `subject` is
the **agent** (an approval issued to one subject must not release another's call) and
`trustLevel` is the **selected agent's own** recorded floor — reading the request's
`minimumTrust` instead would let a permissive caller speak for the agent it picked.

### 0D.3 B-13, half-closed, with the residue stated

`ToolCallApproval` — `{ toolId, subject, approvedBy, approvedAt }` — makes the
side-effect requirement satisfiable, and the refusal now names what would satisfy it.
All four fields are load-bearing and each has a test.

**No flow issues one during an execution**, because the approval authority is the
coordinator's gate and a tool call happens *inside* the execution that gate already
approved. So the orchestrator always sets `requiresApprovalForSideEffects: true` —
with **no configuration that turns it off**, because a flag settable to `false` is a
way to switch off the project's definition of done — and an irreversible tool is
**refused**. `describe().toolApproval === "required-and-unobtained"`, printed at boot.

A mid-execution approval is Phase 13.

### 0D.4 B-09, closed: the configured policy governs the primary

`orchestration.routing.defaultPolicy` ordered the **fallback chain only**; the primary
was a hardcoded verified-facts scorer and the selection reason said so in as many
words. The most-read routing setting in the product governed its second choice.

`RoutingRequest.policy` now carries it to the one router, `orderByPolicy` orders the
primaries, and `RoutingDecision.ordering` reports `decidingFacts` **and**
`uninformedFacts` — so "routed by latency" is distinguishable from "nothing has ever
been measured, so it ordered by capability breadth instead". `evaluateCandidate` is
untouched: a policy orders and cannot add eligibility, and governance's narrowing is
still applied first. No policy named means `verified-facts`, unchanged.

One fix fell out of it: `DefaultRouter.select` **threw synchronously** out of a
promise-returning method, so a refused policy name was invisible to `.catch(...)`.
Refusing a bad policy is only useful if the refusal arrives where the caller is
already looking.

### 0D.5 A name is not a measurement

`AgentAdapter.isAvailable()` had zero callers, and the CLI printed the registered
adapter **names** — so `agent adapters  unavailable` was a string that read as a
measurement, correct only because the shipped adapter is named `"unavailable"`. That
is the worst kind of honest-looking output: right today, and a place a real regression
would hide.

`runtime.probe()` now asks, and the boot check prints
`unavailable (NOT available)`. It is a separate method because `describe()` is
synchronous structure and availability is a behavioural answer; folding it in would
make the boot check a promise.

### 0D.6 Decided, not left to rot

- **`AgencyAgentAdapter` is not composed.** Stronger than the TODO claimed: it is never
  constructed in `src/` at all. Agency is a specialist/capability source, and composing
  it would make it a second system authority. `describe().agencyAdapterComposed ===
  false`, printed at boot, so the absence is a decision rather than an oversight.
- **`AgentAdapter.describe` is kept** as a library contract. The product composes no
  external adapter, so there is nothing to describe; removing it from a public port
  would be an API break to fix a cosmetic problem. PHASE 08 decides whether it is ever
  wired.
- **No MCP.** No client, no transport, no dependency. `"mcp"` survives only as a
  `ToolKind` a future real client would register, and the boot check says
  `MCP client  none`.

### 0D.7 Two amended tests, and the reason is the point

- `compositionRoot.phase02.test.ts` asserted the primary was **not** policy-ordered, in
  as many words, as "Phase 05's decision to make". It now asserts the **stronger**
  property. Deleting it silently would have left the suite claiming a narrower
  guarantee than the code makes.
- `approvalExecutionBoundary.phase04.test.ts` asserted no execution path may touch the
  tool host. That is now false, and the test would have **kept passing for the wrong
  reason** — it scanned `toolHost.invoke` on a `toolHost.` receiver while the real call
  goes through a local variable. It now asserts `verifyReported` is called from exactly
  one file and that nothing `invoke`s a tool.

### 0D.8 What the battery found in my own work

M8 — "the tool host and the orchestrator must share one registry" — **SURVIVED** the
first run. The constructor guard was correct and completely untested, which makes it a
comment. The test was written; M8 is now CAUGHT.

And running a battery at all **broke `npm run lint`** with ~410 "file not found by the
project service" errors, because the harness working copy is compiled JavaScript inside
the repository and eslint did not ignore it. The same shape as D-03 from Phase 01: a
check that appears to run against the code and does not. All four harnesses now delete
their control copy, and `eslint.config.mjs` ignores `.mutation-*` and `.probe-selftest`.
---

## 0E. PHASE 06 - workspace / brand isolation

Recorded: Phase 06, against the tree described above plus the Phase 06 changes.

| Gate | Result |
|---|---|
| typecheck / lint / build / clean rebuild | PASS |
| full regression | **1864/1864**, 279 suites |
| architecture / isolation | **261/261**, 42 suites |
| PHASE 06 evidence suites | 61 tests, 5 files |
| mutation battery (Phase 06) | **21/21 caught, 0 survivors, 0 harness errors** |
| mutation batteries 02-05, re-run | 25/25, 34/34, 21/21, 21/21 |
| bad-mutation control | **CAUGHT** |
| mutation harness self-test | **PASS 9/9** |
| independent probe | **PASS 8/8** |
| probe self-test | **PASS 6/6** |
| `config:validate` | VALID (requires `TOZ_ENV`; run with `TOZ_ENV=test`) |
| `runtime:describe` | PASS |

### What is now true

1. A workspace and a brand enter the system **only** from an identity with
   `provenance: "resolved"`. Asserted, delegated, absent and hand-rolled shapes are
   refused — even when they name a valid workspace.
2. Every customer-data store is partitioned by `(workspace, brand)`. Five deployment
   registries are not, by an explicit user decision, and `describe()` says which and
   why with a machine-checked no-customer-data assertion.
3. `describe()` reports `"partitioned"` or `"unasserted"` and never silently serves
   everyone.
4. `ModelRecord.metadata` is a **closed type plus a runtime allowlist**. It was
   `Record<string, unknown>`, and that single fact is why the "core.models holds no
   customer data" claim used to be unfalsifiable.
5. No memory, audit or authorization path derives anything from a caller-supplied
   `taskId`.

### Nine defects that were not in the plan

All nine were the same shape — a partition applied on read and forgotten on write, or a
key composed in one place and not the other. Each typechecked, each read correctly, and
each was found by a test rather than by inspection. The most serious was
`createCore` building the queue, the state store and the **audit log** with no
workspace: a declared runtime reported `"partitioned"` while the audit history it then
read was empty.

### The methodological change, recorded because it is the part worth keeping

Nine mutations of store key functions **survived** the first battery run. The decisions
were real and the mutations were correct; they were simply not observable, because each
store instance already belongs to exactly one workspace and two instances never share a
Map. The response was neither to delete the mutations nor to write them off as
defence-in-depth nobody checks:

- the key **wiring** is now asserted from source, and
- the harness gained a second mode that patches source, with its own control that must
  be green before any verdict is read.

A structural run whose control was not green would have reported all nine as "caught"
for an unrelated reason. The controls exist to rule that out, not to decorate the run.