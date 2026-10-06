# MASTER PLAN — TOZ AI OFFICE

> Phase 00 takeover plan. Derived from the verified baseline in
> `CURRENT_STATE.md`. Replaces the previous project's PHASE 00-10 numbering,
> which is retained as history in `PROJECT_STATE.md` and is **not** the plan
> this project continues on.

---

## 1. Where this project actually is

The previous project closed itself at PHASE 10 with a "certified library and
reference architecture". That description is accurate. The important
consequence, which the closure record does not state plainly:

> **No runnable system exists.** There is no composition root for the
> orchestration layer, no provider client, no HTTP surface, no persistence. The
> repository is a set of authorities, seams, and 1,598 tests proving the seams
> hold.

Phase 00 therefore did not find "a working system needing hardening". It found
**a well-built, honestly-documented component library carrying four live
authorization defects, with no composition root in front of it.**

That reframes the whole plan. The first job is not to add capability. It is to
close the four holes and then build the one thing that is missing: a composition
root, so that the governance that is already written is actually in the path.

## 2. Governing principles (binding on every phase)

These are the target architecture's rules, restated as constraints any change
must satisfy. They come from the project brief and are not negotiable per-phase.

1. **No fail-open, anywhere.** An absent value is never "permitted". No gate →
   blocked. No capability list → denied. No actor → denied. This is the single
   rule that C-1..C-4 all violate.
2. **Separation of powers.** An agent may not approve its own work. Governance
   and QA are not self-approving. The executor is not the approver.
3. **One authority per concern.** Enforced by test, not convention. The
   repository already honours this well; it must not be diluted.
4. **A test must fail when the guarantee is removed.** A test that passes both
   with and without the protection is worse than no test, because it manufactures
   confidence. D-03 is the worked example of this failure.
5. **Never claim what was not measured.** This codebase's strongest habit. Keep it.
6. **Human approval is explicit and non-inheritable.** Publishing, spending,
   sending, irreversible external change, binding acts, privilege escalation.

## 3. Phase order

The brief's draft order was 00-14. It is kept in shape but re-sequenced against
verified reality. Changes from the draft, with reasons:

| Draft | Decision | Reason |
|---|---|---|
| 01 Critical Security Fixes | **kept, moved to the front, expanded** | Confirmed live and exploitable through the library API. |
| 02 Governance & QA Separation | **kept, moved after 01** | Separation is meaningless while governance has holes. |
| 03 Approval / Execution Boundary | **kept** | |
| 04 Provider / Tool Boundary | **kept** | |
| 05 Workspace / Brand Isolation | **kept, and elevated in importance** | C-1 is a *provider* boundary failure; this phase is the same class of defect. |
| 06 Memory Architecture | **kept** | |
| 07 Agent Architecture | **kept** | |
| 08 Skill Architecture | **kept** | Skill subsystem is **ABSENT**; this is a greenfield phase, not a refactor. |
| 09 n8n Integration Boundary | **kept, but deferred much later** | Not needed by the core. Must not be pulled forward. |
| 10 Knowledge / RAG Boundary | **kept** | |
| 11 Audit / Logging / Recovery | **kept, split** | Recovery is a different order of work from observability. |
| 12 MVP Business Workflow | **kept** | |
| 13 Production Hardening | **kept** | |
| 14 Final Certification | **kept** | |
| — | **+ NEW: Composition Root phase** | Inserted after 01. Nothing is testable in situ until the orchestration layer can be assembled. |
| — | **+ NEW: Dependency & toolchain policy** | The repo is a library; someone must decide how it becomes a product. |

### Final order

```
PHASE 00  Baseline / Discovery                      DONE (this phase)
PHASE 01  Critical Security Fixes (C-1..C-4)       <- next
PHASE 02  Composition Root for Orchestration        <- NEW
PHASE 03  Governance & QA Separation
PHASE 04  Approval / Execution Boundary
PHASE 05  Provider / Tool Boundary
PHASE 06  Workspace / Brand Isolation
PHASE 07  Memory Architecture
PHASE 08  Agent Architecture
PHASE 09  Skill Architecture
PHASE 10  Knowledge / RAG Boundary
PHASE 11  Audit / Observability Hardening
PHASE 12  Durable State & Recovery
PHASE 13  External Tool Boundaries (n8n, CRM, …)   <- was draft 09
PHASE 14  MVP Business Workflow
PHASE 15  Production Hardening
PHASE 16  Final Certification
```

**Inserted:** Composition Root (02), split of draft 11 into 11/12.
**Moved:** draft 09 (n8n) from 9th to 13th — the core has no demonstrated need
for it, and pulling it forward would add an external dependency before the
governance path is sound.
**Merged:** none.

### Rationale for Composition Root at 02

`TozOrchestrator` has never been constructed in `src/`. Every governance test
builds its own gate. C-1 survived *1598 green tests* precisely because no test
and no production path assembles the real thing. A composition root is what
turns C-1 from "a bug in a component" into "a bug that can actually happen to
someone", and it is what makes phases 03-05 verifiable rather than theoretical.

It goes **after** 01, not before, so the composition root is not built on top of
a routing path that ignores governance.

## 4. What is explicitly NOT planned

- **No rewrite.** The existing authorities, registries, state machines and tests
  are sound and are kept. Phase 00 found no reason to replace any of them.
- **No 100+ agents.** MVP is 5 agents (`MASTER_PLAN.md` §5).
- **No premature external dependencies.** n8n, Twenty CRM, AnythingLLM,
  Firecrawl, browser automation, Postiz, Pipecat are **not** added as
  dependencies in any phase before 13.
- **No framework change.** TypeScript/ESM/NodeNext, zero runtime dependencies,
  Node's built-in test runner. This is a deliberate, working choice.
- **No deletion in Phase 00.** Nothing was removed. Removal decisions are
  deferred to their own phase and require a dependency check first.

## 5. Agent strategy (target, not built in Phase 00)

The existing agent architecture is adequate: registry, explicit lifecycle,
adapter port, deterministic two-stage selection with a reason for every
selected *and* rejected candidate. **KEEP.**

MVP — 5 agents:

| # | Role | Note |
|---|---|---|
| 1 | Hermes Coordinator | the single orchestration authority |
| 2 | Independent QA Reviewer | structurally cannot approve its own work |
| 3 | Briefing / Approval Officer | the human-approval boundary |
| 4 | Research Analyst | |
| 5 | Content Strategist / Drafter | |

Production core — 10 agents: the above plus Brand Guardian, Compliance Checker,
Data/Measurement Analyst, Budget Controller, CRM/Operations Agent.

Constraint carried forward: an ingested external agent arrives **disabled**
(`agentsource/source.ts:275`) and `promoteToAvailable` is **off by default**
(`ingest.ts:67-73`). That default is correct and must not be relaxed.

## 6. Skill strategy

**A skill subsystem does not exist in this repository.** Verified by exhaustive
search: `skill`/`SkillRegistry`/`SKILL.md` → 0 matches across 227 tracked files;
no `.opencode/`, `skills/` or equivalent directory.

So the brief's instruction "keep the existing on-demand skill architecture" rests
on a false premise, and the correct Phase 00 action is to record it as a **GAP,
not a defect**:

- The nearest existing concepts are `CapabilityRegistry`, `AgentRegistry`,
  `AdapterRegistry`, `ToolRegistry`. None is a skill system.
- The design intent — registry as single source of truth, on-demand loading, no
  bulk loading per task — is **compatible** with those registries and should be
  honoured when skills are built.
- **Do not** retrofit skills onto `ToolRegistry`. A skill is a capability bundle
  with lifecycle and authority; a tool is one callable. Different concern.

`DECISIONS.md` D-09 records this as a correction to the brief.

## 7. Phase gate rule

```
PHASE -> TODO -> IMPLEMENT -> TEST -> VERIFY -> PASS / FAIL
```

No phase begins before the previous one is PASS. A FAIL routes to §17 of the
brief: locate → root cause → minimal fix → test → regression → re-verify all
PASS criteria. A blocker that cannot be resolved mechanically routes to
`BLOCKERS.md` and the phase halts in `WAITING_FOR_HUMAN`.

## 8. Definition of done for the project

Not "tests pass". All of:

1. C-1..C-4 closed, each with a test that fails when the fix is reverted.
2. A composition root exists and the real orchestrator runs a real job.
3. `workspace_id` / `brand_id` partition every registry, memory scope and audit
   read. — **MET in Phase 06.** Every customer-data store is partitioned by
   `(workspace, brand)`; a workspace comes only from `provenance: "resolved"`;
   `AuditSink.read(scope)` is mandatory and filtered; and the five
   deployment-scoped registries are listed in `describe()` with a machine-checked
   no-customer-data assertion. **Scale is still an open decision** and was not
   invented from.
4. Job, task, approval and budget state survive a process restart.
5. An agent cannot approve its own work, enforced structurally rather than by a
   caller-supplied argument.
6. A human approval is required for every irreversible or outbound action, and
   the approval record is durable and attributable.
7. 5 MVP agents run one MVP business workflow end to end.
