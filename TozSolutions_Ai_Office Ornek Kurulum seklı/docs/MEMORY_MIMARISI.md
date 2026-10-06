# TOZ AI GROUP — MEMORY MİMARİSİ
*Memory architecture: Hermes + Obsidian boundary, scoped access, weekly workflow*
*Completed: 2026-10-06*

## 1. MEMORY ARCHITECTURE OVERVIEW

The TOZ AI GROUP memory architecture has **two distinct layers** that serve different
purposes and have clear boundaries:

```
+----------------------+       +----------------------+
| Hermes Memory (Ephe-  |       | Obsidian Knowledge Base|
| meral, Execution-Sc  |       | (Permanent, Company-Sc|
| oped)                |       | pe)                  |
+----------+-----------+       +----------+-----------+
           |                                  |
           | (boundary defined in §4.3)       |
           v                                  v
+----------------------+       +----------------------+
| Task State           |       | Weekly Notes         |
| (current execution)  |       | (every Friday)       |
+----------------------            |
+----------------------          |
           |                          |
           weekly-           |
                                |
                                              |
                                                              |
           |                                                          |
           |                                  |
           v                                  v
+----------------------+       +----------------------+
| Agent Memory         |       | Permanent Knowledge   |
| (agent-specific,     |       | Base (archived info)  |
|  execution-scoped)   |       |                      |
+----------------------+       +----------------------+
```

---

## 2. HERMES MEMORY (EPHEMERAL, EXECUTION-SCOPED)

### 2.1 Memory Scopes (Closed Enum)
Hermes memory uses a **fixed enum of 11 scopes**. These are closed — an invalid scope
is a type error at compile time.

| Scope | Meaning | Duration | Default Recall |
|---|---|---|---|
| `system` | Global system params | Process lifetime | No (must be explicitly granted) |
| `project` | Project-level context | Project lifetime | No (must be explicitly granted) |
| `task` | Task-specific state | Single task execution | No (must be explicitly granted) |
| `agent` | Agent-specific memory | Single agent execution | No (must be explicitly granted) |
| `team` | Team execution context | Team plan topology | No (must be explicitly granted) |
| `provider` | Provider-specific data | Single provider call | No (must be explicitly granted) |
| `pattern` | Recurring pattern detection | Cross-task patterns | No (must be explicitly granted; learning signal opt-in) |
| `knowledge` | **NOT used by Hermes** | — | Reserved for Obsidian |
| `organization` | Organization-wide context | Organization lifetime | No (must be explicitly granted) |
| `global` | **Wide within one workspace** | Process lifetime | ✅ YES — but "wide within one workspace", never shared |
| `conversation` | Chat/conversation context | Conversation lifetime | No (must be explicitly granted) |

**Key properties**:
- **Default-deny**: `recallScopes ships []` (empty array), meaning *no recall*, never *all scopes*
- **Scope beside workspace** (PHASE 06): `MemorySubject` and `MemoryStore` both carry a workspace;
  grants are keyed by `(workspace, subjectId)`
- **`global` means *wide within one workspace*, never *shared across workspaces***
- **No persistent provider** — nothing survives process restart (PHASE 05 §24.16 limitation, acknowledged)
- **Write is verification-gated** — nothing is learned from an unverified run
- **Importance ceiling**: `Math.max(0.2, ...)` floor is PHASE 07 (pinned by tests)

### 2.2 Memory Access Policy
| Operation | Gates | Result if Denied |
|---|---|---|
| Read access | `MemoryAccessPolicy.assertRead()` | Refused as outcome; work continues without the memory |
| Write access | `MemoryAccessPolicy.assertWrite()` | Refused as outcome; work continues without the write |
| Grant with `writableScopes` empty | ✅ Observer pattern | Agent can read but not write — safe default |
| Grant with `writableScopes` non-empty | ✅ Writer pattern | Agent can read AND write within granted scopes |
| No grant at all | ✅ Default-deny | Agent cannot read or write any memory scope |

### 2.3 Memory Grant Structure
```typescript
interface MemoryGrant {
  readonly scopes: readonly MemoryScope[];      // readable scopes
  readonly writableScopes: readonly MemoryScope[]; // writable scopes
}
```

**Properties**:
- `scopes` and `writableScopes` are **separate lists** — read access is NOT write access
- A grant with **empty `writableScopes` is an observer** — can read but not write
- **Nothing is granted by default** — empty recallScopes means no recall
- **Writes are idempotent by key** — same key, same result; no duplicate side effects
- **Refused write is returned as value, never thrown** — work is already done; bookkeeping failure
  is not a reason to lose it

---

## 3. OBISIDIAN KNOWLEDGE BASE (PERMANENT, COMPANY-SCOPED)

### 3.1 Directory Structure
Obsidian is a **file-based knowledge base** with the following directory structure (relative to
project root):

```
weekly-notes/          # Every Friday's notes — never deleted
  2024-01-05.md
  2024-01-12.md
  ...

permanent-knowledge/   # Archived company-relevant information — never deleted
  company-policies.md
  project-retrospectives.md
  organization-structure.md
  ...

temp-working/          # Temporary working information — cleared weekly
  draft-articles.md
  meeting-notes.md
  ...

project-docs/          # Project-specific reference material — per project
  toz-agent-catalogue.md
  orchestration-architecture.md
  ...

company-policies/      # Organizational policies and standards — never deleted
  code-of-conduct.md
  data-privacy.md
  security-practices.md
```

### 3.2 Weekly Workflow (CRITICAL PROCESS)
**Every Friday (or designated day):**

1. **Collect** — All `temp-working/` files are gathered
2. **Analyze** — System (or designated person) reviews all collected files
3. **Archive** — Important information moved from `temp-working/` to `permanent-knowledge/`
   - Company policies → `company-policies/`
   - Project retrospectives → `permanent-knowledge/` with key lessons extracted
   - Other important info → appropriate location
4. **Clean** — `temp-working/` directory is cleared (ready for next week)
5. **Start fresh** — New week begins with empty `temp-working/`

**This workflow is mandatory** — it ensures that:
- Information that should persist beyond a single task/agent execution eventually moves to
  permanent knowledge
- Transient working information does not accumulate indefinitely
- Company knowledge grows organically over time
- No "knowledge debt" accumulates unnoticed

### 3.3 Information Types and Destination

| Information Type | Hermes Memory | Obsidian Destination | Boundary Rule |
|---|---|---|---|
| Real-time execution state | ✅ (task, agent scopes) | ❌ | Ephemeral — disappears when task completes |
| Agent reasoning trace | ✅ (agent scope) | ✅ (as doc in temp-working) | Trace → temp-working → possibly permanent-knowledge |
| Source references/reports | ✅ (evidence) | ✅ (as source doc) | Evidence persists; source info may move to permanent-knowledge |
| Tool call results | ✅ (evidence) | ✅ (as appendix) | Same as source references |
| Weekly learnings | ❌ | ✅ (weekly-notes/[date].md) | Always goes to weekly notes first |
| Project retrospectives | ❌ | ✅ (permanent-knowledge/) | After weekly analysis, key lessons archived |
| Company policies | ❌ | ✅ (company-policies/) | Never in Hermes memory; always in Obsidian |
| Model outputs/verdicts | ✅ (evidence) | ✅ (as record doc) | Evidence persists; verdict doc may move to permanent-knowledge |
| Error logs / failures | ✅ (evidence) | ✅ (as incident doc) | Same pattern as model outputs |
| Transient working info | ❌ | ✅ (temp-working/) | Stays temp; cleared weekly; may archive important bits |
| Source code / artifacts | ✅ (evidence metadata) | ✅ (project-docs/) | Evidence metadata persists; actual artifacts in project-docs |

### 3.4 Boundary Enforcement Rules

**Rule 1: If it must persist beyond a single task/agent execution, it goes to Obsidian.**
- Example: "The analysis from last week's research task" → Obsidian `permanent-knowledge/`
- Example: "The company's data privacy policy" → Obsidian `company-policies/`

**Rule 2: If it is ephemeral to execution, it stays in Hermes memory.**
- Example: "The current task's intermediate results" → Hermes memory `task` scope
- Example: "The agent's identification of its own role" → Hermes memory `agent` scope

**Rule 3: Task state bridges both — it is recorded in evidence (which persists) but is also
the current execution context (in Hermes memory).**
- Example: "The task's objective and its current subtask breakdown" → 
  - Hermes memory: current execution context
  - Obsidian evidence: persistent record of what was attempted

**Rule 4: Source references always go to Obsidian first, evidence records the reference.**
- When an agent reports a source, the source information is recorded in Hermes evidence
- But the actual source material goes to Obsidian (appropriate knowledge base location)
- This ensures that "knowledge that persists" and "evidence that records what happened" are
  both satisfied

---

## 4. MEMORY BOUNDARY DECISION MATRIX (EXPANDED)

| Information Type | Hermes Memory | Obsidian | Task State | Weekly Notes | Permanent Company Info | Removed |
|---|---|---|---|---|---|---|
| Execution objective (current) | ✅ | ❌ | ✅ (current) | ❌ | ❌ | ❌ |
| Execution objective (past) | ❌ | ✅ (as doc) | ❌ | ❌ | ✅ (if key lesson) | ❌ |
| Agent reasoning trace | ✅ (agent scope) | ✅ (temp-working) | ✅ (if relevant) | ✅ (if weekly-relevant) | ✅ (key lessons) | ❌ |
| Source references | ✅ (evidence) | ✅ (as doc) | ✅ (in evidence) | ❌ | ✅ (as reference doc) | ❌ |
| Tool call results | ✅ (evidence) | ✅ (as appendix) | ✅ (in evidence) | ❌ | ✅ (as reference) | ❌ |
| Weekly learnings | ❌ | ✅ (weekly-notes) | ❌ | ✅ (the entry) | ❌ | ❌ |
| Project retrospectives | ❌ | ✅ (permanent-knowledge) | ❌ | ✅ (summary) | ✅ (key lessons) | ❌ |
| Company policies | ❌ | ✅ (company-policies) | ❌ | ❌ | ✅ (full text) | ❌ |
| Transient working info | ❌ | ✅ (temp-working) | ❌ | ⚠️ (temp, cleared weekly) | ❌ | ✅ (weekly cleanup) |
| Model outputs/verdicts | ✅ (evidence) | ✅ (as record) | ✅ (in evidence) | ❌ | ✅ (if key finding) | ❌ |
| Error logs / failures | ✅ (evidence) | ✅ (as incident) | ✅ (in task state) | ❌ | ✅ (if pattern) | ❌ |
| Temporary calculations | ❌ | ✅ (temp-working) | ❌ | ❌ | ❌ | ✅ (weekly) |
| Agent self-assessment | ✅ (agent scope) | ✅ (as doc) | ✅ (if current) | ❌ | ✅ (if pattern) | ❌ |

**Boundary default**: If uncertain, the information **goes to Obsidian**. It is always better to
have information in the permanent knowledge base than to lose it from ephemeral memory.

---

## 5. MEMORY LIFECYCLE

### 5.1 Read Lifecycle
1. **Request recall** — Orchestrator calls `MemoryService.recall(scopes)`
2. **Policy check** — `MemoryAccessPolicy.assertRead(grants, requestedScopes)`
3. **Scope filtering** — Only requested scopes that are in the agent's grants are returned
4. **Workspace filtering** — Only records from the agent's workspace are returned
5. **Return results** — Relevant memory items, or empty if no matching grants exist

**Default outcome**: If `recallScopes` is `[]` (empty), **no recall happens**. The agent
executes without memory of prior context. This is the intentional design — "empty means no
recall, never all scopes."

### 5.2 Write Lifecycle
1. **Attempt write** — Orchestrator or agent calls `MemoryService.write(key, value, scopes)`
2. **Policy check** — `MemoryAccessPolicy.assertWrite(grants, requestedScopes)`
3. **Scope verification** — Only granted writable scopes are accepted
4. **Key-based storage** — Value stored under the key; idempotent (same key = same result)
5. **Return outcome** — `ok` if write succeeded, `refused` if policy denied

**Refused write outcome**: The work is already done; the refusal is returned as a value and
reported in the run's steps. A bookkeeping failure is not a reason to lose the work.

### 5.3 Post-Execution Lifecycle
After every execution:
1. **Verified outcome only** — Memory is only captured after a verification `pass`
2. **Verification-gated** — Nothing is learned from an unverified run
3. **Importance-bearing** — Only memories with stated importance are captured; importance=0
   is read as "worthless" and refuses the write
4. **Scope-bearing** — Memory is stored only in granted scopes; no implicit wide-scale recall

---

## 6. MEMORY AND OBISIDIAN: INTEGRATION PATTERNS

### 6.1 Pattern 1: Research → Evidence → Obsidian
```
Agent researches → Records evidence (Hermes) → Reports sources (Obsidian temp-working) →
Weekly analysis → Archives key findings (Obsidian permanent-knowledge)
```

### 6.2 Pattern 2: Project Work → Project Docs → Obsidian
```
Agent works on project → Records evidence (Hermes) → Saves artifacts (project-docs/) →
Weekly analysis → Archives key lessons (permanent-knowledge/)
```

### 6.3 Pattern 3: Error/Failure → Evidence → Obsidian
```
Failure occurs → Records evidence (Hermes, error scope) → Documents incident (Obsidian
temp-working) → Weekly analysis → Archives pattern (permanent-knowledge/)
```

### 6.4 Pattern 4: Agent Self-Assessment → Agent Memory → Possible Obsidian
```
Agent assesses its performance → Records in agent memory (Hermes agent scope) → If pattern
identified across weeks → Archives to Obsidian permanent-knowledge/
```

---

## 7. REMAINING LIMITATIONS (DOCUMENTED)

| Limitation | Detail | Acknowledged |
|---|---|---|
| **No persistent memory provider** | Nothing survives process restart | ✅ PHASE 05 §24.16 |
| **No embedding provider / RAG** | Semantic retrieval through port only; unavailable path | ✅ PHASE 05 §24.18 |
| **No document connectors** | Ingestion accepts already-extracted text only | ✅ PHASE 05 |
| **Scope breadth inconsistency** | `SCOPE_BREADTH` still inconsistent with declaration order | ⚠️ PHASE 07, pinned by tests |
| **Importance ceiling floor** | `Math.max(0.2, ...)` still unreachable in some paths | ⚠️ PHASE 07, pinned by tests |
| **`ModelRecord.metadata` closed type** | Mapped type with no index signature; runtime allowlist exists | ✅ PHASE 10 |
| **Memory cannot express tenancy** | Tenancy carried beside scope, not inside it | ✅ PHASE 06 (declared and partitioned) |

---

## 8. MEMORY ARCHITECTURE VALIDATION

| Validation Check | Status | Notes |
|---|---|---|
| **Single authority for memory** | ✅ YES | MemoryAccessPolicy is the only gate; no other component grants memory access |
| **Default-deny is enforced** | ✅ YES | Empty recallScopes = no recall; structurally guaranteed by MemoryGrant design |
| **Workspace partitioning** | ✅ YES | PHASE 06: grants keyed by (workspace, subjectId); describe().workspaceIsolation |
| **Read/write separation** | ✅ YES | `scopes` and `writableScopes` are separate lists; grant with empty writableScopes = observer |
| **Verification-gated capture** | ✅ YES | Nothing learned from unverified run; captured only after `pass` |
| **Idempotent writes** | ✅ YES | Same key, same result; no duplicate side effects |
| **Refused write is value, not throw** | ✅ YES | Work already done; bookkeeping failure does not lose it |
| **Obsidian boundary explicit** | ✅ YES | Decision matrix §4.3; rules 1-4 govern where information goes |
| **Weekly workflow mandatory** | ⚠️ CONDITIONAL | Process-defined; not enforced by code but by operational procedure |

---

## 9. MEMORY ARCHITECTURE COMPLETE — SUMMARY

The TOZ AI GROUP memory architecture consists of **two complementary layers**:

1. **Hermes Memory** (ephemeral, execution-scoped, default-deny):
   - 11 fixed scopes, closed enum
   - Grant-based access (read/write separate)
   - Verification-gated capture
   - Process-local only (acknowledged limitation)
   - Weekly learning opt-in (tiebreak-only)

2. **Obsidian Knowledge Base** (permanent, company-scoped, file-based):
   - Directory structure: weekly-notes/, permanent-knowledge/, temp-working/, project-docs/, company-policies/
   - Mandatory weekly workflow (collect → analyze → archive → clean)
   - Explicit boundary with Hermes memory (decision matrix)
   - No vendor lock-in (MIT licensed, pure filesystem)
   - Permanent persistence across process restarts

**The boundary between them is the critical design element**: information that must persist
beyond a single execution goes to Obsidian; ephemeral execution state stays in Hermes memory.
Task state bridges both — recorded in persistent evidence but also the current execution context.

This architecture satisfies the 10 criteria by providing **real operational capability** (agents
can recall relevant context), **long-term sustainability** (knowledge persists and grows organically),
**isolation/removability** (each layer can be independently replaced without breaking the other),
and **direct commercial contribution** (company knowledge base directly supports commercial
activities).

*Memory Architecture completed: 2026-10-06*