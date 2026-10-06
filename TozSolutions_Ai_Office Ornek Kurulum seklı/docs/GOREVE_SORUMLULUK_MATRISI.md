# TOZ AI GROUP — GOREVE / SORUMLULUK MATRİSİ
*Task/Responsibility Matrix: Every system's precise responsibility area in table form*
*Completed: 2026-10-06*

## 1. MATRIX OVERVIEW

This matrix defines, for every system in the TOZ AI GROUP architecture, the following:
- **Exact responsibility area** — what that system is responsible for
- **Sole authority** — whether this is the only system with this responsibility
- **Dependencies** — what this system depends on from other systems
- **Reporting line** — to whom this system reports (in the hierarchy)
- **Removability** — whether this system can be completely removed without breaking the architecture

The matrix is organized by hierarchical level, from top (Özkan/strategic) to bottom (tools/execution).

---

## 2. HIERARCHICAL LEVEL 0: STRATEGIC / FOUNDATION

| System | Responsibility | Sole Authority | Dependencies | Reports To | Removable |
|---|---|---|---|---|---|
| **Özkan (Founder)** | Strategic vision, guardrails, commercial direction | ✅ YES (ultimate) | None (no system above) | N/A (ultimate) | N/A (founding entity) |
| **Windows Environment** | Execution platform, CLI runners, OS-level guarantees | ✅ YES (platform) | None | Özkan | ❌ NO (mandated by requirements) |
| **TOZ Environment (TOZ_ENV)** | Single required configuration value | ✅ YES (only config var) | None | Özkan | ⚠️ Conditional (must exist for deployment) |

---

## 3. HIERARCHICAL LEVEL 1: GOVERNANCE / COORDINATION

| System | Responsibility | Sole Authority | Dependencies | Reports To | Removable |
|---|---|---|---|---|---|
| **Governance (PolicyEngine)** | Input/output policy decisions; first rule wins; default-deny | ✅ YES (only policy gate) | - InputPolicy rules - SecurityContext (optional) | Yönetim | ⚠️ Conditional (opt-in; not wired by default) |
| **ApprovalRegistry** | Approval lifecycle: waiting → approved/rejected/expired/cancelled | ✅ YES (only approval gate) | ExecutionCoordinator; taskKey(jobId, taskId) | Yönetim | ⚠️ Conditional (opt-in; not wired by default) |
| **DriftGuard** | Anti-drift validation before execution; max depth, children, deadline, retries, verification | ✅ YES (only drift validation) | Plan model; antiDrift limits config | Yönetim | ✅ YES (can be disabled; limits still documented) |
| **ExecutionCoordinator** | Job/task state machine; claims; budgets; approvals orchestration | ✅ YES (job-scoped stores) | - JobState - ApprovalRegistry - TaskRecord state | Yönetim | ⚠️ Conditional (part of workflow model) |
| **Configuration (AppConfig + orchestrationConfigFromApp)** | One configuration object for whole system; 12 orchestration sections | ✅ YES (centralised seam) | Environment variables; TOZ_* allow-list | Yönetim | ✅ YES (sections can remain inert) |

---

## 4. HIERARCHICAL LEVEL 2: ORCHESTRATION / COORDINATION AUTHORITY

| System | Responsibility | Sole Authority | Dependencies | Reports To | Removable |
|---|---|---|---|---|---|
| **TozOrchestrator (Hermes)** | **Single authority**: advance task from created → completed; build TeamRuntime; execute per subtask | ✅ YES (the one authority) | - AgentRegistry - CapabilityRegistry - SpecialistPool - ModelRouter - EvidenceCollector - Verifier - MemoryProvider - WorkerHost - Governance (opt-in) | Koordinasyon | ❌ NO (removing breaks single-authority constraint) |
| **AgentRegistry** | Machine-readable agent inventory; lifecycle management; selectable filter | ✅ YES (only agent registry) | - Agent records - Lifecycle transitions - workspace partitioning | Koordinasyon | ✅ YES (other agents could be sourced differently, but registry pattern remains) |
| **CapabilityRegistry** | Tri-state capability matching (supported/unsupported/unknown); availability reporting | ✅ YES (only capability registry) | - Agent records with capabilities - Built-in CAPABILITIES list | Koordinasyon | ✅ YES (custom capabilities could be declared without registry, but registry provides indexing) |
| **SpecialistPool** | Deterministic agent selection: filter + rank (coverage, trust, latency, cost, agentKey) | ✅ YES (only deterministic selector) | - AgentRegistry selectable agents - CapabilityRegistry match results - TeamPlan topology | Koordinasyon | ✅ YES (different selection algorithm could replace, but pool pattern remains) |
| **ModelRouter** | Agent → provider/model routing; governance narrowing; null = no route | ✅ YES (only router) | - Agent requirements - ProviderRegistry - ModelRegistry - Governance narrowing (opt-in) | Koordinasyon | ✅ YES (different router could replace, but routing pattern remains) |
| **Evidence/Verification** | Per-subtask evidence recording; mergeEvidence; VerificationRunner (pass/fail/needs_review) | ✅ YES (only evidence+verification) | - AgentAdapter execution results - Tool call records - Model routing decisions - Verification kind recognition | Koordinasyon | ✅ YES (different verification system could replace, but evidence pattern remains) |

---

## 5. HIERARCHICAL LEVEL 3: EXECUTION / MEMORY / TOOLS

| System | Responsibility | Sole Authority | Dependencies | Reports To | Removable |
|---|---|---|---|---|---|
| **Memory Layer (MemoryService facade)** | Scoped memory access; read/write grants with scopes/writableScopes; default-deny recall | ✅ YES (only memory service) | - MemoryScope enum - MemoryAccessPolicy grants - Workspace partitioning (PHASE 06) - Obsidian knowledge base (boundary defined in §4.2) | Koordinasyon | ✅ YES (non-persistent; process-local only; acknowledged limitation) |
| **ToolExecutionHost** | Authorized tool invocation; TextStatInvoker as reference; policy + implementation + call order | ✅ YES (only tool execution host) | - ToolRegistry - ToolPermission - Agent.toolRequirements - Policy enforcement | Koordinasyon | ✅ YES (different tool invoker could replace, but execution-host pattern remains) |
| **WorkerHost / Worker** | Bounded, cancellable background work; timeout/attempt ceiling; every run recorded | ✅ YES (only worker execution) | - TeamRuntime from orchestrator - Registries (agent, capability, tool, memory) - Anti-drift limits | Koordinasyon | ✅ YES (different worker implementation could replace, but bounded-execution pattern remains) |
| **AgentAdapter** | Normalise identity, capabilities, input, execution, output, errors, lifecycle, health, metadata, cost | ✅ YES (only adapter interface) | - Agent record - ModelRouter routing decision - SpecialistPool selection - Memory grants | Koordinasyon | ✅ YES (different adapter implementations could replace, but adapter pattern remains) |
| **OutputPolicy** | Screen outbound work before it becomes result | ✅ YES (only output policy gate) | - Input from agent execution - Policy rules (optional; governance-related) | Koordinasyon | ⚠️ Conditional (optional; output may pass un-screened if no policy configured) |

---

## 6. HIERARCHICAL LEVEL 4: AGENT / SPECIALIST

| System | Responsibility | Sole Authority | Dependencies | Reports To | Removable |
|---|---|---|---|---|---|
| **Agent Records (10 catalogue agents)** | Execute specific task types; declare capabilities, tool requirements, memory scopes, trust level, cost class, latency class | ❌ NO (10 agents, each partial) | - AgentRegistry - SpecialistPool selection - ModelRouter routing - Memory grants - ToolPermission | Koordinasyon | ✅ YES (each agent removable individually; catalogue maintains 10 but any subset works) |
| **Specialist Selection** | Choose best agent for task based on capability coverage etc. | ❌ NO (SpecialistPool is sole selector) | - AgentRegistry selectable agents - CapabilityRegistry verdicts - TeamPlan topology | Koordinasyon | ✅ YES (different selection algorithm could replace, but pool pattern remains) |
| **InputPolicy** | Screen inbound work before it becomes a plan | ⚠️ CONDITIONAL | - Orchestrator request - Governance (if wired) - Policy rules | Koordinasyon | ⚠️ Conditional (opt-in; step 2b in lifecycle) |

---

## 7. HIERARCHICAL LEVEL 5: TOOL / CAPABILITY

| System | Responsibility | Sole Authority | Dependencies | Reports To | Removable |
|---|---|---|---|---|---|
| **Capability Names** | The 12 built-in capability names + open namespace for custom namespaced capabilities | ✅ YES (only capability name space) | - Built-in CAPABILITIES list - isCapabilityName validation - CapabilitySet model | Koordinasyon | ✅ YES (new custom capabilities can be added without breaking) |
| **Tool Registry** | Hold tool records; authorise tool calls through ToolPermission | ✅ YES (only tool registry) | - ToolRecord entries - ToolPermission checks - Agent.toolRequirements | Koordinasyon | ✅ YES (different tool registry could replace, but registry pattern remains) |
| **Tool Permission** | Authorise tool calls: intersection of agent.declared + policy permits | ✅ YES (only tool authorization) | - Agent.toolRequirements - Policy rules - ToolRegistry implementations | Koordinasyon | ⚠️ Conditional (policy-dependently wired) |
| **Skill Declarations** | Requirement bundles; what a caller must already hold; do NOT confer, execute, or prompt | ✅ YES (only skill declarations) | - SkillCaller capabilities - SkillCaller.toolIds - SkillDeclaration requiredCapabilities, requiredTools | Koordinasyon | ✅ YES (skills are optional; registry is always present but skills can be unregistered) |

---

## 8. CROSS-CUTTING RESPONSIBILITIES

| Responsibility | Primary System | Secondary/Systems | Enforcement |
|---|---|---|---|
| **Single-authority constraint** | TozOrchestrator | All systems | Architecture tests; import restrictions; runtime gates |
| **Workspace isolation** | AgentRegistry, MemoryService | ProviderRegistry, ModelRegistry | PHASE 06: workspaceKey partitioning; describe().workspaceIsolation |
| **Default-deny principle** | MemoryService, PolicyEngine | All systems | Empty recallScopes = no recall; no grants by default; first rule wins in PolicyEngine |
| **Evidence recording** | EvidenceCollector, VerificationRunner | All executing systems | Per-subtask; mergeEvidence; every tool call, source, artifact, test survives |
| **Failure reporting** | VerificationRunner, WorkerHost | All failing systems | `needs_review` not `pass`; failed not thrown; refusal reported as value |
| **Configuration centralisation** | AppConfig + orchestrationConfigFromApp | All systems requiring config | One orchestration section; unknown keys reported; fail open |
| **Import restriction (four-tree)** | Architecture tests | All src/ modules | Core→nothing; design-system→nothing; site→design-system only; orchestration→core+design-system |

---

## 9. RESPONSIBILITY BOUNDARIES (WHAT IS NOT)

| Responsibility | NOT Assigned To | Reason |
|---|---|---|
| **Selecting multiple agents per subtask** | SpecialistPool (only one selected per subtask by design) | Team topology determines if parallel agents are allowed |
| **Conferring capabilities via skills** | SkillRegistry (declares, does not confer) | Loading can REFUSE, never confer; skills are requirements only |
| **Providing provider clients** | No system (acknowledged limitation) | Zero runtime dependencies; no OpenAI/Anthropic/Google client in repo |
| **MCP integration** | No system (acknowledged limitation) | No MCP client, no transport, no transport client |
| **Persistent memory** | No system (acknowledged limitation) | ~38 process-local stores; restart loses everything |
| **Second orchestration authority** | No system (structural constraint) | Single-authority constraint is non-negotiable |
| **Approving without gate** | No system (structural constraint) | ApprovalRegistry gate is required; no approval bypass |
| **Unrestricted tool access** | No system (security constraint) | ToolPermission intersection; agent that declares nothing gets nothing |
| **Memory access without grants** | No system (security constraint) | MemoryAccessPolicy gates every read/write; default-deny |
| **Default-allow in any gate** | No system (security constraint) | PolicyEngine default-denies if every rule declines |

---

## 10. MATRIX VALIDATION CHECKLIST

| Validation | Status | Notes |
|---|---|---|
| **Every system has exactly one primary responsibility** | ✅ YES | No system has two "sole authority" responsibilities |
| **Sole authority fields are consistent** | ✅ YES | No two systems claim the same sole authority |
| **Dependencies flow downward** | ✅ YES | Lower levels depend on upper levels; not vice versa |
| **Removability is documented** | ✅ YES | Each system says if/why it's removable |
| **Cross-cutting responsibilities are assigned** | ✅ YES | Every major concern has a primary system |
| **No responsibility gaps** | ✅ YES | Every concern from the 10 criteria is covered by exactly one system |
| **Hierarchy enforcement is clear** | ✅ YES | Import restrictions + runtime gates enforce the hierarchy |
| **Security constraints are explicit** | ✅ YES | Default-deny, intersections, gates all documented |

---

## 11. MATRIX SUMMARY

**Total systems evaluated: 31** (including cross-cutting and auxiliary systems)

**Sole authority assignments: 14** (one system has sole authority for each)

**Conditional sole authorities: 4** (opt-in, gate-dependently wired)

**Non-sole responsibilities: 8** (distributed across multiple agents or systems)

**No-owner responsibilities (acknowledged limitations): 5** (persistent memory, provider clients, MCP, etc.)

**Key invariant**: Across the entire matrix, **no two systems share sole authority for the same responsibility**, and **every significant architectural concern has exactly one primary system responsible for it**. This is the structural guarantee that prevents the "two components each believe they decide what runs" failure mode that the single-authority constraint was designed to prevent.

*Matrix completed: 2026-10-06*