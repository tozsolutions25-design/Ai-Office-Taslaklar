# CHANGELOG

> Execution-state changelog for the takeover plan. Records state transitions and
> decisions, not code history — for code history use `git log`.

Format: date-less, ordered newest first, one entry per phase transition or
material state change.

---
## [Phase 10] Knowledge / RAG Boundary - PASS

**State transition:** `Phase 10: NOT STARTED` -> `Phase 10: PASS`.

**Three of the four TODO items were already true, and the fourth was not.** That is the honest
headline, and it belongs first: a phase that builds nothing is a phase whose audit did its job.

- `EmbeddingProvider` has **no implementation** — verified by scanning `src/`, not even an
  unavailable one. Now pinned by a test, because "no fake ships" decays the moment someone
  adds one.
- The three ingestion classes are boundary-only — **in `memory/ingestion.ts`, not under
  `knowledge/`**, which the TODO's wording did not say and where a reader would look first.
  They are tested, and the composition root constructs none of them.
- Relevance **is** a gate — but in `RetrievalScorer.score`, not in
  `RetrievalEngine.#passesFilters` as the TODO's wording implies. The filter has **no score
  floor at all**, so an audit reading only it would have concluded the gate was missing and
  "fixed" a correct system by adding a second gate — the defect D-51 removed from the access
  policy. Both halves are now asserted behaviourally, including the one a fix breaks: an
  **empty** query still recalls, because a query with no terms makes no relevance claim.

**The gap: a knowledge provider could be attached and never consulted, invisibly.**
`KnowledgeProvider` was accepted by `createRuntime`, threaded all the way into `Core`, and
queried by **nothing** in `src/`. Attaching a full RAG backend changed nothing observable and
`describe()` said nothing either way.

That is the fabricated-capability shape D-53 names, and a worse instance than the ones found
before, because the port is not inert — it is **accepted**. An empty tool registry is empty; a
knowledge port with a provider attached is a *promise*.

The fix is not to build the integration: AnythingLLM is **PHASE 13**'s external boundary and
D-10 moved external dependencies behind a sound governance path deliberately. So the boundary
was made honest instead. `describe().knowledge` is `"unattached"` or
**`"attached-not-consulted"`** — the second half is the point — `runtime:describe` prints it,
and a test asserts no production file calls the provider. **Phase 13 changes that test,
deliberately, in a diff.** The port's own two claimed invariants, which nothing tested, are now
asserted too.

**A mutation was written, survived, and was removed because it could not fail** (D-73). It
targeted "the core never imports a concrete knowledge implementation" — true by **absence of
subject matter**, since no concrete implementation exists to import. The first attempt added a
second import *from* `knowledge/port.js`, which the check permits correctly, and expressing a
real violation would need a new file, which a string-replacement harness cannot create. It was
removed rather than left in a battery where its survival would imply coverage that does not
exist; the **test** stays and becomes falsifiable the moment a vendor module exists. This is the
second non-discriminating claim in three phases, after PHASE 08's cross-workspace check, so it
is now a named pattern rather than a surprise.

**Gate evidence.** typecheck / lint / build / clean rebuild PASS. Full regression **1971/1971**
across 296 suites. Mutation battery **7/7 caught, 0 survivors, 0 harness errors**. Bad control
**CAUGHT**. Harness self-test **19/19**. Independent probe **7/7**, probe self-test **7/7**.
Prior batteries and probes re-run with no regression: PHASE 09 12/12 and 8/8, PHASE 08 16/16 and
12/12, PHASE 07 14/14 and 11/11. `config:validate` VALID with `TOZ_ENV=test`.
`runtime:describe` PASS.

**Deferred, with reasons and owners.** `KnowledgeProvider` is still consulted by nothing —
that is this phase's reporting, not an oversight, and Phase 13's to change. There is no RAG: no
vector index, no embeddings implementation, no document store. The ingestion boundary is
deliberately unwired. Relevance is **lexical**, so a genuinely relevant memory sharing no query
terms is still refused — the honest behaviour of a lexical gate, and the argument for a semantic
one, which needs an index and so is Phase 13. **B-05** and **B-07** remain open and neither
blocks this phase.

---
## [Phase 09] Skill Architecture - PASS

**State transition:** `Phase 09: NOT STARTED` -> `Phase 09: PASS`.

**Greenfield, as `DECISIONS.md` D-09 recorded.** Nothing existed, so the phase's first
deliverable was the answer to `TODO.md` item 1 — what a skill IS — and it is a table rather
than a mode of an existing registry:

| Concept | Cardinality | Can reach authority | Runs things |
|---|---|---|---|
| Capability | an atom (a name) | no | no |
| Tool | ONE invokable call | YES | yes |
| Agent | an executor | YES | yes |
| **Skill** | a bundle of REQUIREMENTS | **no** | no |

A skill is a validated, versioned bundle of requirements: the capabilities it needs, the tools
it needs, and a summary a human can review before installing it. Loading it checks those
requirements against a real caller and records the attempt. It shares no cardinality with a
tool and no lifecycle with an agent, which is why `src/orchestration/skill/skill.ts` is a new
file rather than a mode of `ToolRegistry` — the retrofit D-09 forbade.

**The two prohibitions are enforced by absence, not convention.** `TODO.md` says skills must
not become a way to grant authority, and that loading must be on-demand only. Neither is stated
as a mechanism, so: `SkillRegistry` has **no method** that grants, confers, elevates or widens
anything, and **no bulk-load path** — one loader, taking one skill, because a `loadAll()` would
satisfy every word of the requirement while violating it. The capability check runs from the
caller's capabilities against the skill's requirements, in that direction only, so loading can
REFUSE and can never confer. This is the third such rule in this repository after Phase 07's
absent-trust-means-`untrusted` and Phase 08's executive port.

**Validation happens at registration, so an invalid skill never exists.** Not at load time —
that would leave a window in which an invalid declaration sits in the registry and appears in
`names()`, which is the window a reviewer would be inspecting. A duplicate `skillId`@`
version` is refused rather than replacing, so review cannot become a race.

**Every load ATTEMPT is recorded**, refusals included, with the refusal kind and what was
missing. The records go to the runtime's audit trail under two distinct event kinds,
`skill_loaded` and `skill_load_refused` — both declared AND emitted, because `TODO.md`
PHASE 11 already records 15 orchestration kinds that are never emitted and calls that a
fabricated capability. `runtime:describe` now prints `skills  0 (declares-only: a skill
declares what a caller must already hold)`, because a count alone would leave open the only
question that matters about this subsystem.

**The battery found four bad mutations of my own making**, and the numbers only mean something
because it did (D-70). Two were **inert** — one widened the *type* of `skillAuthority` while
leaving the reported value alone, another added a *comment* about a second registry without
adding one — and both survived, because a mutation that changes a declaration without changing
behaviour tests nothing. One was **misfiled**, a `dist/` path in the structural list, and the
harness reported HARNESS_ERROR rather than counting a load failure as a catch. And two
survivors were a **missing test** rather than a bad mutation: every assertion about the sink and
the boot report read SOURCE, so the wiring could have been reverted silently. Two end-to-end
tests were added — load through a real `createRuntime()` and read the events back, and assert
`describe().skillAuthority` where it is produced — and both mutations were rewritten to change
behaviour.

The **bad-mutation control SURVIVED**, which is the more informative outcome: PHASE 08's was
CAUGHT, showing the harness detects a defect, while a SURVIVED control shows it does not simply
catch everything — so "0 survivors" is a measurement rather than an artefact.

**Gate evidence.** typecheck / lint / build / clean rebuild PASS. Full regression **1962/1962**
across 295 suites. Mutation battery **12/12 caught, 0 survivors, 0 harness errors**. Bad
control SURVIVED (as designed). Harness self-test **23/23**. Independent probe **8/8**, probe
self-test **9/9**. Prior batteries and probes re-run with no regression: PHASE 08 16/16 and
12/12, PHASE 07 14/14 and 11/11. `config:validate` VALID with `TOZ_ENV=test`.
`runtime:describe` PASS.

**Deferred, with reasons and owners.** A skill does not **execute** — there is no runtime for it
and inventing one would be the fabricated-capability shape D-53 and D-09 exist to prevent; a
workflow that runs skills is PHASE 14. The load log is **process-local**, so it does not survive
a restart: Phase 12, and the reason records go to the partitioned audit trail rather than into
the registry. No skill is installed by default. **B-05** and **B-07** both remain open and
neither blocks this phase.

---
## [Phase 08] Agent Architecture - PASS

**State transition:** `Phase 08: NOT STARTED` -> `Phase 08: PASS`.

**The existing architecture was kept; the claims about it were corrected.** The audit found
`MASTER_PLAN.md` §5 accurate — enforced lifecycle, leaf-shaped adapter port, deterministic
two-stage selection, a reason for every selected and rejected candidate. What needed work was
what the code said about itself.

**The sole-sequencer claim was FALSE as written, and is now true as narrowed.**
`authority.ts` called itself "the single system authority" and "the only place a task advances
through its lifecycle". `ExecutionCoordinator` is a second, fully-enforced state machine that
creates jobs, transitions tasks, opens gates, and whose `decideApproval` moves a task to
`ready` or `skipped`. `TODO.md` PHASE 08 item 2 had asked for this claim to be made
structural and tested; it was neither. It is now **the agent-execution authority** — the only
production site that selects an agent, invokes an adapter, or runs a subtask wave — asserted by
counting call sites in `src/`. The two authorities are layered, not parallel: the coordinator
reaches execution only through `TaskExecutionPort`, whose sole production implementation
forwards to `orchestrator.execute`.

**The configured trust policy reached neither place it belongs.**
`agent.defaultMinimumTrust` is documented as the floor used when a task states none, and was
implemented nowhere — its only read fed `SpecialistPool.maximumTrustFloor`, a different
question. Because that guard refuses a request whose floor is ABOVE it, the shipped default of
`"low"` meant **every task asking for `standard` or more was refused outright**. Meanwhile the
behaviour the field does document was hardcoded as the literal `"low"` at three sites.
`agent.maximumTrustFloor` is new; the default is now wired to the orchestrator, and a
behavioural test proves it is used.

**An agent that reached a provider anyway was recorded as having used no provider.**
`AgentExecutionResult` has always carried `providerId`/`modelId` — "Provider/model the adapter
actually used, when it can report them" — and nothing in `src/` read them. On the self-hosted
path the orchestrator discarded the only account of where the work went. The new
`agent_reported_route` event records it as a claim, stays silent when it agrees with the route,
and records a **mismatch** when a routed agent reports something else.

**Three declared-but-unreachable surfaces were removed**, applying `DECISIONS.md` D-53 rather
than leaving them to accumulate: `DEFAULT_TRUST_REQUIREMENT` and `AgentTrustRequirement`;
the unreachable rejection reason `"unhealthy"` (there is no such `HealthStatus`); and
`tools.grantUndeclaredTools`, a validated, environment-mappable switch that read nothing. The
last was removed rather than wired because wiring it would let anyone who can edit an
environment variable widen an authority boundary, with no approval and no operator identity,
while B-05 is open.

**The catalogue went from empty to nine declared roles.** No `agentId` literal existed anywhere
in `src/`. `src/orchestration/agent/catalogue.ts` now declares the MVP four and the production
core five, each registering `disabled` and unpromoted. **Hermes is deliberately not one of
them**: that role is held structurally by `TozOrchestrator`, and an agent record would put the
single orchestration authority inside a registry where a trust floor could reject it and an
operator could disable it. The composition root does **not** compose the catalogue.

**The executive layer's port exists; its implementation does not.** `ExecutiveControlPort` has
exactly `describe`, `observe`, `submit`, and the phase ships no Jarvis. The brief's
prohibitions — no advancing task state, no approving, no governing, no executing — are
**missing methods** rather than prose, and the suite asserts the absence against the declaration
and against the module's imports.

**The harness corrected itself three times, and all are recorded (D-64).** The structural stage
copied `src` but not `tests`, so a suite died with `ENOENT` and the harness reported a BROKEN
structural control — which would have invalidated every verdict for an unrelated reason. One
mutation survived because **a test was missing**: every assertion about the configured trust
default read source, and nothing ran a task with no stated floor, so the Phase 08 wiring could
have been reverted silently. Two mutations changed mode rather than being removed, in opposite
directions. And one probe check is kept but is absent from the self-test, because it cannot
discriminate — its decision is covered structurally instead.

**Gate evidence.** typecheck / lint / build / clean rebuild PASS. Full regression **1949/1949**
across 293 suites. Mutation battery **16/16 caught, 0 survivors, 0 harness errors**. Bad
control **CAUGHT**. Harness self-test **27/27**. Independent probe **12/12**, probe self-test
**10/10**. Prior batteries and probes re-run with no regression: PHASE 06 21/21 and 8/8, PHASE
07 14/14 and 11/11. `config:validate` VALID with `TOZ_ENV=test`. `runtime:describe` PASS.

**Deferred, with reasons and owners.** No agent can execute — the catalogue names the honest
`UnavailableAgentAdapter`, and a real adapter is Phase 13. An adapter's reported route is a
**claim**; verifying a destination needs an allowlist, also Phase 13. The destination an adapter
reaches remains outside TOZ's visibility. `ToolExecutionHost.invoke` still has no caller, so an
agent can only report a tool call and the report is verified after the fact — the declared-tool
boundary is now unconditional rather than optional. `authority.ts` and `coordinator.ts` were
deliberately **not** split; the reasoning is in `FINAL_ARCHITECTURE.md` §24.16. **B-05** and
**B-07** both stay open, and B-05 now has two Phase 08 decisions leaning on it staying so.

---
## [Phase 07] Memory Architecture — PASS

**State transition:** `Phase 07: NOT STARTED` -> `Phase 07: PASS`.

**The two Phase 06 defers are closed.** `SCOPE_BREADTH` is now **derived** from
`MEMORY_SCOPES` in declaration order, so the ordering has one source and no second
table to drift; and `importanceCeilingFor` normalises by `MAX_SCOPE_BREADTH` instead of a
literal 20, which makes the `Math.max(0.2, ...)` floor beside it **reachable** for the
first time. The per-scope ceiling is now load-bearing in `DefaultWritePolicy`, applied
after the floor, and it cites `importance_ceiling` only when a clamp actually happened.

**Breadth is decided once.** `withinBreadth` is the only function that consults
`SCOPE_BREADTH`; `MemoryAccessPolicy.grant()` strips scopes the subject's operating scope
does not reach and returns them in `refusedScopes`. An over-broad grant is no longer
recorded and then filtered at read time.

**Trust is enforced, and absence is not privilege.** `MemoryGrant.minimumTrust` is
required and checked beside grant expiry using the existing `agent/trust.ts` ranking. A
subject with no `trustLevel` is treated as **`untrusted`** - the fail-open default would
have made omitting a field the most privileged act available to a caller. B-05 stays
**open**: trust still originates in a deployment-supplied context the system trusts.

**Seven defects were found, none of which were in the plan.** `invalidate()` wrote by key
into an id-keyed map (invisible on every read path, and it made each reuse of a key add a
permanent entry); `listScope()` ignored expiry while `get()` honoured it; `liveCount()`
counted addresses rather than retrievable beliefs; `RetrievalEngine` reported the
`"semantic"` strategy while discarding the query vector it had just computed, with no
vector index to search; `ephemeral_content` and `duplicate_of_recent` had been declared
as policy rules since Phase 05 with no implementation anywhere; `MemoryService.learning()`
had zero callers in `src/` and zero in tests; and the Phase 07 scope table claimed
durability for nine scopes in a build whose only provider is process-local.

**One claim was retracted rather than fixed.** The scope table's `retention` column was
documented as "whether a memory in this scope survives a restart" and labelled nine scopes
`durable`. It now states the retention class a scope is *intended* to carry, and a
separate test asserts the honest physical fact — that nothing survives a restart — so the
intent cannot drift back into a promise when Phase 12 adds a durable provider.

**The harness corrected itself twice, and both are recorded in `DECISIONS.md` (D-56,
D-57).** The first battery run reported three SURVIVORS with `CONTROL` green, because
`STRUCTURAL_SUITES` still listed only Phase 06's suite; two of those mutations were then
promoted to behavioural, having established that a structural run's suite imports come
from unmutated `dist/`. And five HARNESS_ERRORs from stale anchors showed that an
unverified anchor silently removes a mutation from the battery, so `--selftest` now
re-checks every anchor against the real source.

**Gate evidence.** typecheck / lint / build / clean rebuild PASS. Full regression
**1900/1900** across 286 suites. Mutation battery **14/14 caught, 0 survivors, 0 harness
errors**. Deliberate bad-mutation control **CAUGHT**. Harness self-test **25/25**.
Independent probe **11/11**, probe self-test **12/12**. `config:validate` VALID with
`TOZ_ENV=test` (the variable is required). `runtime:describe` PASS.

**Deferred, with reasons and owners.** No memory survives a restart (**Phase 12**).
Semantic retrieval reports itself unavailable and names why, because there is no vector
index to search (**Phase 10**). The general question of what distinguishes an `episodic`
memory from a `semantic` one is still open, though the policy now treats a *transient*
failure differently from a permanent one. And `MemorySubject.operatingScope` remains an
ordinary field: production has one construction site and that is asserted from source, but
closing the type itself needs an opaque subject token from the identity layer.

---
## [Phase 06] Workspace / Brand Isolation — PASS

**State transition:** `Phase 06: NOT STARTED` -> `Phase 06: PASS`. `B-04` ->
`RESOLVED`, **with scale deliberately left open** as a recorded decision rather than an
assumption.

**User decisions taken, not inferred.** Composite-key partitioning with **hard
isolation** (no cross-brand or cross-workspace aggregation). Five registries stay
deployment-scoped - `providers`, `models`, `capabilities`, `verifiers`,
`providerAdapters` - because they hold deployment configuration rather than customer
data, under three attached conditions that are enforced rather than documented:
`describe()` lists each with what it holds and a required `customerData: false`; a
structural test proves no customer-data registry is in that list *and* proves it
positively via each store's constructor; and no platform record type may declare a
workspace, brand or customer identity.

**`ModelRecord.metadata` was closed, not caveated.** It was
`Record<string, unknown>` inside a registry `describe()` calls deployment-scoped - the
one reason "core.models holds no customer data" was unfalsifiable, because a field-name
check cannot see inside a `Record`. It is now a mapped type over an allowlist with no
index signature, plus a runtime validator, because a **cast compiles with no error** and
the runtime half is the part that holds.

**Nine defects found, none of them on the plan.** All the same shape: a partition applied
on read and forgotten on write. The worst was `createCore` building the queue, the state
store and the **audit log** with no workspace, so a declared runtime reported
`"partitioned"` while the audit history it then read was empty.

**A method change, recorded because it is the durable part.** Nine mutations of store key
functions survived the first battery run. They were correct mutations of real decisions
that had **no observable behaviour**, because each store instance already belongs to one
workspace. Rather than delete them or excuse them, the key wiring is now asserted from
source and the harness gained a second, source-patching mode with its own control. A
structural run whose control was not green would have reported all nine as "caught" for
an unrelated reason.

**Evidence:** 1864/1864 tests (279 suites); architecture/isolation 261/261 (42 suites);
Phase 06 mutation battery 21/21 caught, 0 survivors, 0 harness errors; prior batteries
02-05 re-run green (25/25, 34/34, 21/21, 21/21); bad-mutation control CAUGHT; mutation
harness self-test 9/9; independent probe 8/8; probe self-test 6/6; `config:validate`
VALID; `runtime:describe` PASS.

**Still open, deliberately:** scale (how many workspaces and brands in 12 months - no
architecture was invented from it); B-05 authentication (the resolver is trusted);
memory scope breadth and two `importanceCeilingFor` defects (PHASE 07, pinned by tests
so the deferral cannot go stale).

---

## [Phase 04] Approval / Execution Boundary — PASS

**State transition:** `Phase 04: NOT STARTED` → `Phase 04: PASS`. `B-05 question 3:
OPEN` → `answered (what an approval is bound to)`; `B-05 question 2` untouched.
`B-13: NEW, MEDIUM, Phase 05` raised. `B-11`, `B-12` re-verified unchanged. B-02
still open. Runtime dependencies still 0. Jarvis still not implemented.

The phase's question was not "can a human approve a task" — Phase 03 proved that.
It was **what an approval is bound to, whether anyone can forge that, where the
record lives, and who re-drives afterwards.**

### Delivered

- **An approval is bound to the content it was granted for.** `ApprovalGate.binding`
  is a SHA-256 digest of objective, input, required capabilities and minimum trust.
  `ApprovalRegistry.open` and `ApprovalRegistry.mayRelease` each take an *intent*
  and each **derive** the digest themselves; a mismatch refuses and names both
  digests. `ExecutionCoordinator.openApproval` takes **no** intent and derives from
  the record the coordinator holds. There is no field through which a caller could
  assert that two contents match — the class of defect D-23 and D-30 were about.
  Capabilities are sorted, because the requirement is a set and a reordering is not
  a change of material. The digest is **stored on the record**, not only checked, so
  a decided gate names its material and an auditor re-derives nothing.
- **`ApprovalRecordStore`, and an honest durability claim.** A five-member port;
  `InProcessApprovalRecordStore` is the only implementation and declares
  `durability: "process-local"`. Every registry read and write goes through it, so
  Phase 12 swaps one constructor argument. `describe().approvalDurability` reads
  the value **from the store**, and `runtime:describe` prints it. No provider was
  invented to satisfy a phase that is not this one.
- **The brief's six categories, mapped onto seven real operations** —
  `HUMAN_APPROVAL_CATEGORIES` / `HUMAN_APPROVAL_OPERATIONS`, beside the two existing
  classifications, with the catalogue-drift test now covering all three. **A
  classification, not a second switch**: `governance.approvalRequired` stays the
  only thing that demands a human, and `ApprovalRule` reads none of it. What the
  map makes possible is the direction nobody could previously read, so the gap is
  now a printed number: `classified as needing one 7, configured to need one 2`.
  The shipped default was **not** changed — which operations require a human is
  policy (B-07-shaped), and the phase was asked to verify the mechanism.
- **Re-drive is caller-owned, and the obligation is detectable.**
  `ExecutionCoordinator.redriveRequired` reports tasks holding an approved gate in
  state `ready`; `describe().approvalRedrive` states it. No `setInterval`, no
  `setImmediate`, no `node:timers` in the workflow layer, and a test says so — the
  pre-existing `setTimeout` per-task **timeout** is a bound on work already in
  flight, not a schedule. Before this, a decision that made a task runnable
  produced **no signal at all** — a forgotten re-drive was indistinguishable
  from a slow system.
- **`authoriseExecution` removed rather than wired**, and its five specification
  tests re-asserted against `ExecutionCoordinator` with a positive control. Wiring
  meant either duplicating `executeTask`'s checks, or reversing the PHASE 01 (C-3)
  order so a claim is a precondition of authorisation — which would let a
  gate-blocked task consume and release a claim on every attempt.
- **`approvalGatesFor()`** — the production `ApprovalGatePort` factory, exported
  from the composition root, replacing a duplicate port implementation.
- **B-13 raised and bounded.** `authorizeToolCall` states an approval requirement it
  cannot satisfy, one wiring mistake from being live, where it would fail closed by
  accident rather than by design. A test asserts no execution path calls
  `ToolExecutionHost`.

### The honest part

A `TaskRecord.task` is never patched after `createJob`, so **in the composed path the
binding cannot drift today** and the guarantee is structural rather than exercised.
It is proved at the authority against a deliberate mismatch, and the battery removes
each digest field in turn. What the change buys *today* is mostly **attributability**;
drift protection becomes live the moment something can edit a task. Recorded rather
than presented as a defence that is already being tested under fire.

### Numbers

| | |
|---|---|
| Tests | **1754/1754**, 268 suites, 0 skipped, 0 todo, 0 cancelled (was 1729) |
| New tests | **+30**, one file; **5** dead-code specification tests deleted |
| Pre-existing test files touched | 6, mechanically — no assertion weakened |
| Mutations | Phase 04 **21/21 CAUGHT**; Phase 03 **34/34**; Phase 02 **25/25**; 0 survivors, 0 harness errors |
| Probe | **70/70** (49 → 70); self-test **16/16** reverts detected, 0 false positives |
| Architecture / isolation | 238 tests across seven files |
| Runtime dependencies | **0**, unchanged |

Four mutations survived the first run of the Phase 04 battery and every one was a
**weak test, not a strong implementation** — a capability set never written in a
different order, an objective and an input changed together so neither was
provably load-bearing, and a redundant guard masking another. The battery found all
four before they could be reported as PASS.

---

## [Phase 05] Provider / Tool Boundary — PASS

**State transition:** `Phase 05: NOT STARTED` → `Phase 05: PASS`. `B-09: OPEN` →
`RESOLVED`. `B-13: MEDIUM, Phase 05` → **half-closed and re-scoped to Phase 13**.
`B-11`, `B-12` untouched. B-02 still open. Runtime dependencies still **0**. Jarvis
still not implemented. MCP still absent.

The five `TODO.md` items are all closed or decided. The work that mattered was not on
that list.

### Delivered

- **The tool boundary stopped believing its own callers.** `authority.ts` was writing
  an adapter's self-reported tool call into the run's evidence with
  `sideEffecting: false` hardcoded and **no authorisation check**. An irreversible
  action was recorded as harmless, and an unauthorised one was recorded as having
  happened. Now the ONE tool authority decides: a tool the agent never declared, one
  that is not registered, one above the agent's trust floor, or one that is
  side-effecting with no approval is **refused**, produces **no evidence**, and
  **fails the subtask**. `sideEffecting` comes from the registry; `durationMs` stays
  `null` because the host measured nothing; `tool_invoked` and `tool_refused` are
  emitted from verified facts. The three `tool_*` kinds had never been emittable.
- **`ToolExecutionHost` is wired, as the single tool authority.** The composition root
  hands the orchestrator the same host it exposes, and the orchestrator refuses a host
  built over a different registry.
- **B-09 closed: the configured policy orders the PRIMARY.** `RoutingRequest.policy`
  carries it to the one router, which orders with the `orderByPolicy` engine that
  already existed. `RoutingDecision.ordering` reports `decidingFacts` **and**
  `uninformedFacts`, so "routed by latency" is distinguishable from "nothing has been
  measured". A policy orders; it cannot add eligibility, and governance's narrowing
  still runs first.
- **B-13 half-closed: the side-effect approval is obtainable.** `ToolCallApproval` is a
  real value the one authority issues, bound to a tool, a subject, a named approver and
  an instant - and the refusal now names how to satisfy it instead of being a dead end.
  No flow issues one during an execution, so an irreversible tool is refused and
  `describe().toolApproval` reports `required-and-unobtained` at boot.
- **`DefaultRouter.select` rejects instead of throwing synchronously.** A refused
  policy name escaped a promise-returning method, so `.catch(...)` saw nothing.
- **The dead methods are decided, not left to rot.** `isAvailable()` is now called -
  `runtime.probe()` asks each adapter and the CLI prints the answer, replacing a line
  that printed an adapter's *name* where a reader reads an availability. `describe()`
  is kept as a library contract. The agency adapter is **not composed**, and
  `describe().agencyAdapterComposed` says so. No MCP, stated at boot.

### Two amended tests, and the reason is the point

- PHASE 02 asserted the primary was **not** policy-ordered, in as many words, as
  "Phase 05's decision to make". It now asserts the **stronger** property.
- PHASE 04 asserted no execution path may touch the tool host at all. That is now
  false, and the test would have kept passing for the wrong reason. It now asserts
  `verifyReported` is called from exactly one file and that nothing `invoke`s a tool.

### A tooling defect this phase ran into

Running a mutation battery made `npm run lint` fail with ~410 errors, because the
harness working copy is compiled JavaScript inside the repository and eslint did not
ignore it - the same shape as D-03. All four harnesses now delete their control copy,
and `eslint.config.mjs` ignores `.mutation-*` and `.probe-selftest`.

### Numbers

| | |
|---|---|
| Tests | **1795/1795**, 274 suites, 0 skipped, 0 todo, 0 cancelled (was 1754) |
| New tests | **+41**, one file; 3 pre-existing files amended with the reason inline |
| Mutations | Phase 05 **21/21 CAUGHT**; 04 **21/21**; 03 **34/34**; 02 **25/25**; 0 survivors, 0 harness errors |
| Probe | **91/91**; self-test **24/24** reverts detected, 0 false positives |
| Architecture / isolation | 279 tests across eight files |
| Runtime dependencies | **0**, unchanged |

One mutation **survived** the first run and it was a real gap in my own work: the
"one tool registry" constructor guard was correct and completely untested. A guard
nobody exercises is a comment. The test was written; M8 is now CAUGHT.

---
## [Phase 03, second pass] A configured approval is answerable — PASS

**State transition:** `B-10: OPEN` → `B-10: RESOLVED`; `B-11: MEDIUM` → `B-11:
LOW`; `B-12` re-verified unchanged. `B-05` untouched. Jarvis not implemented.

The three findings behind B-10 were one defect: the governance verdict and the
approval registry had never met, and the composition root is the only place in
`src/` that can see both.

### Delivered

- **`ApprovalGateObserver`.** A read-only port with one verb,
  `observedApproval({ jobId, taskId })`. `ApprovalRule` abstains only for a gate
  that is `approved`, names a decider and carries a timestamp; eight
  preconditions, each with its own mutation, each CAUGHT. It never reads
  `approvalState`, and expiry is deliberately left to the authority that already
  applies it, so governance and `mayRelease` cannot disagree about one gate.
- **A real call site for `bridgeApproval`**, in the composition root's bridge, on
  an `approval_required` outcome, with the decision the engine *actually recorded*
  (read from `PolicyEngine.decisions()`). Not a re-decision, not a decision
  synthesised from an error class.
- **A held task, not a failed one.** The coordinator asks its OWN registry whether
  a human is being asked; an open undecided gate means `waiting_approval` with
  `failure: null` and the attempt not consumed. A decided gate is an answer, so a
  rejection still fails.
- **The job binding.** `inJobScope` stamps (job, task) at the composition seam
  from the coordinator's own record, overwriting the submitter's value. The port
  gained an optional `jobId`.
- **`approvalState` de-authorized and tested**, not deleted — `delegate`'s
  non-inheritance guarantee is only observable from a parent that has one.
- **Measurement.** `describe()` reports `approvalBridge` and `approvalAuthority`,
  and `npm run runtime:describe` prints
  `configured approvals  answerable (authority: workflow-registry)`.

### Evidence

- **1729/1729 tests**, 264 suites, 0 skipped, 0 todo, 0 cancelled; +11 new, all
  in the Phase 03 file, 0 pre-existing test files touched.
- **Mutation: 34/34** individual reverts CAUGHT in the Phase 03 battery, control
  GREEN, 0 survived, 0 load errors — including eleven new ones (M24–M34) covering
  every wiring decision this pass made.
- **Mutation: 25/25** in the Phase 02 battery, after re-pointing two anchors that
  had been silently `HARNESS_ERROR` since the first pass, and re-scoping them to
  the full suite. One then SURVIVED — correctly — because no test anywhere ran a
  job that relied on the service principal. A test was added and it is now caught.
- **Independent probe: 49/49**, sharing no code with any test file.
- **Probe self-test: 8/8 reverts detected**, 0 false positives. It also found three
  bugs in the probe itself, one of which had generalised B-11 from
  approval-required tasks to all tasks.
- Typecheck, lint, build, clean rebuild, config validation and runtime boot all
  green; 208 tests across the six architecture/isolation files pass.

### Not fixed, and why

- **B-11 (LOW).** `needs_review` still has no escalation target. Reachable only
  through the pre-existing `approval()` step, not through the new path, and no
  minimal coupled production change exists.
- **B-12 (LOW).** `settle()` still throws on an already-waiting job — reachable
  more often now, recorded — and a missing verifier is still classed `unknown`.
  Adjacent to this pass, not coupled to it.
- **B-05.** `decidedBy` is still a self-asserted string, and an approval is still
  bound to a (job, task) pair rather than a content hash. Both are B-05's decision.
- **No auto-runner.** A gate is resolved by the caller re-driving with `runJob`,
  which is the contract the PHASE 07 gate already had.

---

## [Phase 03] Governance & QA Separation — PASS

**State transition:** `PHASE 03: NOT STARTED` → `PHASE 03: PASS`; `B-08: OPEN` →
`B-08: RESOLVED`; `B-05` mechanism closed, decision still open; `B-10`, `B-11`,
`B-12` raised.

B-08 and B-05 were closed together because they are one decision: the identity a
background task runs AS is exactly the identity whose work an approval would be
accepting. Without a caller on the job nobody knows who executed; without knowing
who executed, the approver refusal has nothing to compare `decidedBy` against.

### Delivered

- **Provenance.** `IdentityProvenance` (`asserted` / `resolved` / `delegated`) on
  `SecurityContext`, stamped by the party in a position to know: the composition
  root marks `resolved`, `delegate` marks `delegated`, `createSecurityContext`
  marks `asserted` — and `provenance` is **no longer an input**, because the probe
  showed a caller could declare themselves established (D-24).
- **The resolver is real.** `establishRequestIdentity` runs once at the top of
  `TozOrchestrator.execute`, before every enforcement check, and only when the
  request carries no context of its own. An unidentified refusal records **zero**
  policy decisions.
- **`Job.caller` + `OrchestratorExecutionPort.securityContext`.** The identity
  travels job → task request → port → bridge, which prefers the job's caller
  over the declared service principal. B-08 resolved.
- **The approver is derived from records.** `assertDecidable`/`decide` take
  `executedBy`, computed by the coordinator from the job's caller, the runtime's
  service principal and the live claim's worker — never read from a caller
  argument. A forged `executedBy: []` cannot blank them. B-05's mechanism closed.
- **An approved job completes.** `TaskExecutionOutcome.verificationVerdict` wired
  through the executor and coordinator; `null` means NOT MEASURED and never blocks,
  while any verdict other than `pass` does (D-27).
- **The approval rule is constructed.** `ApprovalRule` appended last in
  `referenceGovernanceRules`, filtered through `isOperation`, wired from
  `config.governance.approvalRequired` — which it never was before.
- **Frozen gate records.** `ApprovalRegistry.open`/`decide` freeze what they store,
  so `get`/`forTask`/`all` cannot hand out a mutable view of a decision (D-26).
- **One governance file in the workflow layer's reach.** `import type` only, erased
  at emit, enforced on `dist/`: zero `governance/` strings across all eight emitted
  workflow files.

### What the independent probe changed

The first battery — 25 tests and 19 mutation reverts, all green — was probed
independently and **failed 8 of 46 sub-checks**, three of them
caller-attestable holes in guarantees this phase had just asserted. All three were
closed (D-23, D-24, D-26), re-probed at **44/49 with no regressions**, and added to
the battery as M20-M23. The remaining 5 are B-10, B-11 and B-12.

### Raised, not fixed

- **B-10 (HIGH, Phase 04):** a governance-configured approval cannot be
  satisfied. `bridgeApproval` has no call sites, no gate opens, and a recorded
  approval never feeds back into governance — so enabling the setting fails every
  job using it. Fail-closed, deliberately: the satisfiable version was the hole.
- **B-11 (MEDIUM):** `needs_review` has no escalation path, and QA still verifies
  the executor's own evidence record. Both are design decisions.
- **B-12 (LOW):** `settle()` throws when already `waiting`; a missing verifier is
  classed `unknown`.

### Verification

| Gate | Result |
|---|---|
| Typecheck / lint / build | PASS |
| Tests | **1718/1718**, 263 suites, 0 skipped, 0 todo |
| Mutation battery | **23/23 CAUGHT**, control GREEN, 0 survived |
| Independent probe | 44/49 after amendment, no regressions |
| Runtime boot | PASS |

---

## [Phase 02] Composition Root for Orchestration — PASS

**State transition:** `PHASE 02: NOT STARTED (blocked on B-03)` → `PHASE 02: PASS`

B-03 answered: **current state = library core, target state = AI Office product.**
The product needs a bootable core before it needs a transport, so Phase 02 produced
a library composition root plus one read-only entry point that boots it.

### The finding that shaped the phase

Executed against all 149 `src/*.ts` files: **every orchestration class was
constructed nowhere.** `src/core/composition.ts` was the only file that constructed
anything beyond one `PolicyEngine`; `TozOrchestrator` had never been built in
`src/`. The only assembly of the orchestration layer in existence was a test helper.

### C-5 — a defect that only composing could find

Wiring `ExecutionCoordinator` → `OrchestratorTaskExecutor` → `TozOrchestrator` for
the first time failed immediately: **a background task that required no verification
could never complete.** The orchestrator had decided no verification was required and
then reported a `needs_review` verdict anyway, because `VerificationRunner` answers
that way for an empty required-kind list. The workflow executor reads a non-`pass`
verdict as "executed but unverified" and fails the task, while the same run driven
directly reported `succeeded` with a reason of "Completed with no verification
required". Closed: a verdict is reported only when a check actually ran.

### Delivered

- `createRuntime(options)` — assembles 28 subsystems on top of `createCore`, reusing
  its registries rather than duplicating them.
- `bootstrapRuntime(options)` — reads the environment, refuses a rejected
  configuration, names every offending field, starts nothing on failure.
- `describe()` — measured facts only, including the absences: no durable state, no
  tenancy, no identity, no provider.
- `npm run runtime:describe` — boots from the real process environment, prints what
  it composed and what it cannot do, exits 0.
- `GovernanceGateOptions.engine` now required, so a runtime holds **one** policy
  engine rather than two, one of them authoritative for nothing.
- `ModelRouterOptions.policy`, so `orchestration.routing.defaultPolicy` reaches the
  fallback planner — and an unknown name fails at construction.
- `"runtime_started"` in `ORCHESTRATION_EVENT_KINDS`, so a startup is in the one
  history with everything else.

### Verification

| Gate | Result |
|---|---|
| Typecheck / lint / build | PASS |
| Tests | **1688/1688**, 256 suites, 0 skipped, 0 todo |
| Clean rebuild | PASS |
| New tests | **+74**, exactly one new file |
| Mutation battery | **25/25 CAUGHT**, control GREEN, **0 survived** |
| Independent probe | **20/20 PASS**, clean exit |

### The fail-closed contract

Governance installed by default · identity absent = every run refused · service
identity absent = background path refused · no agent backend =
`UnavailableAgentAdapter` · no provider adapter = a provider-backed run fails ·
memory disabled = grants nothing · empty recall scopes = no recall · ingestion
never promotes unless configured · rejected config = nothing starts.

### Two things that went wrong, and what they produced

1. **A claimed fix that was not a fix.** The first version of this phase made
   `route()` honour the configured routing policy, on the belief that `plan()` did
   and `route()` did not. `DefaultRouter` has no policy concept at all — it orders by
   a verified-facts scorer — so the change was inert. Writing the test that was
   supposed to prove it proved the opposite, and the change was reverted with the
   real scope documented. **D-03 reproduced itself a third time, in the most
   expensive form: a line of code that looks like it wires something up and does
   not.**
2. **Six mutations survived the first battery, and every one meant the test was
   insufficient rather than the line redundant.** Phase 01's response to a survivor
   was to delete the line; this phase's was to write the missing measurement. The
   difference is recorded because both outcomes are real and the phase that gets a
   survivor wrong cannot tell them apart.

### Blockers

- **B-03 RESOLVED** — library core → AI Office product. Not a blocker.
- **B-08 RAISED** — `OrchestratorExecutionPort` has no field for a caller, so a
  background task cannot carry an identity and the runtime must declare the
  principal its worker acts as. Feeds B-05 (Phase 04).
- **B-09 RAISED** — `orchestration.routing.defaultPolicy` orders the fallback chain
  but not the primary selection. Phase 05 decision, recorded so it is not forgotten.

### State

- `PHASE_STATUS.md` → Phase 02 **PASS**.
- Next phase: **03 — Governance & QA Separation**.

---

## [Phase 01] Critical Security Fixes — PASS

**State transition:** `PHASE 01: NOT STARTED` → `PHASE 01: PASS`

Decisions applied: `DECISIONS.md` §5 (B-01..B-06). Scope held to C-1..C-4 —
no refactor beyond what the fixes required, no new capability, no composition
root.

### Method, in the required order

1. **Failing tests first.** `tests/criticalSecurity.phase01.test.ts` written
   against the defective behaviour. **11 of 15 failed** against unfixed `HEAD`;
   the 4 that passed were deliberate positive controls, so a fix that refused
   everything could not pass.
2. **Then the fix**, one defect at a time.
3. **Then mutation proof**, granular, on throwaway copies of `dist/` outside the
   repository.
4. **Then regression**, plus an independent probe sharing no code with the tests.

### Defects closed

| # | Closed how |
|---|---|
| **C-1** | `CandidateExclusion` added to `RoutingRequest` and `FallbackChainRequest`; applied in `DefaultRouter` where candidates enter and in `FallbackPlanner` before the hard filter. `toCandidateExclusion` maps `RoutingRestriction` across the layer boundary as a **pure function with a type-only import**, because governance must not call the router. |
| **C-2** | `assertDecidable` uses the gate's own recorded `taskId`; `decideApproval` derives the executing worker from the live claim. The coordinator's `taskId` derivation was deleted after mutation proved it redundant. |
| **C-3** | `mayRelease(jobId, taskId, approvalRequired)` — required, no default, so a future call site cannot forget. Both `planRelease` and `executeTask` pass it. `flattenWorkflow` carries the declared question/expiry; `createJob` opens the gate. |
| **C-4** | The enforcement **trigger** now uses the union of the subtask's declared capabilities and the agent's registered ones. The empty-grant-list semantics were found to be a deliberate contract and escalated as **B-07**. |

### Also corrected

- **The false security comment** at `authority.ts:827-831`, which claimed "a
  denied provider cannot be selected". It now states what is true and says the
  previous claim was false. Part of C-1's defect.
- `#fallbackAvailability` was dropping the restriction, so the reported fallback
  chain would have listed denied providers. Now passes it.

### Verification

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS |
| Build | PASS |
| Tests | **1614/1614**, 244 suites, 0 skipped, 0 todo |
| Clean rebuild (`clean` + `test`) | PASS |
| Mutation battery | **9/9 individual reverts CAUGHT**; control GREEN |
| Independent probe | **21/21 checks PASS** |

Test delta over HEAD is exactly **+17**, the new file. `git diff -- tests` shows
zero added or removed `it(`/`describe(` in any pre-existing file.

### Three false-confidence traps caught during this phase

1. **A syntax error scored as "mutation caught."** The first C-3 mutation patch
   produced a JavaScript `SyntaxError`, which `node --test` reports as a single
   file-level failure. The naive check read that as a successful catch. It proved
   nothing. The probe was rewritten to classify load errors separately and never
   count them as catches. **D-03 reproduced itself in a new form.**
2. **One reversion SURVIVED, and the survivor was right.** Removing the
   coordinator's `taskId` derivation left every test green — `assertDecidable`
   already used the gate's own `taskId`. The line was deleted rather than kept as
   unprovable defence-in-depth.
3. **`npm run validate` tests a stale `dist/`.** It is
   `typecheck && lint && test:unit` with no build; `npm test` does build. One
   verification run reported green against an out-of-date build and was caught
   only because the numbers did not move. Same shape as the four defects: a check
   that appears to run against the code and does not.

### Baseline correction

Phase 00 recorded 1598 tests. Re-measured against a clean `git archive` of HEAD
with the same method, the per-file sum is **1597**. The 1597/1598 difference is
a pre-existing counting artifact — `tests/workflow.jobscope.test.ts:82` turns one
`it(` into two cases inside a loop. The verified facts are that HEAD sums to
1597, the tree now sums to 1614, and the difference is exactly the new file.
**No test was lost.** See `CURRENT_STATE.md` §5a.

### Files

Modified 12, added 1. `git status` shows no other change and no deletion.

### Blockers

- **B-07 RAISED** — empty capability list in a `Grant`: "any" or "none"? A
  security-boundary policy decision with a real cost on both sides. Not
  blocking Phases 02-06.
- **B-03 remains the next blocker** — Phase 02's shape depends on it.

### State

- `PHASE_STATUS.md` → Phase 01 **PASS**, Phase 02 **NOT STARTED, blocked on B-03**.
- Next phase: **02 — Composition Root for Orchestration**, and it must not begin
  until B-03 is answered.

---

## [Phase 00] Baseline / Discovery — PASS

**State transition:** none → `PHASE 00: PASS`

### Repository

- Verified: git repository, branch `master`, working tree **clean**.
- HEAD `0898464` (`docs: close the project - identity table and closure record`).
- 12 commits, linear, no merges. History preserved; nothing rewritten.
- No `reset --hard`, no `clean`, no branch change, no file deletion.

### Files created (the only writes in Phase 00)

```
docs/execution/MASTER_PLAN.md
docs/execution/CURRENT_STATE.md
docs/execution/PHASE_STATUS.md
docs/execution/TODO.md
docs/execution/BLOCKERS.md
docs/execution/DECISIONS.md
docs/execution/CHANGELOG.md
```

No file under `src/`, `tests/`, `scripts/`, `docs/` (pre-existing) or the
repository root was created, modified, moved or deleted.

### Baseline recorded (executed)

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** — 0 errors |
| `npm run lint` | **PASS** — 0 problems |
| `npm run build` | **PASS** |
| `npm test` | **PASS — 1598/1598**, 240 suites, 0 skipped, 0 todo |

No failure hidden or explained away. The suite is green **and** four live
authorization defects exist. Both facts are recorded.

### Findings

- **4 live defects reproduced by execution**, not by reading:
  - **C-1** governance's denied-provider list is computed then discarded; the
    router re-derives an unrestricted candidate set. A denied provider was
    selected, and appears in the fallback chain.
  - **C-2** the executor can approve its own work; the guard depends on the
    caller volunteering `workerId`.
  - **C-3** `approvalRequired: true` is not an enforcement precondition; a task
    declaring it is released with no gate at all.
  - **C-4** an empty capability list disables enforcement at two independent
    layers.
- **Root cause of C-2/C-3/C-4 identified:** absent value treated as "nothing to
  enforce" rather than "nothing is permitted". The safe idiom already exists
  elsewhere in this same codebase.
- **No composition root** for the orchestration layer. `TozOrchestrator` is never
  constructed in `src/`. This is why C-1 survived 1,598 green tests.
- **No skill subsystem exists** — the brief's "keep the existing on-demand skill
  architecture" rests on a false premise. Recorded as a GAP (D-09).
- **No `workspace_id` / `brand_id`** anywhere in `src/`. Phase 06, highest
  structural risk.
- **D-03:** the previous "mutation-verified" claim on routing narrowing is
  misleading. The mutation is caught, but only by a case the defective code also
  passes for a different reason.
- **5 documentation drifts** recorded, including the material one:
  `PROJECT_STATE.md` §22.1 claims governance is "enforced on the execution
  path", which C-1..C-4 contradict.

### Prior-audit findings verified

| Prior claim | Verdict |
|---|---|
| Kritik 1 — denied provider list not passed to router | **CONFIRMED** |
| Kritik 2 — executor can approve its own work | **CONFIRMED** |
| Kritik 3 — fail-open when no gate | **CONFIRMED** |
| Kritik 4 — empty capability list disables enforcement | **CONFIRMED** (two layers) |
| All 12 orchestration config sections inert | **CONFIRMED** |
| `orchestrationConfigFromApp` called only from tests | **CONFIRMED** |
| Not multi-tenant safe (classification D) | **CONFIRMED** |
| `TraceRecorder` stores un-redacted events | **CONFIRMED** |
| Routing narrowing mutation-verified | **MISLEADING** (D-03) |
| 1,537/1,537 tests | **STALE** — 1,598 at HEAD |
| `errorClass` never supplied | **OVERSTATED** — supplied at 5 sites |

### Decisions recorded

`D-00` .. `D-12` in `DECISIONS.md`. Headline: **KEEP** the existing authorities
(no rewrite — the defects are wiring and default-direction, not design);
add a Composition Root phase at 02; split durability from observability; move
n8n from 09 to 13.

### Plan produced

17 phases, 00-16. Phase order re-sequenced against verified reality with a
recorded reason for every change.

### Blockers raised

`B-01` .. `B-06`, three of them **OPEN / WAITING_FOR_HUMAN** and blocking
(B-01 hotfix policy, B-03 library-vs-product, B-04 isolation model).

### State

- `PHASE_STATUS.md` → Phase 00 **PASS**, Phase 01 **NOT STARTED**.
- Next phase: **01 — Critical Security Fixes (C-1..C-4)**.
- Phase 01 must not begin until B-01 is answered.
