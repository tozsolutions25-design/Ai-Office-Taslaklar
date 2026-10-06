# PHASE 08 gap and reuse map

Audit of the repository at `5d0fce0` (PHASE 06 + PHASE 07, 1441/1441). Recorded
before implementation so the reasoning is auditable rather than reconstructed
from the diff.

## The finding that shaped the phase

**Governance is not absent from this repository — it is scattered.** The audit
found six separate, working authorization surfaces, and NO central permission
catalogue anywhere (a search for `PERMISSIONS` / `permissionCatalogue` /
`OPERATIONS` returns nothing).

That shape has a specific cost, and it is the thing PHASE 08 must fix: a decision
like "may this actor invoke this tool" is made in `tool.ts` using a `ToolPermission`
shape, while "may this actor read this memory scope" is made in `memory.ts` using
`MemoryGrant`, and "is this provider approved" is made in `providers/registry.ts`
using `approvalStatus`. Three vocabularies, no shared notion of an *operation*, and
— critically — **`SecurityDecision` is a boolean**:

```ts
export type SecurityDecision =
  | { readonly allowed: true;  readonly reason: string }
  | { readonly allowed: false; readonly reason: string };
```

The brief requires `ALLOW / DENY / REQUIRE_APPROVAL / NOT_APPLICABLE` and forbids
reducing governance to a boolean. That is a real gap and it is a genuine defect of
the current shape: a boolean cannot express "this needs a human", so an
approval-requiring operation is currently forced to either allow or deny.

## EXISTING — reuse, do not duplicate

| Existing | Location | How PHASE 08 uses it |
|---|---|---|
| `SecurityDecision` (boolean) | `orchestration/policy/security.ts` | **Kept as-is.** Input/output screening is a working binary screen and does not need four states. PHASE 08's richer decision *adapts* to it at that boundary rather than rewriting it |
| `InputPolicy` / `OutputPolicy`, `Permissive*`, `DenyAll*`, `HeuristicInjection*` | same | Unchanged. The orchestrator's existing step-2 screening stays exactly where it is |
| `SecurityDecisionLog` (6 stages) | same | The existing decision history. Governance records into it |
| `authorizeToolCall` + `ToolPermission` | `orchestration/tools/tool.ts` | **A real, working tool authorization**: registration, retirement, availability, a denied list, trust ranking, and a side-effect approval concept. PHASE 08 governs it; it does not reimplement it |
| `MemoryAccessPolicy` + `MemoryGrant` | `orchestration/memory/memory.ts` | PHASE 05's memory authority, with read and write scopes deliberately separate. Unchanged |
| `ProviderRecord.approvalStatus`, lifecycle | `providers/registry.ts`, `lifecycle.ts` | Provider identity and approval. Unchanged |
| `TRUST_LEVELS`, `trustRank`, `meetsTrustFloor` | `orchestration/agent/trust.ts` | The trust ladder governance reasons in terms of. Not redefined |
| `redact`, `isSensitiveKey`, `redactWithReport` | `audit/redaction.ts` | Applied to every governance decision before it is recorded. Not replaced |
| `AuditLog` + `TraceRecorder` | `audit/events.ts`, `orchestration/observability/trace.ts` | The ONE history. Governance adds kinds; it does not add a logger |
| `AgentRegistry` lifecycle, `AgentRecord` | `orchestration/agent/registry.ts` | Agent identity and availability. Unchanged |
| `VerificationRunner` | `orchestration/verification/verifier.ts` | Verification authority. Unchanged |
| PHASE 07 `ApprovalRegistry` | `orchestration/workflow/gates.ts` | **The execution gate.** PHASE 08 governs *when* it is required and *who* may resolve it, and creates no second gate |
| PHASE 07 `ResourceBudget`, `budgetStatus` | `orchestration/workflow/coordinator.ts` | Resource authorization builds ON it. The unpriced-spend rule is preserved verbatim |
| PHASE 06 `evaluateCandidate`, `ProviderRouter` | `routing/router.ts` | The hard filter. Governance may only *narrow*; it never selects |

## The gaps that are the actual work

| Gap | Why the existing thing cannot do it |
|---|---|
| **Central permission catalogue** | None exists. Operations are implicit in three subsystems' own vocabularies |
| **Four-valued decision** | `SecurityDecision` is a boolean, so "requires approval" is inexpressible |
| **Structured, explainable metadata** | A `reason: string` cannot answer "which rule, against which policy, under which scope" |
| **Canonical `SecurityContext`** | Actor, roles, scopes, delegation and the job/task/execution ids are assembled ad hoc at each boundary |
| **Bounded delegation** | Nothing models a child authority, so nothing can prevent escalation |
| **Governance narrowing of routing** | No interface through which governance can restrict candidates without becoming a second router |
| **Who may resolve an approval** | PHASE 07 correctly refuses a worker approving itself, but that is a local rule, not a governance-wide one |
| **`governance` config section** | Does not exist |

## Architecture rules PHASE 08 must not break

1. **The PHASE 07 job state machine is not touched.** No `paused` in the
   orchestration task machine, no merged states, no third execution machine, and
   job state authority stays inside `ExecutionCoordinator`.
2. **No second approval system.** Governance decides that approval is *required*;
   the PHASE 07 `ApprovalRegistry` remains the gate that is actually enforced.
3. **No second router.** Governance contributes a *restriction*; PHASE 06
   `evaluateCandidate` remains the hard filter and the only selector.
4. **No duplicate memory authority.** PHASE 05 `MemoryAccessPolicy` remains the
   only thing that answers "may this subject read/write this scope".
5. **Unpriced spend still blocks.** The PHASE 07 rule is preserved, not relaxed.
6. **No core/CLI architectural violation.** `governance` config is validated by
   `validateOrchestrationConfig` and reachable through `orchestrationConfigFromApp`,
   and is **not** wired into `validate-config`, because `src/cli` is core-layer and
   PHASE 06 established that isolation outranks convenience.
7. **No live MCP client is invented.** The tool abstraction is governed; the
   absence of a real MCP transport is documented, not papered over.

## Confirmed absent from the repository

No central permission catalogue. No role-based access control. No delegation or
sub-authority model. No four-valued governance decision. No tamper-evident or
append-only governance log beyond the existing in-memory `AuditLog`. No signed
policy bundles, no policy versioning, and no multi-tenant isolation primitive.
`SecurityDecisionLog` and `AuditLog` are in memory and are lost on restart.
