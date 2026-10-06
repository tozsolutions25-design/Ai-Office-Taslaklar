# TOZ AI GROUP — TEST GATES
*Sequential test gates every phase must pass before progressing*
*Completed: 2026-10-06*

## 1. GATE OVERVIEW

The TOZ AI GROUP architecture employs a **strict sequential test gate system**. No phase may
progress to the next stage until ALL preceding gates pass. This ensures that architectural
defects are caught early, before they compound across phases.

**Core invariant**: Gates are ANDed — every gate in a phase must pass before progression.
No OR logic — if any gate fails, the entire phase stops.

---

## 2. GATE NUMBERING AND LEVEL

| Gate | Phase | Dependencies | Criticality |
|---|---|---|---|
| **G-01** | Pre-PHASE 01 | None (environment setup) | ✅ Mandatory |
| **G-02** | PHASE 01 | G-01 | ✅ Mandatory |
| **G-03** | PHASE 02 | G-02 | ✅ Mandatory |
| **G-04** | PHASE 03 | G-03 | ✅ Mandatory |
| **G-05** | PHASE 04 | G-04 | ✅ Mandatory |
| **G-06** | PHASE 04.1 | G-05 | ✅ Mandatory |
| **G-07** | PHASE 05 | G-06 | ✅ Mandatory |
| **G-08** | Full suite | G-07 + all prior | ✅ Mandatory (1598/1598) |
| **G-09** | Memory service | G-08 + memory tests | ✅ Mandatory (97/97) |
| **G-10** | Capability registry | G-08 + capabilities tests | ✅ Mandatory (open-capability coverage) |
| **G-11** | Agent registry | G-08 + agent lifecycle tests | ✅ Mandatory (selection, lifecycle) |
| **G-12** | Verification cycle | G-08 + evidence/verification tests | ✅ Mandatory (pass/fail/needs_review) |
| **G-13** | Governance gate | G-08 + governance tests | ⚠️ Conditional (opt-in) |
| **G-14** | Tool execution | G-08 + tool tests | ✅ Mandatory (invocation, permission, refusal) |
| **G-15** | Memory boundary | G-08 + Hermes/Obsidian boundary tests | ✅ Mandatory (decision matrix) |

---

## 3. GATE DEFINITIONS

### 3.1 G-01: Environment Setup
**Purpose**: Verify the development environment is correctly configured.

**Command**: 
```powershell
# Verify Node.js version
node --version  # Should be v22+

# Verify npm version
npm --version  # Should be 11.19.0+

# Verify Git is available
git --version

# Verify OpenCode is available
opencode.cmd --help

# Check TOZ_ENV is set
echo $env:TOZ_ENV  # Should be "development" or "production"
```

**Pass criteria**: All checks succeed; TOZ_ENV is set to development or production.

**Fail action**: Stop; fix environment before proceeding.

---

### 3.2 G-02: PHASE 01 Regression
**Purpose**: Verify the original PHASE 01 tests still pass (greenfield start, no migration).

**Command**:
```powershell
npm run test:unit
```

**Expected**: 232/232 passing (12 original PHASE 01 test files).

**Pass criteria**: All 232 PHASE 01 unit tests pass.

**Fail action**: Stop; investigate which PHASE 01 tests failed; do not proceed.

---

### 3.3 G-03: PHASE 02 Regression
**Purpose**: Verify the design-system tests still pass.

**Command**:
```powershell
npm run test:unit  # This runs the full suite; check PHASE 02 results
```

**Expected**: 285/285 passing (8 design-system test files).

**Pass criteria**: All 285 PHASE 02 design-system tests pass.

**Fail action**: Stop; investigate design-system regressions; do not proceed.

---

### 3.4 G-04: PHASE 03 Site Build
**Purpose**: Verify the site builds correctly (content integrity, architecture, reliability).

**Command**:
```powershell
npm run site:build
```

**Expected**: `index.html` (32,275 bytes) and `404.html` (6,030 bytes) generated.

**Pass criteria**: Site builds successfully; content integrity test passes (scans copy for
absent percentages, multipliers, testimonials, etc.).

**Fail action**: Stop; fix site build issues; do not proceed.

---

### 3.5 G-05: PHASE 04 Full Orchestration Suite
**Purpose**: Verify the full orchestration suite passes (the comprehensive test suite).

**Command**:
```powershell
npm test
```

**Expected**: 1598/1598 passing across 240 suites, 0 skipped, 0 todo.

**Pass criteria**: 
- Full suite: 1598/1598 passing
- PHASE 01 regression: 235/235 passing (includes 3 new tests from PHASE 04.1)
- PHASE 02 regression: 287/287 passing
- PHASE 03 regression: 117/117 passing
- PHASE 04 + 04.1: 454/454 passing
- Config validation: VALID
- Site build: unchanged output
- Preview build: PASS
- Runtime dependencies: none (npm ls --depth=0)
- Ruflo installed: not installed (asserted by test)

**Fail action**: Stop; investigate which tests failed; do not proceed to next phase.

---

### 3.6 G-06: Memory Service Tests
**Purpose**: Verify the memory service implementation (PHASE 05).

**Command**:
```powershell
# Run memory-specific tests
npm test -- --grep "memory"
# Or specifically:
# tests/memory.service.test.ts - 97/97 passing
# tests/memory.model.test.ts - 50/50 passing
# tests/orchestration.memory.test.ts - 15/15 passing
```

**Expected**: 
- memory.service.test.ts: 97/97 passing
- memory.model.test.ts: 50/50 passing
- orchestration.memory.test.ts: 15/15 passing

**Pass criteria**: All memory service tests pass (162/162 total).

**Fail action**: Stop; investigate memory service defects; do not proceed.

---

### 3.7 G-10: Capability Registry Tests
**Purpose**: Verify the capability registry with open-capability support.

**Command**:
```powershell
npm test -- --grep "capabilities"
# Or: tests/capabilities.test.ts
```

**Expected**: Open-capability coverage test passes; agents can declare custom namespaced
capabilities (e.g., `web_research`, `entity_extraction`) without core code changes.

**Pass criteria**: 
- All capability tests pass
- `isBuiltinCapability` works for built-in names
- `isCapabilityName` validates namespaced custom names
- `CapabilitySet.unknown()` starts with all as `unknown`
- Custom capabilities register and index correctly

**Fail action**: Stop; investigate capability registry defects; do not proceed.

---

### 3.8 G-11: Agent Registry Tests
**Purpose**: Verify the agent registry with lifecycle management and selection.

**Command**:
```powershell
npm test -- --grep "agent"
# Or specifically:
# tests/orchestration.agency.test.ts - 61 tests
# tests/orchestration.fabric.test.ts - includes agency tests
```

**Expected**: 
- Agent lifecycle management (discovered → verified → registered → available → draining → retired)
- Selectable filter: lifecycle `available` AND status `active`
- No duplicate registration (same agentId@version rejected)
- workspace partitioning (PHASE 06)

**Pass criteria**: All agent registry tests pass.

**Fail action**: Stop; investigate agent registry defects; do not proceed.

---

### 3.9 G-12: Verification Cycle Tests
**Purpose**: Verify the evidence/verification cycle (pass/fail/needs_review).

**Command**:
```powershell
npm test -- --grep "verification"
# Or: tests/orchestration.verification.test.ts
```

**Expected**: 
- Evidence recorded per subtask
- Verification verdicts: `pass`, `fail`, `needs_review`
- Unverified result = `needs_review`, NOT `pass`
- Merge evidence works correctly (union: every tool call, source, artifact, test survives)
- Multi-agent task produces one record per subtask

**Pass criteria**: All verification cycle tests pass.

**Fail action**: Stop; investigate verification defects; do not proceed.

---

### 3.10 G-13: Governance Gate Tests (Conditional)
**Purpose**: Verify the governance gate when wired (opt-in).

**Command**:
```powershell
# Only run if governance is wired in the composition root
npm test -- --grep "governance"
# Or: tests/governance.test.ts
```

**Expected**: 
- PolicyEngine three outcomes: ALLOW/DENY/REQUIRE_APPROVAL/NOT_APPLICABLE
- Default-deny when every rule declines
- Governance gate lifecycle (waiting → approved/rejected/expired/cancelled)
- Approval may-release consulted on every release

**Pass criteria**: All governance tests pass (only if governance is wired).

**Fail action**: Stop; investigate governance defects; do not proceed. 
**Note**: This gate is conditional — if governance is not wired, skip with the note
"governance opt-in not configured; gate skipped."

---

### 3.11 G-14: Tool Execution Tests
**Purpose**: Verify tool invocation, permission, and refusal.

**Command**:
```powershell
npm test -- --grep "tool"
# Or: tests/tool.test.ts
```

**Expected**: 
- ToolInvocation authorisation through ToolPermission
- Agent that declares nothing gets nothing
- Refusal reported as refusal (`refused: true`) ≠ call made and failed
- TextStatInvoker works as reference implementation
- Policy + implementation existence + call order enforced

**Pass criteria**: All tool execution tests pass.

**Fail action**: Stop; investigate tool execution defects; do not proceed.

---

### 3.12 G-15: Memory Boundary Tests
**Purpose**: Verify the Hermes memory + Obsidian knowledge base boundary.

**Command**:
```powershell
npm test -- --grep "memory.*boundary" || npm test -- --grep "obsidian"
# Or: Custom tests that verify the decision matrix
```

**Expected**: 
- Memory scope grants respect workspace partitioning (PHASE 06)
- Default-deny: empty recallScopes = no recall
- Verification-gated capture: nothing learned from unverified run
- Information that persists beyond execution goes to Obsidian (documented, not code-enforced)
- Task state bridges both: recorded in evidence + current execution context

**Pass criteria**: All memory boundary tests pass.

**Fail action**: Stop; investigate memory boundary defects; do not proceed.

---

## 4. GATE PROGRESSION RULES

### 4.1 AND Logic (All Gates Must Pass)
```
Gate Sequence: G-01 → G-02 → G-03 → ... → G-15

PROGRESSION RULE:
G-01 AND G-02 AND G-03 AND ... AND G-15 MUST ALL PASS

If ANY gate fails:
- The current phase STOPS immediately
- No progression to the next phase
- All prior gates' results are recorded (but progression blocked)
- Fix the failing gate(s); re-run; only then proceed
```

### 4.2 Conditional Gates
Some gates are conditional on configuration:

| Gate | Condition | Action if Condition Not Met |
|---|---|---|
| **G-13** (Governance) | Governance wired in composition root | Skip with note: "governance opt-in not configured" |
| **G-15** (Memory Boundary) | Hermes + Obsidian boundary documented | Proceed with documentation review, not code enforcement |

**Conditional gate rule**: If condition not met, gate is skipped with documented reason;
progression may proceed but the omission is recorded as a known gap.

### 4.3 Gate Re-running
After a gate fix:
- **Re-run from the failed gate**, not from G-01 (unless the fix touches foundational code)
- **All subsequent gates must also pass** — a fix in G-07 requires re-running G-08 through G-15
- **No partial credit** — all gates in the phase must pass

### 4.4 Gate Documentation
Every gate failure must be documented with:
- Gate ID and name
- Test(s) that failed
- Root cause (if identifiable)
- Fix applied
- Re-verification result

---

## 5. PHASE-GATE MAP

| Phase | Gates |
|---|---|
| **PHASE 00** | G-01 (environment only) |
| **PHASE 01** | G-01, G-02 |
| **PHASE 02** | G-01, G-02, G-03 |
| **PHASE 03** | G-01 through G-04 |
| **PHASE 04** | G-01 through G-05 |
| **PHASE 04.1** | G-01 through G-06 |
| **PHASE 05** | G-01 through G-09 |
| **PHASE 06** (workspace isolation) | G-01 through G-09 + workspace partitioning tests |
| **PHASE 07** (governance opt-in) | G-01 through G-09 + G-13 (if wired) |
| **PHASE 08** (authority) | G-01 through G-08 + authority evidence |
| **PHASE 09** (skills) | G-01 through G-08 + skill contract tests |
| **PHASE 10** (certification) | G-01 through G-15 (ALL gates) |

**PHASE 10 certification requires ALL 15 gates to pass.**

---

## 6. GATE FAILURE PROTOCOL

### 6.1 Immediate Actions (when gate fails)
1. **Stop** — do not proceed to any subsequent gate or phase
2. **Record** — gate ID, failing test(s), error messages
3. **Analyze** — determine root cause (is it a regression? a new defect? a configuration issue?)
4. **Fix** — apply the minimal fix required
5. **Re-verify** — re-run the failed gate(s)

### 6.2 Escalation (when gate repeatedly fails)
1. **Document** — the gate, the failure, the fix attempts
2. **Escalate** — raise to the architecture review level (Özkan → Yönetim → Koordinasyon)
3. **Review** — determine if the gate is architecturally too restrictive, or the failure is
   a legitimate defect that needs addressing
4. **Decision** — Özkan decides: proceed with waiver, redesign the gate, or address the defect

### 6.3 Waiver Protocol
A gate waiver is only granted when:
- The gate is **conditionally mandatory** (e.g., G-13 governance not wired)
- The waiver is **documented** with reason and risk assessment
- **Özkan approves** the waiver in writing (session record)
- **All other gates still pass** — no other gates may fail to qualify for a waiver

---

## 7. GATE COMPLETION CERTIFICATE

When ALL gates for a phase pass, the following is recorded:

```
PHASE X GATE COMPLETION CERTIFICATE
===============================
Phase: PHASE X
Date: YYYY-MM-DD
Gates Passed: G-01 through G-Y (Y gates)
Test Suite: npm test (or specific test commands)
Result: ALL TESTS PASSING (count/count)
Next Phase: PHASE X+1 (begin authorized)
Architectural Integrity: PRESERVED

Authorized by: [Lead/Özkan]
```

This certificate authorizes the team to begin the next phase. No phase transition is
authorized without this certificate.

---

## 8. GATE HARDENING HISTORY

| Gate | Previously Failed | Fixed In | Fix Type |
|---|---|---|---|
| **G-05 (PHASE 04 suite)** | Yes (pre-PHASE 10) | PHASE 10 | Cross-job approval bypass fix; memory write fixes; evidence fixes |
| **G-11 (Agent registry)** | Yes (pre-PHASE 04.1) | PHASE 04.1 | Lifecycle management; selectable filter; requiresModelRoute |
| **G-09 (Memory service)** | Yes (pre-PHASE 05) | PHASE 05 | Default-deny recall; verification-gated write; scope separation |
| **G-04 (Site build)** | Yes (pre-PHASE 03) | PHASE 03 | Content integrity; no escaped markup; proper footer element |
| **G-01 (Environment)** | Yes (pre-PHASE 00) | PHASE 00 | Environment setup; TOZ_ENV requirement; Node.js version |

**Gate hardening history**: 5 gates had pre-existing failures that were fixed across phases.
No gate has failed repeatedly after its initial fix phase.

---

## 9. TEST GATES COMPLETE — SUMMARY

**Total gates**: 15 (G-01 through G-15)

**Mandatory gates**: 13 (G-01 through G-12, G-15)

**Conditional gates**: 2 (G-13 governance, G-15 memory boundary — conditional on configuration)

**PHASE 10 certification requirement**: ALL 15 gates must pass.

**Gate enforcement**: AND logic — every gate must pass; if any fails, progression stops.

**Gate documentation**: Every failure documented; every fix recorded; every completion certified.

*Test Gates completed: 2026-10-06*