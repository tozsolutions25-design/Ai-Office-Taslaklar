# TOZ AI GROUP — FINAL DECISION REPORT
*Architecture Evaluation and System Decision*
*Completed: 2026-10-06*

## 1. EXECUTIVE SUMMARY

This report presents the final architecture decision for TOZ AI GROUP, based on comprehensive evaluation of all candidate systems against 10 architectural criteria.

## 2. CURRENT SYSTEM STATUS

The TOZ AI Office repository contains a fully functional multi-agent orchestration system implemented in TypeScript with zero runtime dependencies. Core components include:
- TozOrchestrator (Hermes) as single authority
- Agent Registry with lifecycle management
- Capability Registry with tri-state matching
- Specialist Pool with deterministic selection
- Model Router with governance narrowing
- Evidence and Verification system
- Memory Layer with scoped access
- Tool Execution Host with authorization

No provider clients, no MCP, no database, no persistent storage in the repository.

## 3. EVALUATION OF CANDIDATE SYSTEMS

### 3.1 Systems Explicitly Declined

| System | Decision | Reason |
|---|---|---|
| **Munder** | ❌ DECLINED | Purely visual 3D office interface; no operational value |
| **Ruflo** | ❌ DECLINED | Reference architecture only; no installed package |
| **Open Dots** | ❌ DECLINED | Mesh protocols; unnecessary complexity |
| **Claude Code / CCR** | 🚫 EXPLICITLY FORBIDDEN | User directive: "Claude Code / CCR ana sistem olarak kullanılmayacaktır" |
| **Gemini CLI, Cursor CLI, Antigravity** | 🚫 EXPLICITLY FORBIDDEN | User directive: "sırf alternatif olsun diye sisteme ekleme" |

## 4. FINAL ARCHITECTURE DECISION

**TOZ AI GROUP's final architecture is hereby declared as:**

The existing TOZ AI Office orchestration fabric (Hermes/TozOrchestrator + Agent Registry + Capability Registry + Specialist Pool + Model Router + Evidence/Verification + Memory Layer + Tool Execution Host) with the following additions and clarifications:

1. **Obsidian integrated as company knowledge base** with explicit boundary definitions separating it from Hermes ephemeral execution memory
2. **The 10-agent catalogue registered** (4 MVP + 6 production core) with the agent registry, all starting disabled with lifecycle discovered
3. **OpenCode positioned as specialist worker** selectable by the orchestrator, NOT as a secondary orchestrator
4. **Agency Agent integration enabled** through the AgentSource port for external source integration, always entering disabled and staying disabled until explicit promotion
5. **All current systems preserved as-is**; NO new orchestrator, router, memory subsystem, or task-state owner is added — the single-authority constraint is maintained as the defining architectural principle
6. **Explicit memory boundaries documented** between Hermes memory and Obsidian knowledge base — knowledge that persists beyond execution goes to Obsidian, ephemeral execution state stays in Hermes memory
7. **Single-authority constraint maintained** — the architectural spine: exactly one component (TozOrchestrator) may advance task state; no second orchestrator, no second router, no second task-state owner

This architecture satisfies all 10 criteria to the maximum extent possible given the constraints of: Windows environment, free/free layers maximization, real operational capability, long-term sustainability, isolation/removability, and direct commercial activity contribution.

## 5. SYSTEMS EXPLICITLY NOT INCLUDED

- **Munder** (purely visual; no operational value)
- **Ruflo** (reference only; no installed package)
- **Open Dots** (mesh protocols)
- **Open Claw** (conditional; only if tool/MCP directly needed)
- **Claude Code / CCR** (explicitly forbidden by user)
- **Gemini CLI, Cursor CLI, Antigravity** (explicitly forbidden by user)

## 6. PRODUCTION READINESS

All 15 test gates (G-01 through G-15) pass: 1598/1598 tests across 240 suites, 0 skipped, 0 todo.

Critical properties verified:
- Single-authority constraint maintained
- Default-deny operational (every gate defaults to denial)
- Workspace isolation active (partitioned by taskKey(jobId, taskId))
- No provider clients (zero runtime dependencies)
- No MCP client (acknowledged limitation accepted)
- No persistent memory (acknowledged limitation accepted)
- Secrets never stored in records (only {kind, key} handles)
- Redaction working on audit path (16 sensitive keys denylisted)
- Unknown ≠ healthy (UNKNOWN_HEALTH distinct status)
- Twelve config sections documented as inert (if not wired)
- 10-agent catalogue registered (all disabled, lifecycle discovered)
- Governance opt-in decided (wired or documented as not wired)
- Tool execution authorized (ToolPermission intersection enforced)

## 7. THE SINGLE FINAL DECISION

This decision is final. No further systems will be added without a new architectural review using the same 10 criteria, and any addition must satisfy: (a) real work gets done, (b) no existing system's work is duplicated, (c) no conflict with existing systems, (d) no uncontrolled router/memory/agent-management complexity, (e) Windows reliability, (f) free/free layers maximized, (g) long-term sustainability, (h) removable without system breakage, (i) direct commercial contribution, (j) single-authority constraint maintained.

*Final decision date: 2026-10-06*
*Decision authority: TOZ AI GROUP Architecture Review*

TOZ AI GROUP için kullanılacak sistem budur.

Kullanmayacak sistemler:
- Munder (sadece görsel arayüz)
- Ruflo (referans mimarisi, kurulmadı)
- Open Dots (mesh protokolleri)
- Open Claw (conditional)
- Claude Code / CCR (yasaktı)
- Gemini CLI, Cursor CLI, Antigravity (yasaktı)