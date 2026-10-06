# PHASE 08: Governance, Policy, Security and the Control Plane

Status: **delivered and green**. 1510/1510 tests, 224 suites, typecheck, lint and
build clean. No new runtime dependency. See `docs/PHASE08_MAP.md` for the
pre-implementation audit.

## The finding that shaped the phase

**Governance was not absent from this repository — it was scattered.** The audit
found six separate, working authorization surfaces and **no central permission
catalogue at all** (a search for `PERMISSIONS` / `permissionCatalogue` /
`OPERATIONS` returns nothing). Three vocabularies decided three different kinds
of question: `ToolPermission` in `tool.ts`, `MemoryGrant` in `memory.ts`, and
`approvalStatus` in `providers/registry.ts`.

And the decision type was a boolean:

```ts
export type SecurityDecision =
  | { readonly allowed: true;  readonly reason: string }
  | { readonly allowed: false; readonly reason: string };
```

That is a real gap, not a style note. A boolean cannot express "a human must
decide this first", so an approval-requiring operation is currently forced to
either allow or deny. PHASE 08 closes it with a **new** four-valued decision and
**leaves `SecurityDecision` alone** — rewriting it would ripple through the
orchestrator's screening step and every policy implementation for a need that
screen does not have.

## What governance is, and what it is not

`PolicyEngine` holds **no agent registry, no provider registry, no model
registry, no router, no memory service, and no reference to the orchestrator.** It
holds a `Clock` and a list of rules, and it returns a decision. That is not a
convention; it means "a worker picked its own provider" is a capability it does
not have, rather than a rule it could break.

| Authority | Owner | Unchanged by PHASE 08 |
|---|---|---|
| Orchestration, delegation, execution coordination | TOZ Orchestrator | yes |
| Job/workflow state, dependency release, claims | PHASE 07 `ExecutionCoordinator` | yes |
| Provider/model eligibility and selection | PHASE 06 `evaluateCandidate` + policy | yes |
| Memory authority, retrieval, scope, provenance, capture | PHASE 05 `MemoryAccessPolicy` | yes |
| Verification status | `VerificationRunner` | yes |
| Registry identity and metadata | agent / capability / provider / model registries | yes |
| **Authorization, policy, permission, approval requirement, delegation** | **PHASE 08 governance** | new |
| Execution of authorized work | workers | yes — execution only |

## Four verdicts, not a boolean

| Verdict | The caller must |
|---|---|
| `ALLOW` | proceed |
| `DENY` | not proceed; the reason is mandatory |
| `REQUIRE_APPROVAL` | not proceed until a human decides **at the PHASE 07 gate** |
| `NOT_APPLICABLE` | governance has no opinion; the subsystem's own authority decides |

`NOT_APPLICABLE` is the one that is easy to get wrong, so it is named: it means
"subscribe to the subsystem that owns this", never "allowed". `isPermitted()`
returns `false` for it, and a test asserts `NOT_APPLICABLE !== ALLOW`.

## Rule semantics, and a bug this phase had

A rule returns one of three things:

- `ALLOW` — the rule **verified** a requirement. An opinion.
- `DENY` / `REQUIRE_APPROVAL` — the rule **refused**. Short-circuits.
- `null` — the rule has **no opinion**. Evaluation continues.

The first draft had `GrantRule` return `null` when it *found* the grant, reading
that as "nothing to say". That left the decision with no permitting rule, and the
engine's default-deny then **refused properly granted operations**. It is the
worst kind of bug: a safety check denying correct behaviour, in the shape of a
permission granted. Both halves are now tested.

## Default-deny, and where it is *not* applied

Default-deny fires in exactly one place: when **no rule permitted** a
security-sensitive operation. Blanket default-deny over unrelated internal
mechanics is explicitly avoided, and `deferToSubsystem` is the mechanism — naming
an operation hands it back to the subsystem that already answers it well, which
is how PHASE 05 memory authority and PHASE 06 routing stay authoritative rather
than being shadowed by a second opinion.

## Delegation cannot escalate

`SecurityContext` is **frozen**. Authority is a set of named `Grant`s, never a
mutable list someone can push onto — a mutable authority object turns every
decision into a snapshot of something that may since have changed.

An escalation attempt is **refused, not clamped**:

```ts
delegateAuthority(parent, { operations: ["tool.invoke"], allowList: ["calculator", "shell"] })
// -> { ok: false, detail: "Delegation refused: requested allow-list entries shell …" }
```

This is the one place where "intersect and carry on" is wrong. A caller that asks
for `shell` and is handed `calculator` back may reasonably believe it was granted
`shell` and discover otherwise mid-execution. Intersections still apply for
everything not explicitly requested (resources, capabilities, scopes, expiries),
and the child's trust floor is raised to the parent's — never lowered.

A delegated context also **never inherits the parent's approval**, so a delegator
cannot hand its own approval onward.

## Approval: governance decides, PHASE 07 enforces

```
Governance  --REQUIRE_APPROVAL-->  PHASE 07 ApprovalRegistry  --APPROVED-->  Execution
```

`bridgeApproval` is the whole bridge, and its ordering is the point:

- `DENY` → no gate is opened. Asking about something already refused would imply
  it might be permitted.
- `REQUIRE_APPROVAL` → an **existing** gate is reused; a new one is opened only if
  there is none. A second gate for one task would be the competing-approval-system
  failure.
- `REQUIRE_APPROVAL` with **no gate available** → `DENY`. "No gate available" must
  never mean "no approval needed".
- `ALLOW` / `NOT_APPLICABLE` → proceed.

Because the gate is consulted on *every* release, a retry, a fallback, a worker
and an external adapter all arrive at the same bridge and are blocked identically.

## Routing: narrowing only

`RoutingRestriction` has exactly four fields — `deniedProviders`,
`deniedModels`, `deniedProviderTypes`, and provenance (`reason`, `decidedBy`).
There is **no** `preferred`, `score`, `rank`, `order` or `weight` field, so
"governance quietly became a second router" is not representable. A test asserts
that, and asserts survivors keep their order, so PHASE 06's `evaluateCandidate`
and policy ordering remain untouched.

## Resource governance, and the rule it preserves

Governance **adds** ceilings (concurrency, attempts per actor, runtime) and
**consults** PHASE 07's `budgetStatus` rather than recomputing it. It never
duplicates the budget system.

The PHASE 07 rule is preserved verbatim: **unpriced spend blocks.** A provider
that reported tokens and no amount means the budget *cannot be evaluated*, and
execution stops and says so. `blockOnUnknownCost` defaults to `true`, and
turning it off is a decision that appears in the record rather than a default.

## Audit

A new `governance_decided` event goes into the **one** `TraceRecorder` history, so
an authorisation and the execution it governed are readable together rather than
in two logs that can disagree.

Redaction is applied in the decision **constructor**, not left to the caller — a
caller that pasted a credential into a reason would otherwise write it into the
one log that is meant to be safe to keep. `redactWithReport` names fields redacted
*by key*; a secret embedded in free text has no suspicious key and is still
redacted but is not named, so the decision compares input against output to
report that a redaction happened. A redacted decision is marked `redacted` in its
rule list — visible, not silent.

## Configuration

A `governance` section beside `memory`, `routing` and `workflow`, with a section
allow-list, a per-key allow-list, and validation of every operation name **against
the real catalogue** — a permission spelled `tools.invoke` in configuration and
`tool.invoke` in the catalogue is two permissions with a typo between them, and
the typo reads as a denial.

`enforced` ships `true`: a control plane that ships advisory is not a control
plane, and the difference is invisible until it is needed.

**Deliberately not wired into the CLI**, following the PHASE 06 lesson:
`src/cli` is core-layer, and making it import orchestration config broke a
`phase01Isolation` test, correctly.

## PHASE 07 limitations preserved, not silently "fixed"

Job state is still in memory. There is still no durable persistence, no
distributed lock, and `DELIVERY_SEMANTICS.scope` is still `single-process`.
Exactly-once is still not claimed. Parallel groups are still released in waves.
Conditional predicates are still a fixed vocabulary. `wait` still records intent
rather than blocking. None of these was quietly addressed, because doing so would
have meant inventing infrastructure this repository does not have.

## What is deliberately NOT implemented

- **No live MCP client.** The tool abstraction is governed; the absence of a real
  MCP transport is documented, not papered over.
- **No central policy store, policy versioning, or signed policy bundles.**
  Rules are objects supplied at construction.
- **No role-based access control.** A `Grant` is a permission; `roles` is a
  non-authoritative label on the context.
- **No tamper-evident or append-only governance log.** `AuditLog` and
  `GovernanceRecorder`'s in-memory history are lost on restart.
- **No multi-tenant isolation primitive.** `owner` is recorded and reported; it
  does not partition anything.
- **No second orchestrator, router, memory authority, or approval system.**
- **No new runtime dependency.**

## Known limitations

1. **The governance decision history is in memory** and is lost on restart, as is
   `AuditLog`. A denial that happened is only evidenced for the life of the
   process.
2. **Governance is not yet wired into the orchestrator's execution path.** It is a
   complete, tested control plane that the subsystems call, and a deployment
   wires it in; the orchestrator does not call it automatically, because doing so
   unprompted would change behaviour for every existing deployment.
3. **Approval resolution is governed, not implemented.** Governance decides *who
   may* resolve; PHASE 07's `ApprovalRegistry` remains the thing that records the
   decision.
4. **Delegation is synchronous and in-process.** A delegation cannot be revoked by
   anything other than expiry or a narrower re-derivation; there is no revocation
   registry.
5. **No policy composition.** Rules are a flat list evaluated in order, with no
   AND/OR groups or negation.
6. **No live health probe, no real MCP client, no browser or E2E tests** (K-07,
   K-11) — unchanged since PHASE 03.
7. **Inner pages remain outstanding.**
