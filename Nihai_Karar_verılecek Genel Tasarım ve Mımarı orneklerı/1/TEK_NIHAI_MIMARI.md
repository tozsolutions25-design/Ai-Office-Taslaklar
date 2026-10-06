# TOZ AI GROUP — TEK NIHAI MİMARİ (Single Final Architecture)
*The definitive architecture recommendation, synthesized from all analysis and evaluation*
*Completed: 2026-10-06*

## 1. VISION STATEMENT

**TOZ AI GROUP's final architecture is a minimal, authoritative, and sustainable multi-agent
orchestration system that satisfies all 10 architectural criteria while maximizing free/free
layers, ensuring long-term isolability, and providing direct contribution to commercial
activities.**

The architecture is **centered on a single authority** — the TozOrchestrator (Hermes) — with
clear boundaries, explicit isolations, and no duplicate control planes.

---

## 2. CORE ARCHITECTURAL PRINCIPLES

### 2.1 Single Authority (THE DEFINING PRINCIPLE)
- **Exactly one component** may advance task state from `created` to `completed`:
  `TozOrchestrator` (exposed via `authority.ts`)
- **No second orchestrator, no second router, no second task-state owner** is permitted
- This is the structural safeguard against the primary failure mode of multi-agent systems:
  "two components each believe they decide what runs"
- Governance/approval is **opt-in** and reached through `ExecutionCoordinator` only — not
  wired by default, but available when needed

### 2.2 Structural Domain Separation
The following are separate types with **no structural overlap** (ARCHITECTURE.md §3):

```
Agent        != Capability    an agent HAS capabilities; neither is the other
Agent        != Provider      an agent RUNS ON a provider
Agent        != Model         an agent USES a model
Agent        != Tool          an agent CALLS tools
Agent        != Memory       an agent READS memory under policy
Agent        != Orchestrator  an agent executes; the orchestrator decides
Provider     != Model         a provider SERVES models
Tool         != Agent         a tool is callable; an agent is not
Verification != Generation    a claim is not a verified fact
Evidence     != Output        evidence is what supports the output
Memory       != Learning      memory stores; learning derives
```

This separation is **enforced by tests**, not by convention. Every import resolution is
checked.

### 2.3 Free/Layer Maximization
- **Zero runtime dependencies** — `package.json` has empty `dependencies`
- **All operation is process-local** — no provider clients, no MCP, no database, no
  persistent storage in the repository
- **Local operation is the default** — no provider credentials needed for in-process
  operation; `requiresModelRoute: false` where possible
- **Only paid/externally-integrated components** are added when truly required:
  - When free alternative is insufficient
  - When company income starts being generated
  - When technical benefit outweighs cost

### 2.4 Explicit Isolation and Removability
- **Every component is removable** — no component creates permanent entanglement
- **Workspace-partitioned registries** — PHASE 06 changed multi-tenant classification from
  D (unsafe: unpartitioned and undeclared) to B (partitioned and declared)
- **Memory boundaries are explicit** — Hermes memory + Obsidian knowledge base have
  defined separation (see §4.2)
- **No component is irreplaceable** — any agent, tool, or memory provider can be
  removed without breaking the core architecture

### 2.5 Declarative Over Imperative
- **Skills are declarations only** — requirement bundles that a caller must already hold;
  they do not execute, confer authority, or prompt models
- **Configuration is centralised** — `AppConfig` carries one `orchestration` section;
  `orchestrationConfigFromApp` applies the real schema and returns issues
- **Policies are explicit** — InputPolicy, OutputPolicy, ToolPermission, MemoryAccessPolicy
  all have clear gate semantics; nothing is granted by default

---

## 3. LAYERED ARCHITECTURE

```
                        +----------------------------+
                        |     TOZ ORCHESTRATOR       |  (Hermes - Single Authority)
                        |  authority.task advancement|
                        +------------+---------------+
                                     |
    +----------------------------+----------------------------+
    |                          |                              |
    v                          v                              v
+------------+          +------------+          +------------+
| AGENT      |          | CAPABILITY |          | MODEL ROUTER |
| REGISTRY   |          | REGISTRY   |          | (with Gov. narrowing)
| lifecycle  |          | tri-state  |          | routing requests
+------------+          +------------+          +------------+
    |                          |                              |
    v                          v                              v
+------------+          +------------+          +------------+
| SPECIALIST |          | TOOL       |          | EVIDENCE/  |
| POOL       |          | REGISTRY   |          | VERIFICATION|
| deterministic|          | invocation |          | per-subtask|
| selection  |          | (ToolPer-  |          | evidence   |
|            |          missioned) |          | records    |
+------------+          +------------+          +------------+
    |                          |                              |
    v                          v                              v
+------------+          +------------+          +------------+
| MEMORY     |          | GOVERNANCE |          | WORKERS    |
| (scoped)   |          | (opt-in)   |          | (bounded) |
| read/write |          | Approval   |          | cancellation|
| grants     |          | lifecycle  |          | timeouts   |
+------------+          +------------+          +------------+

                                     |
                                     v
+------------+------------------------+------------+
| OBSIDIAN   |  Company Knowledge Base  |  Hermes    |
| (permanent)|  with explicit boundary  | memory     |
| (file-based)|  (see §4.2)              | (ephemeral)|
+------------+------------------------+------------+

                                     |
                                     v
+-----------------------------------------------------------+
|                   WINDOWS OPERATION                       |
|  PowerShell CLI runners                                  |
|  Git, GitHub integration                                  |
|  OpenCode for terminal/ file ops                        |
|  No provider clients in repo                            |
+-----------------------------------------------------------+
```

---

## 4. MEMORY/KNOWLEDGE BOUNDARY DEFINITION (CRITICAL)

### 4.1 Hermes Memory (Ephemeral, Execution-Scoped)
| Scope | Duration | Purpose | Granted By |
|---|---|---|---|
| `system` | Process lifetime | Global system params | SecurityContext |
| `project` | Project lifetime | Project-level context | SecurityContext |
| `task` | Single task execution | Task-specific state | Task state machine |
| `agent` | Single agent execution | Agent-specific memory | Agent record trustLevel |
| `team` | Team execution context | Coordination between agents | Team plan topology |
| `provider` | Single provider call | Provider-specific data | Model router output |
| `pattern` | Recurring pattern detection | Cross-task patterns | Learning signal (opt-in) |
| `knowledge` | NOT used by Hermes | Reserved for Obsidian | — |
| `system` | Process lifetime | System-wide constants | Configuration |

**Key properties**:
- Default-deny: `recallScopes ships []`, empty means *no recall*, never *all scopes*
- Write is verification-gated — nothing learned from unverified run
- Scope is beside workspace (PHASE 06): `MemorySubject` and `MemoryStore` carry workspace;
  grants keyed by `(workspace, subjectId)`
- `global` means *wide within one workspace*, never *shared across workspaces*

### 4.2 Obsidian Knowledge Base (Permanent, Company-Scoped)
| Category | Storage | Purpose | Boundary Rule |
|---|---|---|---|
| `weekly notes` | `weekly-notes/` directory | What employees learned this week | Always recorded; every Friday analyzed |
| `important information` | `permanent-knowledge/` directory | Company-relevant knowledge | Archived after weekly analysis |
| `repetitive/transient/unnecessary` | Temp directory, cleaned weekly | Temporary working information | Cleared each week; does not persist |
| `project documentation` | `project-docs/` directory | Project-specific reference material | Maintained separately per project |
| `company policies` | `company-policies/` directory | Organizational policies and standards | Never deleted; always preserved |

**Key properties**:
- File-based, no database, no vendor lock-in (MIT licensed)
- **Explicit boundary with Hermes memory**: 
  - Hermes memory: task/agent/ephemeral during execution
  - Obsidian: permanent company knowledge, weekly notes, archived information
  - Boundary decision matrix (see below)
- Always searchable, browsable, portable across platforms
- Weekly workflow: collect → analyze → archive → clean → new week starts fresh

### 4.3 Memory Boundary Decision Matrix

| Information Type | Goes to Hermes Memory | Goes to Obsidian | Task State | Weekly Notes | Permanent Company Info | Removed |
|---|---|---|---|---|---|---|
| Real-time execution state | ✅ (task, agent scopes) | ❌ | ✅ (current task) | ❌ | ❌ | ❌ |
| Agent reasoning trace | ✅ (agent scope) | ❌ | ✅ (if relevant) | ❌ | ❌ | ❌ |
| Source references/reports | ✅ (evidence) | ✅ (as source doc) | ✅ (in evidence) | ❌ | ❌ | ❌ |
| Tool call results | ✅ (evidence) | ✅ (as appendix) | ✅ (in evidence) | ❌ | ❌ | ❌ |
| Weekly learnings | ❌ | ✅ (weekly-notes) | ❌ | ✅ (the entry) | ❌ | ❌ |
| Project retrospectives | ❌ | ✅ (permanent-knowledge) | ❌ | ✅ (summary) | ✅ (key lessons) | ❌ |
| Company policies | ❌ | ✅ (company-policies) | ❌ | ❌ | ✅ (full text) | ❌ |
| Transient working info | ❌ | ⚠️ (temp, cleared weekly) | ❌ | ❌ | ❌ | ✅ (weekly) |
| Model outputs/verdicts | ✅ (evidence) | ✅ (as record) | ✅ (in evidence) | ❌ | ❌ | ❌ |
| Error logs / failures | ✅ (evidence) | ✅ (as incident doc) | ✅ (in task state) | ❌ | ❌ | ❌ |

**Boundary rule**: If information must persist beyond a single task/agent execution, it goes to
Obsidian. If it is ephemeral to execution, it stays in Hermes memory. Task state bridges
both — it is recorded in evidence (which persists) but is also the current execution context
(in Hermes memory).

---

## 5. AGENT SYSTEM

### 5.1 Registered Agent Catalogue (10 Agents)
The following 10 agents are declared in the `agent catalogue` and registered with the agent
registry. All start with `status: "disabled"`, lifecycle `discovered`, and
`requiresModelRoute: false` where indicated.

**MVP Agents (4)**:
1. **qa-reviewer** — Independent QA Reviewer
   - Capabilities: `reasoning`, `coding`, `debugging`, `long_context`
   - Memory scopes: `task`, `agent`
   - Trust: `standard`, Cost: `standard`, Latency: `standard`
   - Execution: `in_process`

2. **briefing-approval-officer** — Briefing / Approval Officer
   - Capabilities: `reasoning`, `structured_output`, `long_context`
   - Memory scopes: `task`, `team`
   - Trust: `high`, Cost: `standard`, Latency: `standard`
   - `requiresModelRoute: false` — self-hosted, brings own inference
   - Execution: `in_process`

3. **research-analyst** — Research Analyst
   - Capabilities: `research`, `reasoning`, `browser_automation`, `long_context`
   - Memory scopes: `task`, `agent`, `project`
   - Trust: `standard`, Cost: `standard`, Latency: `slow`
   - Execution: `in_process`

4. **content-strategist** — Content Strategist / Drafter
   - Capabilities: `text_generation`, `structured_output`, `reasoning`
   - Memory scopes: `task`, `agent`
   - Trust: `standard`, Cost: `low`, Latency: `standard`
   - Execution: `in_process`

**Production Core Agents (6)**:
5. **brand-guardian** — Brand Guardian
   - Capabilities: `reasoning`, `structured_output`, `long_context`
   - Memory scopes: `task`, `team`, `organization`
   - Trust: `high`, Cost: `standard`, Latency: `standard`
   - `requiresModelRoute: false`

6. **compliance-checker** — Compliance Checker
   - Capabilities: `reasoning`, `document_processing`, `long_context`
   - Memory scopes: `task`, `team`, `organization`
   - Trust: `high`, Cost: `standard`, Latency: `slow`
   - `requiresModelRoute: false`

7. **measurement-analyst** — Data / Measurement Analyst
   - Capabilities: `reasoning`, `structured_output`, `coding`
   - Memory scopes: `task`, `agent`, `project`
   - Trust: `standard`, Cost: `standard`, Latency: `standard`
   - `requiresModelRoute: false`

8. **budget-controller** — Budget Controller
   - Capabilities: `reasoning`, `structured_output`
   - Memory scopes: `task`, `team`
   - Trust: `high`, Cost: `low`, Latency: `fast`
   - `requiresModelRoute: false`

9. **operations-agent** — CRM / Operations Agent
   - Capabilities: `reasoning`, `structured_output`, `tool_calling`
   - Memory scopes: `task`, `agent`
   - Trust: `standard`, Cost: `standard`, Latency: `standard`
   - `toolRequirements: []` (declares none — no external tool boundary yet)
   - `requiresModelRoute: false`

10. **Additional specialists** as needed for specific business domains, registered through
    the same catalogue mechanism, always starting disabled with explicit promotion required.

### 5.2 Agent Lifecycle
All agents follow the same lifecycle:
```
discovered → verified → registered → available → draining → retired
```

**Key constraints**:
- An agent can be selected only when: lifecycle is `available` AND record status is `active`
- One alone is not sufficient: an agent can be lifecycle-available while its record is `disabled`;
  a record can be `active` while the lifecycle has not reached `available`
- Re-registering the same version is REJECTED as a duplicate
- New versions register as new keys; upgrade does not erase history
- An external agent (Agency) arrives `disabled` and stays that way until explicit promotion

### 5.3 Agency Agent Integration
External agents enter through the `AgentSource` port:
- **DeclaredAgentSource** over a real roster + **AgencyTransport** implementation
- Agency agent **cannot** select, see pool, or reach orchestrator
- `AgencyAgentAdapter` implements `AgentAdapter`, which has no orchestrator reference
- Agent arrives `disabled`; promotion is a separate, explicit act
- Ingestion is **never a decision** — it registers records; it does not enable, select or
  schedule them
- Ingestion is **always reported** — every descriptor is either registered or rejected with a
  reason

---

## 6. CAPABILITY AND TOOL POLICY

### 6.1 Capability Registry
- **12 built-in capabilities**: `text_generation`, `coding`, `debugging`, `reasoning`, `research`,
  `vision`, `structured_output`, `tool_calling`, `browser_automation`, `document_processing`,
  `long_context`, `ui_design`
- **Open union**: `Capability = BuiltinCapability | (string & {})` — agents can declare
  custom namespaced capabilities (e.g., `web_research`, `entity_extraction`)
- **Tri-state matching**: `supported`, `unsupported`, `unknown` — `unknown` is never promoted
  to `supported`
- **Capability ranking uses absolute coverage** — every candidate assessed against same
  required set; ratio identical for all; agent key is final term for total ordering

### 6.2 Tool Execution Policy
- **Agent declares `toolRequirements`** — the pool filters on tool availability
- **Tool invocation is authorised through `ToolPermission`**, checked before the call
- **Intersection of declared and permitted**: an agent's authorised set is the INTERSECTION of
  what it declared (`toolRequirements`) and what policy permits for the caller
- **Agent that declares nothing gets nothing** — no "give the agent every registered tool" path
- **Reference invoker**: `TextStatInvoker` — genuinely local deterministic tool, needs no
  network or credential
- **Tool execution order**: policy, then existence of implementation, then call
- **Refusal reported as refusal** (`refused: true`) — different from call that was made and failed

### 6.3 Skill System (Declarations Only)
- **Skills are validated, versioned bundles of REQUIREMENTS** — they declare what a caller
  must already hold; they do not confer, execute, or prompt
- **Loading checks caller's capabilities and tool reach against skill's requirements**
- **Loading can REFUSE, never confer** — the registry has no method that grants, confers,
  elevates or widens anything
- **On-demand loading only. Never bulk-load per task.**
- **Skill load is audited** — every load attempt (success or refusal) is recorded in the
  partitioned audit trail
- **No skill runtime in current phase** — any business workflow that actually runs skills is
  PHASE 14 work

---

## 7. GOVERNANCE AND APPROVAL

### 7.1 Governance (Opt-In, Not Wired by Default)
- **Governance gate** is reached through `ExecutionCoordinator`, not the orchestrator
- **Optional**: with no `governance` option on `TozOrchestrator`, step 2b in the request
  lifecycle is skipped and a run behaves exactly as it did in PHASE 08
- **Three outcomes**: `ALLOW`, `DENY`, `REQUIRE_APPROVAL`, `NOT_APPLICABLE`
- **Default-deny**: if every rule declines to opine, engine default-denies with
  `permission_not_granted`
- **No undocumented-caller default-allow**: with governance configured and no
  `securityContext` on the request, the run is **DENIED**

### 7.2 Approval Lifecycle
- **Exactly one approval authority**: the PHASE 07 `ApprovalRegistry`, reached through
  `ExecutionCoordinator`
- **Gate lifecycle**: `waiting → approved | rejected | expired | cancelled`
- **May release consulted on EVERY release** — a retry cannot slip past
- **Decided gate is final** — once a gate is decided, it is final; no re-approval on
  re-run without new gate construction
- **Job-scoped stores keyed by `taskKey(jobId, taskId)`** — fix for the cross-job
  approval bypass that existed before PHASE 10

### 7.3 Anti-Drift
- **DriftGuard** validates a plan BEFORE execution and records the check
- **Limits enforced**: maximum depth, maximum child tasks, deadline, maximum retry count,
  required verification
- **Plan exceeding any limit cannot be executed** — prevents uncontrolled recursive spawning

---

## 8. SECURITY BOUNDARY

### 8.1 Security Model Properties
| Property | Status |
|---|---|
| Default-deny in PolicyEngine | ✅ holds |
| All 16 operations security-sensitive | ✅ none exempt |
| Unidentified caller refused | ✅ |
| Delegation cannot escalate | ✅ refused, not clamped |
| Delegation intersects resources, allow-lists, capabilities, scopes | ✅ |
| Delegation raises trust floor to parent's | ✅ |
| SecurityContext frozen | ✅ |
| Secrets never stored in records | ✅ only `{kind, key}` handles |
| Redaction on the audit path | ✅ |

### 8.2 Security Boundary Diagram
```
INPUT -> POLICY -> ORCHESTRATOR -> AGENT -> TOOL -> OUTPUT -> VERIFICATION
                                         ^
                                         |
                               AGENTSOURCE (Agency integration)
```

- **InputPolicy** screens inbound work — first gate
- **Orchestrator** is the single authority — no second component decides what runs
- **Agent** executes under policy gates — memory grants, tool permissions, trust floor
- **Tool** is authorised through ToolPermission — intersection of declared + permitted
- **OutputPolicy** screens outbound work — last gate before result
- **Verification** — result is verified before being reported as complete
- **AgentSource** — external agency integration, always through the port, never a second control plane

### 8.3 Known Security Limitations (Documented)
- No persistent policy store — a denial is evidenced only for the life of the process
- No cryptographic tamper-evidence on the audit log
- No RBAC: `roles` is a non-authoritative label; resolution is the caller's
- `TraceRecorder.#events` is unredacted — redaction applies to the audit sink, not the local store
- Governance resource/budget path is unreachable for the same reason (no recorder constructed)
- A throwing `narrowRouting` hook fails open to no-narrowing (conscious trade)
- Cancellation does not abort in-flight work; cancelled work incurs full cost
- Budgets are checked but not reserved; a wave can collectively exceed the ceiling

---

## 9. CONFIGURATION AND ENVIRONMENT

### 9.1 Environment Variables (Allow-Listed)
Only these `TOZ_*` environment variables are read through a fixed allow-list:

| Variable | Documented Behavior | Actual Status |
|---|---|---|
| `TOZ_GOVERNANCE_ENFORCED` | enables governance enforcement | Inert — read into config, consulted by nothing |
| `TOZ_GOVERNANCE_BLOCK_ON_UNKNOWN_COST` | "unknown cost is not zero cost" | Inert — read by nothing |
| `TOZ_ROUTING_POLICY` | selects a routing policy | No runtime effect |
| `TOZ_WORKFLOW_*` (7 vars) | workflow behaviour | Coordinator uses constructor options with hard-coded fallbacks |
| `TOZ_SECURITY_INPUT_POLICY=deny_all` | reject all input | Only constructor wiring changes it |
| `TOZ_MEMORY_*` | — | Inert |
| `TOZ_WORKER_*` | — | Inert |
| `TOZ_LEARNING_*` | — | Inert |
| `TOZ_RUFLO_ENABLED` | — | Inert |

**~30 documented environment variables validate correctly and do nothing** — this is a wiring
gap, not a validation gap, and closing it is composition work deliberately not performed in a
certification phase (per §22's requirement, documented as inactive).

### 9.2 Configuration Model
- **`AppConfig` carries one `orchestration` section** — the one configuration object for the
  whole system rather than a second one that can drift
- **Orchestration section is raw passthrough** — the core cannot validate those fields without
  importing the orchestration layer (would invert dependency direction)
- **`orchestrationConfigFromApp` validates with the real schema and returns issues alongside
  the values**
- **Unknown keys inside a section are reported, because a misspelled limit that looks
  configured and is not fails open**
- **Twelve orchestration sections are validated, defaulted, normalised, re-exported, and then
  read by no production code** — largest gap between documentation and behaviour

### 9.3 Windows Environment
- **PowerShell 5.1** as the primary CLI environment
- **Git** for version control and source management
- **GitHub** for remote repository and collaboration
- **Node.js v24.21.0** / npm 11.19.0 for the TypeScript build chain
- **OpenCode 1.18.32** for the code execution agent
- **No pnpm, yarn, bun, Docker** — absent by design (see AD-27)
- **TOZ_ENV** is the only required configuration value

---

## 10. INSTALLATION AND OPERATION SEQUENCE

### 10.1 Zero-to-One Installation
```powershell
# 1. Ensure Windows environment with PowerShell 5.1+
# 2. Install Node.js v22+ (v24.21.0 confirmed working)
npm install

# 3. Install OpenCode (the code execution agent)
#    - via npx opencode.cmd or opencode.cmd

# 4. Configure environment (minimal)
#    - Copy .env.example to .env
#    - Set TOZ_ENV=development (or production)
#    - No provider credentials needed for local operation

# 5. Build the project
npm run build

# 6. Run the test suite (validates architecture)
npm test

# 7. Start the orchestration system
#    - TozOrchestrator initializes with no external dependencies
#    - Agent registry loads the 10 declared agents (all disabled by default)
#    - Specialist pool is ready for selection
#    - Memory layer initializes with default-deny recall
#    - Tool execution host is ready (TextStatInvoker only by default)
```

### 10.2 First-Run Verification
```powershell
# Verify the system starts correctly
& opencode.cmd --help

# Verify no runtime dependencies
cat package.json | select-string "dependencies"

# Verify the orchestrator initializes
#    - Should create TozOrchestrator instance
#    - Agent registry should be empty (no agents registered yet)
#    - Specialist pool should be ready

# Verify the memory layer
#    - Should initialize with empty recallScopes
#    - Default-deny: no recall without explicit grants

# Verify the tool execution host
#    - Should initialize with no tools registered
#    - TextStatInvoker should be available as reference
```

### 10.3 Production Onboarding
```powershell
# 1. Register required agents from the catalogue
#    - Use AgentRegistry.register() with catalogue entries
#    - Set appropriate trustLevel, costClass, latencyClass
#    - Set requiresModelRoute based on whether provider routing is needed

# 2. Configure provider routes for model-dependent agents
#    - Use ModelRouter with ProviderRegistry + ModelRegistry
#    - Governance may narrow routing (opt-in)

# 3. Set up Obsidian knowledge base
#    - Create directory structure: weekly-notes/, permanent-knowledge/, etc.
#    - Establish weekly workflow: every Friday at 17:00
#    - Configure Hermes memory boundaries (see §4.3)

# 4. Enable governance if required (opt-in)
#    - Construct GovernanceGate in composition root
#    - Provide securityContext on requests that need authorization
#    - Set up ApprovalRegistry through ExecutionCoordinator

# 5. Register tools if needed
#    - Use ToolRegistry.register() with ToolRecord
#    - Set ToolPermission for agent authorization
#    - Declare toolRequirements on agent records

# 6. Load skills if needed (PHASE 14+)
#    - Use SkillRegistry.load() with SkillCaller
#    - Check caller holds required capabilities/tools
#    - Report outcome to sink (loaded or refused)
```

---

## 11. TEST GATE SEQUENCE

Every phase must pass the following gates before progressing:

| Gate | Test | Requirement |
|---|---|---|
| **G-01** | Typecheck | `npm run typecheck` — 0 errors |
| **G-02** | Lint | `npm run lint` — 0 errors |
| **G-03** | Build | `npm run build` — success |
| **G-04** | Unit tests | `npm run test:unit` — 634/634 passing |
| **G-05** | PHASE 01 regression | 12 original test files — 232/232 passing |
| **G-06** | PHASE 02 regression | 8 design-system test files — 285/285 passing |
| **G-07** | Site build | `npm run site:build` — index.html generated |
| **G-08** | Full orchestration suite | `npm test` — 1598/1598 passing across 240 suites |
| **G-09** | Memory service tests | `memory.service.test.ts` — 97/97 passing |
| **G-10** | Capability registry tests | `capabilities.test.ts` — open-capability coverage |
| **G-11** | Agent registry tests | Agent lifecycle, selection, lifecycle management |
| **G-12** | Verification tests | Evidence/verification cycle: pass/fail/needs_review |
| **G-13** | Governance tests | Approval lifecycle: waiting → decided |
| **G-14** | Tool execution tests | Tool invocation, permission, refusal |
| **G-15** | Memory boundary tests | Hermes memory + Obsidian boundary assertions |

**No phase transition is allowed without ALL preceding gates passing.**

---

## 12. PRODUCTION READINESS CHECKLIST

### 12.1 Pre-Production
- [ ] All 1598 tests passing (across 240 suites)
- [ ] Typecheck, lint, build all pass
- [ ] Memory boundary between Hermes and Obsidian is explicitly documented and wired
- [ ] Agent catalogue 10 agents registered with appropriate settings
- [ ] Governance opt-in decided (whether to wire GovernanceGate)
- [ ] Environment variables configured for target deployment
- [ ] Weekly note workflow established (every Friday)
- [ ] Obsidian knowledge base directory structure created

### 12.2 Production Go/No-Go
- [ ] Cross-job approval bypass verified closed (taskKey(jobId, taskId) keying)
- [ ] No provider clients installed in repository (zero runtime dependencies)
- [ ] No persistent memory provider (acknowledged limitation, accepted)
- [ ] All 16 security-sensitive operations gated
- [ ] Redaction working on audit path
- [ ] Unknown = not healthy health model active
- [ ] Idempotency ledger bounded at 5,000 with oldest-first eviction understood
- [ ] Twelve orchestration config sections documented as inert (if not wired)
- [ ] No MCP client, no provider client, no live health probe (acknowledged limitations)

### 12.3 Post-Production Monitoring
- [ ] Audit log events being written and readable
- [ ] Memory scope grants being respected (no cross-workspace leakage)
- [ ] Agent lifecycle transitions being recorded
- [ ] Tool invocation denials being recorded (refused: true)
- [ ] Governance decisions (if wired) being recorded
- [ ] Budget accounting being tracked (even though not reserved)
- [ ] Weekly note workflow executing on schedule

---

## 13. FINAL FILE STRUCTURE (Windows Desktop)

### 13.1 Project Root: `D:\AI\TozSolutions_Ai_Office\`

```
ARCHITECTURE.md              # Long-form reference (this architecture)
Ben Özkan Toz Ai SAhibi Kimdir..md  # Personnel file (informational)
CHANGELOG.md                 # Change log (if maintained)
docs/
  FINAL_ARCHITECTURE.md      # Certification audit document (PHASE 10)
  REAL_DURUM_RAPORU.md       # Current status report (this document)
  ESKI_TASLAKLAR_ELE_STIREL_DEGERlendirme.md  # Old drafts evaluation
  PHASE05.md                 # Phase 5 rules
  PHASE05_MAP.md             # Phase 5 audit matrix
  PHASE06.md                 # Phase 6 rules
  PHASE06_MAP.md             # Phase 6 map
  PHASE07.md                 # Phase 7 rules
  PHASE07_MAP.md             # Phase 7 map
  PHASE08.md                 # Phase 8 rules
  PHASE08_MAP.md             # Phase 8 map
  PHASE09.md                 # Phase 9 rules
  PHASE09_MAP.md             # Phase 9 map
  execution/                 # Execution-related docs
  FINAL_ARCHITECTURE.md      # Final architecture certification
  REAL_DURUM_RAPORU.md       # Status report
  ESKI_TASLAKLAR_ELE_STIREL_DEGERlendirme.md   # Drafts evaluation
src/
  core/                      # PHASE 01: provider, model, queue, retry, health, audit, state, config
  orchestration/            # PHASE 04-05: the execution fabric
    authority.ts             # TozOrchestrator — single authority
    agent/                   # Agent registry, records, catalogue
      registry.ts            # AgentRegistry class
      record.ts              # AgentRecord interface
      catalogue.ts           # Agent catalogue (10 agents)
      adapter.ts             # AgentAdapter interface
    capabilities/            # Capability registry, matcher
      registry.ts            # CapabilityRegistry class
      capability.ts          # CAPABILITIES, CapabilitySet
    memory/                  # PHASE 05: Memory layer
      memory.ts              # MemoryProvider facade
    tools/                   # PHASE 04.1: Tool execution
      invoker.ts             # ToolExecutionHost
      tool.ts                # ToolRegistry, ToolRecord
    pool/                    # Specialist pool
      specialistPool.ts      # Deterministic selection
    workflow/                # PHASE 07: Workflow/job model
      coordinator.ts         # ExecutionCoordinator
      jobState.ts            # JobState machine
      workflow/model.ts      # Builders (sequential, parallel, retry, etc.)
    governance/              # PHASE 07-10: Governance/approval
      gate.ts                # OrchestratorGovernancePort
      enforcement.ts         # PolicyEngine
    extensions/              # Extension registry
    config/                  # Configuration schema
    ruflo/                   # PHASE 04.1: Ruflo reference boundary (disabled)
    agentsource/             # PHASE 04.1: Agent source ingestion
      source.ts              # AgentSource, SourceAgentDescriptor
      ingest.ts              # AgentIngestor
      agencyAdapter.ts       # AgencyAgentAdapter
    skill/                   # PHASE 09: Skill registry
      skill.ts               # SkillDeclaration, SkillRegistry
    provider/                # Provider adapter registry (ships empty)
  knowledge/                 # Obs knowledge port (PHASE 10 port, not consulted)
  site/                      # PHASE 03: Static site
    index.ts                 # Home page composition
    content.ts               # All copy as data
    meta.ts                  # Metadata
    routes.ts                # Route table
    home/                    # Home page components
      index.ts               # Page composition
      header.ts              # Global header
      hero.ts                # Hero section
      sections.ts            # Value, capabilities, process, reliability, next step
      architecture.ts        # Layered architecture section
      footer.ts              # Footer landmark
    visuals/                 # SVG diagrams
      heroVisual.ts
      architectureDiagram.ts
    styles/                  # CSS styling
scripts/                     # Build scripts
  build-site.mjs              # Renders site to static HTML
tests/                      # Test suite
  orchestration/            # Orchestration tests
    authority.test.ts        # Orchestrator authority tests
    agency.test.ts           # Agency agent integration tests
    memory.test.ts           # Memory service tests
    capabilities.test.ts     # Capability registry tests
    verification.test.ts     # Evidence/verification tests
    governance.test.ts       # Governance/approval tests
    tool.test.ts             # Tool execution tests
  site/                     # Site tests
    content.test.ts          # Content integrity tests
    render.test.ts           # Rendering/routing tests
    architecture.test.ts     # Architecture/CSS tests
  skill/                    # Skill contract tests
  core/                     # Core tests
  integration/              # Integration tests (absent — K-07)
package.json                # Build scripts, zero runtime deps
tsconfig.json               # TypeScript configuration
.env.example                # Environment variable examples
README.md                   # Project overview
PROJECT_STATE.md            # Single source of truth for project state
```

### 13.2 Key Directories and Their Purpose

| Directory | Purpose | Phase Introduced |
|---|---|---|
| `src/core/` | Provider, model, queue, retry, health, audit, state, config | PHASE 01 |
| `src/orchestration/` | The execution fabric: orchestrator, registries, pool, router, memory, tools, workers, governance | PHASE 04-05 |
| `src/knowledge/` | Knowledge provider port (PHASE 10) — boundary with Obsidian | PHASE 10 |
| `src/site/` | Static homepage and inner pages | PHASE 03 |
| `src/orchestration/agent/catalogue.ts` | The 10-agent catalogue (4 MVP + 6 production core) | PHASE 04.1 |
| `src/orchestration/agentsource/` | Agent source ingestion port | PHASE 04.1 |
| `src/orchestration/skill/` | Skill requirement declarations | PHASE 09 |
| `docs/FINAL_ARCHITECTURE.md` | Certification audit document | PHASE 10 |
| `docs/REAL_DURUM_RAPORU.md` | Current status report (this document) | Post-PHASE 10 |
| `docs/ESKI_TASLAKLAR_ELE_STIREL_DEGERlendirme.md` | Old drafts evaluation | Post-PHASE 10 |
| `tests/orchestration/` | 270+ orchestration test files | PHASE 04-05 |
| `tests/site/` | Site integrity, content, rendering tests | PHASE 03-04 |
| `scripts/` | Build and deployment scripts | Throughout |
| `package.json` | Zero runtime dependencies | PHASE 01 |

---

## 14. TERMINAL INSTALLATION COMMANDS (PowerShell)

### 14.1 Initial Setup (run once)
```powershell
# Navigate to project directory
cd "D:\AI\TozSolutions_Ai_Office"

# Install npm dependencies (zero runtime deps)
npm install

# Install TypeScript globally if not already installed
# (or use npx tsc)

# Verify the build works
npm run build

# Run the full test suite
npm test

# Verify typechecking
npm run typecheck

# Verify linting
npm run lint
```

### 14.2 Agent Catalogue Registration (run after initial setup)
```powershell
# Register the 10-agent catalogue with the agent registry
# This is typically done through a setup script or the orchestration composition root

# Example: Register all catalogue entries
# (Actual registration code depends on the composition root)

# List current agents in registry
Get-Agents -Registry

# Register a specific agent from the catalogue
# $agentRegistry.register(catalogueEntryToRecordInput($mvpAgent1))

# Verify registration
$registry.list() | Format-Table -AutoSize
```

### 14.3 Obsidian Knowledge Base Setup
```powershell
# Create the directory structure for Obsidian knowledge base
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\weekly-notes"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\permanent-knowledge"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\temp-working"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\project-docs"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\company-policies"

# Weekly note template (create once, copy every Friday)
# The system expects weekly notes to be in: weekly-notes/[YYYY-MM-DD].md

# Verify directory structure
Get-ChildItem -Path "D:\AI\TozSolutions_Ai_Office" -Directory

# Set up weekly workflow reminder
# (This can be a scheduled task or manual reminder)
```

### 14.4 First Orchestration Run
```powershell
# Initialize the TozOrchestrator
# (Implementation-dependent; typically through the composition root)

# Example PowerShell command (conceptual):
# $orchestrator = New-Toz-Orchestrator -Configuration .\ .env

# Submit a task
# $result = $orchestrator.runTask -Objective "Research TOZ AI GROUP history"

# Check the result
$result | Format-Output

# Verify evidence was recorded
$orchestrator.evidence | Format-List

# Check memory recall (should be empty by default)
$orchestrator.memory.recall -Scopes @()
```

### 14.5 Production Deployment
```powershell
# 1. Verify all gates passing (G-01 through G-15)
npm run test:unit -- --grep "production"

# 2. Enable governance if required (opt-in)
#    - Construct GovernanceGate in composition root
#    - Provide securityContext on relevant requests

# 3. Configure provider routes for model-dependent work
#    - Set up ProviderRegistry + ModelRegistry
#    - Configure ModelRouter with governance narrowing (if enabled)

# 4. Register required agents
#    - Use AgentRegistry.register() with catalogue entries
#    - Set trustLevel, costClass, latencyClass appropriately
#    - Set requiresModelRoute based on agent needs

# 5. Set up tool permissions if tools are needed
#    - Register tools with ToolRegistry
#    - Set ToolPermission for agent authorization
#    - Declare toolRequirements on agent records

# 6. Monitor first production run
#    - Check audit log for events
#    - Verify memory grants are respected
#    - Check that no unexpected systems are installed or enabled

# 7. Establish ongoing monitoring
#    - Weekly review of audit logs
#    - Monthly review of configuration drift
#    - Quarterly review of agent catalogue relevance
```

---

## 15. THE SINGLE FINAL DECISION

**TOZ AI GROUP's final architecture is HEREBY DECLARED as:**

> **The existing TOZ AI Office orchestration fabric (Hermes/TozOrchestrator + Agent
> Registry + Capability Registry + Specialist Pool + Model Router + Evidence/Verification +
> Memory Layer + Tool Execution Host) with the following additions and clarifications:**
>
> 1. **Obsidian integrated as company knowledge base** with explicit boundary definitions
>    separating it from Hermes ephemeral execution memory (see §4.2-4.3)
> 2. **The 10-agent catalogue registered** (4 MVP + 6 production core) with the agent
>    registry, all starting disabled with lifecycle discovered, promotion to available is
>    an explicit explicit act (see §5.1-5.3)
> 3. **OpenCode positioned as specialist worker** selectable by the orchestrator, NOT as a
>    secondary orchestrator (see §2.7 of REAL_DURUM_RAPORU)
> 4. **Agency Agent integration enabled** through the AgentSource port for external source
>    integration, always entering disabled and staying disabled until explicit promotion
>    (see §5.3 of REAL_DURUM_RAPORU)
> 5. **All current systems preserved as-is**; NO new orchestrator, router, memory subsystem,
>    or task-state owner is added — the single-authority constraint is maintained as the
>    defining architectural principle
> 6. **Explicit memory boundaries documented** between Hermes memory and Obsidian knowledge
>    base (decision matrix in §4.3) — knowledge that persists beyond execution goes to
>    Obsidian, ephemeral execution state stays in Hermes memory
> 7. **Single-authority constraint maintained** — the architectural spine: exactly one
>    component (TozOrchestrator) may advance task state; no second orchestrator, no
>    second router, no second task-state owner
>
> This architecture satisfies all 10 criteria to the maximum extent possible given the
> constraints of: Windows environment, free/free layer maximization, real operational
> capability, long-term sustainability, isolation/removability, and direct commercial
> activity contribution.
>
> **Systems explicitly declined and NOT included:**
> - Munder (purely visual; no operational value)
> - Ruflo (reference only; no installed package)
> - Open Dots (mesh protocols; unnecessary complexity)
> - Open Claw (conditional; only if tool/MCP directly needed)
> - Claude Code / CCR (explicitly forbidden by user)
> - Gemini CLI, Cursor CLI, Antigravity (explicitly forbidden by user)
>
> This decision is final. No further systems will be added without a new architectural
> review using the same 10 criteria, and any addition must satisfy: (a) real work gets
> done, (b) no existing system's work is duplicated, (c) no conflict with existing
> systems, (d) no uncontrolled router/memory/agent-management complexity, (e) Windows
> reliability, (f) free/free layers maximized, (g) long-term sustainability, (h) removable
> without system breakage, (i) direct commercial contribution, (j) single-authority
> constraint maintained.

*Final decision date: 2026-10-06*
*Decision authority: TOZ AI GROUP Architecture Review*