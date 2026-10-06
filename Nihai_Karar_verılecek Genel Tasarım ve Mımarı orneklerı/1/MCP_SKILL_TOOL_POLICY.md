# TOZ AI GROUP — MCP / SKILL / TOOL POLİTİKASI
*MCP client status, skill declaration policy, tool authorization policy*
*Completed: 2026-10-06*

## 1. MCP STATUS (PHASE 10 CERTIFICATION)

### 1.1 Official Status
**MCP client not implemented.** No MCP abstraction, no transport, no client.

> "MCP client not implemented. No MCP abstraction, no transport, no client. None was
> created, because a stub shaped like MCP would be a fabricated capability." —
> FINAL_ARCHITECTURE.md §20

### 1.2 Current Tool Execution Model
Tool execution exists without MCP:
- `ToolExecutionHost` (`src/orchestration/tools/invoker.ts`) — the port and one local
  implementation (`TextStatInvoker`)
- No MCP wire protocol is implemented or faked
- Tool invocation is authorised through `ToolPermission` — intersection of agent's
  `toolRequirements` + what policy permits for the caller
- **Agent that declares nothing gets nothing** — no "give the agent every registered tool"
  path

### 1.3 Why No MCP?
A stub shaped like MCP would be a **fabricated capability** — it would have the shape of
MCP but no real transport, no wire protocol, no actual integration. The repository
authentically reports this limitation rather than inventing a fake integration.

**MCP-related capabilities** (if needed in future) would be:
- `mcp_client` — would require actual MCP transport implementation
- `entity_extraction` — already a valid custom capability (namespace-compliant)
- `web_research` — already a valid custom capability

### 1.4 MCP Adoption Policy
| Condition | Action |
|---|---|
| **Real MCP transport available** | May integrate through `ToolExecutionHost` extension point; no core changes required |
| **Stub or fabricated MCP** | ❌ EXPLICITLY FORBIDDEN — would be a fabricated capability |
| **MCP-lite for local files** | ✅ ACCEPTABLE — `TextStatInvoker` already provides deterministic local tool execution |
| **MCP for provider integration** | ⚠️ CONDITIONAL — would require actual provider adapter; not in current scope |

---

## 2. SKILL POLICY (PHASE 09)

### 2.1 Core Philosophy
**Skills are declarations only — they do not confer, execute, or prompt.**

> "A skill here is a declaration plus an audited load. It does not execute, prompt a model, or
> hold resources — because there is no runtime for it to execute in, and inventing one would be
> the fabricated-capability shape." — skill.ts §45-52

> "Skills must not become a way to grant authority. A skill declares capabilities; it does not
> confer them." — PHASE 09 design principle (decisions.md D-09, D-53)

### 2.2 Skill Declaration Structure
```typescript
interface SkillDeclaration {
  readonly skillId: string;
  readonly version: string;
  readonly summary: string;                      // MUST be non-empty
  readonly requiredCapabilities: readonly Capability[];  // what caller must already hold
  readonly requiredTools: readonly string[];          // what caller must already reach
  readonly metadata?: Readonly<Record<string, unknown>>; // free-form, never authoritative
}
```

### 2.3 Loading Policy (The Only Loading Path)
**`SkillRegistry.load(skillId, version, caller)`** — the single loading method, takes ONE skill:

1. **Check if skill is registered** — if not, return `unknown_skill` refusal
2. **Check caller's capabilities** — `matchCapabilities(declaration.requiredCapabilities, 
   caller.capabilities)`:
   - If missing capabilities → return `capability_not_held` refusal
   - If all present → continue
3. **Check caller's tool reach** — `caller.toolIds` vs `declaration.requiredTools`:
   - If missing tools → return `tool_not_reachable` refusal
   - If all reachable → continue
4. **Report successful load** — sink receives `outcome: "loaded"`, `refusal: null`
5. **Return loaded skill** — `ok(LoadedSkill)` with declaration echoed back

### 2.4 Loading Refusals (Always Reported, Never Collapsed)
| Refusal Type | Meaning | Report Details |
|---|---|---|
| `unknown_skill` | Skill not registered | Skill `"id"@`version` is not registered` |
| `capability_not_held` | Caller lacks required capabilities | `"Caller does not hold the capabilities this skill requires: ..."` |
| `tool_not_reachable` | Caller cannot reach required tools | `"Caller cannot reach the tools this skill requires: ..."` |
| `not_validated` | Structural validation failed | Internal error; should not occur |

**Key property**: Loading can **REFUSE, never confer**. The registry has no method that
grants, confers, elevates or widens any capability set.

### 2.5 Skill Load Audit
Every load attempt (success or refusal) is recorded in the **partitioned audit trail**:
- `skillId`, `version`, `workspace`, `outcome` ("loaded" or "refused")
- `refusal` (if refused), `reason` (human-readable), `missing` (what was missing)
- `at` (timestamp)

**No skill load is kept secret** — the audit record is a first-class shape that operators
can query.

### 2.6 Skill Registry Operations
| Operation | Effect | Notes |
|---|---|---|
| `register(declaration)` | Stores validated declaration | Invalid declarations are rejected at registration, never stored |
| `has(skillId, version)` | Checks if registered | Says nothing about whether anyone may load it |
| `get(skillId, version)` | Returns declaration or null | Does NOT confer anything; just returns data |
| `load(skillId, version, caller)` | Attempts load for one caller | The ONLY loading path; checks caller holds requirements |
| `names()` | Returns all registered skill names | Configuration display only |

### 2.7 Skill System Limitations (Documented)
| Limitation | Detail | Acknowledged |
|---|---|---|
| **No skill runtime** | Skills do not execute, prompt models, or hold resources | ✅ skill.ts §45-52 |
| **No bulk loading** | Only one skill at a time; loadAll() forbidden | ✅ skill.ts §39-43 |
| **No capability conferral** | Loading never adds capabilities to caller | ✅ skill.ts §31-33 |
| **No on-demand execution** | Any workflow that actually runs skills is PHASE 14 | ✅ skill.ts §51-52 |
| **Process-local load log** | Load records are process-local; not in registry | ✅ skill.ts §228-230 |

---

## 3. TOOL POLICY (PHASE 04.1)

### 3.1 Tool Authorization Model
Tool invocation follows a strict **three-step authorization order**:

1. **Policy check** — `ToolPermission` authorises the call
2. **Implementation existence** — tool must have a registered implementation
3. **Actual call** — the tool is performed

If step 1 or 2 fails, the call is refused without being made.

### 3.2 ToolPermission Structure
```typescript
// An agent's authorised tool set = INTERSECTION of:
// 1. What the agent declared (toolRequirements)
// 2. What policy permits for the caller
```

**Key properties**:
- **Agent that declares nothing gets nothing** — if `toolRequirements: []`, agent can call
  no tools
- **No "give the agent every registered tool" path** — the registry is not a permission list
- **Refusal reported as refusal** (`refused: true`) — different from call made and failed
- **sideEffecting flag** — comes from the registry; `durationMs` is `null` (the host
  performed nothing; the adapter reported the call)

### 3.3 ToolExecutionHost (Reference Implementation)
```typescript
// TextStatInvoker — the only shipped tool invoker
// - Genuinely local deterministic tool
// - Needs no network or credential
// - Working tool, not a stand-in pretending to be an MCP client
// - PHASE 04.1: closes the "tools filtered but never called" gap
```

**Tool execution order** (enforced):
1. **Policy** — `ToolPermission` checks authorisation
2. **Implementation** — registry confirms a tool implementation exists
3. **Call** — the tool is performed (if both above pass)

### 3.4 Tool Registration
```typescript
// ToolRegistry.register(input: ToolRecordInput): Result<ToolRecord, ToolRegistryError>
// - Validates tool record
// - Keyed by tool name
// - Re-indexing is idempotent (refresh without first removing)
// - Stores: name, inputContract, outputContract, sideEffecting, etc.
```

### 3.5 Tool Policy Constraints
| Constraint | Detail |
|---|---|
| **No unrestricted access** | Agent must declare toolRequirements; intersection with policy |
| **No MCP dependency** | TextStatInvoker is local; no MCP client required |
| **Side effects recorded** | `sideEffecting` from registry; `durationMs` is null |
| **Refusal distinct from failure** | `refused: true` ≠ call made and failed |
| **No tool selection authority** | Tools are callable only; cannot select agents or tasks |

---

## 4. SKILL vs TOOL vs CAPABILITY COMPARISON

| Attribute | Skill | Tool | Capability |
|---|---|---|---|
| **What it is** | Declaration of requirements | Callable entity | Name with tri-state status |
| **Can execute?** | ❌ NO (by PHASE 09 design) | ✅ YES (invoked by agent) | ❌ NO (it is a label) |
| **Can confer authority?** | ❌ NO (structural rule) | ❌ NO (authorized only) | ✅ YES (supported/unsupported/unknown) |
| **Load check required?** | ✅ YES (caller must hold requirements) | ✅ YES (ToolPermission check) | ❌ NO (just status) |
| **Runtime exists?** | ❌ NO (acknowledged limitation) | ✅ YES (TextStatInvoker + registry) | ✅ YES (built-in + custom) |
| **Affects selection?** | ❌ NO (declares what caller must have) | ✅ YES (pool filters on tool availability) | ✅ YES (pool ranks on coverage) |
| **Versioned?** | ✅ YES (skillId@version) | ✅ YES (tool records have versions) | ✅ YES (BuiltinCapability | custom) |
| **Audited?** | ✅ YES (every load recorded) | ✅ YES (every invocation recorded in evidence) | ✅ YES (matcher verdicts audited) |

---

## 5. POLICY INTEGRATION FLOW

```
                        +----------------------+
                        |  Orchestration       |
                        |  Request Lifecycle   |
                        +------------+---------+
                                     |
    +----------------+  input policy  +-----------------+
    | Agent Request -->| Screen inbound -->|  Governance (opt-|
    +----------------+  (InputPolicy)   |   in)           |
                                     +--------+----------+
                                              |
                                      route subtask
                                              |
    +----------------+  select agent  +-----------------+
    | SpecialistPool|  choose agent -->|  ModelRouter    |
    +----------------+   (deterministic)  +--------+--------+
                                              |
    +----------------+  route provider +--+                |
    |  AgentAdapter  |---------->       |  Execute         |
    +----------------+              |  through adapter |
                                              |
    +----------------+  screen output  +--+                |
    |  OutputPolicy  |<---------------  |  Verification    |
    +----------------+              |  (pass/fail/NR)  |
                                              |
    +----------------+  record evidence   |                |
    |  Evidence      |<---------------  |  Feedback        |
    +----------------+              +----------------+
                                              |
                                      +--------v--------+
                                      |  Memory (scoped)|
                                      +--------+--------+
                                               |
                                               v
                              +----------------------+
                              |  Obsidian Knowledge   |
                              |  Boundary (see       |
                              |   §4.3 MEM_MATRIX)    |
                              +----------------------+
```

---

## 6. AUTHORIZATION INTERSECTION EXAMPLES

### 5.1 Example 1: Agent Declares Tools, Policy Permits
| Component | State |
|---|---|
| Agent `toolRequirements` | `["text_stat", "file_read"]` |
| Policy permits | `["text_stat", "file_read", "web_search"]` |
| **Authorized set** | `["text_stat", "file_read"]` (intersection) |
| Result | Agent can call `text_stat` and `file_read` |

### 5.2 Example 2: Agent Declares Tools, Policy Restricts
| Component | State |
|---|---|
| Agent `toolRequirements` | `["text_stat", "file_read", "web_search"]` |
| Policy permits | `["text_stat", "file_read"]` (web_search denied) |
| **Authorized set** | `["text_stat", "file_read"]` (intersection) |
| Result | Agent can call `text_stat` and `file_read`; `web_search` denied |

### 5.3 Example 3: Agent Declares Nothing
| Component | State |
|---|---|
| Agent `toolRequirements` | `[]` (empty) |
| Policy permits | `["text_stat", "file_read", "web_search"]` |
| **Authorized set** | `[]` (intersection with empty = empty) |
| Result | Agent can call **no tools** — even if policy permits some |

### 5.4 Example 4: Agent Declares, Policy Permits Nothing
| Component | State |
|---|---|
| Agent `toolRequirements` | `["text_stat"]` |
| Policy permits | `[]` (empty; maybe governance denied all) |
| **Authorized set** | `[]` (intersection with empty = empty) |
| Result | Agent can call **no tools** — policy overrules declaration |

---

## 7. POLICY ENFORCEMENT SUMMARY

| Policy Type | Primary System | Enforcement Mechanism | Sole Authority |
|---|---|---|---|
| **Input Policy** | InputPolicy | First gate in request lifecycle; first rule with non-null verdict wins | ✅ YES (only input gate) |
| **Output Policy** | OutputPolicy | Last gate before result; screens outbound work | ✅ YES (only output gate) |
| **Tool Permission** | ToolPermission | Intersection of agent.declared + policy permits; refusal reported as value | ✅ YES (only tool auth) |
| **Memory Access** | MemoryAccessPolicy | Gates every read/write; separate scopes/writableScopes; default-deny | ✅ YES (only memory gate) |
| **Governance** | PolicyEngine | Three outcomes: ALLOW/DENY/REQUIRE_APPROVAL/NOT_APPLICABLE; default-deny if every rule declines | ✅ YES (only governance gate) |
| **Approval** | ApprovalRegistry | Gate lifecycle: waiting → approved/rejected/expired/cancelled; jobKey(keyed) | ✅ YES (only approval gate) |

**Cross-cutting invariant**: For **every** policy type, **exactly one system** has sole
authority. No two systems share the same policy gate. This is the structural guarantee that
prevents the "two components each believe they decide" failure mode.

---

## 8. REMAINING LIMITATIONS (DOCUMENTED)

| Limitation | Detail | Acknowledged |
|---|---|---|
| **No persistent policy store** | A denial is evidenced only for the life of the process | ✅ FINAL_ARCHITECTURE.md §41 |
| **No cryptographic tamper-evidence** | Audit log is redacting and in-process, not signed | ✅ FINAL_ARCHITECTURE.md §447 |
| **No RBAC** | `roles` is a non-authoritative label; resolution is the caller's | ✅ FINAL_ARCHITECTURE.md §451 |
| **Governance resource path unreachable** | No recorder constructed; wiring gap (composition work) | ✅ FINAL_ARCHITECTURE.md §408-409 |
| **Throwing narrowRouting hook fails open** | Conscious trade: policy-store blip should not fail healthy work | ✅ FINAL_ARCHITECTURE.md §228-230 |
| **Cancellation does not abort in-flight work** | Cooperative abort; in-flight completes against provider | ✅ FINAL_ARCHITECTURE.md §236-240 |
| **Budgets checked but not reserved** | Wave can collectively exceed ceiling | ✅ FINAL_ARCHITECTURE.md §238-239 |
| **Twelve orchestration config sections inert** | Validated, defaulted, normalised, then read by no production code | ✅ FINAL_ARCHITECTURE.md §465-491 |

---

## 9. MCP/SKILL/TOOL POLICY — COMPLETE SUMMARY

**MCP**: Not implemented — acknowledged limitation. No stub or fabricated integration. Local
tool execution through `TextStatInvoker` is the reference implementation.

**Skill**: Declaration-only system. Requires caller to already hold capabilities/tools. Loading
can REFUSE, never confer. No runtime execution in current phase. Any actual skill execution is
PHASE 14 work.

**Tool**: Authorized invocation through `ToolPermission` — intersection of agent's
`toolRequirements` + what policy permits. Agent that declares nothing gets nothing. Side
effects recorded; `durationMs` is null. Refusal distinct from failure.

**Integration**: These three systems operate independently but with consistent policies:
- Skills check caller requirements before load
- Tools check authorization before invocation
- Capabilities provide the tri-state matching foundation
- All policies follow the single-authority constraint
- All outcomes are recorded in evidence for auditability

**Policy principle**: For every concern (input, output, tools, memory, governance, approval),
**exactly one system has sole authority**. This is the structural guarantee that prevents
confusion, conflict, or duplicate decision-making across the architecture.

*MCP/Skill/Tool Policy completed: 2026-10-06*