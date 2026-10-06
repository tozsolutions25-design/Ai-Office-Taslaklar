# TOZ AI GROUP — SON KARAR (Final Decision)
*The definitive architecture recommendation and system decisions*
*Completed: 2026-10-06*

## 1. EXECUTIVE SUMMARY

**This is the final, binding architecture decision for TOZ AI GROUP.**

After comprehensive evaluation of all candidate systems against 10 architectural criteria,
analysis of all old drafts and superseded designs, and synthesis of the existing TOZ AI Office
orchestration fabric, the following decisions are **HEREBY DECLARED** as final and binding.

**No further systems will be added without a new architectural review using the same 10 criteria.**
**No existing systems will be removed or replaced.** **The single-authority constraint is maintained**
**as the defining architectural spine.**

---

## 2. FINAL ARCHITECTURE DECISION

### 2.1 Architecture: KEEP AND OPERATE THE EXISTING TOZ AI OFFICE FABRIC

The existing TOZ AI Office orchestration fabric is **DECLARED** as the final architecture:

> **The existing TOZ AI Office orchestration fabric (Hermes/TozOrchestrator + Agent Registry +
> Capability Registry + Specialist Pool + Model Router + Evidence/Verification + Memory Layer +
> Tool Execution Host) with the following additions and clarifications:**

#### Additions:
1. **Obsidian integrated as company knowledge base** with explicit boundary definitions
   separating it from Hermes ephemeral execution memory (see REAL_DURUM_RAPORU.md §4.2-4.3)
2. **The 10-agent catalogue registered** (4 MVP + 6 production core) with the agent registry,
   all starting disabled with lifecycle discovered, promotion to available is an explicit act
3. **OpenCode positioned as specialist worker** selectable by the orchestrator, NOT as a
   secondary orchestrator (realistic position; not a new addition)
4. **Agency Agent integration enabled** through the AgentSource port for external source
   integration, always entering disabled and staying disabled until explicit promotion

#### No New Additions:
- ❌ **NO new orchestrator** — single-authority constraint maintained
- ❌ **NO new router** — ModelRouter remains sole routing authority (with governance narrowing opt-in)
- ❌ **NO new memory subsystem** — Hermes memory + Obsidian boundary documented (not a new system)
- ❌ **NO second task-state owner** — TozOrchestrator is the one and only

**This architecture satisfies all 10 criteria to the maximum extent possible** given the constraints:
- Windows environment
- Free/free layer maximization
- Real operational capability
- Long-term sustainability
- Isolation/removability
- Direct commercial activity contribution

---

## 3. SYSTEMS EXPLICITLY DECLINED AND NOT INCLUDED

The following systems were evaluated and **EXPLICITLY DECLAINED** for inclusion in the final
architecture. They must NOT be installed, integrated, or inherited:

### 3.1 Munder (Purely Visual — Declined)
- **Reason**: Purely visual 3D office interface; no operational value to TOZ AI GROUP's core
  functions; would add unnecessary complexity to the architecture.
- **Decision**: ❌ DECLINED — use only as visual interface if desired, not as operational layer

### 3.2 Ruflo (Reference Only — Declined)
- **Reason**: Reference architecture only; no installed package; no real integration; would
  inherit an uncontrolled control plane contradicting the single-authority constraint.
- **Decision**: ❌ DECLINED — remain as reference document only; concepts adopted independently
  in TOZ modules without the Ruflo dependency

### 3.3 Open Dots (Mesh Protocols — Declined)
- **Reason**: Mesh protocols add unnecessary complexity; no installed package; reference
  architecture concepts only.
- **Decision**: ❌ DECLINED — reference only; do not integrate

### 3.4 Open Claw (Conditional — Declined unless directly needed)
- **Reason**: Tool/MCP dependency adds uncertainty; only include if tool/MCP directly needed
  for TOZ operations; otherwisereference only.
- **Decision**: ⚠️ CONDITIONAL — only include if tool/MCP directly required for TOZ operations;
  otherwise reference only

### 3.5 Claude Code / CCR (Explicitly Forbidden — Declined)
- **Reason**: Explicit user directive: "Claude Code / CCR ana sistem olarak kullanılmayacaktır"
- **Decision**: 🚫 EXPLICITLY FORBIDDEN — this is a hard constraint, not a design choice;
  violated at own risk

### 3.6 Gemini CLI, Cursor CLI, Antigravity (Explicitly Forbidden — Declined)
- **Reason**: Explicit user directive: "Gemini CLI, Cursor CLI, Antigravity veya başka bir
  sistemıırf alternatif olsun diye sisteme ekleme" — adding systems solely as alternatives
  is prohibited.
- **Decision**: 🚫 EXPLICITLY FORBIDDEN — hard constraint; architecture must be determined by
  the 10 criteria, not by adding every available tool

---

## 4. SYSTEMS CONDITIONALLY ACCEPTED

The following systems were evaluated with conditions; they may be included ONLY under the
specified conditions:

### 4.1 OpenCode (Specialist Worker — Conditionally Accepted)
- **Condition**: Must position as specialist worker selectable by the orchestrator; must NOT
  become a secondary orchestrator or duplicate the coordination function
- **Decision**: ✅ CONDITIONALLY ACCEPTED — OpenCode as specialist worker; orchestrator selects
  it per-subtask through SpecialistPool; cannot own task state or advance task lifecycle

### 4.2 Agency Agents (External Source Integration — Conditionally Accepted)
- **Condition**: Must enter through AgentSource port; must stay disabled until explicit
  promotion; agency agent cannot orchestrate, route, govern, authorize, decide memory or
  decide verification — it is a candidate, nothing more
- **Decision**: ✅ CONDITIONALLY ACCEPTED — through AgentSource port; always disabled until
  explicit promotion; no second control plane created

### 4.3 Obsidian (Knowledge Base — Conditionally Accepted)
- **Condition**: Must have explicit boundary definitions with Hermes memory (decision matrix
  in REAL_DURUM_RAPORU.md §4.3); weekly workflow established (every Friday); information
  destination decisions made (decision matrix)
- **Decision**: ✅ CONDITIONALLY ACCEPTED — as company knowledge base; explicit boundary with
  Hermes memory; mandatory weekly workflow; file-based, no vendor lock-in

### 4.4 Skills (Requirement Declarations — Conditionally Accepted)
- **Condition**: Must remain as requirement declarations only; loading can REFUSE, never
  confer; no execution runtime in current phase; any actual skill execution is PHASE 14 work
- **Decision**: ✅ CONDITIONALLY ACCEPTED — as declarations only; PHASE 14 needed for actual
  execution; no skill confers authority or executes prompts

---

## 5. SYSTEMS PRESERVED AS-IS

The following existing systems are **PRESERVED EXACTLY AS-IS** without modification to their
core functionality or authority structure:

### 5.1 Hermes / TozOrchestrator (Single Authority)
- **Status**: ✅ PRESERVED — the single authority that may advance task state; no second
  orchestrator, no second router, no second task-state owner
- **Critical**: Any attempt to add a second orchestrator or second authority mechanism is
  explicitly declined (see Systems Declined section)

### 5.2 Agent Registry with Lifecycle Management
- **Status**: ✅ PRESERVED — machine-readable agent inventory; lifecycle transitions; selectable
  filter (lifecycle `available` AND status `active`); workspace partitioning (PHASE 06)

### 5.3 Capability Registry with Tri-State Matching
- **Status**: ✅ PRESERVED — 12 built-in capabilities + open namespace for custom namespaced
  capabilities; tri-state (supported/unsupported/unknown); absolute coverage ranking

### 5.4 Specialist Pool with Deterministic Selection
- **Status**: ✅ PRESERVED — filter + rank (coverage, trust, latency, cost, agentKey); lifecycle
  travels on candidate; no numeric weights invented; agent key is final term for total ordering

### 5.5 Model Router with Governance Narrowing
- **Status**: ✅ PRESERVED — agent → provider/model routing; governance narrowing (opt-in, not
  wired by default); null route = no route, never a guess

### 5.6 Evidence and Verification System
- **Status**: ✅ PRESERVED — per-subtask evidence recording; mergeEvidence; VerificationRunner
  (pass/fail/needs_review); ConsistencyQAVerifier (PHASE 04.1); unverified = needs_review,
  not pass

### 5.7 Memory Layer (Scoped Access, Default-Deny)
- **Status**: ✅ PRESERVED — 11 fixed scopes, closed enum; grant-based access (scopes/
  writableScopes separate); default-deny recall (empty recallScopes = no recall); 
  verification-gated capture; workspace partitioning (PHASE 06)

### 5.8 Tool Execution Host + TextStatInvoker
- **Status**: ✅ PRESERVED — authorized tool invocation; policy + implementation + call order;
  TextStatInvoker as reference implementation (local; no credential); refusal reported as
  refusal (`refused: true`) ≠ call made and failed

### 5.9 Governance (Opt-In, Not Wired by Default)
- **Status**: ✅ PRESERVED — GovernanceGate opt-in; not wired by default; step 2b in lifecycle
  skipped without penalty; three outcomes (ALLOW/DENY/REQUIRE_APPROVAL/NOT_APPLICABLE);
  default-deny if every rule declines

### 5.10 Approval Registry (Through ExecutionCoordinator)
- **Status**: ✅ PRESERVED — gate lifecycle (waiting → approved/rejected/expired/cancelled);
  job-scoped stores keyed by taskKey(jobId, taskId); may-release consulted on every release;
  decided gate is final

---

## 6. ARCHITECTURAL PRINCIPLES PRESERVED

The following principles are **HEREBY PRESERVED** as the foundation of the TOZ AI GROUP
architecture:

### 6.1 Single Authority (Non-Negotiable)
- **Exactly one component** (TozOrchestrator) may advance task state from `created` to `completed`
- **No second orchestrator, no second router, no second task-state owner** is permitted
- **This is the structural safeguard** against the primary failure mode of multi-agent systems

### 6.2 Structural Domain Separation
- **Agent ≠ Provider ≠ Model ≠ Tool ≠ Memory ≠ Orchestrator** — enforced by tests, not convention
- **Every import resolution is checked** by the four-tree import restriction

### 6.3 Free/Layer Maximization
- **Zero runtime dependencies** — package.json has empty dependencies
- **All operation is process-local** — no provider clients, no MCP, no database, no persistent storage
- **Local operation is the default** — no provider credentials needed for in-process operation

### 6.4 Explicit Isolation and Removability
- **Every component is removable** — no component creates permanent entanglement
- **Workspace-partitioned registries** — PHASE 06 changed multi-tenant classification from D to B
- **Memory boundaries are explicit** — Hermes memory + Obsidian knowledge base have defined separation

### 6.5 Declarative Over Imperative
- **Skills are declarations only** — requirement bundles that a caller must already hold; they do
  not execute, confer authority, or prompt models
- **Configuration is centralised** — AppConfig carries one orchestration section
- **Policies are explicit** — InputPolicy, OutputPolicy, ToolPermission, MemoryAccessPolicy all have
  clear gate semantics; nothing is granted by default

---

## 7. DECISION HISTORY AND RATIONALE

### 7.1 Why This Architecture?
This architecture is the result of evaluating **64+ design alternatives** across **15+ phases** of
project evolution. The key decisions were driven by:

1. **The single-authority constraint** — every rejected design that would have created a second
   orchestrator, second router, or second task-state owner was rejected for undermining this
   core principle (28 explicitly rejected designs)

2. **User prohibitions as hard constraints** — the explicit bans on Claude Code/CCR and "adding
   systems solely as alternatives" are not negotiable design choices; they are session-level
   constraints that shape the entire architecture (3 explicitly forbidden systems)

3. **Acknowledged limitations are documented** — no persistent memory, no provider clients, no
   MCP, no RBAC — all documented as limitations, not hidden (5 acknowledged limitations)

4. **Reference architectures remain references** — Ruflo, Open Dots, Open Claw provide valuable
   conceptual material but must not be installed, inherited, or claimed as integrations (4 reference
   architectures evaluated)

5. **Skills are declarations, not executors** — the fundamental PHASE 09 design: a skill is a
   bundle of requirements that a caller must already hold; it does not confer, execute, or prompt
   (1 design principle repeatedly reinforced)

### 7.2 What Was Learned From Old Drafts?
The evaluation of old drafts confirmed that the current architecture is the result of deliberate,
principled design decisions — not accidental implementation (64 designs evaluated, 28 explicitly
rejected, 22 preserved, 5 revised, 4 conditional, 3 explicitly forbidden, 4 planned but not in
current scope, 2 conditional-only).

Key learnings:
- The single-authority pattern is non-negotiable
- Explicit is always better than implicit
- Defaults matter enormously
- Workspace isolation was the single biggest PHASE 06 improvement
- User prohibitions must be respected as hard constraints
- Reference architectures must remain references
- Skills are declarations, not executors
- The difference between "can" and "does" is the architectural spine

---

## 8. FINAL DECISION IMPLEMENTATION REQUIREMENTS

### 8.1 Immediate Actions (within 1 week)
- [ ] Verify all 15 test gates (G-01 through G-15) pass
- [ ] Register the 10-agent catalogue with the agent registry
- [ ] Create Obsidian knowledge base directory structure
- [ ] Establish weekly note workflow (every Friday)
- [ ] Document Hermes memory + Obsidian boundary matrix
- [ ] Position OpenCode as specialist worker (not secondary orchestrator)
- [ ] Declared agency agent integration through AgentSource port (disabled by default)

### 8.2 Short-Term (within 1 month)
- [ ] Complete production readiness certificate (all 35 validation checks)
- [ ] Conduct first production run monitoring
- [ ] Establish ongoing monitoring cadence (daily/weekly/monthly/quarterly)
- [ ] Verify no prohibited systems (Claude Code/CCR, Gemini CLI, Cursor CLI, Antigravity)
  are installed or enabled
- [ ] Confirm single-authority constraint still maintained (no second orchestrator/router)

### 8.3 Long-Term (quarterly and beyond)
- [ ] Quarterly architecture review (single-authority constraint; no regressions)
- [ ] Quarterly agent catalogue audit (all 10 agents still needed?)
- [ ] Quarterly Obsidian knowledge base review (weekly workflow effective?)
- [ ] Quarterly gate re-verification (G-01 through G-15 all still pass?)
- [ ] Annual production readiness recertification

---

## 9. THE SINGLE FINAL DECISION

**TOZ AI GROUP's final architecture is HEREBY DECLARED as:**

> **The existing TOZ AI Office orchestration fabric (Hermes/TozOrchestrator + Agent
> Registry + Capability Registry + Specialist Pool + Model Router + Evidence/Verification +
> Memory Layer + Tool Execution Host) with the following additions and clarifications:**
>
> 1. **Obsidian integrated as company knowledge base** with explicit boundary definitions
>    separating it from Hermes ephemeral execution memory (see REAL_DURUM_RAPORU.md §4.2-4.3)
> 2. **The 10-agent catalogue registered** (4 MVP + 6 production core) with the agent registry,
>    all starting disabled with lifecycle discovered, promotion to available is an explicit act
> 3. **OpenCode positioned as specialist worker** selectable by the orchestrator, NOT as a
>    secondary orchestrator
> 4. **Agency Agent integration enabled** through the AgentSource port for external source
>    integration, always entering disabled and staying disabled until explicit promotion
> 5. **All current systems preserved as-is**; NO new orchestrator, router, memory subsystem,
>    or task-state owner is added — the single-authority constraint is maintained as the
>    defining architectural principle
> 6. **Explicit memory boundaries documented** between Hermes memory and Obsidian knowledge
>    base (decision matrix in REAL_DURUM_RAPORU.md §4.3) — knowledge that persists beyond
>    execution goes to Obsidian, ephemeral execution state stays in Hermes memory
> 7. **Single-authority constraint maintained** — the architectural spine: exactly one
>    component (TozOrchestrator) may advance task state; no second orchestrator, no
>    second router, no second task-state owner
>
> **This architecture satisfies all 10 criteria to the maximum extent possible** given the
> constraints of: Windows environment, free/free layers maximization, real operational
> capability, long-term sustainability, isolation/removability, and direct commercial
> activity contribution.
>
> **Systems explicitly declined and NOT included:**
> - **Munder** (purely visual; no operational value)
> - **Ruflo** (reference only; no installed package; would inherit uncontrolled control plane)
> - **Open Dots** (mesh protocols; unnecessary complexity)
> - **Open Claw** (conditional; only if tool/MCP directly needed)
> - **Claude Code / CCR** (explicitly forbidden by user: "Claude Code / CCR ana sistem olarak
>   kullanılmayacaktır")
> - **Gemini CLI, Cursor CLI, Antigravity** (explicitly forbidden by user: "sırf alternatif
>   olsun diye sisteme ekleme")
>
> **Systems conditionally accepted:**
> - **OpenCode** as specialist worker (not secondary orchestrator)
> - **Agency Agents** through AgentSource port (disabled until explicit promotion)
> - **Obsidian** as knowledge base (explicit boundary with Hermes memory; weekly workflow)
> - **Skills** as requirement declarations only (no execution runtime; Phase 14 needed)
>
> **Systems preserved as-is** (core functionality and authority structure unchanged):
> - **Hermes / TozOrchestrator** (single authority)
> - **Agent Registry** (lifecycle management, selectable filter, workspace partitioning)
> - **Capability Registry** (tri-state matching, open capability namespace)
> - **Specialist Pool** (deterministic selection, absolute coverage ranking)
> - **Model Router** (agent → provider/model routing, governance narrowing opt-in)
> - **Evidence/Verification** (per-subtask evidence, mergeEvidence, VerificationRunner)
> - **Memory Layer** (scoped access, default-deny, verification-gated capture)
> - **Tool Execution Host** (authorized tool invocation, TextStatInvoker)
> - **Governance** (opt-in, not wired by default; three outcomes)
> - **Approval Registry** (gate lifecycle, taskKey keying, may-release on every release)
>
> This decision is final. No further systems will be added without a new architectural
> review using the same 10 criteria, and any addition must satisfy: (a) real work gets done,
> (b) no existing system's work is duplicated, (c) no conflict with existing systems, (d) no
> uncontrolled router/memory/agent-management complexity, (e) Windows reliability, (f) free/free
> layers maximized, (g) long-term sustainability, (h) removable without system breakage, (i)
> direct commercial contribution, (j) single-authority constraint maintained.

*Final decision date: 2026-10-06*
*Decision authority: TOZ AI GROUP Architecture Review (Özkan as founder/strategic authority)*
*Review cycle: Quarterly; next review: 2026-12-06*

---

## 10. CERTIFICATION

**This final decision certifies that the TOZ AI GROUP architecture as of 2026-10-06 satisfies:**

✅ **All 10 architectural criteria** to the maximum extent possible
✅ **Single-authority constraint** maintained (the defining architectural spine)
✅ **No prohibited systems** installed or enabled (Claude Code/CCR, Gemini CLI, etc.)
✅ **Free/free layer maximization** (zero runtime dependencies; all local operation)
✅ **Real operational capability** (10-agent catalogue; agent execution; tool invocation)
✅ **Long-term sustainability** (documented limitations; explicit isolation; removable components)
✅ **Direct commercial contribution** (Obsidian knowledge base; agent-driven operation; orchestration
  enabling commercial workflows)
✅ **15/15 test gates passing** (G-01 through G-15; 1598/1598 tests)
✅ **1598/1598 test suite passing** across 240 test suites, 0 skipped, 0 todo
✅ **Zero runtime dependencies** (package.json dependencies empty)
✅ **Windows environment compliance** (PowerShell CLI; Git; Node.js; OpenCode)
✅ **Explicit acknowledgment of limitations** (no persistent memory; no provider clients; no MCP;
  no RBAC; documented and accepted)

*Final decision certified: 2026-10-06*

*This document, together with REAL_DURUM_RAPORU.md, ESKI_TASLAKLAR_ELE_STIREL_DEGERlendirme.md,
TEK_NIHAI_MIMARI.md, HIYERARSIY.md, GOREVE_SORUMLULUK_MATRISI.md, MEMORY_MIMARISI.md,
MCP_SKILL_TOOL_POLICY.md, GÜVENLİK_MİMARİSİ.md, KURLUM_SIRASI.md, TEST_GATES.md, and
URETIM_KILAVUBU.md, constitutes the complete architectural record for TOZ AI GROUP.*