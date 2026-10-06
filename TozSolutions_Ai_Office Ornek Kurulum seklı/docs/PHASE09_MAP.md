# PHASE 09 — Production hardening: enforcement, audit and honesty

> **Headline: governance is now ENFORCED, not merely available.**
>
> At the end of PHASE 08 the control plane was complete, tested, and *not wired
> into the execution path*. PHASE 09 closed that gap. The proof is
> `tests/governance.enforcement.test.ts`, and the proof that the proof is not
> vacuous is the mutation test recorded in [§6](#6-mutation-test-the-tests-are-not-vacuous).

---

## 1. The question this phase had to answer

PHASE 08 shipped 16 operations, four verdicts, a deterministic policy engine,
delegation, an approval bridge, resource governance and a redacting audit
recorder — and a documented limitation:

> governance is not wired into the orchestrator's execution path; it is available
> as a deployment-level control.

That sentence was honest, and it was also the single most important open risk in
the system. An authorization subsystem that only runs when someone calls it by
hand is a subsystem whose enforcement depends on every engineer remembering to
call it. PHASE 09 was required to stop treating that as acceptable and to
determine whether a **safe** integration boundary exists.

## 2. The audit: code over documentation

Before writing anything, the execution path was read. The order of operations
matters, because a phase that trusts its own documentation about where it can hook
in will wire itself somewhere plausible and wrong.

`TozOrchestrator.execute` already had a boundary that turned out to be exactly
right:

| Step | What happens | Why it matters |
| --- | --- | --- |
| `1 identified the task` | state → `created` | — |
| `2 refused at / passed the input policy` | **input screening, then refusal** | **the pre-execution authorization boundary** |
| `3 classified the task` | classification | first thing that *uses* the request |
| `5–6` | plan validation, anti-drift | plan exists from here on |
| `4a` | PHASE 05 memory recall | irreversible-ish side effect |
| `7+` | topology, per-subtask routing, `adapter.execute` | **provider is invoked from here** |

Placing enforcement at step 2 means a denied request never becomes a plan, never
reaches PHASE 06 routing, never recalls memory, and never reaches a worker. That
is the strongest placement available without rewriting the orchestrator.

Two boundaries were added rather than one:

- **Execution boundary** — `workflow.execute`, checked once, before anything uses
  the request.
- **Capability boundary** — `capability.execute`, checked per required
  capability, immediately before `adapter.execute`.

The second is not redundant. A job can be permitted while one of its subtasks
names a capability the policy denies only some callers. The capability check is
the last point at which an unauthorized call can be stopped *without having
invoked a provider*, which is what makes it the one that matters for spend and
egress rather than merely for the verdict.

## 3. What was wired, and how narrowly

### The port

`OrchestratorGovernancePort` in `src/orchestration/governance/gate.ts` has exactly
two capabilities:

```ts
authorize(input: { context; operation; resource?; capability?; jobId?; taskId?; executionId?; policy? }): AuthorizationOutcome
narrowRouting?(context, { taskId }): RoutingRestriction | null
```

What the port **cannot** do is the point. There is no method to select a provider,
choose a model, plan, mutate topology, write memory, or verify. Those are not
forbidden by convention — they are *absent*, so a gate holding this interface has
no way to do them even if it tried. This is the same port-shaped reasoning the
codebase already used for `ModelRoutingPort` and `TaskExecutionPort`.

### The narrowing hook, and why it is structurally incapable of selecting

`RoutingRestriction` has `deniedProviders`, `deniedModels`, `deniedProviderTypes`,
`reason` and `decidedBy`. It has **no** field for a preference, score, priority,
boost or replacement. Governance can subtract candidates and nothing else.

The restriction is applied in `ModelRouter.selectRoute` *before* PHASE 06
`evaluateCandidate`:

```
candidate set  →  [governance narrows]  →  [evaluateCandidate: hard filter]  →  [PHASE 06 ordering]
```

That ordering is the whole guarantee. Governance cannot make an ineligible
candidate eligible, and `evaluateCandidate` cannot resurrect a denied one. Both
authorities keep exactly the scope they had.

### Approval was deliberately NOT given a second gate

`REQUIRE_APPROVAL` at the execution boundary returns `approval_required` and stops
the work. It does **not** open, wait on, or satisfy an approval. The orchestrator
has no approval gate; the `ExecutionCoordinator` does. The refusal reason tells the
caller to re-drive the work through the coordinator, which owns the PHASE 07 gate.

Building a second gate here would have been the easy thing to do and would have
created two authorities for one decision — the exact failure this codebase has
spent nine phases refusing to introduce.

### The unidentified-caller default-deny

A caller is identified by `OrchestrationRequest.securityContext`, because a caller
is the only party that knows who it is. The orchestrator cannot infer an actor
from a `taskId`, and guessing one would defeat the subsystem.

Governance configured + no `securityContext` ⇒ **DENY**. An unidentified caller is
not an authorised one. This is the one place where the wiring is *stricter* than
"opt in", and it is deliberate.

## 4. The failure taxonomy

PHASE 09 found a genuine gap. A policy denial had to be reported as
`configuration_error` or `invalid_request`, and both describe a **mistake**. A
denial is not a mistake — it is the correct outcome of a correct request. An
operator reading a run could not tell "this is broken" from "this was refused on
purpose".

Two classes were added to `ERROR_CLASSES`, and explicitly to
`PERMANENT_ERROR_CLASSES`:

| Class | Meaning | Retryable |
| --- | --- | --- |
| `authorization_error` | the actor may not perform the operation | **no** — retrying is a loop |
| `approval_required` | blocked pending a decision at the PHASE 07 gate | **no** — blocked, not failed |

`approval_required` is kept distinct from `authorization_error` because the
remedies differ: a denial is final, an outstanding approval is waiting. Conflating
them makes a deployment either retry a denial forever or abandon a pending
approval. Both are wrong, and both are what a single "denied" class would cause.

## 5. Verification

`tests/governance.enforcement.test.ts` — 15 tests, 3 suites.

Every test asserts on **observable effects** — was the adapter called, did routing
run, what did the run claim, where did state settle — because a test that only
checked "a DENY can be produced" would have passed against the PHASE 08 code
*unchanged*.

Two of them are controls that keep the rest honest:

- **`runs normally when governance is NOT configured`** — the compatibility claim,
  as a test. The PHASE 08 deployment shape still works after the wiring lands.
- **`enforces per request, not once per process`** — guards against a "checked
  once" wiring in which an earlier run could poison a later one.

The step log carries the **engine's own reason code and the actor**, not a generic
"refused". A trace that says only "refused" is a claim; naming the rule is the
evidence.

## 6. Mutation test: the tests are not vacuous

The strongest objection to an enforcement suite is that it can pass while
enforcement is absent. That was tested rather than argued.

Both enforcement sites in `authority.ts` were disabled behind a temporary
environment flag, the project rebuilt, and the suite re-run:

| Configuration | Enforcement tests |
| --- | --- |
| Wiring present | **15/15 pass** |
| Both checks neutered | **8 of 9 fail** |
| Both checks neutered — the no-governance control | still passes (correct: it asserts the *absence* path) |

So the suite genuinely observes enforcement. This is the check that separates
"available" from "enforced", and it is the one worth repeating whenever the
enforcement path is touched.

The flag was removed afterwards and the absence of any remnant was verified.

## 7. Repo-wide audit

Run across all 142 `src` and all test TypeScript files.

| Check | Result |
| --- | --- |
| Files over 1000 lines | 4 — `authority.ts` (1513), `coordinator.ts` (1343), 2 test files |
| Duplicated 8-line blocks | 8 clusters, all pre-existing and all in settle/record paths |
| Empty or swallowed `catch` | **none** |
| Always-true / always-false conditions | **none** |
| Exported-but-never-imported | 420 — **heuristic, not confirmed dead code** |

### Findings acted on

**`authority.ts` was at 1581 lines** after the wiring landed. The three enforcement
methods needed *no orchestrator state* — each is a pure function of the gate, the
request and its arguments. They were extracted to
`src/orchestration/governance/enforcement.ts` (223 lines), and the orchestrator now
delegates to them. The file returned to 1513.

That extraction is more than tidiness. An authorization check that can also settle
state is a check whose failure mode is ambiguous; a pure function can only return a
value, and the tests are only meaningful *because* of that.

**A real defect found and fixed during the refactor:** the first version of the
step-log line passed a hardcoded `"refused"` in place of the engine's reason code.
A test now asserts the actual `ReasonCode` and the actor appear in the step.

### Findings recorded but deliberately not acted on

- **`authority.ts` and `coordinator.ts` remain over 1000 lines.** Both were
  already over that line before PHASE 09 (1366 and 1343). Splitting the
  orchestrator's settle paths is a refactor with real regression risk and no
  bearing on enforcement; it is recorded as PHASE 10 work rather than smuggled
  into this one.
- **The 420 "never imported" exports are mostly false positives.** They are
  discriminated-union members (`TaskEnqueuedEvent`), public API surface
  (`EmptySecretStore`, `Core`), and constants published for consumers. Deleting
  them on the strength of a grep heuristic would break the package's public
  interface. Reported as a heuristic finding, not acted on.
- **The 8 duplication clusters are pre-existing** and sit in result-settlement and
  record paths where the repetition is near-identical by design. Left alone; noted.

## 8. Classification

PHASE 09 required an explicit, non-evasive statement. The answer:

### ✅ Governance is ENFORCED in the execution path.

Not "enforced when configured" as a hedge — with a gate supplied, `ALLOW`, `DENY`
and `REQUIRE_APPROVAL` are produced automatically on every request, before
planning, before routing, and before any provider call. Removing the wiring makes
8 of 9 tests fail.

It remains **opt-in by deployment**, which is a compatibility property, not a
weakening: a deployment with no `governance` configured behaves exactly as it did
in PHASE 08, and that path is itself tested.

## 9. Limitations that remain

Stated plainly, because hardening a system is not the same as making it complete.

- **No persistent policy store.** Rules are supplied in-process by a
  `GovernanceGate`. A policy store is a deployment concern and is not fabricated.
- **No cryptographic tamper-evidence.** The audit log is redacting and
  in-process; it is not signed or append-only across restarts.
- **No RBAC primitive.** Roles and grants exist as data; role resolution is the
  caller's.
- **A throwing `narrowRouting` hook degrades to no-narrowing.** Contained, and
  tested, but it is a *fail-open on the routing restriction* — a conscious
  choice, because the alternative is failing healthy work when a policy store
  blips. The hard filter still applies, so this is a limitation, not a hole. It
  should be revisited if the restriction ever becomes a security boundary rather
  than a cost/control one.
- **Job state remains in memory** (PHASE 07), so a restart loses the record of what
  was authorized. Unchanged and not fixed here.
- **All PHASE 07 delivery-semantics limits stand**: single-process scope, no
  distributed lock, no exactly-once claim, bounded parallel waves.
- **No live provider, MCP, or external E2E.** Every test is against local doubles.
- **Multi-tenant isolation is not implemented.** `SecurityContext` carries a
  principal and a team, and nothing enforces separation between tenants yet.

## 10. Files

| File | Role |
| --- | --- |
| `src/orchestration/governance/enforcement.ts` | pure enforcement primitives; no orchestrator state |
| `src/orchestration/governance/gate.ts` | `OrchestratorGovernancePort` + `GovernanceGate` |
| `src/orchestration/authority.ts` | the two boundaries, delegating to the above |
| `src/orchestration/model/modelRouter.ts` | applies the narrowing before the hard filter |
| `src/core/errors.ts` | `authorization_error`, `approval_required` |
| `src/retry/policy.ts` | both classes pinned permanent/non-retryable |
| `tests/governance.enforcement.test.ts` | 15 tests, mutation-verified |
| `tests/helpers/orchestrationHarness.ts` | optional `governance`, absent by default |

### Not changed

`ExecutionCoordinator`, PHASE 05 `MemoryAccessPolicy`, PHASE 06 `evaluateCandidate`,
`VerificationRunner`, the worker registry, both task state machines, and the core
CLI. Each of those is an authority this phase was required to leave alone, and
each was left alone.
