# PHASE 12 — SESSION HANDOFF

**This file is the authoritative working handoff for Phase 12.** Phase 12 state is to be read
from here and from the repository, never reconstructed from memory or assumed.

> Written from the verified repository state, not from a request template. Four points in the
> original handoff request were stale and were corrected; each is listed in
> [Corrections to the request](#corrections-to-the-request). Nothing else was changed.

---

## CURRENT PHASE

**PHASE 12 — Durable State & Recovery**

## CURRENT STATUS

**PHASE 12 IS NOT COMPLETE.**

Slides 12.1 through 12.8 are done. 12.9 through 12.18 remain.

## LATEST VERIFIED COMMITS

1. `471a882 feat(phase-12): establish durable state foundation`
2. `647f7b6 fix(phase-12): normalize checkpoint identity source`
3. `c934849 feat(phase-12): persist idempotency state`   ← HEAD

**Do NOT amend any of these.** All three are immutable checkpoints.

Working tree was clean at `c934849`.

---

## COMPLETED

- 12.1 Durable repository contract
- 12.2 Durable state model
- 12.3 SQLite schema/store
- 12.4 transaction boundaries
- 12.5A coordinator durable migration
- 12.5B remaining coordinator state migration
- 12.8 idempotency persistence
- checkpoint identity persistence
- claim persistence
- job transition persistence
- execution/attempt/result/verdict/measuredAmount persistence
- Job.budget persistence
- workspace/brand partitioning
- repository-first writes
- repository-authoritative reads
- cache is not authoritative
- identity source NUL-character correction

---

## 12.5B VERIFIED EVIDENCE

- Results: **5/5 PASS**
- Verdicts: **5/5 PASS**
- MeasuredAmount: **7/7 PASS**
- Focused evidence total: **17/17 PASS**
- Full suite: **2070/2070**, 316 suites
- Typecheck: **PASS**
- Lint: **PASS**
- Build: **PASS**
- Clean rebuild: **PASS**
- Diff check: **PASS**

## 12.8 VERIFIED EVIDENCE

`tests/idempotencyPersistence.p12.test.ts` — **14/14 PASS**

| # | Evidence | Result |
|---|---|---|
| 1 | Empty-cache | PASS |
| 2 | Same-attempt duplicate begin | PASS |
| 3 | Different-attempt retry | PASS |
| 3b | Attempt identity, via the real `executeTask` path | PASS |
| 4 | In-progress persistence | PASS |
| 5 | Restart persistence (real close/reopen) | PASS |
| 6 | Workspace isolation (one file, two scopes) | PASS |
| 7 | Stale-cache behaviour | PASS |
| 8 | Completion persistence | PASS |
| 9 | Abandon / failure semantics | PASS |
| 9b | Failed attempt replays as failed | PASS |
| 10 | Failure atomicity — refused `complete` and refused `begin` | PASS |
| 11 | No duplicate executable operation for same attempt/key | PASS |
| 12 | No exactly-once claim | PASS |

### 12.8 MUTATION / NEGATIVE CONTROLS

| Mutation | Observed |
|---|---|
| `begin` bypasses the durable write | **11 of 14 failed** |
| `get` reads only the cache | **1 of 14 failed** — STALE CACHE only |
| attempt dropped from `#idempotencyKey` | **1 of 14 failed** — ATTEMPT IDENTITY only |

All mutations were reverted and the revert verified. No test was weakened to make a control pass.

### CURRENT FULL-SUITE BASELINE

- Full suite: **2084/2084**, 317 suites
- 12.5B focused evidence still green: **17/17**
- Typecheck / Lint / Build / Clean rebuild / Diff check: **PASS**

---

## IMPORTANT SEMANTICS

These are load-bearing. A change that breaks one of them is a regression even if every test
still passes.

- `indeterminate` is a real state.
- `indeterminate` MUST NOT auto-transition to completed or failed.
- Exactly-once external side effects are NOT promised. An attempt that was in flight when the
  process ended stays `in_progress`; a restart reports it as unresolved rather than inventing a
  result.
- The durable repository is authoritative.
- In-memory structures are only caches where retained.
- Repository write first, cache second.
- Repository read first; a stale cache must never override durable state.
- Workspace isolation is mandatory.
- A transaction failure must not leave a false successful cache state.

### `DELIVERY_SEMANTICS`

`scope` is `"durable-per-workspace"`, `claim` is `"effectively-once"`. It was `"single-process"`
before 12.8 and that became false when idempotency moved into the repository. It is still **not**
cross-workspace and still **not** exactly-once.

---

## KNOWN DEFECTS FOUND, NOT YET FIXED

Found during 12.8. Both are pre-existing and outside 12.8's scope; they were left alone
deliberately and need a decision.

**1. `SqliteDurableStore.listJobs()` and `listClaims()` are broken.**

Both pass the statement name to `#where`, which expects a SQL fragment, producing
`WHERE "workspace" = ? AND "brand" = ?listJobs` and a SQLite syntax error. The identical mistake
in `listIdempotent()` was found and fixed in 12.8 (`c934849`) because 12.8 needed it.

`coordinator.jobIds()` calls `listJobs()`, so it is unreachable against a SQLite store. One-line
fix each. **12.9 and 12.10 will hit these.**

**2. `ClaimRegistry` does not use the coordinator's durable store.**

`coordinator.ts` constructs it as `new ClaimRegistry({ clock, defaultTtlMs, workspace })` with no
`repository`, so it builds its own empty `InMemoryDurableStore`. `CheckpointStore` and
`IdempotencyLedger` both receive `repository: this.#durable`; `ClaimRegistry` is the one exception.
**Claims therefore do not persist when a shared SQLite store is supplied.** This is a 12.4 gap.

---

## KNOWN INTENTIONAL FUTURE ITEM

`perTaskLimit` durable checkpoint eviction/deletion policy was intentionally NOT silently
implemented. The option is accepted and readable (`gates.ts`, default `20`; `perTaskLimit()`
getter exists) but nothing evicts. It requires a product decision and **must not be invented
during later implementation.**

## KNOWN SECURITY FOLLOW-UP

A development HMAC default, `toz-phase-12-development-key`, is present in:

- `src/state/inMemoryStore.ts`
- `src/orchestration/workflow/claims.ts` (line 146)
- `src/orchestration/workflow/gates.ts` (line 153)

This is **NOT a real credential.** It is a well-known development constant and each site is
overridable via `options.identity`.

Do NOT casually change it during 12.9 or 12.10. Evaluate a production rejection / default-secret
policy during the designated Phase 12.11–12.18 security and final-gate work.

---

## CURRENT NEXT STEP

**PHASE 12.9 — Rehydration**

12.8 is complete and committed. Do not re-implement it.

### 12.9 MUST NOT START

- 12.10 Recovery
- 12.11 Engine integration
- 12.12+ final gates

### AFTER 12.9

- 12.10 Recovery
- 12.11 Engine integration
- 12.12–12.18 evidence, mutation, negative controls, security, documentation and the final
  Phase 12 gate

---

## RULE

- Never report PASS unless all mandatory evidence for the current slice exists and passes.
- Never invent evidence.
- Never silently broaden scope.
- If a required behaviour cannot be honestly proven, **STOP and report the exact gap.**

---

## NEXT SESSION INSTRUCTION

Start by verifying:

```
git status --short
git log -3 --oneline
```

Expected HEAD:

```
c934849 feat(phase-12): persist idempotency state
```

Then begin **ONLY PHASE 12.9 — Rehydration.**

---

## Corrections to the request

The handoff request specified a state that no longer matched the repository. Each item below was
verified against the repo before writing, and this file records what is actually true.

| # | Request said | Actual |
|---|---|---|
| 1 | Latest commits are `471a882`, `647f7b6` | A third commit exists: `c934849 feat(phase-12): persist idempotency state` |
| 2 | Expected HEAD `647f7b6` | HEAD is `c934849` |
| 3 | Next step is 12.8 Idempotency Persistence | 12.8 is **complete and committed**; next step is 12.9 Rehydration |
| 4 | Full suite 2070/2070, 316 suites | **2084/2084, 317 suites** after 12.8 |

Writing the requested version would have told the next session that 12.8 was still pending, which
is the exact failure this document exists to prevent.

Two request items were checked and found **accurate**, and are recorded above as given:
`perTaskLimit` genuinely exists with no eviction implemented, and the development HMAC default
genuinely exists.