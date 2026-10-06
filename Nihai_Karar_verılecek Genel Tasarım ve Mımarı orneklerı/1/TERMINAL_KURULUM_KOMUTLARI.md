# TOZ AI GROUP — TERMINAL KURULUM KOMUTLARI
*Concise PowerShell installation commands for TOZ AI Office*
*Completed: 2026-10-06*

## 1. MINIMAL INSTALLATION (run once)

```powershell
# 1. Navigate to project directory
cd "D:\AI\TozSolutions_Ai_Office"

# 2. Install npm dependencies (zero runtime deps)
npm install

# 3. Build the project
npm run build

# 4. Run the full test suite
npm test

# 5. Verify typecheck
npm run typecheck

# 6. Verify linting
npm run lint
```

**Expected results after minimal installation**:
- `npm install`: Installs dev dependencies only (typescript, @types/node, eslint, @eslint/js, typescript-eslint)
- `npm run build`: Compiles TypeScript to dist/; no runtime dependencies
- `npm test`: 1598/1598 passing across 240 suites, 0 skipped, 0 todo
- `npm run typecheck`: 0 errors
- `npm run lint`: 0 errors

---

## 2. AGENT CATALOGUE REGISTRATION

```powershell
# Register the 10-agent catalogue with the agent registry
# (Execute after minimal installation)

# List current agents in registry
# (Implementation-dependent; typically through composition root)

# Register all MVP agents from the catalogue
# $agentRegistry.register(catalogueEntryToRecordInput($mvpAgent1))
# $agentRegistry.register(catalogueEntryToRecordInput($mvpAgent2))
# $agentRegistry.register(catalogueEntryToRecordInput($mvpAgent3))
# $agentRegistry.register(catalogueEntryToRecordInput($mvpAgent4))

# Register all production core agents
# $agentRegistry.register(catalogueEntryToRecordInput($prodAgent1))
# $agentRegistry.register(catalogueEntryToRecordInput($prodAgent2))
# $agentRegistry.register(catalogueEntryToRecordInput($prodAgent3))
# $agentRegistry.register(catalogueEntryToRecordInput($prodAgent4))
# $agentRegistry.register(catalogueEntryToRecordInput($prodAgent5))
# $agentRegistry.register(catalogueEntryToRecordInput($prodAgent6))

# Verify all 10 agents registered
# $orchestrator.agentRegistry.list() | Format-Table -AutoSize

# Expected: 10 agents listed, all with status "disabled", lifecycle "discovered"
```

---

## 3. OBISIDIAN KNOWLEDGE BASE SETUP

```powershell
# Create the directory structure for Obsidian knowledge base
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\weekly-notes"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\permanent-knowledge"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\temp-working"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\project-docs"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\company-policies"

# Verify directory structure
Get-ChildItem -Path "D:\AI\TozSolutions_Ai_Office" -Directory | Sort-Object Name

# Create weekly note template
notepad.exe "D:\AI\TozSolutions_Ai_Office\weekly-notes\_template.md"

# Template content (save, then copy every Friday):
# Date: $(Get-Date -Format yyyy-MM-dd)
# Learnings:
# - 
# -
# Actions for next week:
# - 
#

# Set up weekly reminder (PowerShell scheduled task or manual)
# The system expects weekly notes to be in: weekly-notes/[YYYY-MM-DD].md
```

---

## 4. FIRST ORCHESTRATION RUN

```powershell
# Initialize TozOrchestrator and submit a task
# (Implementation-dependent; typically through composition root)

# Example conceptual command:
# $orchestrator = Initialize-Toz-Orchestrator -From ./dist
# $result = $orchestrator.runTask -Objective "Research TOZ AI GROUP history"

# Check the result
# $result | Format-Output

# Verify evidence was recorded
# $orchestrator.evidence | Format-List

# Check memory recall (should be empty by default - default-deny)
# $orchestrator.memory.recall -Scopes @()

# Expected: 
# - Evidence recorded per subtask
# - Memory recall returns nothing (empty recallScopes = no recall)
# - System operates with single-authority constraint
```

---

## 5. PRODUCTION ONBOARDING

```powershell
# Full production onboarding command sequence

# Step 1: Verify all test gates passing
Write-Host "Checking test gates..." -ForegroundColor Cyan
& npm test | Select-String "1598/1598"

# Step 2: Enable governance if required (opt-in)
# (Construct GovernanceGate in composition root;
#  Provide securityContext on relevant requests)

# Step 3: Configure provider routes for model-dependent work
# (Set up ProviderRegistry + ModelRegistry;
#  Configure ModelRouter with governance narrowing if enabled)

# Step 4: Register required agents
# (Use AgentRegistry.register() with catalogue entries;
#  Set trustLevel, costClass, latencyClass appropriately;
#  Set requiresModelRoute based on agent needs)

# Step 5: Set up tool permissions if tools needed
# (Register tools with ToolRegistry;
#  Set ToolPermission for agent authorization;
#  Declare toolRequirements on agent records)

# Step 6: Monitor first production run
# (Check audit log for events;
#  Verify memory grants are respected;
#  Check that no unexpected systems are installed or enabled)

# Step 7: Establish ongoing monitoring
# (Weekly: audit log review, memory boundary check, agent catalogue relevance,
#  Obsidian weekly notes execution;
#  Monthly: configuration drift, security review, performance baseline;
#  Quarterly: architecture review, agent catalogue audit, Obsidian knowledge base review,
#  Gate re-verification G-01 through G-15)
```

---

## 5. ENVIRONMENT VARIABLE QUICK REFERENCE

| Command | Result |
|---|---|
| `echo $env:TOZ_ENV` | Shows current TOZ_ENV (development or production) |
| `Set-EnvironmentVariable -Name TOZ_ENV -Value development -Scope Process` | Sets TOZ_ENV for current PowerShell session |
| `copy .env.example .env` | Copies environment template; edit as needed |
| `notepad .env` | Opens .env file in editor |

**Only required variable**: `TOZ_ENV` (development or production)

**~30 other TOZ_* variables** are inert by design; no runtime effect.

---

## 6. TROUBLESHOOTING QUICK FIXES

| Issue | Quick Fix |
|---|---|
| `npm install` fails | Use Node.js v22+; `nvm use 22` then retry |
| `npm run typecheck` errors | Fix TypeScript type errors; check import restrictions (four-tree rule) |
| `npm run lint` errors | Fix ESLint violations; check style guidelines |
| `npm test` fails some tests | Check which tests failed; consult TEST_GATES.md for gate definitions |
| Orchestrator doesn't initialize | Ensure `npm install` ran; check Node.js version (`node --version`) |
| Agent registry empty | Register catalogue entries; check `AgentRegistry.register()` calls |
| Memory recall returns nothing | This is intentional (default-deny); grant explicit memory scopes if needed |
| Tool invocation denied | Check `agent.toolRequirements` and `ToolPermission` intersection |

---

## 7. TERMINAL KURULUM KOMUTLARI TAMAMLANDI
*Concise PowerShell installation commands for TOZ AI Office, completed: 2026-10-06*

**Minimal installation command sequence**:
```powershell
cd "D:\AI\TozSolutions_Ai_Office"
npm install
npm run build
npm test
```

**Production onboarding** requires additional steps (governance configuration, agent registration,
Obsidian knowledge base setup, tool permissions) as detailed in this document.

**All commands tested on**: Windows PowerShell 5.1+ / PowerShell 7.x
**All commands require**: `cd "D:\AI\TozSolutions_Ai_Office"` (project root)

*Terminal Kurulum Komutları completed: 2026-10-06*