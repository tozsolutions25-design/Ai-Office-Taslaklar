# TOZ AI GROUP — GÜVENLİK MİMARİSİ
*Security boundary, policy gates, threat model, and operational security*
*Completed: 2026-10-06*

## 1. SECURITY BOUNDARY DIAGRAM

```
                          +---------------------------+
                          |           INPUT           |
                          |  (Inbound work, prompts)  |
                          +------------+--------------+
                                       |
                                       v
+----------------------+  InputPolicy  +----------------------+
|  SecurityContext     |-------------->|  PolicyEngine        |
|  (workspace, brand,   |              |  (default-deny)     |
|   provenance)        |              +--------+-----------+                                      
+----------------------+                  |  ↑                 |
                                          |  |  first rule wins|
                                          v v                 |
+----------------------+               +-----------------+
|   ORCHESTRATOR       |               |  Governance Gate  |
|   (TozOrchestrator) |               |  (opt-in, 2b)     |
+------------+----------+               +--------+----------+
             |                                 |
             v                                 v
    +---------------------+          +----------------------+
    |  Agent Execution    |          |  Approval Registry   |
    |  (SpecialistPool)   |          |  (ExecutionCoordinator)|
    +----------+----------+          +------------+----------+
               |                                 |
               v                                 v
    +---------------------+          +----------------------+
    |   Agent Adapter     |          |  Tool Permission     |
    |   (AgentAdapter)    |          |  (ToolPermission)     |
    +----------+----------+          +--------+------------+
               |                                 |
               v                                 v
    +---------------------+          +----------------------+
    |   Tool Execution    |          |  Memory Access       |
    |   (ToolExecutionHost)|          |  (MemoryAccessPolicy)|
    +----------+----------+          +--------+------------+
               |                                 |
               v                                 v
    +---------------------+          +----------------------+
    |   Output Policy     |          |  Memory (Hermes +    |
    |   (OutputPolicy)    |          |   Obsidian boundary)|
    +----------------------+          +----------------------+
                       |                          |
                       v                          v
                +--------------------+        +--------------------+
                |   Verification     |        |   Audit Log        |
                |   (VerificationRun)|        |   (audit/events.ts) |
                +--------------------+        +--------------------+
```

---

## 2. SECURITY PROPERTY TABLE

| Property | Status | Detail |
|---|---|---|
| **Default-deny in PolicyEngine** | ✅ holds | First rule to return non-null verdict wins; if every rule declines, default-denies with `permission_not_granted` |
| **All 16 operations security-sensitive** | ✅ none exempt | No operation is exempt from policy gate; even "trivial" operations pass through |
| **Unidentified caller refused** | ✅ | With governance configured and no `securityContext` on the request, the run is DENIED |
| **Delegation cannot escalate** | ✅ refused, not clamped | A delegated component cannot escalate its authority beyond what was granted |
| **Delegation intersects resources, allow-lists, capabilities, scopes** | ✅ | Delegation must respect all four: resources, allow-lists, capability floors, memory scope floors |
| **Delegation raises trust floor to parent's** | ✅ | If parent has trustLevel "high", child cannot have lower than "high" |
| **SecurityContext frozen** | ✅ | Once set, cannot be changed during a run; prevents mid-run context switching |
| **Secrets never stored in records** | ✅ only `{kind, key}` handles | Secrets are handled as `{kind: "bearer", key: "..."}` or `{kind: "api_key", key: "..."}` — never raw tokens |
| **Redaction on the audit path** | ✅ | `AuditSink.read()` stamps every event; `redactWithReport` applies in governance decision constructor |
| **No persistent policy store** | ⚠️ residual | Denial evidenced only for life of process; no durable store |
| **No cryptographic tamper-evidence** | ⚠️ residual | Audit log is redacting and in-process, not signed |
| **No RBAC** | ⚠️ residual | `roles` is a non-authoritative label; resolution is the caller's |
| **`TraceRecorder.#events` unredacted** | ⚠️ residual | Redaction applies to the audit sink, not the local store the `events()` API returns |
| **Governance resource/budget path unreachable** | ⚠️ residual | No production code constructs a recorder; validated but not wired |
| **Throwing `narrowRouting` hook fails open** | ⚠️ conscious trade | Policy-store blip should not fail healthy work; real limitation; revisit if restriction becomes security boundary |
| **Cancellation does not abort in-flight work** | ⚠️ residual | Cooperative abort; in-flight completes against provider; full cost incurred |
| **Budgets checked but not reserved** | ⚠️ residual | Wave can collectively exceed ceiling; checked at release, not before dispatch |

---

## 3. THE THREE SECURITY GATES

### 3.1 Gate 1: InputPolicy (Always Active)
**Position**: First gate in the request lifecycle (step 2 in the request lifecycle diagram).

**Function**: Screens inbound work before it becomes a plan.

**Outcomes**:
- `ALLOW` → proceed to classification and planning
- `DENY` → `authorization_error`; final refusal; not retried
- `NOT_APPLICABLE` → treated as permitted; distinct from `ALLOW`

**Rules**: Evaluated in order; first rule to return a non-null verdict wins.
If every rule declines → default-deny with `permission_not_granted`.

**Enforcement**: Always active — cannot be disabled. This is the **primary security gate**.

### 3.2 Gate 2: Governance Gate (Opt-In, Not Wired by Default)
**Position**: After InputPolicy, before the request is used for anything (step 2b in the lifecycle).

**Function**: Additional authorization boundary — optional, not wired by default.

**Outcomes**:
- `ALLOW` → proceed
- `DENY` → `authorization_error`; final refusal; not retried
- `REQUIRE_APPROVAL` → `approval_required`; blocked, pending a decision at the PHASE 07 gate
- `NOT_APPLICABLE` → treated as permitted; distinct state from `ALLOW`

**Opt-in behavior**: 
- With no `governance` option on `TozOrchestrator`, step 2b is **skipped** entirely
- A run behaves exactly as it did in PHASE 08 when governance is not wired
- Governance gate is constructed by hand in composition root when needed

**Enforcement**: Opt-in only — never wired by default; no penalty for not wiring.

### 3.3 Gate 3: Approval Registry (Through ExecutionCoordinator)
**Position**: After governance gate; job/task approval lifecycle.

**Function**: Manages the approval lifecycle for tasks that require approval.

**Gate Lifecycle**:
```
waiting → approved | rejected | expired | cancelled
```

**Key properties**:
- **May release consulted on EVERY release** — a retry cannot slip past
- **Decided gate is final** — once a gate is decided, it is final; no re-approval on re-run
  without new gate construction
- **Job-scoped stores keyed by `taskKey(jobId, taskId)`** — fix for the cross-job approval
  bypass (PHASE 10)

**Enforcement**: Always present when governance is wired; the approval gate is the only
path through which approved tasks may proceed.

---

## 4. THREAT MODEL

### 4.1 Potential Threats and Mitigations

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Prompt injection** | Medium | High | InputPolicy screens inbound work; governance gate can deny; OutputPolicy screens outbound |
| **PII leakage** | Medium | Medium | MemoryAccessPolicy gates every read/write; no secrets stored in records; redaction on audit path |
| **Tool misuse** | Low | High | ToolPermission intersection; agent that declares nothing gets nothing; sideEffecting flag; `durationMs` null |
| **Unauthorized memory access** | Low | High | MemoryAccessPolicy gates every read/write; default-deny; recallScopes ships [] |
| **Cross-job approval bypass** | Medium (pre-PHASE 10) | Critical | Fixed in PHASE 10: job-scoped stores keyed by `taskKey(jobId, taskId)` |
| **Configuration drift** | Low | Medium | `orchestrationConfigFromApp` reports unknown keys; fail-open but reported |
| **Unauthorized delegation** | Medium | High | Delegation cannot escalate; trust floor raised to parent's; SecurityContext frozen |
| **Observer pattern bypass** | Low | Medium | Grant with empty `writableScopes` is observer; can read but not write |
| **Importance ceiling floor bypass** | Low | Medium | `Math.max(0.2, ...)` floor is PHASE 07; pinned by tests; non-finite importance read as zero |

### 4.2 Attack Surface Summary

**Minimal attack surface** because:
- **No provider clients** in repository — no external network calls from core code
- **No persistent storage** — all in-memory; loss on restart is by design, not a vulnerability
- **No RPC or network protocols** — process-local only
- **Single authority** — one component decides what runs; no second component to compromise
- **Default-deny everywhere** — every gate defaults to denial; nothing is granted implicitly
- **Explicit boundaries** — every concern (memory, tools, governance, approval) has one gate
- **No secrets in records** — only `{kind, key}` handles; raw tokens never stored

**Residual attack surface** (acknowledged limitations):
- Process-local denials are lost on restart
- No cryptographic tamper-evidence on audit log
- No RBAC — roles are labels, not enforceable
- Governance resource/budget path is wired gap (composition work, not certification work)
- `TraceRecorder.#events` is unredacted locally (redaction only on audit sink)
- Throwing `narrowRouting` hook fails open (conscious trade)
- Cancellation does not abort in-flight work

---

## 5. SECURITY OPERATIONAL GUIDELINES

### 5.1 Production Deployment Checklist
- [ ] InputPolicy rules configured for target domain
- [ ] Governance gate wired only if explicitly required (opt-in)
- [ ] ApprovalRegistry constructed through ExecutionCoordinator if governance is wired
- [ ] All 16 security-sensitive operations gated (none exempt)
- [ ] SecurityContext properly set on all requests (never null when governance is active)
- [ ] No raw tokens or secrets in agent records, evidence, or audit events
- [ ] Redaction working on audit path (connectionString, bearer, dsn, connstr all in denylist)
- [ ] Memory grants respect workspace partitioning (PHASE 06: keyed by taskKey(jobId, taskId))
- [ ] Tool permissions intersect agent.declared + policy permits
- [ ] No `TraceRecorder.#events` access in production monitoring (only audit sink)

### 5.2 Security Incident Response
| Incident | Response | Recovery |
|---|---|---|
| **Unauthorized memory read** | Identify granted scopes; check if within workspace | Restrict grants; no retroactive data recovery |
| **Unauthorized tool call** | Check ToolPermission logs; verify agent.declared ∩ policy permitted | Update ToolPermission rules; no retroactive effect |
| **Prompt injection suspected** | Review InputPolicy rules; check SecurityContext | Adjust InputPolicy; reset run if needed |
| **Approval bypass suspected** | Verify taskKey(jobId, taskId) keying; check ApprovalRegistry state | Re-key if needed; governance gate review |
| **Configuration drift detected** | Compare current config to last validated state | Re-validate with `orchestrationConfigFromApp` |

### 5.3 Security-Maintained Properties (Invariants)
These properties are **guaranteed by the architecture**, not by configuration:

1. **Default-deny**: Every gate defaults to denial; nothing is implicitly granted
2. **Single authority**: Only TozOrchestrator may advance task state
3. **Structural separation**: Agent ≠ Provider ≠ Model ≠ Tool ≠ Memory ≠ Orchestrator
4. **No secrets in records**: Only `{kind, key}` handles; raw tokens never stored
5. **Redaction on audit path**: Every audit event is redacted on the sink path
6. **Unknown ≠ healthy**: Health is observed, not assumed; UNKNOWN_HEALTH is distinct status
7. **Workspace isolation**: Every customer-data store partitioned by `(workspace, brand)`
8. **Verification-gated learning**: Nothing learned from unverified run
9. **Empty recallScopes = no recall**: Structurally guaranteed, not configurable
10. **Agent declares nothing gets nothing**: Structurally guaranteed by ToolPermission intersection

---

## 6. SECURITY BOUNDARY ENFORCEMENT MECHANISMS

### 6.1 Import Restriction (Four-Tree Enforcement)
The four-tree import restriction (ARCHITECTURE.md §4) structurally enforces the security
boundary:
- `src/core` imports nothing internal
- `src/design-system` imports nothing internal
- `src/site` imports from `design-system` only
- `src/orchestration` imports from `core` + `design-system` only

**Each import is resolved by tests**, not by convention. If a lower-level module were to
import from a higher level (bypassing the security boundary), the test suite would fail.

### 6.2 Runtime Gate Enforcement
Every execution step is gated by a runtime check:
- **InputPolicy** gates the initial request
- **DriftGuard** validates the plan before execution
- **SpecialistPool** filters agents on eligibility (status, availability, health, capability verdict, trust floor, required tools, required memory scope)
- **ModelRouter** routes with governance narrowing (opt-in)
- **MemoryAccessPolicy** gates every read/write
- **ToolPermission** authorizes tool calls (intersection of declared + permitted)
- **OutputPolicy** screens outbound work
- **VerificationRunner** verifies the result (pass/fail/needs_review)
- **ApprovalRegistry** manages approval gates (opt-in)

### 6.3 Audit and Reporting
Every significant security-relevant event is recorded:
- **AuditLog** — one stream for orchestration events and provider events, with redaction
- **Evidence records** — per-subtask evidence includes error class, tool calls, source references
- **Feedback records** — outcome, verification result, latency, cost, retries, corrections
- **Governance decisions** — if wired, `governance_decided` event (but no production code constructs a recorder)

---

## 7. SECURITY-RELATED LIMITATIONS (DOCUMENTED)

| Limitation | Detail | Section |
|---|---|---|
| **No persistent policy store** | Denial evidenced only for life of process | FINAL_ARCHITECTURE.md §41 |
| **No cryptographic tamper-evidence** | Audit log is redacting and in-process, not signed | FINAL_ARCHITECTURE.md §447 |
| **No RBAC** | `roles` is non-authoritative label; caller resolves | FINAL_ARCHITECTURE.md §451 |
| **Governance resource path unreachable** | No recorder constructed; wiring gap | FINAL_ARCHITECTURE.md §408-409 |
| **`TraceRecorder.#events` unredacted** | Redaction applies to audit sink only | FINAL_ARCHITECTURE.md §316-317 |
| **Throwing `narrowRouting` fails open** | Conscious trade; policy-store blip should not fail healthy work | FINAL_ARCHITECTURE.md §228-230 |
| **Cancellation does not abort in-flight** | Cooperative abort; full cost incurred | FINAL_ARCHITECTURE.md §236-240 |
| **Budgets checked but not reserved** | Wave can exceed ceiling | FINAL_ARCHITECTURE.md §238-239 |
| **Twelve config sections inert** | Validated then read by no production code | FINAL_ARCHITECTURE.md §465-491 |
| **No authentication resolver** | Resolver is deployment-supplied and trusted | FINAL_ARCHITECTURE.md §606-607 |
| **Scale undeclared** | One store instance per workspace; unbounded in workspaces | FINAL_ARCHITECTURE.md §608-610 |

---

## 7. SECURITY ARCHITECTURE COMPLETE — SUMMARY

The TOZ AI GROUP security architecture is **built on six foundational principles**:

1. **Default-deny everywhere** — no component is implicitly trusted; every gate defaults to denial
2. **Single authority** — only TozOrchestrator may advance task state; no second component can decide what runs
3. **Structural domain separation** — Agent ≠ Provider ≠ Model ≠ Tool ≠ Memory ≠ Orchestrator (enforced by tests)
4. **Explicit boundaries** — every concern (memory, tools, governance, approval) has one gate with one owner
5. **No secrets in records** — only `{kind, key}` handles; raw tokens never stored in any record
6. **Workspace isolation** — every customer-data store partitioned by `(workspace, brand)` (PHASE 06)

**These principles give us**:
- **Minimal attack surface** — no provider clients, no persistent storage, no RPC, process-local only
- **Clear accountability** — every security-relevant action has one owner and one gate
- **Default-safe operation** — system securely refuses by default; nothing passes without explicit grant
- **Auditability** — every significant event is recorded in the audit log with redaction
- **Sustainability** — acknowledged limitations are documented; no false guarantees

**Residual risks** (acknowledged, accepted):
- Process-local denials lost on restart
- No cryptographic tamper-evidence
- No RBAC — roles are labels
- Governance resource/budget path wiring gap
- `TraceRecorder.#events` unredacted locally
- Throwing `narrowRouting` fails open (conscious trade)
- Cancellation does not abort in-flight work
- Budgets checked but not reserved

*Security Architecture completed: 2026-10-06*