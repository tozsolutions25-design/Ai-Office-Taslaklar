# DECISIONS

> Decisions taken or required during Phase 00, with evidence. Anything marked
> **NEEDS HUMAN** is blocking and must not be decided unilaterally.

---

## 1. Method decisions

### D-00 — Phase 00 is read-only, and that was verified

**Decision.** No source file was created, modified, moved or deleted. The only
writes are the seven files in `docs/execution/`.

**Evidence.** `git status --porcelain` was empty before and after. Probes were
written to `%TEMP%\opencode\`; the mutation test ran against a **copy** of
`dist/` in `%TEMP%`. No `reset --hard`, no `clean`, no branch change, no history
rewrite.

---

### D-01 — Verification is by execution, not by reading

**Decision.** Every claim about runtime behaviour in `CURRENT_STATE.md` was
reproduced against the built `dist/`, not inferred from source.

**Why.** The previous project's most consequential claim — that governance is
"enforced on the execution path" — was made in good faith and is nonetheless
contradicted by execution. Reading alone would likely have repeated the error.

**Method.** Probes import only `dist/`, hold no repository state, and are
discarded. This is also how the C-1..C-4 findings were upgraded from
"plausible" to "reproduced".

---

### D-02 — The baseline is recorded as green, and green is not evidence of safety

**Decision.** Baseline: typecheck PASS, lint PASS, build PASS, **1598/1598
tests**, 0 failures. No failure is hidden or explained away.

**But.** C-1..C-4 are all live **with that suite green**. The suite is not
wrong; it is insufficient. Recorded explicitly so Phase 01 is not scoped by the
misreading "the tests pass, therefore the system is sound."

---

### D-03 — The "mutation-verified" claim on routing narrowing is MISLEADING

**Status: CONFIRMED as a defect in the test, not in the code alone.**

`FINAL_ARCHITECTURE.md` §26 claims routing narrowing is mutation-verified: with
`applyRoutingRestriction` neutered, a test fails.

**What was actually done in Phase 00.** A copy of `dist/` was patched so
`ModelRouter` computes `applyRoutingRestriction(this.#candidates(), null)` — the
filter fully neutered — and the suite was re-run:

- `governance.enforcement.test.js` **does** fail, at the "sole provider"
  assertion.

**Why that is not sufficient.** The test `narrows the REAL router` has three
parts. The decisive one (lines 562-603) builds a registry containing **only** the
banned provider, then asserts the narrowed route is `null`. In the **real** code
that assertion is satisfied by the `candidates.length === 0` short-circuit at
`modelRouter.ts:155` — *not* by the router honouring the restriction. The test's
own comment calls this "proof the restriction was actually applied". It is proof
the pre-check fired.

The case that would expose the real defect — two eligible providers where the
denied one ranks first — is exactly the case the fixture avoids. And the test
file documents that it was *previously* written the other way and passed "by
luck rather than by the restriction" (lines 528-537), then revised to a fixture
that cannot distinguish the two.

**Consequence.** The mutation is caught, so the claim is not false. But it is
caught by a case that the defective code also passes, for a different reason.
The mutation test therefore provides **no protection** against the actual bug
(C-1), which it appears to cover.

**Decision.** Recorded as the project's worked example of principle 4 in
`MASTER_PLAN.md` §2. Phase 01 requires the C-1 fix to be verified by a fixture
with two or more eligible providers, and every security test from Phase 01
onward to be mutation-verified **individually** and reported honestly, including
mutations that survive.

---

## 2. Architecture decisions

### D-04 — KEEP the existing authorities. Do not rewrite.

**Decision.** Keep `TozOrchestrator` (single orchestration authority),
`ExecutionCoordinator` (job state), `PolicyEngine` (only verdict producer),
`evaluateCandidate` (only hard filter), `MemoryAccessPolicy`, `VerificationRunner`,
`SpecialistPool`, the four state machines, and the audit/redaction layer.

**Evidence for keeping.** These are genuinely well built and honestly
documented. Specific strengths, verified in Phase 00:

- Exactly one routing hard filter; a weight-free deterministic scorer that
  refuses to invent weights without measured data (`routing/router.ts:152-201`).
- Unknown ≠ healthy, and unknown is excluded from routing (`health/health.ts`).
- Unknown cost ≠ zero cost, enforced in both the budget and governance paths.
- `RoutingRestriction` has **no field capable of expressing a preference**
  (`governance/policy.ts:612-619`) — governance *cannot* select a provider even
  if written to try. This is structural, and it is excellent.
- `OrchestratorGovernancePort` has no method to select, plan, mutate, write
  memory or verify (`governance/gate.ts`). Absent rather than forbidden.
- Every quantity in a record is nullable and `null` means "not measured". No
  fabricated latency, cost or health anywhere.
- Ingested external agents arrive **disabled**; `promoteToAvailable` is off by
  default (`agentsource/source.ts:275`, `ingest.ts:67-73`).
- `ARCHITECTURE.md`'s one-way dependency rule is enforced by tests that resolve
  every import in all four trees.
- The four-layer idempotency/claim design is sound, and its non-guarantee
  (`DELIVERY_SEMANTICS`) is stated in the code, in a constant, and in a test.

**Decision.** No rewrite. Phase 00 found no defect that requires replacing any
of these. The defects are **wiring and default-direction** defects, not design
defects — which is a much cheaper class to fix.

---

### D-05 — The dominant anti-pattern is "absent means permitted"

**Decision.** This is the root cause of C-2, C-3 and half of C-4, and it becomes
the project's first binding principle (`MASTER_PLAN.md` §2.1).

**The pattern.** An absent value is treated as *"there is nothing to enforce"*
rather than *"nothing is permitted"*.

| Site | Absent value | Current meaning | Required meaning |
|---|---|---|---|
| `gates.ts:337` | no gate | allowed | **blocked** |
| `gates.ts:267` | no `workerId` | self-approval permitted | **refused** |
| `enforcement.ts:148` | no declared capabilities | no check | **denied** |
| `policy.ts:494` | no capabilities in grant | rule abstains | **denied** |

**Why this is the right frame.** The repository already applies the correct idiom
elsewhere and says so itself:

- Memory recall treats `recallScopes: []` as **no recall**, never all scopes
  (`orchestrationConfig.ts:263`, `authority.ts:1311`).
- `PolicyEngine` default-denies, with an explicit comment that "nobody objected"
  is not "somebody permitted" (`policy.ts:262-266`).
- `ScopeRule` treats an empty scope list as DENY, not as unrestricted
  (`policy.ts:512-516`).
- Tools: "an agent that declares nothing gets nothing"
  (`tools/invoker.ts:86-88`).

**Therefore the four defects are not design decisions. They are places where an
existing, documented, in-repo convention was not applied.** That is the most
important single conclusion of Phase 00: the fix is small, and it is consistent
with the codebase rather than foreign to it.

---

### D-06 — There is no composition root, and that is why C-1 survived

**Decision.** Insert a Composition Root phase at **02**, immediately after the
security fixes.

**Evidence.** Verified absent from all of `src/`: `AgentRegistry`,
`SpecialistPool`, `AdapterRegistry`, `MemoryService`, `MemoryStore`,
`RetrievalEngine`, `DefaultWritePolicy`, `LearningEventStore`, `TraceRecorder`,
`ResourceTracker`, `AgentIngestor`, `AgencyAgentAdapter`, `IngestionService`,
`GovernanceRecorder`, `ToolExecutionHost`. `TozOrchestrator` is never
constructed in `src/`; the only assembly is `tests/helpers/orchestrationHarness.ts`.

**Why it matters for security.** Every governance test constructs its own gate
and its own router. C-1 lives in the seam *between* `ModelRouter` and
`DefaultRouter` — a seam that no test crosses with both objects real, except the
one test that builds a fixture unable to expose it (D-03). A composition root
forces that seam to be crossed for real, which is what makes later phases
verifiable.

**Ordering.** After Phase 01, not before, so the composition root is not built
on a routing path that ignores governance.

---

### D-07 — All twelve orchestration config sections are inert. CONFIRMED.

**Status: CONFIRMED.**

**Evidence.** `orchestrationConfigFromApp` has no production caller. The two
`src/` occurrences are doc comments (`config/schema.ts:82`,
`config/validate.ts:285`) plus a barrel re-export (`orchestration/index.ts:475`).
`.env.example` documents 29 distinct `TOZ_*` variables. They validate correctly
and change nothing: `TOZ_GOVERNANCE_ENFORCED`, `TOZ_ROUTING_POLICY`,
`TOZ_WORKFLOW_*`, `TOZ_MEMORY_*`, `TOZ_WORKER_*`, `TOZ_LEARNING_*`,
`TOZ_RUFLO_ENABLED`.

Also confirmed: `governance.blockOnUnknownCost` is validated, defaults `true`,
documented as "the safe direction", and **read by nothing** — because
`GovernanceGate` reaches `checkResourceLimits` only through a
`GovernanceRecorder`, and no production code constructs one. Same root cause as
`governance_decided` never being emitted.

**Decision.** Close in Phase 02 via the composition root. Until then, the
`.env.example` documentation of these variables is misleading and should be
marked as not-yet-wired.

---

### D-08 — `TraceRecorder` stores un-redacted events. CONFIRMED.

**Evidence.** `observability/trace.ts:148` stores `metadata: { ...detail }` raw
into `#events`. The separate sink append (`:156-170`) is redacted by
`AuditLog.append`. `events()`, `byKind()`, `byTrace()`, `byTask()` all read the
**un-redacted** array. `#events` is also unbounded — no `maxEvents`, no
`droppedCount`, unlike `AuditLog` and `LearningEventStore`.

**Decision.** FIX in Phase 11. Redaction must be applied on the way in, so the
one history is redacted everywhere. Also resolve the
`provider_health_changed` collision between the two event vocabularies.

---

## 3. Corrections to the brief

### D-09 — "Keep the existing on-demand skill architecture" rests on a false premise

**Status: CORRECTION. A skill subsystem does not exist.**

**Evidence.** Exhaustive search across all 227 tracked files: `skill` (any
case) → **0 matches**. `SkillRegistry` → 0. `SKILL.md` → 0. `git ls-files` → no
filename containing `skill` or `opencode`. No `.opencode/`, `skills/`,
`.claude/`, `.cursor/` or `.github/` directory exists. The 5 `opencode` string
matches are all references to the **OpenCode 1.18.32 CLI toolchain**.

**Nearest existing concepts**, none of which is a skill system:
`CapabilityRegistry`, `AgentRegistry`, `AdapterRegistry`, `ToolRegistry`.

**Decision.** Record as a **GAP**, not a defect. The *design intent* in the brief
— registry as single source of truth, on-demand loading, no bulk loading — is
sound and should be honoured in Phase 09. But there is nothing to keep, and
Phase 09 is greenfield. Do not retrofit skills onto `ToolRegistry`: a skill is a
capability bundle with lifecycle and authority; a tool is one callable.

---

### D-10 — "Do not add n8n / Twenty CRM / AnythingLLM / … yet" is CORRECT and is enforced by re-ordering

**Decision.** n8n moves from draft position 09 to **13**. The core has no
demonstrated need for any of them, and adding an external dependency before the
governance path is sound inverts the risk order.

**Additional constraint.** Each becomes an **adapter behind a port**, never a
library dependency in the core, and must declare the `Operation`s it needs so
governance can gate it without knowing the vendor.

---

### D-11 — "Do not apply workspace_id / brand_id in Phase 00" is CORRECT

**Status: CONFIRMED as a gap, not applied.**

**Evidence.** No `workspace_id`, `brand_id`, `tenant`, `orgId`, `organizationId`,
`accountId` or `customerId` exists in `src/`. The only hits are
`knowledge/port.ts:5,21` — `readonly workspace: string | null` — a field nothing
reads. Independently confirmed by the previous audit as classification **D**.

**Decision.** Phase 06. Recorded now as the highest structural risk. Note the
ordering dependency: Phase 06 depends on Phase 02 existing, because partitioning
nine flat registries is either a rewrite or a per-workspace composition at the
boundary — and `core/composition.ts` is that boundary.

**Sub-finding that must be fixed first.** `MemorySubject` is
`{ id: string; trustLevel?: ... }` (`memory/memory.ts:63-68`) and the subject id
is derived from a **caller-supplied `taskId`** (`task:${request.taskId}`).
Presenting another task's id yields that task's grants. That is an
**identity-confusion bug independent of tenancy**, and partitioning without
fixing it would just partition a confused identity.

---

## 4. Phase-plan changes from the brief's draft

### D-12 — Two phases added, one split, one moved. Reasons given in `MASTER_PLAN.md` §3.

| Change | Reason |
|---|---|
| **+ Composition Root (02)** | D-06. Nothing is verifiable in situ without it. |
| **+ Durable State & Recovery split from Audit (11/12)** | Different work, different risk, different reviewers. Losing cancellation/budget/idempotency on restart **removes a safety stop**; that is not an observability concern. |
| **n8n moved 09 → 13** | D-10. |
| Draft order otherwise preserved | — |

**The draft list is not treated as fixed.** The brief explicitly permits
re-ordering with recorded justification.

---

## 5. Resolved decisions — Phase 00 accepted, B-01..B-06 answered

Phase 00 was accepted. All six blockers were answered. Recorded here because
each one changes what Phase 01 is allowed to do.

### B-01 — RESOLVED: single reviewed Phase 01, stronger C-2/C-3 designs

| Question | Decision |
|---|---|
| Hotfix now, or one phase? | **One reviewed Phase 01.** No out-of-band hotfix. Scope is strictly C-1..C-4. |
| C-2 identity source | **The gate's own `taskId`, plus a coordinator-derived `workerId` read from the live claim.** No reliance on a caller-supplied argument. The API change was authorised. |
| C-3 gate opening | **Automatic.** A step declared via the `approval()` builder opens its gate at job creation, and the declared `question`/`expiresAtMs` are carried through `flattenWorkflow` instead of being dropped. A missing gate **blocks** in any case. |

Why these: both make the guarantee **structural** rather than conventional, so
a future caller cannot reintroduce the hole by omitting an argument. This is the
D-05 principle applied at the design level rather than the patch level.

### B-02 — RESOLVED, deferred: persistence stays out of Phase 01

Zero-runtime-dependency is a current-state property, not a hard constraint, but
the substrate is **not** decided now. Phase 01 does not touch persistence.
Lives in Phase 12.

### B-03 — RESOLVED: library factory + a runnable, read-only entry point

| Question | Decision |
|---|---|
| Library factory, runnable service, or both? | **A library factory (`createRuntime`) plus a runnable read-only entry point (`bootstrapRuntime` + `npm run runtime:describe`).** Not a service. |
| HTTP or CLI first? Who authenticates? | **Deferred to Phase 03/04** together with B-05. The Phase 02 CLI executes no work and authenticates nobody; it is a boot check. |
| First real provider adapter? | **Deferred to Phase 13.** Provider data is still not invented. |

Why: the product needs a bootable core before it needs a transport. A transport on
an unassembled library would have produced a server answering requests through a
system that had never been executed — the same failure the previous project closed
itself on.

### B-04 — RESOLVED, deferred: workspace model is a Phase 06 decision

Phase 01 does not introduce any tenant or workspace identifier. The
`taskId`-derived memory identity bug found in Phase 00 is recorded as a Phase 06
prerequisite and is **not** fixed in Phase 01, to keep this phase strictly
scoped.

### B-05 — RESOLVED, deferred: approval authority is a Phase 04 decision

Phase 01 does not introduce RBAC, role storage, or content-hash binding of
approvals. C-2's fix uses only what already exists on the gate record, so it
does not pre-empt B-05. The content-hash binding remains recommended for Phase 04.

### B-06 — RESOLVED: mark superseded, retain the Phase 10 record, add a Phase 00 addendum

`docs/FINAL_ARCHITECTURE.md` is **retained in full** as the Phase 10 audit
record and marked superseded *as a statement of current behaviour*. The Phase 00
addendum listing C-1..C-4 is written at the **end of Phase 01**, once the fixes
and their mutation evidence exist — so the addendum describes closed defects
with proven tests rather than open ones.

Nothing in the Phase 10 findings is edited. D-03 is only possible because the
original claim was written down confidently; that record has value.

**Scope note.** Phase 01 is authorised to fix C-1..C-4 only. The one
documentation change made inside Phase 01 is the correction of the *false*
security comment at `authority.ts:827-831`, because that comment is part of
C-1's defect — a false claim at the point of use. The broader drift items
(`README.md:6` phase drift, `package.json:6` description, test-count drift) stay
in `TODO.md` and are **not** touched in this phase.

---

## 6. Phase 02 decisions

### D-13 — KEEP the runtime fail-closed on every absence, and make each refusal state itself

**Decision.** Every optional collaborator in the composition root has a default that
REFUSES, and every refusal is reported by `describe()` rather than implied.

**The defaults, each mutation-verified.**

| Absent | Behaviour |
|---|---|
| governance | **Installed by default.** Its absence is a deployment's explicit choice, not the shape of the code. |
| identity resolver | Every run is refused. No actor is guessed. |
| service identity | The background workflow path is refused. |
| agent backend | `UnavailableAgentAdapter` — a classified `configuration_error`, never a fake success. |
| provider adapter | A provider-backed run fails rather than claiming a provider served it. |
| memory, when disabled | `DisabledMemoryProvider` — grants nothing, rather than being unconfigured and therefore empty. |
| recall scopes | Empty by default = **no recall**, never "everything readable". |
| ingestion promotion | Off unless configured; promotion is a trust decision. |
| configuration issue | `bootstrapRuntime` refuses and names every offending field. |

**Why this is the phase's real work.** Composing a system is easy. Composing one so
that every absent thing refuses is the difficulty, and it is where C-1..C-4 came from
(D-05). Each row above is a mutation target and each is CAUGHT, so each is a
guarantee rather than a preference.

### D-14 — `describe()` reports measurements, including the absences

**Decision.** `RuntimeDescription` reads every number from the live component at
call time. Empty registries read as `0`; an absent backend reads as `absent`.

**Why it is not decoration.** A runtime that boots must be able to say what it
cannot do, or "it started" is indistinguishable from "it works".
`durableState: false` and `tenancy: "none"` are constants — and a test strips the
comments out of `composition.ts` and asserts there is no `node:fs`, no database and
no tenant identifier in it, so the constants are checked rather than hoped for.

`selectionOrder` and `fallbackPolicy` are reported **separately** because the
configured routing policy governs only the latter (D-17). One field would have been
the D-03 failure mode in a new place.

### D-15 — C-5: a verdict is reported only when a check actually ran

**Decision.** `OrchestrationResult.verification` is `null` when the run required no
verification, and a `VerificationResult` otherwise — including `needs_review`.

**The defect.** `VerificationRunner` answers `needs_review` for an empty
required-kind list: correct in isolation, since it refuses to claim a pass for
nothing. The orchestrator had already decided no verification was **required**, and
then handed that verdict to every consumer. `OrchestratorTaskExecutor` reads a
non-`pass` verdict as "executed but unverified" and fails the task — so a background
task that asked for no verification could never complete, while the same task driven
directly reported `succeeded` and a reason of "Completed with no verification
required". **The payload contradicted the sentence beside it.**

**Why it is D-05's pattern.** "Nothing was checked" was rendered as "something was
checked and could not be established" — the same absent-value conflation that
produced C-2, C-3 and C-4, one layer up.

**How it was found.** By composing the workflow path for the first time. Phase 00's
four reproduction probes could not have found it: no reproduction existed, because the
path had never been assembled.

### D-16 — `GovernanceGate` takes its engine; it does not build one

**Decision.** `GovernanceGateOptions.engine` is required. `rules` and
`deferToSubsystem` moved to where they belong — the engine.

**The reason is mechanical, not stylistic.** `GovernanceRecorder` cannot be given an
engine the gate has not constructed yet, because the gate is constructed first. A
runtime that wired a recorder therefore held **two** `PolicyEngine` instances — and
because `GovernanceGate.authorize` delegates entirely to the recorder when one is
present, the gate's own engine was the one whose verdicts **nothing ever saw**. Two
decision authorities, one authoritative for nothing.

One call site changed (`tests/governance.enforcement.test.ts:150`). That is the
whole cost, and the alternative was a permanent untested second authority.

### D-17 — `orchestration.routing.defaultPolicy` orders the fallback chain only

**Decision.** `ModelRouterOptions.policy` was added; `DefaultRouter` was left alone.
`describe()` reports `selectionOrder` and `fallbackPolicy` separately.

**The false start, recorded because it is the D-03 pattern a third time.** This phase
first made `selectRoute()` pass `policy` into `router.select()`, on the belief that
`plan()` honoured `requirements.policy` and `route()` did not. The belief was half
right and the fix was inert: `DefaultRouter` has **no policy concept at all**, it
orders candidates with a deterministic verified-facts `Scorer`. The field changed
nothing. The test written to prove the change proved the opposite, the change was
reverted, and the real scope was documented on the option.

**This is D-03 reproduced in its most expensive form:** a line of code that looks
like it wires something up and does not. It survived review because it read
correctly. Only a fixture on which the two policies genuinely disagree could tell.

**Decision not made here.** Whether primary selection should be policy-aware is a
routing-design decision inside the core's one hard authority. Phase 05 (B-09).

### D-18 — The bootstrap entry point lives in the orchestration tree

**Decision.** `src/orchestration/cli/bootstrap-runtime.ts`, not `src/cli/`.

**Why.** `tests/designSystem.phase01Isolation.test.ts:84` asserts that the CORE tree
— which includes `src/cli` — may not depend on the orchestration layer. The first
version of this file was `src/cli/bootstrap-runtime.ts` and that test failed, which
is the correct outcome. Booting the runtime *is* orchestration, so the entry point
belongs there.

**This is the answer to "are the architecture tests load-bearing?"** They were, on
the first attempt, against a change written by the same person who wrote the check.

### D-19 — Six survivors meant the tests were insufficient, not the lines redundant

**Decision.** Write the missing measurements; do not delete the wiring.

| Mutation | What survived | Why | Response |
|---|---|---|---|
| `memoryPolicy` off the orchestrator | The same policy is also wired into the `MemoryService`, so a granted test write still passed | The test measured the wrong seam | Test now observes the run's own memory-write step |
| `memoryService` off the orchestrator | Nothing asserted that the orchestrator recalls | Recall scopes were configured but never exercised | End-to-end recall test |
| `providerAdapters` off the orchestrator | Every composed agent was self-hosted (`requiresModelRoute: false`), so the route gate was never reached | The fixture could not reach the code | A test with a routed agent and two eligible providers |
| `workflow.maxConcurrency` | `describe()` echoed the configured value | Echoing a setting proves nothing | `ExecutionCoordinator.maxConcurrency` getter, read from the running object |
| `providerIds` off the orchestrator | No agent declared `providerRequirements` | Nothing exercised `missing_provider` | Both directions: refused when absent, permitted when present |
| `recallScopes` → `[]` | No test recalled anything | Same as `memoryService` | Covered by the end-to-end recall test |

**Why this is recorded.** Phase 01's single survivor was redundant and was deleted.
This phase's six were all load-bearing and were kept. **A survivor can mean either,
and a phase that assumes one of the two will delete working code or keep untested
code.** The discriminator is whether the line has an observable effect anywhere, not
whether a test currently asserts it.

### D-20 — The mutation harness asserts its own preconditions

**Decision.** `scripts/mutation-phase02.mjs` refuses to report if its control is not
green, and classifies a load error separately from a catch.

**Three harness bugs it caught, each of which would have produced a false result:**

1. **A copy under `%TEMP%` broke the control.** Three suites resolve `src/` relative
   to their own compiled location, so a copy one level shallower reported nine
   failures unrelated to any mutation. Each variant is now a direct child of the
   repository root — the same depth as `dist/` — and the control is asserted green
   before any mutant is scored.
2. **An empty file list silently ran the SOURCE tests.** `node --test` with no files
   falls back to discovering `**/*.test.ts`, producing a plausible result about a
   different set of files. The harness now throws rather than running with an empty
   list, and asserts the list is non-empty.
3. **The load-error classifier matched assertion text.** It included "is not defined"
   and "is not a constructor", which appear in ordinary failure messages, so a real
   catch was reported as an unprovable mutant. Narrowed to module-load diagnostics.

None of the three changed the verdict on any mutation, and all three would have made
the report wrong in a way nobody would notice.

### D-21 — An independent probe that awaited nothing

**Decision.** The verification probe awaits its checks.

**What happened.** The first version called `check(name, fn)` without awaiting, so an
async check reported PASS before its assertions ran, and its rejection escaped as an
unhandled rejection **after** the summary printed. The probe claimed 20/20 and then
threw.

**Why it matters here.** This is the fourth time in two phases that a verification
mechanism reported success while measuring nothing else: D-03's mutation caught by
the wrong case, Phase 01's syntax error scored as a catch, Phase 02's harness running
the wrong files, and now an unawaited probe. The pattern is worth naming: **a check
that has not finished has not passed.**

---

## PHASE 03 — Governance & QA Separation

### D-22 — The job carries its identity as a full `SecurityContext`, and the workflow layer may import exactly one governance file

**Decision.** `Job.caller` is a `SecurityContext | null`, not an actor string. The
workflow layer may `import type { SecurityContext } from "../governance/context.js"`
and **nothing else** from `governance/`.

**Why a full context, not a string.** The approver refusal (B-05) needs the
runtime's *declared* principal and the job's caller compared as records, and the
authorization decision downstream needs grants and trust. An actor string would
have forced a lookup that does not exist, or a second copy of the context.

**Why the import rule is narrow.** A type-only import is erased at emit, so the
enforced test is on the emitted JavaScript: no file under
`dist/src/orchestration/workflow/*.js` may contain the string `governance/`.
Anything that *decides* — `policy`, `enforcement`, `gate`, `integration`,
`recorder` — stays unreachable from the workflow layer, which is what keeps
"the coordinator may not authorize" and "governance may not decide" from being
conventions. It is asserted structurally in
`governanceQaSeparation.phase03.test.ts`, on both `src` and `dist`.

**Alternative rejected.** Carrying `actor`/`principal` only would have satisfied
the refusal check and hidden the fact that nothing downstream could recover the
grants. The full context keeps one representation of identity instead of two.

### D-23 — A caller may not approve its own operation by writing a field

**Decision.** `ApprovalRule` no longer reads `request.context.approvalState`. For
an operation named by configuration it returns `REQUIRE_APPROVAL`, unconditionally.

**What the independent probe found.** The rule's only satisfiable path was
`approvalState: "approved"` — a field on the context the caller constructed.
Nothing in the repository ever set it to `"approved"` by any other route, so the
check was circular: the way to prove you were approved was to say so. Observed:
the same request failed with `approval_required` or succeeded depending solely on
a field in the caller's own payload.

**The consequence, accepted deliberately.** Nothing now satisfies the rule, and
`bridgeApproval` — the function written to open the coordinator's gate from this
very verdict — has no call sites. So a configured operation **fails closed** and
never runs. That is B-10, raised for Phase 04 rather than fixed here, because
wiring it requires a pending-approval task state in the workflow layer and a
decision about who re-drives the work: a scope change, not a fix.

**Why not the alternative.** Deleting `ApprovalRule` from
`referenceGovernanceRules` would have restored Phase 02's behaviour, where
`governance.approvalRequired` was read by nothing — a configuration that says
"this always needs a human" and changes nothing is the fail-open shape C-1 through
C-4 all had, and Phase 03 exists to remove exactly that. A rule that cannot be
waived is a defect; a rule anyone can waive is a hole.

### D-24 — Provenance is not a caller-settable input

**Decision.** `provenance` was removed from `CreateContextInput`.
`createSecurityContext` always stamps `"asserted"`.

**What the independent probe found.** The field existed as
`input.provenance ?? "asserted"`, so a caller could construct a context declaring
itself `"resolved"` — while `withProvenance`'s own docblock, twelve lines below,
said that doing so "would be recording a claim, not a resolution". The comment
described an intention the code did not implement.

**Why removal rather than validation.** Rejecting unknown values with
`isIdentityProvenance` would still have accepted `"resolved"`. A field no caller
may set is a stronger guarantee than a field no caller should set, and the guard
is kept only for consumers reading `context.provenance`.

**Scope note.** `approvalState` was **not** removed for the same reason it was
not trusted: `tests/governance.test.ts` proves a delegated context never inherits
its parent's approval, which is only testable from an approved parent. It is
documented as non-authoritative at the input and no rule reads it (D-23).

### D-25 — Identity is established once, before authorization, and a supplied context is never replaced

**Decision.** `establishRequestIdentity(gate, request, traceId)` runs a single time
at the top of `TozOrchestrator.execute`, before every enforcement check. It
consults `GovernanceGate.resolve` **only** when the request carries no
`securityContext`; otherwise it returns the request untouched.

**Why once, at the front.** Establishing identity after the first authorization
check would let a refusal happen against an identity nobody had established yet,
and establishing it in two places would make "who is this?" answerable twice.
Establishing before authorization is what makes "an unidentified caller is
refused" mean *refused* rather than *undecided*: the probe confirmed the refusal
records **zero** policy decisions, so nobody can mistake it for a governance
ruling.

**Why the guard matters.** Without it, a resolver that fires on every request
makes the caller's own context decorative — the probe's control case, asserted as
`resolvedCalls === 0` when a context was supplied. Composition wraps
`identity.resolve` so its answer is stamped `"resolved"`; the caller's answer is
never overwritten with it.

**Rejected alternative.** Replacing a supplied context when the resolver
disagrees would make the runtime's identity source authoritative over the
caller's — which is defensible only if the resolver were authenticated, and B-05
has not established that it is.

### D-26 — A gate record is frozen, because the type system already promised it was

**Decision.** `ApprovalRegistry.open` and `ApprovalRegistry.decide` `Object.freeze`
the record they store and return.

**What the independent probe found.** `get`, `forTask` and `all` returned the live
stored object, so flipping `record.state = "approved"` on the returned record made
`mayRelease` report `allowed: true` with a detail of *"granted by null"* — no
decision, no decider, no timestamp, and a task released without anything having
decided it. Phase 03's own claim, "only `ApprovalRegistry.decide` may move a gate
to a decided state", was false as written, and the source scan asserting it could
not see an alias.

**Why freezing and not copying.** Returning a copy would have made the mutation
harmless while leaving the record the release path reads mutable from inside.
`Object.freeze` makes the compiler's `readonly` fields true at runtime, for the
internal reader and the external one alike. Verified: legitimate expiry
(`expireDue` → `decide`) still works, and no production code mutates a gate in
place.

### D-27 — `null` is "not measured" everywhere, including at the approval boundary

**Decision.** The coordinator records `outcome.verificationVerdict ?? null`, and
`settle()` blocks completion only when
`verdict !== null && verdict !== "pass" && state === "completed" && approvalRequired`.

**Why the `null` term is load-bearing.** Without it, every job with no
verification requirement would be stuck forever: `#verdicts` starts as `null`,
the production path reports `null` when nothing was required, and the completion
rule would have treated "never measured" as "failed to verify". The approved-job
path — the whole reason P3-7 existed — would have been unusable end to end. Both
directions are asserted against the same coordinator: `"needs_review"` waits,
`null` completes.

### D-28 — The mutation harness counted its own control as an unclassified result

**Decision.** `mutation-phase02.mjs` and `mutation-phase03.mjs` filter unclassified
results by `r.id !== "CONTROL"`, not by `r.verdict !== "CONTROL"`.

**What happened.** The control's verdict is `"GREEN"`, so the literal `"CONTROL"`
never matched and the control was counted among the not-a-catch results: a run
that printed `CAUGHT 19/19, SURVIVED 0, NOT-A-CATCH 1: CONTROL=GREEN` exited 2.
The numbers on screen contradicted the summary line beneath them.

**Why it matters here.** Found by reading the harness after the run rather than by
trusting its exit code — the same discipline as D-20, applied to the tool that
applies it. A harness whose summary is wrong about its own result is the failure
mode this whole method exists to remove, and it had already shipped in the Phase 02
script unnoticed.

---

## PHASE 03, SECOND PASS

### D-29 — The composition root is the seam, so `bridgeApproval` is called there

**Decision.** `RuntimeExecutionBridge.execute` is the one and only call site of
`bridgeApproval`, and it passes the decision the engine **actually recorded** -
read out of `PolicyEngine.decisions()` through a new read-only
`GovernanceGate.approvalRequiringFor(taskId)`.

**Why there and nowhere else.** Three subsystems have to agree: governance's
verdict (which may not write a decision), the coordinator's gate (which may not
authorize, and may not import `governance/` at all), and the task state. The
composition root is the only place in `src/` that can see both authorities, and it
is also the only place a test permits the system to be assembled.

**Why the decision is READ rather than re-made.** The three alternatives were all
worse. Re-authorizing in the bridge is a second decision point and writes a second
record. Synthesising a `GovernanceDecision` from the `approval_required` error
class is a decision nobody took, carrying an operation name the bridge would have
to hardcode. Reading the engine's own record is the only one of the three that is
both faithful and free of new authority - and it made a class of bug impossible,
because the bridge cannot bridge a verdict that governance never reached.

**Rejected: the coordinator opening its own gate.** It cannot import
`governance/integration.js` (the isolation test would fail, and the emitted
JavaScript check would catch it), and giving the coordinator an approval port
would make the job-state authority into a second policy authority.

### D-30 — Governance observes approvals through a read-only port, never a field

**Decision.** `ApprovalGateObserver` has one verb,
`observedApproval({ jobId, taskId })`, and `ApprovalRule` abstains only for a gate
that is `approved`, names a decider and carries a timestamp.

**The rule that produced it.** A rule may consult a *record* it cannot write; it
must not consult a *field* the party it is checking wrote for itself. D-23 removed
the field consultation and left the requirement unsatisfiable, which was the safe
direction but not a working system. The read-only port is the only shape that
satisfies both halves at once: the rule can read an answer, and there is no verb
through which reading could become writing.

**Fail-closed at every step, deliberately enumerated.** No observer wired, no job,
no task, no gate for that pair, any state other than `approved`, an empty
`decidedBy`, a null `decidedAt` - each is `REQUIRE_APPROVAL`. Eight mutations, one
per precondition, each individually reverted and each CAUGHT.

**Expiry is deliberately NOT re-decided here.** Whether a decided gate has gone
stale is the approval authority's rule, applied once, when the decision is made
(`ApprovalRegistry.decide` refuses to approve an expired gate). Re-deriving it in
a second place would let governance and `mayRelease` disagree about the same gate,
and two answers to "is this approved?" is the failure this project exists to
remove. Making governance stricter than the release path was considered and
rejected: it cannot create a bypass, but it turns a runnable job into a hard
failure for no security gain.

**The lookup is keyed on the JOB as well as the task.** A task id is unique only
within a job. Keyed on the task alone, one job's approval releases another job's
identically-named task - the PHASE 10 bypass, reproduced in a new place. Two jobs,
one approved, one still held, is asserted for exactly this reason.

### D-31 — The job scope is stamped at the composition seam, and it is not authority

**Decision.** `inJobScope(context, { jobId, taskId })` stamps the pair onto the
identity the bridge forwards, from the port request the coordinator fills from the
job record it owns. It **overwrites** whatever the submitter wrote, adds no grant,
removes no grant, and carries provenance through unchanged.

**Why a function and not a field on `createSecurityContext`.** The same reason
`provenance` is not an input (D-24): a caller asking to be told which job it is in
is asking a question only the coordinator that owns the job can answer.

**Why it overwrites rather than fills.** A submitter that stamped its own `jobId`
would otherwise choose which gate governance resolves against. Overwriting is what
makes the pair a fact. This does **not** close the residual - a caller with a
direct handle on `SecurityContext` can still construct the pair itself - and that
residual is recorded in `BLOCKERS.md` §B-10 rather than claimed away. It is B-05
question 3, and the pre-existing PHASE 07 gate has the same property.

**Why the port gained an OPTIONAL `jobId`.** Required would have broken every
existing port implementation for no gain, and a request with no job simply cannot
resolve a recorded approval - which is the fail-closed direction.

### D-32 — A held task waits; it is not a failure and it is not a retry

**Decision.** On the failure path the coordinator asks its **own** `ApprovalRegistry`
whether a human is currently being asked. `errorClass === "approval_required"` plus
an open gate in state `waiting` means: abandon the idempotency key, release the
claim, set `waiting_approval` with `failure: null` and the attempt not consumed, and
record `task_waiting_for_approval`. Anything else falls through to the existing
retry policy untouched.

**Why the coordinator's own registry, and not the outcome.** The outcome says
"approval is required"; only the registry says "a human is being asked". Reading the
second from the first would be the D-23 shape one layer down - a claim accepted as
an answer.

**Why only a `waiting` gate holds.** A rejected, expired or cancelled gate is a
real answer from a human, and re-running the attempt would be retrying a refusal
into a different one. `decideApproval` already marks such a task `skipped` with a
failure; the hold must not contradict that.

**Why the attempt is not consumed.** `approval_required` is the one failure class a
human can still resolve, and spending the attempt budget on it would turn a
question into a permanent failure - which is exactly the B-10 symptom. The
rejected alternative (reclassify `approval_required` as retryable) was rejected for
the same reason: a retry storm against a human is not a wait.

**Why no new `TaskExecutionOutcome` state.** The distinction that matters -
"waiting on a human" versus "failed" - is already in `TaskRecord.state`, and
`settle` already reads `waiting_approval` as a waiting reason. A second state would
have meant a second place for it to be forgotten.

### D-33 — `approvalState` is kept, and de-authorization is tested rather than promised

**Decision.** `SecurityContext.approvalState` stays, documented as INERT, with a
test that fails if any code under `governance/` reads it and a second that fails if
any production code treats it as an approval.

**Why it is not deleted.** `delegate` resets it to `"none"`, and that reset is only
observable from a parent that HAS one. Deleting the field would delete the ability
to state - let alone test - that a delegated context does not inherit an approval,
which is one of the guarantees approval exists to provide.

**Why this pass touched it at all.** D-23 removed the read. What changed is that
the rule now consults something REAL, so a context claiming `"approved"` and a
context carrying a real approved gate look identical from this field, and only one
of them is an approval. A field named `approvalState` that looks load-bearing when
it is not is how the original defect came to exist; leaving it merely undocumented
would leave the same trap in place with a new, genuinely load-bearing neighbour
beside it.

**Why a test rather than a docblock.** A promise in prose is not a guarantee, and
this project's own method says so. The scan strips comments first, so a guarantee
asserted only in a docblock does not satisfy it.

### D-34 — An independent probe is validated by reverting, not by reading

**Decision.** The 49-part probe carries a `--selftest` mode that copies `dist/` and
`src/`, reverts one wiring decision at a time (8 of them), and requires the probe to
report a failure. All 8 are detected.

**Why.** A checker that cannot fail is the one defect an independent probe inherits
from the suite it was written to replace, and it is invisible by construction: 49
green results look exactly like 49 correct results. The only way to tell them apart
is to break the thing being checked and see whether the checker notices.

**What it found.** Three bugs in the probe itself, on the first run: a
destructured value that was never returned, an assertion made before the action it
was supposed to follow, and a limitation written against a case that does not
exhibit it. The third is the one that matters - it had generalised B-11 from
"approval-required tasks" to "all tasks", which is precisely how a limitation gets
overstated in a status document and then inherited by the next phase as fact.

**Also decided here.** Two `mutation-phase02.mjs` anchors were **already**
`HARNESS_ERROR` before this pass, so the previously reported "25/25" rested on two
mutations that had not run. Re-pointed, re-scoped, and one of them then SURVIVED -
correctly, because no test in the repository ran a job that relied on the service
principal. A test was added. A harness that reports a catch it did not perform is
worse than one that reports nothing, and this one had been reporting one.

---

## PHASE 04

### D-35 — An approval is bound to a digest of what it runs, derived by the authority

**Decision.** `ApprovalGate.binding` is a SHA-256 digest of the execution intent.
`ApprovalRegistry.open` derives it; `ApprovalRegistry.mayRelease` re-derives it on
every release and refuses on a mismatch. `ExecutionCoordinator.openApproval` takes
**no** intent argument - it derives from the task record the coordinator holds.

**Why the digest, and why both sides derived rather than one passed.** The obvious
shape is "the caller passes the digest it was given, and the gate compares it",
which is forgeable in exactly the way D-23 was: the caller supplies the value that
decides. The shape chosen has no such field. Both sides take an *intent* and each
derives, so the only way to make two contents agree is for them to be the same
content. A binding a caller can assert is not a binding.

**Why SHA-256 and not a pure function.** `node:crypto` is already used in
`src/core/ids.ts`, so this adds no dependency. A non-cryptographic digest would be
the wrong tool here precisely because it is cheap to collide, and a collision means
one approval releasing another's content.

**Why capabilities are SORTED.** The requirement is a set. Treating a reordering as
a different intent would invalidate a real approval for no reason, and a fail-closed
rule that fires on nothing is an outage rather than a safety property. M3 in the
Phase 04 battery reverts the sort and is caught.

**Why the binding is stored on the record and not only checked.** `MASTER_PLAN.md`
§8.6 asks for an approval record that is ATTRIBUTABLE. An auditor holding a decided
gate must be able to say what was approved without re-deriving anything, and a check
leaves no such trace.

### D-36 — The record container is a port; the durability claim is read, not asserted

**Decision.** `ApprovalRecordStore` is a five-member port with one shipped
implementation, `InProcessApprovalRecordStore`, which declares
`durability: "process-local"`. `describe().approvalDurability` reads that value
**from the store**.

**Why the phase owes the seam and not the provider.** `MASTER_PLAN.md` §8.6 wants a
durable approval record and §8.4 puts "approval state survives a restart" in the
project definition of done. That is Phase 12, and B-02 - the persistence substrate -
is still an open decision that would reverse a property the project has claimed
repeatedly. Inventing a filesystem or database store here would be inventing a
provider to satisfy a phase that is not this one.

**Why `durability` is a literal union and not a boolean.** "Durable" is a claim with
a specific meaning - the record survives a process exit - and a boolean would let a
store answer `true` without anyone having defined what it promised.

**What is honest about the failure direction.** Losing a gate on restart fails
CLOSED: an approved gate becomes unknown, `mayRelease` reports "no gate is open",
and the task is held for a human again. That is the right direction to fail in and
it is still not durability, which is why the CLI says both.

### D-37 — The brief's six categories are a CLASSIFICATION; configuration stays the switch

**Decision.** `HUMAN_APPROVAL_CATEGORIES` and `HUMAN_APPROVAL_OPERATIONS` sit
beside the two existing operation classifications. `governance.approvalRequired`
remains the only thing that produces `REQUIRE_APPROVAL`, and `ApprovalRule` reads
nothing from the new map.

**Why not a second map in the sense the instruction meant.** There is only one
switch, and adding a classification does not change which operations it names. What
the classification is for is the direction nobody could previously read: whether a
deployment has turned on the operations the brief names. `describe()` reports both
sets and the runtime prints `classified as needing one 7, configured to need one
2`, so "the brief says a human is required" and "this deployment requires a human"
stop being interchangeable in a reader's head.

**Why the shipped default was not changed.** Which operations require a human is a
policy decision of exactly the kind B-07 was escalated for, and the phase was asked
to verify the mechanism rather than to set policy. The honest record is the visible
gap, not a silent widening that would make every job in a default deployment
wait for an approval nobody asked for.

**Why `workflow.cancel` is FALSE, since "irreversible" would naively include it.**
It is a safety action, and demanding a human in order to stop work is perverse. The
same reasoning marks `workflow.execute` false - it is the vehicle, not the act -
and `approval.request` false, because requiring a human in order to ask a human is
a deadlock rather than a control. Each is stated in the map's docblock.

### D-38 — Re-drive is the caller's, and the obligation is made detectable

**Decision.** `ExecutionCoordinator.redriveRequired(jobId)` reports tasks holding an
approved gate in state `ready`. `describe().approvalRedrive` states
`"caller-owned"`. No scheduler, no unbounded timer, no auto-runner.

**Why not an auto-runner.** The brief asks who re-drives; it does not ask for one.
Adding a runner would put an unbounded loop next to a human decision, which is a
scheduling decision with real failure modes - and Phase 12's recovery semantics
would have to be right before it could be. It is recorded in `TODO.md` as a Phase
04→later decision rather than taken here.

**Why the signal at all, if nothing re-drives automatically.** Before this, a
decision that made a task runnable produced NO signal: the job sat `waiting` with
nothing wrong and nothing to do. A service that forgot to re-drive could not tell
that from a slow system. The contract was real and invisible, and invisible
contracts are the ones that get violated.

**Why two conditions and not three.** See D-19 and §0C.8 of `CURRENT_STATE.md`: the
`approved` half was unreachable and mutually redundant with the state half, and
two guards no test can distinguish is worse than one guard a test can.

### D-39 — `authoriseExecution` removed, not wired

**Decision.** `authoriseExecution` and `AuthorisedExecution` are gone from `src/`
and from the public exports. Their five specification tests were replaced by tests
of the same four conditions through `ExecutionCoordinator`.

**Why removed rather than wired.** Wiring meant one of two things, both bad.
Duplicating `executeTask`'s checks would let them drift - which is exactly what the
function's own docblock warned would happen, naming the outcome "the authoritative
one will be the untested one". Reordering so a claim is a precondition of
authorisation reverses the PHASE 01 (C-3) order: approval is consulted BEFORE the
claim deliberately, so an unapproved task never takes a claim it must then release.
Making the claim a precondition would let a gate-blocked task consume and release a
claim on every attempt, and would report "duplicate delivery" to any worker that
legitimately arrived second.

**Why the tests were replaced rather than left green.** Five passing tests against
a function nothing calls is not neutral - it is evidence of an enforcement point
that does not exist, and it is the kind of evidence that keeps a bug alive in the
code that is never called. The conditions are real and are now asserted where they
are enforced, with a positive control so the refusals cannot be a blanket refusal.

**How the removal is kept from returning.** A source scan, with comments stripped -
because the removal is documented in a docblock that has to name what it removed,
and a docblock is not an enforcement point. CODE that declares or exports the
function fails the test.

### D-40 — B-13 raised rather than fixed: a second unsatisfiable approval requirement

**Decision.** `authorizeToolCall`'s side-effect refusal is recorded as **B-13**,
with a test asserting that no execution path calls `ToolExecutionHost`.

**Why not fixed here.** Completing it means wiring the tool host into the
orchestrator, which is the tool boundary's work and already recorded as PHASE 05.
Half of it - routing the refusal through governance and the one registry - is
Phase 04-shaped, but it cannot be done before the path exists, and doing it to a
path nothing reaches would be untested code.

**Why it is a blocker and not a note.** It is one wiring mistake away from live, and
when live it would fail closed by ACCIDENT, which in an incident reads exactly like
a system that works. Asserting that it stays unreachable is the part Phase 04 owes,
and an assertion is what it wrote rather than a promise in a comment.
---

## PHASE 05

### D-41 - A reported tool call is a claim; the tool authority is the only thing that can turn it into evidence

**Decision.** `ToolExecutionHost.verifyReported(declared, permission, trustRank,
reported, approval?)` is the sole path from "an adapter says it called a tool" to
"this run has tool evidence". A claim that the authority does not verify produces **no
evidence at all** and **fails the subtask** with `configuration_error`.

**Why the previous shape was the worst kind of bug.** It was not a missing check; it
was a check that could not be missing, because there was nothing to check. The code
read:

```ts
collector.toolCall({ toolId: toolCall, durationMs: null, sideEffecting: false });
```

A name from the adapter, a null, and a hardcoded `false`. The record whose entire
purpose is to say what a run did was written by the thing being audited, and it said
the irreversible thing was harmless. Every other authority in this system is defended
by "the caller does not get to assert that" - the approval binding (D-35), the
provenance stamp (D-20), the `approvalState` de-authorization (D-22) - and the tool
boundary was the one place a caller still could.

**Why fail the subtask rather than warn.** A warning is a record that something
unverified happened, which is the defect. There is no partial credit: if any reported
call cannot be authorised, none of them become evidence, because an evidence set that
quietly dropped the refused call is indistinguishable from one where it never
happened.

**Why the permission is built where it is built.** In `#verifyReportedTools`, from
facts the system holds: `subject` is the **agent** (a tool permission is about who may
call something, and an approval issued to one subject must not release another's call);
`trustLevel` is the **selected agent's own** recorded floor, not the request's
`minimumTrust`, which would let a permissive caller speak for the agent it picked.

**Why `requiresApprovalForSideEffects` is `true` with no configuration to change it.**
It is the project definition of done - "a human approval is required for every
irreversible or outbound action" - and the tool boundary is the only place an
irreversible action can occur. A flag that could be set to `false` is a way to switch
off a security property, so it is not one. M13 reverts it and is caught.

**Why `durationMs` stays `null`.** The host performed nothing and measured nothing. A
fabricated `0` reads as "instant", and an evidence record is precisely where a
fabricated measurement does the most damage.

**Why verification and execution are separate verbs.** `verifyReported` never calls an
invoker, and a test asserts it does not. Checking a claim and performing it are
different acts with different authority requirements, and merging them would make
"authorise" and "do" one decision.

### D-42 - A fail-closed requirement that nothing can satisfy is not a control

**Decision.** `ToolCallApproval` exists: `{ toolId, subject, approvedBy, approvedAt }`.
`authorizeToolCall` refuses a side-effecting tool when approval is required **and no
approval covers this exact call** - and the refusal message names what would satisfy
it.

**Why this is B-13 and not a feature request.** Before this, setting
`requiresApprovalForSideEffects: true` did not mean "ask a human". It meant "this call
can never succeed", which is B-10's exact shape - a requirement with no mechanism -
and would have been B-10's exact severity the day the tool path went live. B-10 was
fixed in PHASE 03 by giving governance a real call site. B-13 needed the same
treatment: a gate you can satisfy, or not a gate.

**Why each of the four fields is load-bearing, and each has a test.** `toolId` and
`subject` so an approval is for one call by one party, not "side effects in general";
`approvedBy` non-empty because PHASE 04 made approvals attributable and this must not
reopen it; `approvedAt` a real instant because an approval with no time cannot be aged
out and is therefore permanent by accident. M11 and M12 revert two of them and are
caught.

**What was NOT done, stated plainly.** No flow issues a `ToolCallApproval` during an
execution, so the production path refuses an irreversible tool and says why. That is
honest and it fails in the safe direction, but it is not a working approval - it is a
working *requirement*. Issuing one mid-execution means holding a task while a gate
opens on a tool call, which is Phase 13's work. `describe().toolApproval` reports
`"required-and-unobtained"` so nobody reads the refusal as a bug.

### D-43 - A policy that cannot rank says so, and a policy orders rather than filters

**Decision.** `RoutingRequest.policy` carries a policy name to the one router.
`DefaultRouter` orders eligible candidates with the existing `orderByPolicy`, and
`RoutingDecision.ordering` reports `policy`, `decidingFacts` and `uninformedFacts`. The
selection reason is computed by `explainPolicy` rather than templated.

**Why B-09 was a blocker and not a nit.** A deployment set
`orchestration.routing.defaultPolicy`, the runtime accepted it, `describe()` reported
it, and it governed the **fallback chain only**. The primary - the decision that
actually runs the work - was hardcoded to `verified-facts`, and the selection reason
said "No weighted scoring applied" in as many words. So the most-read routing setting
in the product governed its second choice, and the system said so nowhere except a
code comment. Honesty in a comment is not a control.

**Why `uninformedFacts` is the load-bearing half.** A policy that consults latency
when no latency has ever been measured did not rank on latency. `routeFactsOf` already
models "never recorded" as `null` and `compareFact` already refuses to let `null` win -
but that produced a *correct order* with a *misleading reason*. Reporting
`uninformedFacts` is the difference between "routed by latency" and "would have
preferred to route by latency, but nothing has been measured, so it ordered by
capability breadth instead". M17 reverts it and is caught.

**Why a policy still cannot add eligibility.** `evaluateCandidate` is untouched and
still runs first. The policy is applied to the already-eligible set, so it can reorder
and cannot resurrect. M19 reverts the governance narrowing and is caught; a test
asserts a denied candidate stays denied even when the policy prefers it.

**Why `select` had to become `async`.** Refusing an unknown policy name threw from
inside `#selectSync`, and `select` was `Promise.resolve(this.#selectSync(...))` - so
the throw escaped **synchronously out of a method whose return type is a promise**, and
`select(...).catch(...)` saw nothing at all. Refusing a bad policy is only useful if
the refusal arrives where the caller is already looking. M18 reverts this and is caught.

**Why `selectionOrder` is now `"policy" | "verified-facts"` rather than a constant.**
`describe()` reported `verified-facts` as a measurement of the primary's ordering. It
became a lie the moment a policy could order it, and a description field that reports
the wrong mechanism is worse than an absent one.

### D-44 - A name is not a measurement: `describe()` is structure, `probe()` is behaviour

**Decision.** `Runtime.probe(): Promise<RuntimeProbe>` asks each registered adapter
`isAvailable()`. The boot check awaits it and prints
`unavailable (NOT available)` rather than `unavailable`.

**Why this was worth a change.** `AgentAdapter.isAvailable()` had **zero callers in
`src/`**, and the CLI printed `description.agentAdapters.join(", ")` - the registered
*names*. The shipped adapter is named `"unavailable"`, so the line read as a
measurement of availability while being a string. That is the worst kind of honest-
looking output: correct today, and a place a real regression would hide in.

**Why a separate method rather than making `describe()` async.** `describe()` is
synchronous structure - how many providers, models and tools exist. Availability needs
the adapter to answer. Folding it in would make `describe()` a promise, and a boot
check that cannot be read synchronously is a boot check that gets skipped. M20 reverts
the probe to a constant `true` and is caught.

**Why an adapter that throws is reported unavailable.** It cannot run. That is the
only honest answer, and swallowing the throw would make a broken adapter look like a
present one.

### D-45 - Agency is not composed, and that is a decision rather than an oversight

**Decision.** The composition root does **not** construct `AgencyAgentAdapter`, and
`describe().agencyAdapterComposed === false`.

**Why not wire it.** Agency is a specialist/capability source, and composing it would
make it a second system authority - which the phase's own invariants forbid. Its
`describe()` is also unreachable by construction: it reads a `roster` the product never
supplies, and the ingest path consumes descriptors from a *source*, never from an
adapter. So the honest state is a tested library class with no production call site.

**Why it needed saying out loud.** The alternative is silence, and silence reads as
"we forgot". A boolean in `describe()` and a line at boot make it a decision. Wiring it
is Phase 08 (Agent Architecture) work, where the agent boundary is the subject.

**Why `AgentAdapter.describe` was kept rather than deleted.** It is a public port
method with a real implementation in two adapters. Removing it would be an API break to
fix a cosmetic problem; the phase's job was to stop it being *invisible*, which the
agency boolean and the boot output do.

### D-46 - No MCP, and the word survives only as a kind

**Decision.** No MCP client, no transport, no dependency, no stub. `"mcp"` remains a
`ToolKind` a future real client would register.

**Why this is a decision and not an omission.** `ToolKind` already contained `"mcp"`,
which is a reasonable forward-compatible taxonomy entry. The temptation is to build the
smallest thing that makes the kind non-empty - and `FINAL_ARCHITECTURE.md` §20 is right
that a stub shaped like MCP is a fabricated capability, because a caller cannot tell a
stub from a client until the day it matters. The boot check now prints
`MCP client  none` so the absence is a stated fact.
---

### D-47 - Composite-key partitioning, and hard isolation

**Decision.** Every customer-data store is partitioned by `(workspace, brand)`. A
workspace comes **only** from an identity with `provenance: "resolved"`; `asserted`,
`delegated` and absent contexts are refused for partitioned work. No cross-workspace or
cross-brand aggregation exists.

**Why it is a decision and not the obvious choice.** Row-level scoping with a filter was
cheaper, and this codebase had already demonstrated (C-1) that "the filter is applied
somewhere" is not "the filter is applied on the path". Every additional query is a fresh
opportunity to forget it, and a forgotten filter fails **open**. A partition fails
**closed** by construction: the other workspace's entry is not reachable, because there
is no key that names it.

**What makes it affordable.** Hard partition usually costs a separate governed
aggregation path, because cross-tenant reporting has to live somewhere. Cross-brand
aggregation was answered **not required**, so nothing had to be built for it. That answer
and this decision are the same decision.

**Where the partition actually is enforced - stated, because it is surprising.** For the
per-instance stores (queue, state, agents, tools, claims, checkpoints, approvals,
coordinator jobs) isolation is enforced by the **INSTANCE**, which belongs to exactly one
workspace. The workspace inside the store key is **defence-in-depth**: load-bearing the
moment one instance serves two workspaces, and not observable through behaviour today.
Nine mutations of those key functions initially survived for precisely this reason. The
wiring is now asserted from source and the battery runs in a mode that can see it, rather
than the observation being quietly dropped.

### D-48 - Five registries stay deployment-scoped, and the claim is machine-checked

**Decision.** `core.providers`, `core.models`, `capabilities`, `verifiers` and
`providerAdapters` remain deployment-scoped. `core.router`, `core.concurrency`,
`core.health` and `orchestrationConfig` join them as telemetry **derived** from the
first five.

**Why derived telemetry shares.** A per-workspace rate limiter with no shared view of
the upstream it is limiting is worse than the flat version: one workspace's traffic could
exhaust a limit the others still believe is available. The counter is about the upstream,
not the customer.

**Why it is recorded as a decision and not a comment.** "It holds no customer data" is a
claim about record types, and a claim about record types rots silently. So each entry in
`describe().platformScopedRegistries` carries **what it holds** and a **required**
`customerData: false`; a test asserts no customer-data registry is listed *and* proves it
positively by checking that each such store's constructor accepts a workspace; and a
source-reading test rejects a workspace, brand or customer-identity field on any platform
record type.

**The non-guarantee, deliberately stated.** This is a claim about the CURRENT record
types. It is not a sandbox: provider credentials live in this inventory, referenced by
**env var name**, and nothing in `src/` resolves one. Two things are therefore explicitly
not claimed - isolation by secrecy of configuration, and any second registry authority.
Every registry is constructed in exactly one place, which a test asserts.

### D-49 - `ModelRecord.metadata` is closed, not caveated

**Decision.** `ModelMetadata` is a mapped type over `MODEL_METADATA_KEYS` with **no index
signature**, enforced at runtime by `validateModelMetadata`. The only sanctioned key is
the declared quality tier.

**Why the closed type alone is not enough, and the runtime half is not redundant.** The
type stops a caller who writes an object literal; it does not stop a caller who *asserts*
one, and asserting is the obvious next move when the type says no. A cast compiles with
no error at all. So the same allowlist is enforced where the value actually lands, and a
test exists specifically to record that reasoning — if `validateModelMetadata` were
deleted by someone who believed the type sufficed, that test fails.

**Why it mattered to this phase specifically.** `core.models` is deployment-scoped, so a
free-form bag inside a model record was the one place in the shared inventory where a
customer identifier could be written and then read by every workspace in the process. A
field-name check cannot see inside a `Record`, which is exactly why the claim
"core.models holds no customer data" was unfalsifiable while the bag existed. It is
checkable now.

### D-50 - The mutation harness gained a second mode, and the probe gained a self-test

**Decision.** The Phase 06 battery patches `dist/` for behavioural mutations and **source**
for structural ones, each with its own control. The independent probe ships with a
`--selftest` that reverts each decision it claims and requires the named check to fail.

**Why.** Nine isolation decisions turned out to have no behavioural detector at all, and
the first run reported them as SURVIVED. That is not a harness bug - it is a real limit:
a source-reading structural test cannot see a mutation of `dist/`, so the two halves were
looking at different files. The alternative was to record nine survivors and explain them
away, or to remove the mutations. Both were rejected: the decisions are real, and a
mutation that cannot be seen is a gap in what the suite asserts rather than a passing test.

**What the controls are for.** A structural run whose control was not green would report
every structural mutation as "caught" for an unrelated reason - the worst kind of false
green. The probe self-test exists for the same reason in the other direction: a probe that
only ever prints PASS has demonstrated nothing.
### D-51 - Breadth is decided once, at grant time, and an over-broad grant is stripped rather than filtered

**Decision.** `withinBreadth` is the only function in the memory subsystem that consults
`SCOPE_BREADTH`. `MemoryAccessPolicy.grant()` removes scopes the subject's operating
scope does not reach, from both `scopes` and `writableScopes`, and reports them in
`{ replaced, refusedScopes }`. `canRead` and `canWrite` consult the grant alone.

**Why.** The alternative - record the whole grant and filter at read time - is more
forgiving and was the pre-existing shape. It puts the same decision in two places, and two
places that decide can eventually disagree, at which point the system holds a memory it
both granted and refused. The refusal is also made visible: `refusedScopes` means a
deployment that asked for too much finds out, instead of discovering a grant that silently
does less than it says.

**What it cost.** The grant record is no longer what the caller asked for. That is the
point, and it is why the difference is returned rather than swallowed.

### D-52 - An absent trust level is `untrusted`, not unconstrained

**Decision.** `MemoryGrant.minimumTrust` is required. `#isCurrent` rejects a grant whose
floor is above the subject's level, and a subject with no `trustLevel` is treated as
`untrusted`. The comparison reuses `meetsTrustFloor` from `agent/trust.ts`.

**Why.** The fail-open default - `trustLevel ?? "privileged"` - would make omitting a field
the single most privileged thing a caller could do, which inverts the entire purpose of
declaring a floor. Fail-closed also fails legibly: a caller that forgets the field gets a
refusal it can diagnose, rather than a grant it did not earn.

**Why reuse rather than a new ranking.** `agent/trust.ts` already had a total order and
`meetsTrustFloor`. Inventing a second one inside the memory subsystem would have produced
two answers to "is this actor trusted enough", and they would eventually disagree.

**What is NOT decided.** Trust still originates in a verified security context the
deployment supplies, and the system trusts it. B-05 remains open.

### D-53 - A rule name in `POLICY_RULES` is a claim of capability

**Decision.** `ephemeral_content` and `duplicate_of_recent` were removed from
`POLICY_RULES`. Every declared rule must be reachable, and that is now proved by an
independent probe check that evaluates one draft per rule.

**Why.** `PolicyEvaluation.rules` reports the rules a decision applied, so a name in the
union is a statement that the policy CAN state that rule. `ephemeral_content` and
`duplicate_of_recent` had no implementation anywhere and were cited by nobody and asserted
by no test - the same shape D-46 rejected for MCP ("a stub shaped like a client"), only
quieter because nothing ever tried to call them.

**Why not implement them here.** `ephemeral_content` would have to define when content is
ephemeral, and `expiring_type` already does the part that matters (a `conversational`
memory gets a seven-day TTL); a second, vaguer rule would be a second way to say it.
`duplicate_of_recent` needs a window of RECENT WRITES, and `evaluate(draft)` is stateless
- it takes no history and returns no decision to be revised - so implementing it means
threading write history through the policy interface. That is a design change nobody asked
for, and one this phase could not have tested honestly.

**The general rule.** A declared-but-unreachable name is removed or implemented, never
left to accumulate. Reachability is cheap to check and the check is now automated.

### D-54 - Retention is not durability, and the difference is now asserted

**Decision.** The scope semantics table's `retention` column states the retention class a
scope is INTENDED to carry. A separate test asserts that no memory survives a restart in
this build.

**Why.** The first draft documented that column as "whether a memory in this scope survives
a restart" and then labelled nine scopes `durable` - in a build whose only provider is
`InMemoryMemoryProvider` and which loses all of them on exit. That is a false claim sitting
in a test file, which is worse than an absent one: a reader takes it as a property of the
system rather than as an intention.

**Why assert it rather than write it in prose.** Prose drifts. A test fails when a durable
provider arrives in Phase 12, and whoever adds it has to decide what the column then means
instead of the two diverging unremarked.

### D-55 - `MemoryService.learning()` removed; the other six dead methods kept

**Decision.** `TODO.md` listed seven `MemoryService` methods as dead in `src/` and asked
for a per-method decision. `learning()` was removed. `correct`, `invalidate`, `markStale`,
`metrics`, `queryFor` and `recallForAgent` were kept.

**Why.** The evidence differed in kind, not just in degree. The six kept methods have
1 to 7 test callers each — dead in `src/`, alive as a library contract, and a caller who
needs them should not have to rediscover them. `learning()` had **zero** callers in `src/`
and zero in any test: a public accessor for an internal store that nothing can call is API
surface a reader must still reason about, and it asserted a contract the repository never
exercised.

**What removal did not mean.** `#learning` is untouched. `learn()` still writes it,
`metrics()` still counts it, and it remains part of what the service does. Only the
unreachable accessor was removed.

### D-56 - Two mutations were promoted from structural to behavioural after surviving

**Decision.** The Phase 07 battery keeps one structural mutation — the orchestrator's
`operatingScope: "task"`, which nothing outside the orchestrator can observe — and mutates
the compiled model for the other two, after both survived a structural run.

**Why.** A structural run loads the compiled suite from `dist/`, whose IMPORTS also come
from `dist/`. A source mutation is invisible to those imports; only assertions that read
files from disk can see one. The scope-hierarchy invariants were already covered
behaviourally by `memoryScopeModel`, so the honest experiment is the one where the suite's
own imports notice the change.

**What this is really about.** A survivor is information, not a failure to be explained
away. The first battery run reported S1, S2 and S3 SURVIVED with `CONTROL` green at 1898,
because `STRUCTURAL_SUITES` still listed only Phase 06's suite. The fix was to correct the
harness, not to remove the mutations.

### D-57 - The mutation harness now verifies its own anchors

**Decision.** `--selftest` re-checks every mutation's anchor against the real source and
reports it as `unique`, `absent`, `ambiguous` or `missing`.

**Why.** The first Phase 07 run reported five HARNESS_ERRORs from stale anchors. The
classifier was working correctly, and reporting them was right — but a stale anchor also
silently REMOVES a mutation from the battery, so the battery would have been quietly
shorter than it claimed. The check found S3's wrong indentation on its first run.

**Why the counts are computed.** An earlier draft printed `PASS (9/4+ checks)`, a hardcoded
label that described nothing. Every count in these harnesses is now derived from the
collections it describes.

### D-58 - The sole-sequencer claim was too strong, and was corrected rather than softened

**Decision.** `authority.ts` no longer calls itself "the single system authority" or "the only
place a task advances through its lifecycle". It calls itself **the agent-execution authority**:
the only production site that selects an agent, invokes an adapter, or runs a subtask wave.
`ExecutionCoordinator` is stated as the owner of workflow state and of every approval gate.
Both claims are asserted from source by `tests/agentAuthority.p08-evidence.test.js`.

**Why the old wording was wrong.** `ExecutionCoordinator` creates jobs, transitions tasks, opens
gates, and `decideApproval` moves a task to `ready` or `skipped` directly. A comment that denies
an existing state machine does not make it go away; it makes the next reader trust the comment.
`TODO.md` PHASE 08 item 2 asked for this claim to be "structural and tested" and it was neither.

**Why not merge the two authorities.** `MASTER_PLAN.md` 4 forbids a rewrite, and they answer
different questions: the coordinator decides *which task may be released*; the orchestrator
decides *which agent runs the work and how it is routed*. They are layered — the coordinator
reaches execution only through `TaskExecutionPort`, whose sole production implementation
forwards to `orchestrator.execute` — so "who runs the agent" has one answer even when a job is
driving. Merging would fuse two state machines to remove a sentence.

**Why the narrow claim is worth asserting.** It is the claim that matters for the failure mode
`authority.ts` opens by warning about, and it is exactly true: `adapter.execute(`, `pool.select(`
and the team runtime's `run(` each have ONE production call site, and all three are in
`authority.ts`. A second one would be a component that believes it decides what runs.

### D-59 - Hermes is not an agent, and cannot be

**Decision.** `MASTER_PLAN.md` 5 lists "Hermes Coordinator" as MVP agent 1. The catalogue in
`src/orchestration/agent/catalogue.ts` does **not** contain it, and
`tests/agentCatalogue.p08-evidence.test.ts` asserts it never will.

**Why.** In this repository Hermes is `TozOrchestrator`, which is not an `AgentRecord`. An agent
record would be selectable by the pool, subject to a trust floor, and disableable by an operator
— so the system's single orchestration authority would be something the agent registry could
switch off. An authority that can be switched off by a registry is a participant, not an
authority. The brief for Phase 08 also forbids handing `TozOrchestrator`'s authority away or
creating a second orchestrator, and a registered Hermes would be exactly that.

**Consequence for the roster arithmetic.** The plan's five and ten become four and nine here.
That is recorded rather than reconciled by inventing a Hermes-shaped agent: the count is
correct for the architecture that exists, and the mapping from plan roles to components is
stated so a reader is not left counting.

### D-60 - The declared-tool boundary is not a configuration switch

**Decision.** `tools.grantUndeclaredTools` is **REMOVED** from configuration, from the validator's
allowlist, and from `env.ts` (`TOZ_TOOL_GRANT_UNDECLARED`). `ToolExecutionHost.verifyReported`
refuses an undeclared tool unconditionally.

**Why.** The field was documented as "When false, an agent may call only the tools it declared"
and read **nowhere**. It was validated, allow-listed, environment-mappable and defaultable, and
could not change any behaviour — a fabricated capability in exactly the shape D-53 named.

**Why remove rather than wire.** Wiring it makes "an agent may call a tool it never declared" a
configuration switch with no authority behind it: no approval, no audit, no governance rule, and
no operator identity to attribute the risk acceptance to. B-05 — whose string may assert what,
and how that is evidenced — is still OPEN. Shipping the switch now would ship the ability to
widen an authority boundary to whoever can edit an environment variable, which is the opposite
of what "tools are not granted, they are earned" means.

**If it is wanted later.** It should arrive as a requirement with an authority model attached,
at which point the unconditional refusal in `verifyReported` is the thing that must change —
deliberately, in a diff, rather than by flipping a default.

### D-61 - An undeclared capability is `unknown`, not a refusal

**Decision.** No change. Recorded because it reads like a bug and is not one.

`CapabilitySet.supporting(...)` sets every capability it does not list to `unknown`. An agent that
supports only `code_execution` has therefore **not refused** `web_research` — it has never claimed
it. The pool does not reject that case unless the request sets `requireVerifiedCapabilities`, at
which point `unknown` stops being an acceptable answer.

**Why that direction.** It is fail-open on purpose: a newly ingested adapter with an incomplete
capability profile stays selectable rather than being unusable, and a deployment that cannot
tolerate that says so in the request. The opposite choice would make every new integration
dead on arrival, which produces agents that are registered but never selected and no signal about
why. Both halves are now asserted in `tests/agentReach.p08-evidence.test.ts`, because "someone
will eventually read omission as refusal" is the predictable future event.

### D-62 - An adapter's reported route is recorded as a claim, and a mismatch is recorded too

**Decision.** `OrchestrationEventKind` gains `agent_reported_route`. After an adapter returns, the
orchestrator reconciles what it ROUTED with what the adapter REPORTED and emits that event when
they differ.

**Why.** `AgentExecutionResult` has always carried `providerId`/`modelId`, documented as "Provider
/model the adapter actually used, when it can report them", and nothing in `src/` read them. On
the self-hosted path (`requiresModelRoute: false`) the orchestrator routed nothing, recorded
`provider: null`, and discarded the only account of where the work went — so an agent that
reached a provider anyway was recorded as having used no provider.

**Why a separate event kind.** `model_routed` means the orchestrator chose it. Reusing that kind
for a value an adapter supplied would make a claim indistinguishable from an authority decision
in the one place an auditor looks. The kind is also silent when the adapter agrees, so it does
not fire once per subtask to say nothing.

**Why the mismatch case is the interesting one.** A routed agent that reports a DIFFERENT
provider was billed, egressed and audited as one route and executed as another. That belongs in
the record rather than being reconciled silently.

### D-63 - The executive layer's port has three capabilities and no more

**Decision.** `src/orchestration/executive/index.ts` defines `ExecutiveControlPort` with exactly
`describe`, `observe` and `submit`. No implementation of an executive layer ships in Phase 08.

**Why the absences are structural.** The brief requires that a future Jarvis cannot advance task
state, approve, govern, or execute. A component's capabilities are its type, so a prohibition
kept only in prose is a convention — and conventions are what this repository keeps finding as
defects. Each forbidden capability is therefore a **missing method**, and
`tests/executiveLayer.p08-evidence.test.ts` asserts the absence against the declaration: the
method count, and the absence of any import of the approval, governance, agent, adapter, pool,
router or team types.

**Why `submit` is not a back door.** It returns `Result<OrchestrationResult, Error>` — the
orchestrator's own verdict, refusals included. An executive layer can request work; it cannot
perform the steps, so it cannot skip identity, governance, approval, capability or tool
authority by using it.

**Why `describe()` reports a literal.** `executiveAuthority` is typed
`"executive-observe-and-submit"`, so a later phase that ships a real implementation changes a
constant in a diff rather than a runtime string nobody reads.

### D-64 - Two PHASE 08 mutations changed mode, and one probe check was not discriminating

**Decision.** Recorded because the method changed, twice, in opposite directions.

**Promoted structural → behavioural (two).** The registry key function and the catalogue's
orchestrator-absence were first written as structural mutations and both **SURVIVED** with
`CONTROL` green — the same lesson as D-56. For the registry it is PHASE 06's: each instance
already belongs to one workspace, so two instances never share a Map and the workspace inside
the key is invisible to behaviour. For the catalogue, the assertion is against the IMPORTED
catalogue, and a structural mutation patches `src/` while the suite's imports come from
unmutated `dist/`. The first is now structural (where Phase 06's key-wiring assertions can see
it); the second is behavioural (where the suite's own imports notice).

**Promoted behavioural → behavioural (one), after a missing test.** The orchestrator reading the
configured default trust floor survived, because every assertion about it read source and no
test RAN a task with no stated floor against a configured default. That was a genuine gap in the
Phase 08 fix, not a harness artefact: the wiring could have been reverted and nothing would have
noticed. A behavioural test now configures a `high` default and asserts a `low`-trust agent
becomes unreachable — with a permissive control, so the test cannot pass by refusing everything.

**One probe check is not discriminating, and is kept anyway.** The probe's cross-workspace check
cannot be made to fail by reverting the registry key, for the reason above. It stays in the probe
— it is a true statement an operator wants confirmed — and it is **absent from the probe
self-test**, with the reason recorded in that file. Listing it as though the probe could detect it
would be claiming a sensitivity the probe does not have; the decision is covered by mutation `S4`.
Two other self-test failures were the probe's own fault and were fixed by making the CHECK
specific: a memory-grant check that used two different actor ids could not see the workspace in
the key, and an authorization check used a `low`-trust caller so a trust rule refused regardless
of the grant rule.


### D-65 - A skill is a bundle of requirements, and the table is the design

**Decision.** `src/orchestration/skill/skill.ts` defines a skill as a **validated, versioned
bundle of requirements**: the capabilities it needs, the tools it needs, and a reviewable
summary. It is a new subsystem, not a mode of `ToolRegistry`.

| Concept | Cardinality | Can reach authority | Runs things |
|---|---|---|---|
| Capability | an atom (a name) | no | no |
| Tool | ONE invokable call | YES | yes |
| Agent | an executor | YES | yes |
| **Skill** | a bundle of REQUIREMENTS | **no** | no |

**Why.** `D-09` had already decided half of this ("a skill is a capability bundle with lifecycle
and authority; a tool is one callable") and left the contract open. The table is what makes the
new file justified rather than a preference: a skill shares no cardinality with a tool, shares
no lifecycle with an agent, and — the row that matters — differs from both in the one column
that carries risk.

### D-66 - "Declares, does not confer" is enforced by ABSENCE, not by convention

**Decision.** `SkillRegistry` has no method that grants, confers, elevates or widens anything,
and no bulk-load path. The capability check runs from the caller's capabilities against the
skill's requirements, in that direction only.

**Why.** `TODO.md` PHASE 09 states the prohibition; it does not say how to make it true. The
dangerous implementation is the obvious one — a skill that, when loaded, ADDS its capabilities
to the caller's set — because then every skill an operator installs is a privilege escalation
performed by the operator who installed it.

**Why absence rather than a rule.** A prohibition a caller can violate with one line of code is
a comment. This is now the third such rule in this repository (Phase 07's absent-trust-means
`untrusted`; Phase 08's executive port; this), and each time the enforcement had to be
missing vocabulary rather than a documented intention. The recurrence is the argument for
checking absences structurally from now on.

### D-67 - Validation happens at registration, so an invalid skill never exists

**Decision.** `register()` validates and stores nothing on failure. A duplicate `skillId`@
`version` is refused rather than replacing, and changing a skill means a version change.

**Why.** Validating at load time instead would leave a window in which an invalid declaration is
in the registry and appears in `names()` — precisely the window a reviewer would be inspecting.
The duplicate rule follows from the same logic: a silent replace lets an installed skill change
under a caller who already reviewed the old one, which converts review into a race.

### D-68 - Every load ATTEMPT is recorded, refusals first among the interesting ones

**Decision.** `SkillRegistry` takes an optional `SkillLoadSink` and reports every outcome to it.
The composition root wires it to the runtime's audit trail under two distinct event kinds,
`skill_loaded` and `skill_load_refused`.

**Why "attempt", not "load".** A log of successful loads is a log of what worked. The entry
worth having is the refusal, with which refusal and what was missing.

**Why the sink is a function.** The registry then depends on nothing, and a caller with nowhere
to send records is not forced to invent a collector. That makes the wiring the composition
root's job — and therefore something a test has to check, which it initially did not.

**Why the events go to the audit trail rather than into the registry.** The registry holds
declarations, which are platform-scoped deployment configuration. "Who loaded what, in which
workspace" is ACTIVITY and is partitioned; keeping a private in-registry log would have been one
answer to a partitioned question living outside the partition.

### D-69 - The bad-mutation control SURVIVED, and that is the better outcome

**Decision.** The Phase 09 bad control adds a harmless `description()` accessor to the registry,
which no suite claims to forbid. It SURVIVED, and the harness reported that as OK.

**Why it is recorded.** Phase 08's bad control was CAUGHT, which shows the harness detects a
defect. A SURVIVED control shows something stronger: that the harness does not simply catch
everything, so "0 survivors" in the battery above is a measurement rather than an artefact of a
runner that fails on any change. Both outcomes are acceptable; they are not equally informative.

### D-70 - Four Phase 09 mutations were inert, misfiled, or aimed at a test that did not exist

**Decision.** Recorded because the method changed and the numbers only mean something because of
it. Three separate classes, all found by the battery itself rather than by inspection.

**Inert mutations (two survived).** One widened the *type* of `skillAuthority` to
`"declares-only" | "may-confer"` while leaving the reported value alone. Another added a
*comment* about a second registry without adding one. A mutation that changes a declaration
without changing behaviour tests nothing, and it is the easiest kind to write by accident because
typecheck passes and the file still parses.

**A misfiled mutation (harness error).** A `dist/` path sat in the structural list, whose staging
copies `src/`, and the harness reported `HARNESS_ERROR missing composition.js`. The classifier
was right and the mutation was wrong. This is the third time a mutation has changed mode in one
phase — after D-56 and D-64 — and the rule is now written into the harness headers: a structural
mutation is visible only to an assertion that reads files from disk.

**A missing test, not a bad mutation.** The first run reported three survivors, and two of them
were the sink wiring and the boot report — because every assertion about those read SOURCE.
The wiring could have been reverted silently. Two end-to-end tests were added (load through a
real `createRuntime()` and read the events back; assert `describe().skillAuthority` where it is
produced), after which both mutations were rewritten to change behaviour.


### D-71 - The knowledge port is accepted and consulted by nothing, so the runtime now says so

**Decision.** `RuntimeDescription.knowledge` is `"unattached"` or `"attached-not-consulted"`,
and `runtime:describe` prints it. No production path calls the provider, and a test asserts
that.

**Why.** `KnowledgeProvider` was accepted by `createRuntime` and threaded all the way into
`Core`, and nothing in `src/` ever queried it. So attaching a full RAG backend changed nothing
observable and `describe()` gave a deployer no way to learn that.

**Why this is worse than the usual fabricated capability.** A `ToolRegistry` with no tools is
empty. A knowledge port with a provider ATTACHED is a promise — the caller did the wiring, so
the natural reading is that something uses it. That asymmetry is what makes it worth reporting
rather than leaving.

**Why not wire it.** AnythingLLM is PHASE 13's external boundary and `TODO.md` says to keep
the port until real. Building the integration here would invert the risk order that D-10 set out
when n8n moved from draft 09 to 13.

**What Phase 13 must change.** The assertion that no file calls `knowledge.query(`. That test
failing is the signal, and replacing it deliberately is the point — rather than the check
quietly ceasing to be true while the code moved on.

### D-72 - Relevance is a gate in the SCORER, and an audit of the filter would say it is not

**Decision.** No change to the gate. It is recorded, tested behaviourally on both halves, and
`TODO.md` item 4 is corrected to say where the gate lives.

**Why this needed a decision at all.** `TODO.md` said "relevance must remain a gate, not a
ranking nicety", which is true — but the gate is in `RetrievalScorer.score`, where a
non-matching item is returned as `null`. `RetrievalEngine.#passesFilters`, which is where a
reader would reasonably look, has **no score floor at all**. An audit that read only the filter
would have concluded the gate was missing and added one, producing two gates and a second place
that decides — the exact defect D-51 removed from the access policy.

**Both halves are asserted, including the one a fix breaks.** A query naming terms returns
nothing for a memory matching none of them, however recent, important and verified. And an
**empty** query still recalls, because a query with no terms makes no relevance claim; the
gate's condition carries `queryTerms.length > 0` for exactly that reason.

### D-73 - Two of this phase's own claims could not be made to fail, and one of them was removed

**Decision.** One structural mutation was written, survived, and was **removed**. The
unfalsifiable claim it targeted is listed by name in the probe's self-test output under
`UNTESTABLE HERE`.

**Which claim, and why it cannot fail.** `knowledge/port.ts` claims "the core orchestrator
never imports a concrete knowledge implementation". No mutation of the current source can
violate it, because there is no concrete knowledge implementation in `src/` to import — the
invariant is true by absence of subject matter. The first attempt added a second import *from*
`knowledge/port.js`, which the check permits correctly, since importing the port is what it
demands. Expressing a real violation needs a new `knowledge/<vendor>.ts` file, and a
string-replacement harness cannot create one.

**Why remove rather than keep.** A mutation that survives for a reason nobody can articulate
looks like a coverage gap that has been papered over. Leaving it in the battery would have made
"0 survivors" a number that had been arranged rather than measured. The underlying **test**
stays, because it becomes falsifiable the moment a vendor module exists.

**The pattern, now named.** This is the second non-discriminating claim in three phases, after
PHASE 08's cross-workspace check. The rule that has emerged: when a claim cannot be made to
fail, either say so where the claim lives or drop it — never leave it inside a battery where its
survival implies coverage that does not exist.

**And a third correction of a different kind.** One probe mutation was filed under the wrong
half of its condition: changing \`queryTerms.length > 0\` to \`> 99\` stops the gate firing for
short queries, which breaks the "returns nothing for an irrelevant memory" check rather than
the "an empty query still recalls" check it was written for. Two halves of one condition, two
different breakages — worth knowing before writing the next one.
