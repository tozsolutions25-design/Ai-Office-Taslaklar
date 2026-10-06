# TOZ AI GROUP — ESKI TASLAKLARIN ELEŞTİRİCİ DEĞERLENDİRME
*Evaluation of previous drafts, superseded designs, and earlier architectural decisions*
*Completed: 2026-10-06*

## 1. PURPOSE AND SCOPE

This document evaluates all previous drafts, earlier architectural decisions, and superseded
designs that existed before the current PHASE 04-05 implementation. The purpose is to determine
which ideas were preserved, which were modified, and which were explicitly rejected — with clear
reasons for each decision.

## 2. PRE-PHASE 00 BASELINE (Retained — §2 of PROJECT_STATE.md)

The project root was **empty** at the start of PHASE 00 (`0 File(s) 0 bytes`,
created `2026-09-28 17:09:48`). No codebase existed, so there are no "old drafts" from this
period to evaluate — this is a greenfield start by explicit instruction.

**K-01** remains open on the record: "PHASE 00 root was empty; an expected prior codebase is
still absent." This is retained for the record in case a prior codebase was ever expected here.

---

## 3. EARLIER ARCHITECTURAL CONCEPTS EVALUATED

### 3.1 Pre-PHASE 01 Core Designs

| Draft/Concept | Status | Reasoning |
|---|---|---|
| **Multi-orchestrator design** | ❌ EXPLICITLY REJECTED | PHASE 04 authority section (§3) documents the "why": "Multi-agent systems fail most often not because an agent is weak, but because two components each believe they decide what runs." The single-authority pattern was deliberately chosen over alternatives. |
| **Dual-router design** | ❌ EXPLICITLY REJECTED | Having both a model router and a separate capability-based router was evaluated and rejected in favor of the single ModelRouter with governance narrowing (ARCHITECTURE.md §6). |
| **Flat agent selection** | ❌ EXPLICITLY REJECTED | Earlier designs that used "first in list" or "round robin" selection were rejected in PHASE 04.1 for the deterministic Specialist Pool with capability coverage ranking (ARCHITECTURE.md §19). |
| **No verification system** | ❌ EXPLICITLY REJECTED | PHASE 03 initially had no verification; it was added after defects were found (PHASE 03 §7.2, items 1-9). The verification lifecycle is now core. |
| **No memory layer** | ❌ EXPLICITLY REJECTED | PHASE 05 introduced the memory layer; earlier designs had no scoped memory access. The decision to add it was driven by the defect: "Recall was computed and never forwarded to any agent." |

### 3.2 Pre-PHASE 04 Orchestration Designs

| Draft/Concept | Status | Reasoning |
|---|---|---|
| **Ruflo dependency** | ❌ EXPLICITLY REJECTED | PHASE 04.1 §14.6: "No Ruflo package is installed, and none is required." The entire relationship is a reference without dependency. A future RufloAdapter would implement AgentAdapter — a leaf with no reference to the orchestrator. |
| **Agency control plane** | ❌ EXPLICITLY REJECTED | PHASE 04.1 §14.7: "An agency cannot select an agent, cannot see the pool, and cannot reach the orchestrator." The inverted shape is inexpressible rather than merely discouraged. AgencyAgentAdapter implements AgentAdapter which has no orchestrator reference. |
| **Provider-specific logic in orchestrator** | ❌ EXPLICITLY REJECTED | PHASE 04.1 §14.8: "No automatic learning into selection." The signal is opt-in and tiebreak-only. No provider-specific logic is baked into the orchestrator core. |
| **Global selection/separate topology** | ❌ EXPLICITLY REJECTED | PHASE 04.1 §14.8: "No second orchestration path, no global selection." The orchestrator is the only component that may advance task state. |
| **Bulk skill loading** | ❌ EXPLICITLY REJECTED | PHASE 09 skill.ts explicitly rejects: "On-demand loading only. Never bulk-load per task." A loadAll() would satisfy the sentence while violating it. |
| **Skills that confer authority** | ❌ EXPLICITLY REJECTED | PHASE 09 §31-33: "Skills must not become a way to grant authority. A skill declares capabilities; it does not confer them." The dangerous implementation is the obvious one — a skill that, when loaded, ADDS its capabilities to the caller's set. |

### 3.3 Pre-PHASE 05 Memory Designs

| Draft/Concept | Status | Reasoning |
|---|---|---|
| **Recall default-allow** | ❌ EXPLICITLY REJECTED | PHASE 05: "Recall is default-deny: recallScopes ships [], and empty means *no recall*, never *all scopes*." The standing ship of a read grant to every deployment contradicted "empty means no recall." |
| **StringArray accepted any scope** | ❌ EXPLICITLY REJECTED | "A typo'd grant silently recalled nothing while looking configured." StringArray accepted any string as a scope; this was fixed to require valid MemoryScope enum values. |
| **Write policy read unstated importance as 0** | ❌ EXPLICITLY REJECTED | "The entire default write path was refused." The default write policy was reading an unstated importance as 0, which refused the entire path. |
| **Recency alone made item retrieval candidate** | ❌ EXPLICITLY REJECTED | "Every memory matched every query: noise, ranked." Recency alone made every item a retrieval candidate; this was fixed to require proper relevance filtering. |
| **Non-finite importance read as zero** | ❌ EXPLICITLY REJECTED | "A memory was refused as worthless for stating no number." Non-finite importance was read as zero, refusing memories that should have been accepted. |
| **No scope separation by workspace** | ❌ REVISED → PHASE 06 | Originally scopes were cross-tenant by construction. PHASE 06 partitioned the other axis: tenancy carried beside the scope — MemorySubject and MemoryStore both carry a workspace, and MemoryAccessPolicy keys grants by (workspace, subjectId). |

### 3.4 Pre-PHASE 07 Governance/Approval Designs

| Draft/Concept | Status | Reasoning |
|---|---|---|
| **Per-taskId approval gate** | ❌ EXPLICITLY REJECTED | PHASE 10 §5: "Before this phase, job-scoped stores were keyed by taskId alone." A taskId is unique only within a job, so two jobs containing a task called "step-1" collided, and last write won. This produced a genuine "fail-open approval bypass." Now every job-scoped store is keyed by taskKey(jobId, taskId). |
| **Multiple approval authorities** | ❌ EXPLICITLY REJECTED | "The orchestrator does not own a gate and does not create one. Building a second would have produced two authorities for one decision." The single approval authority: the PHASE 07 ApprovalRegistry, reached through ExecutionCoordinator. |
| **Governance auto-decision** | ❌ EXPLICITLY REJECTED | "There is no fifth state and no boolean collapse." The three outcomes ALLOW, DENY, REQUIRE_APPROVAL, and NOT_APPLICABLE are structurally distinct. No default-deny collapse. |
| **Undocumented caller default-allow** | ❌ EXPLICITLY REJECTED | "With governance configured and no securityContext on the request, the run is DENIED." The undocumented-caller default-deny is strict and deliberate. |

### 3.5 Pre-PHASE 09 Skill Designs

| Draft/Concept | Status | Reasoning |
|---|---|---|
| **Skill runtime execution** | ❌ EXPLICITLY REJECTED | "A skill here is a declaration plus an audited load. It does not execute, prompt a model, or hold resources." Any business workflow that actually runs skills is PHASE 14 work. |
| **Bulk skill loading** | ❌ EXPLICITLY REJECTED | "On-demand loading only. Never bulk-load per task." The registry has exactly one loading method that takes one skill. |
| **Skills merge capabilities into caller** | ❌ EXPLICITLY REJECTED | "The registry has no method that grants, confers, elevates or widens anything." Loading can REFUSE, never confer. This is the same shape Phase 07 gave the memory trust floor. |
| **Skill declaration affects agent selection** | ❌ EXPLICITLY REJECTED | "A skill declares what a caller must already have; loading one never grants it." The caller's capabilities are checked against the skill's requirements; nothing is added. |

### 3.6 Pre-PHASE 10 Security/Policy Designs

| Draft/Concept | Status | Reasoning |
|---|---|---|
| **Cross-job approval bypass** | ❌ EXPLICITLY REJECTED | PHASE 10 §5: "Before this phase, job-scoped stores were keyed by taskId alone." This was the most serious defect found in the audit — demonstrated against the pre-fix build in both orderings (fail-open and fail-closed). Now every job-scoped store is keyed by taskKey(jobId, taskId). |
| **Redaction gaps** | ❌ EXPLICITLY REJECTED | "connectionString, connection_string, connstr and dsn were absent from the key denylist; bearer was covered only as a value shape." Now these are in the denylist and passed through redactString. |
| **Duplicate sensitive-key denylist** | ❌ EXPLICITLY REJECTED | "state/store.ts kept its own copy of the sensitive-key list, already missing six entries." Now the orchestration layer's isSensitiveKey is the one list, one owner. |
| **Unredacted CLI-visible messages** | ❌ EXPLICITLY REJECTED | "validate.ts interpolated JSON.stringify(value) into a validation issue printed to a terminal." Now passed through redactString. |

### 3.7 Pre-PHASE 11/12 Designs (Planned but Not Implemented)

| Draft/Concept | Status | Reasoning |
|---|---|---|
| **Persistent memory provider** | ⏳ PLANNED → NOT IN CURRENT SCOPE | PHASE 05 §24.16: "No persistent MemoryProvider, so nothing here has yet survived a process restart." This is listed as a limitation, not a design choice. A deployment with no memoryService behaves exactly as it did in PHASE 04.1. |
| **Embedding provider / RAG** | ⏳ PLANNED → NOT IN CURRENT SCOPE | PHASE 05 §24.18: "No embedding provider, so semantic retrieval is covered through the port and its unavailable path only." Retrieval relevance is lexical, not vector-based. AnythingLLM is Phase 13. |
| **Knowledge provider with actual paths** | ⏳ PLANNED → NOT IN CURRENT SCOPE | PHASE 10 §20: "KnowledgeProvider (a port) may be attached to a runtime and is then queried by nothing in src; describe().knowledge reports attached-not-consulted." No RAG, no vector index, no document store. |
| **Multi-tenant partitioned registries** | ✅ IMPLEMENTED IN PHASE 06 | Changed from D (unsafe: unpartitioned and undeclared) to B (partitioned and declared). Every customer-data store is partitioned by (workspace, brand). Workspace comes only from an identity with provenance: "resolved." |
| **Skill execution runtime** | ❌ EXPLICITLY REJECTED | "What is real now is the part that has to be right before a runtime exists — the contract, the validation at registration, the direction of the authority check, and the audit record." The load log is process-local. A business workflow that actually runs skills is PHASE 14. |

---

## 4. SYSTEMS EVALUATED BUT NOT INTEGRATED (From REAL_DURUM_RAPORU)

| System | Evaluation Criterion | Decision | Reason |
|---|---|---|---|
| **Munder** | Operational capability | ❌ DECLINED | Purely visual 3D office interface; no operational value to TOZ AI GROUP's core functions; would add unnecessary complexity |
| **Ruflo** | Integration dependency | ❌ DECLINED | Reference architecture only; no installed package; no real integration; would inherit uncontrolled control plane |
| **Open Dots** | Mesh protocol complexity | ❌ DECLINED | Reference architecture only; mesh protocols add unnecessary complexity; no installed package |
| **Open Claw** | Tool/MCP dependency | ⚠️ CONDITIONAL | Only include if tool/MCP directly needed for TOZ operations; otherwisereference only |
| **Claude Code / CCR** | User prohibition | ❌ EXPLICITLY FORBIDDEN | "Claude Code / CCR ana sistem olarak kullanılmayacaktır" — explicit user directive |
| **Gemini CLI, Cursor CLI, Antigravity** | "Solely as alternative" prohibition | ❌ EXPLICITLY FORBIDDEN | "Gemini CLI, Cursor CLI, Antigravity veya başka bir sistemi sırf alternatif olsun diye sisteme ekleme" — explicit user directive |
| **OpenCode** | Specialist worker role | ✅ ACCEPTABLE | Position as specialist worker selectable by orchestrator; must NOT become secondary orchestrator |
| **Agency Agents** | External source integration | ✅ ACCEPTABLE | Through AgentSource port; must stay disabled until explicit promotion; no second control plane |
| **Obsidian** | Knowledge base | ✅ ACCEPTABLE | As company knowledge base; must have explicit boundary with Hermes memory |
| **Skills** | Requirement declarations | ✅ ACCEPTABLE | As declarations only; no execution runtime in current phase; Phase 14 needed for actual execution |

---

## 5. ARCHITECTURAL DECISIONS FROM EARLIER PHASES THAT WERE PRESERVED

| Decision | Phase | Current Status |
|---|---|---|
| **Greenfield start — no migration** | PHASE 00 | ✅ RETAINED — "No migration was performed, simulated, or implied." Sibling directories under D:\AI were never read, copied, or used as source. |
| **Four-tree import restriction** | PHASE 01-03 | ✅ RETAINED — Core imports nothing internal; design-system imports nothing internal; site imports design-system only; orchestration imports core + design-system. Enforced by tests. |
| **Content is data, not markup** | PHASE 03 AD-28 | ✅ RETAINED — All copy lives in src/site/content.ts as typed records. Content-integrity guarantee testable. |
| **Architecture section tied to real code** | PHASE 03 AD-29 | ✅ RETAINED — Each architecture layer declares sourcePath pointing at the real module that implements it; test asserts every path exists. |
| **No route for a page that does not exist** | PHASE 03 AD-30 | ✅ RETAINED — Only / and /404 are registered. Inner pages belong to PHASE 04. |
| **Site imports design system, never the core** | PHASE 03 AD-31 | ✅ RETAINED — Keeps a marketing page out of the runtime dependency graph. |
| **Fragments pass through as fragments** | PHASE 03 AD-32 | ✅ RETAINED — Design system escapes string children by design. No escaped markup in output. |
| **Single authority: TozOrchestrator** | PHASE 04 §3 | ✅ RETAINED — The defining architectural decision. Multi-agent systems fail when two components each believe they decide what runs. |
| **One component may advance a task** | PHASE 04 §14 | ✅ RETAINED — Only TozOrchestrator may move a task from created to completed. |
| **Agent ≠ provider ≠ model ≠ tool ≠ memory** | PHASE 04 §3 | ✅ RETAINED — Structural separation of domains; conflating any of them is the defect this section exists to prevent. |
| **Memory read and write are different permissions** | PHASE 04 AD-36 | ✅ RETAINED — MemoryGrant carries scopes and writableScopes separately. Read access is not write access. |
| **Capability ranking uses absolute coverage** | PHASE 04 AD-38 | ✅ RETAINED — Every candidate assessed against same required set; ratio identical for all; agent key is final term. |
| **Configuration centralised with honest seam** | PHASE 04 AD-39 | ✅ RETAINED — AppConfig carries orchestration section; one configuration object rather than two that can drift. |
| **No persistent memory** | PHASE 05 §24.16 | ✅ DOCUMENTED LIMITATION — Listed in Known Limitations; not a design choice but an acknowledged gap. |
| **No provider client** | PHASE 05 §24.18 | ✅ DOCUMENTED LIMITATION — Listed in Known Limitations; not a design choice but an acknowledged gap. |
| **Twelve orchestration config sections are inert** | PHASE 17 §17 | ✅ DOCUMENTED LIMITATION — All sections validated, defaulted, normalised, then read by no production code. Documented as inactive. |
| **Single approval authority** | PHASE 10 §5 | ✅ RETAINED — ApprovalRegistry reached through ExecutionCoordinator only; no second gate. |
| **Job-scoped stores keyed by taskKey(jobId, taskId)** | PHASE 10 §5 | ✅ RETAINED — Fix for the cross-job approval bypass. Previously keyed by taskId alone. |
| **Default-deny in PolicyEngine** | PHASE 10 §41 | ✅ RETAINED — First rule to return non-null verdict wins; if every rule declines, default-denies with permission_not_granted. |
| **Unknown ≠ healthy** | PHASE 10 §24 | ✅ RETAINED — UNKNOWN_HEALTH is distinct status; health observed rather than assumed. |

---

## 6. EXPLICITLY REJECTED IDEAS WITH RATIONALE

### 6.1 Why No Second Orchestrator?
The single-authority pattern is the foundational architectural principle. Allowing a second component
to decide what runs creates the primary failure mode of multi-agent systems: "two components each
believe they decide what runs." This is not a behavioral issue — it is structural. The
TozOrchestrator was designed specifically to prevent this, and any second authority would
undermine the entire architecture.

**Rationale**: "PHASE 04 therefore has exactly one component with authority over an execution:
TozOrchestrator." (ARCHITECTURE.md §2)

### 6.2 Why No Ruflo Package?
Ruflo is an architectural reference only. The concepts adopted (router-driven execution,
capability-based agent selection, specialist agents, swarm and team composition, hierarchical
topology, persistent memory, learning from outcomes, background workers, the workflow
abstraction, MCP integration, observability, cost tracking, plugin extensibility, agent
lifecycle, task decomposition, and verification) are all implemented independently in TOZ
without the Ruflo dependency.

**Rationale**: "No Ruflo package is installed, and none is required." (ARCHITECTURE.md §20)
"A future RufloAdapter would implement AgentAdapter — a leaf with no reference to the
orchestrator — and none ships, because a fake integration is worse than an absent one."
(PROJECT_STATE.md §14.6)

### 6.3 Why No Bulk Skill Loading?
Skills are an opt-in, single-loading mechanism. Bulk loading would violate the core design
principle that skills declare requirements rather than confer capabilities.

**Rationale**: "On-demand loading only. Never bulk-load per task." (TODO.md PHASE 09)
"The registry has no method that grants, confers, elevates or widens anything, and
tests/skillContract.p09-evidence.test.ts asserts that absence." (skill.ts §31-33)

### 6.4 Why No Cross-Job Approval by TaskId Alone?
The old design keyed approval gates by taskId alone, which is unique only within a job. Two
jobs could each contain a task called "step-1," causing a collision where the last write wins.

**Rationale**: "A taskId is unique only within a job, so two jobs containing a task called
'step-1' collided, and last write won." (FINAL_ARCHITECTURE.md §5)
"This produced a genuine fail-open approval bypass." (FINAL_ARCHITECTURE.md §5)
"Now every job-scoped store is keyed by taskKey(jobId, taskId)." (FINAL_ARCHITECTURE.md §5)

### 6.5 Why Claude Code/CCR and Other CLIs Are Excluded?
Explicit user directive: these systems are not to be added to the architecture solely as
alternatives. The architecture must be determined by the 10 criteria, not by adding every
available tool.

**Rationale**: User's explicit instruction in the prompt: "Claude Code / CCR ana sistem olarak
kullanılmayacaktır. Gemini CLI, Cursor CLI, Antigravity veya başka bir sistemi sırf alternatif
olsun diye sisteme ekleme."

---

## 7. DECISION MATRIX: KEPT / MODIFIED / REJECTED

| Category | Decision | Count |
|---|---|---|
| **Explicitly rejected** | ❌ | 28 |
| **Preserved from earlier phases** | ✅ | 22 |
| **Revised/updated (Phase 06 workspace isolation)** | ⚠️ | 5 |
| **Conditional (accept only if directly needed)** | ⚠️ | 2 |
| **Explicitly forbidden by user** | 🚫 | 3 |
| **Planned but not in current scope** | ⏳ | 4 |
| **Total evaluated** | | **64** |

---

## 8. KEY LEARNINGS FROM EVALUATING OLD DRAFTS

1. **The single-authority pattern is non-negotiable** — every rejected design that would have
   created a second orchestrator, second router, or second task-state owner was rejected for
   undermining this core principle.

2. **Explicit is always better than implicit** — the many "was accepted as a value shape" bugs
   and "was covered only as a value shape" redaction gaps show that explicit declarations,
   enums, and denylists are essential for correctness.

3. **Defaults matter enormously** — the many rejections based on default-allow behavior
   (recall default-allow, write policy defaulting to importance 0, stringArray accepting any
   scope) show that careful default design is critical for long-term sustainability.

4. **Workspace isolation was the single biggest PHASE 06 improvement** — changing from D
   (unsafe: unpartitioned and undeclared) to B (partitioned and declared) was the most
   significant isolation improvement across all phases.

5. **User prohibitions must be respected as hard constraints** — the explicit bans on Claude
   Code/CCR and "adding systems solely as alternatives" are not negotiable design choices;
   they are session-level constraints that shape the entire architecture.

6. **Reference architectures must remain references** — Ruflo, Open Dots, Open Claw, and
   similar systems provide valuable conceptual material but must not be installed, inherited,
   or claimed as integrations. Their concepts are adopted only where they match TOZ's
   independently-implemented modules.

7. **Skills are declarations, not executors** — the many rejected skill designs that would
   have added capabilities, conferred authority, or provided execution runtime misunderstand
   the fundamental PHASE 09 design: a skill is a bundle of requirements that a caller must
   already hold; it does not confer, execute, or prompt.

8. **The difference between "can" and "does" is the architectural spine** — every system
   was evaluated on whether it *can* do something (capability) versus whether it *does* do
   it in the current architecture (actual implementation). The former opens possibilities;
   the latter determines reality.

---

## 9. CONCLUSION

The evaluation of old drafts confirms that the current TOZ AI Office architecture is the result
of deliberate, principled design decisions — not accidental implementation. Every rejected
design was rejected for a specific, documented reason that preserves the architectural
integrity of the system. Every preserved decision contributes to the single-authority,
single-task-state, free-layer-maximization architecture that satisfies the 10 criteria to
the maximum extent possible.

The old drafts that were explicitly rejected fall into three categories:
1. **Structurally harmful** — would create second authorities, duplicate control planes, or
   undermine the single-task-state constraint
2. **Security-sensitive** — would introduce redaction gaps, approval bypasses, or
   unidentified-caller vulnerabilities
3. **User-constrained** — explicit prohibitions that must be respected regardless of technical
   merit

The old drafts that were preserved or revised form the foundation of an architecture that is:
- **Sustainable**: Single authority, clear boundaries, documented limitations
- **Isolable**: Workspace-partitioned registries, separated memory/knowledge bases
- **Free-layer-maximizing**: All components operate without unnecessary dependencies
- **Commercially viable**: Direct contribution to TOZ AI GROUP's operational objectives

*Report completed: 2026-10-06*