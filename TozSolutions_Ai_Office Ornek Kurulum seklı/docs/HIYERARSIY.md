# TOZ AI GROUP — HIYERARŞİYİ BELİRLE
*Hierarchy definition: Özkan → yönetim → koordinasyon → worker → tool*
*Completed: 2026-10-06*

## 1. HIERARCHICAL LAYERING PRINCIPLE

The TOZ AI GROUP architecture implements a **strict top-down hierarchy** with exactly one
authority at each level. No level has authority over the level above it, and no component at
one level can bypass the component at the level above it.

```
Özkan (Founder/Vision)
    ↓
Yönetim (Governance/Coordination)
    ↓
Koordinasyon (Orchestration)
    ↓
Worker (Execution)
    ↓
Tool (Capability invocation)
```

---

## 2. LEVEL 1: ÖZKAN (FOUNDER/VISION)

### 2.1 Role and Authority
- **Founder and vision holder** of TOZ AI GROUP
- **Defines the mission, values, and strategic direction**
- **Ultimate accountability** for the system's commercial success and sustainability
- **Does not have direct technical authority** over execution — provides strategic guardrails

### 2.2 Strategic Guardrails (Set Once, Never Overridden)
| Guardrail | Purpose | Enforcement |
|---|---|---|
| Single-authority constraint | Prevents two components each deciding what runs | Architecture tests (§3 ARCHITECTURE.md) |
| Free/free layer maximization | Ensure long-term sustainability | Economic decision by Özkan |
| Windows environment mandate | Operational consistency | Özkan's operational preference |
| No persistent memory (acknowledged limitation) | Manage expectations | Documentation by Özkan |
| Single task-state owner | Prevents state-split corruption | Authority matrix (ARCHITECTURE.md §2) |

### 2.3 Authority Flow from Özkan
Özkan's authority is **strategic, not operational**. It flows downward through the hierarchy
as **enabling constraints**, not as operational directives. Özkan sets the "rules of the game";
the hierarchy operates within those rules.

**Özkan → hierarchy**: "These are the constraints within which you must operate."
**Hierarchy → Özkan**: "This is the state of the system, the issues we face, and the
decisions we need you to make."

---

## 3. LEVEL 2: YÖNETİM (GOVERNANCE/COORDINATION)

### 3.1 Role and Authority
- **Governance and coordination layer** of TOZ AI GROUP
- **Owns the approval lifecycle** through ExecutionCoordinator / ApprovalRegistry
- **Owns the anti-drift limits** through DriftGuard
- **Owns the configuration seam** — AppConfig with one orchestration section
- **Does NOT own task execution** — that is the Worker's responsibility
- **Owns the governance gate** (opt-in, not wired by default)

### 3.2 Coordination Responsibilities
| Responsibility | Scope | Decision Authority |
|---|---|---|
| Approval lifecycle | One gate per taskKey(jobId, taskId) | ExecutionCoordinator + ApprovalRegistry |
| Anti-drift limits | Max depth, max children, deadline, max retries, required verification | DriftGuard (validates before execution) |
| Configuration centralisation | One AppConfig, one orchestration section | orchestrationConfigFromApp |
| Governance opt-in | Whether to wire GovernanceGate | Composition root decision |
| Workspace isolation | Partitioning by (workspace, brand) | PHASE 06: declared and enforced |

### 3.3 Authority Flow from Yönetim
Yönetim's authority is **coordinative, not executory**. It coordinates through:
- **Gates** (approval, anti-drift validation)
- **Policies** (input, output, tool permission, memory access)
- **Configuration** (centralised, single seam)
- **It never executes**, it only authorizes, validates, and coordinates

**Yönetim → koordinasyon**: "You may proceed subject to these gates and policies."
**Koordinasyon → Yönetim**: "Proceeding; here's the evidence, here's the outcome."

---

## 4. LEVEL 3: KOORDİNASYON (ORCHESTRATION)

### 4.1 Role and Authority
- **TozOrchestrator (Hermes)** — **the single authority** that may advance task state
- **Builds the TeamRuntime** and supplies the executor
- **Selects an agent** through SpecialistPool
- **Routes to a provider and model** through ModelRouter
- **Executes through the agent's adapter** (AgentAdapter.execute)
- **Records evidence** per subtask
- **Verifies the output** through VerificationRunner
- **Records outcome, feedback, memory** (verification-gated)

### 4.2 Orchestration Responsibilities
| Responsibility | Scope | Notes |
|---|---|---|
| Task advancement | created → completed (or failed/cancelled/escalated) | Only TozOrchestrator may advance |
| Agent selection | SpecialistPool deterministic selection | Based on capability coverage, trust, latency, cost |
| Model routing | ModelRouter with governance narrowing | Optional; governance can narrow candidates |
| Adapter execution | AgentAdapter.execute per subtask | Adapter is integration boundary only |
| Evidence recording | Per-subtask evidence + mergeEvidence | Every tool call, source, artifact, test survives |
| Verification | VerificationRunner (pass/fail/needs_review) | Unverified = needs_review, not pass |
| Feedback capture | After verified pass only | Learning is opt-in, tiebreak-only |
| Worker management | Start, stop, cancel bounded workers | Workers are execution-only |

### 4.3 Authority Flow from Koordinasyon
Koordinasyon's authority is **executional, not directional**. TozOrchestrator decides *what*
runs within the gates and policies set by Yönetim. The orchestrator is the **only**
component that can advance task state, but it does so within the constraints provided.

**Koordinasyon → worker**: "Here is the task; select an agent and execute."
**Worker → Koordinasyon**: "Task complete (or failed); here's the evidence and outcome."

---

## 5. LEVEL 4: WORKER (EXECUTION)

### 5.1 Role and Authority
- **Bounded, cancellable execution unit** — receives work; never decides what work exists
- **Starts, stops, and cancels** background work with timeout and attempt ceiling
- **Every run is recorded** — throws are recorded as failed; never silently restarted
- **Cannot start an execution** — receives a TaskExecutionPort request
- **Cannot select a provider or model** — that is the orchestrator's decision
- **Cannot plan or mutate topology** — those are the orchestrator's decisions
- **Cannot access memory beyond granted scopes** — MemoryAccessPolicy gates every operation

### 5.2 Worker Responsibilities
| Responsibility | Constraint |
|---|---|
| Execute assigned work | Only what the orchestrator has prepared |
| Report results | Through evidence records; side effects recorded |
| Handle failures | Recorded as failures; never silently retried beyond maxRetries |
| Respond to cancellation | Cooperative abort; in-flight work completes against provider |
| Report health | Observations; UNKNOWN_HEALTH is distinct status |
| No authority | Never told what other work exists; never decides selection |

### 5.3 Authority Flow from Worker
Worker's authority is **executive only**. It executes what the orchestrator has prepared;
it never decides what work exists, what agent runs, or what model is used.

**Worker → tool**: "Here is the tool call; perform it within your authorization."
**Tool → Worker**: "Result (or refusal); side effects recorded."

---

## 6. LEVEL 5: TOOL (CAPABILITY INVOCATION)

### 6.1 Role and Authority
- **Callable entity** — an agent calls a tool; the tool performs work and returns a result
- **Authorized through ToolPermission** — intersection of agent's toolRequirements + policy permits
- **Agent that declares nothing gets nothing** — no "give the agent every registered tool" path
- **Side effects are recorded** — `sideEffecting` flag from registry; `durationMs` is null
  (the host performed nothing; adapter reported the call)
- **Refusal reported as refusal** (`refused: true`) — different from call that was made and failed
- **Tool never selects an agent** — tools are callable only, not selecitable

### 6.2 Tool Responsibilities
| Responsibility | Constraint |
|---|---|
| Perform the called work | Only what it is authorized to do |
| Report result | To the agent that called it |
| Report side effects | Through the `sideEffecting` flag (from registry) |
| Handle refusal | If not authorized or declared, report `refused: true` |
| No selection authority | Cannot select which agent runs or what task is performed |
| No authority beyond declared scope | Cannot exceed what the agent's toolRequirements + policy permits |

### 6.3 Authority Flow from Tool
Tool's authority is **invocational only**. An agent calls it; the tool performs and returns.
The tool never initiates, never selects, and never decides.

**Tool → output**: "Here is the result; the agent will verify and complete."
**Output → Verification**: "The result is verified (or not); evidence is recorded."

---

## 7. FULL HIERARCHY WITH ACCOUNTABILITY FLOW

```
┌─────────────────────────────────────────────────────────────────┐
│                        ÖZKAN (Founder)                          │
│  Strategic guardrails ⇓                                           │
│                                                                   │
│  ┌────────────────────────────────────────────────────────┐       │
│  │                     YÖNETİM (Governance)                │       │
│  │  Coordination ⇓                                         │       │
│  │  ┌────────────────────────────────────────────────┐     │       │
│  │  │                  KOORDİNASYON (Orchestration)      │     │       │
│  │  │  Agent selection ⇓                               │     │       │
│  │  │  ┌──────────────────────────────────────────┐     │     │       │
│  │  │  │               WORKER (Execution)             │     │       │
│  │  │  │  Tool invocation ⇓                           │     │       │
│  │  │  │  ┌─────────────────────────────────────┐     │     │       │
│  │  │  │  │              TOOL (Invocation)          │     │       │
│  │  │  │  └─────────────────────────────────────┘     │     │       │
│  │  │  └─────────────────────────────────────────────┘     │       │
│  │  │                                                   │       │
│  │  │  Policy gates ⇐──────────────────────────────────┘       │
│  │  │  (InputPolicy, OutputPolicy, ToolPermission,      │       │
│  │  │   MemoryAccessPolicy, Anti-Drift)               │       │
│  │  └────────────────────────────────────────────────┘       │       │
│  └────────────────────────────────────────────────────────┘       │
│                                                                   │
│  Accountability:                                                  │
│  - Özkan: strategic direction and approval of guardrails          │
│  - Yönetim: coordination, gates, policies, configuration        │
│  - Koordinasyon: execution within gates and policies              │
│  - Worker: bounded execution only                                 │
│  - Tool: invocational only                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. ACCOUNTABILITY MATRIX

| Level | Authority | Accountability To | Can Override Above | Can Be Overridden By |
|---|---|---|---|---|
| **Özkan** | Strategic guardrails | Nobody (ultimate) | No | — |
| **Yönetim** | Gates, policies, config | Özkan (strategic review) | No (within guardrails) | Özkan |
| **Koordinasyon** | Execution within gates | Yönetim (policy review) | No (within policies) | Yönetim + Özkan |
| **Worker** | Bounded execution | Koordinasyon (task assignment) | No | Koordinasyon |
| **Tool** | Invocation within authorization | Worker (caller authorization) | No | Worker + Koordinasyon |

**Key invariant**: No level can override the level above it. Each level operates within
the constraints set by the level above, and reports outcomes back up the hierarchy.

---

## 9. HIERARCHY ENFORCEMENT

### 9.1 Test Enforcement
The four-tree import restriction (ARCHITECTURE.md §4) enforces the hierarchy structurally:
- `src/orchestration` imports from `core` + `design-system` only
- `src/core` imports nothing internal
- `src/design-system` imports nothing internal
- `src/site` imports from `design-system` only

**Each import is resolved by tests**, not by convention. If a lower level were to import
from a higher level, the test suite would fail.

### 9.2 Runtime Enforcement
- **Only TozOrchestrator may advance task state** — any other component attempting to
  move a task from `created` to `completed` is rejected
- **Only SpecialistPool selects agents** — no other component has selection authority
- **Only ModelRouter routes providers/models** — no other component decides routing
- **Only ToolPermission authorizes tool calls** — no other component grants unlimited tool access
- **MemoryAccessPolicy gates every read/write** — no automatic or implicit memory access

### 9.3 Violation Consequences
Any violation of the hierarchy is treated as a **structural defect**, not a behavioral one:
- If a worker were to select its own agent, the system's single-authority constraint is violated
- If a tool were to select an agent, the agent/tool separation is breached
- If a lower level were to import from a higher level, the import restriction test fails
- All such violations are caught by the test suite and reported as failures

---

## 10. HIERARCHY SUMMARY

The TOZ AI GROUP hierarchy is **strict, enforceable, and minimal**:

1. **One founder** (Özkan) sets strategic guardrails — no operational authority
2. **One governance layer** (Yönetim) coordinates through gates and policies — no execution authority
3. **One orchestrator** (TozOrchestrator / Hermes) executes within gates — the **single authority** for task advancement
4. **One specialist pool** — deterministic agent selection, no other selector exists
5. **One worker type** — bounded execution only, no selection authority
6. **One tool invocation model** — agent-declared tools, policy-gated, refusal-reported

**Total: 6 layers, 1 authority at each level, 0 duplicate authorities.**

This is the **minimum hierarchy** that satisfies all 10 architectural criteria while
providing sufficient coordination for multi-agent operation. Adding any additional
authority layer would violate the single-authority constraint; removing any layer would
lose necessary coordination functionality.

*Hierarchy definition completed: 2026-10-06*