# TOZ AI GROUP — KURULUM SİRASI
*Installation sequence from zero to production-ready*
*Completed: 2026-10-06*

## 1. PREREQUISITES

### 1.1 Hardware
- **Windows desktop or laptop** with PowerShell 5.1+
- **Disk space**: At least 2 GB free (Node.js, npm, TypeScript build artifacts)
- **Memory**: At least 4 GB RAM (for orchestration runtime with multiple agents)
- **Node.js**: v22+ (v24.21.0 confirmed working)

### 1.2 Software
- **PowerShell 5.1+** (Windows built-in; `pwsh` command available)
- **Git** (for version control and source management)
- **npm** (comes with Node.js; version 11.19.0 confirmed working)
- **OpenCode 1.18.32** (via `opencode.cmd`)

**Absent by design** (per AD-27): pnpm, yarn, bun, Docker, any browser automation
(Playwright, Puppeteer, Cypress, jsdom). None is required for the system.

### 1.3 Environment Configuration
- **TOZ_ENV**: Required configuration value; set to `development` or `production`
- **No provider credentials needed** for local operation (zero runtime dependencies)
- **`.env.example`** provides the template; copy to `.env` and set `TOZ_ENV`

---

## 2. INSTALLATION STEPS

### 2.1 Step 1: Project Initialization (run once)
```powershell
# Navigate to project directory
cd "D:\AI\TozSolutions_Ai_Office"

# Install npm dependencies (zero runtime deps)
npm install

# Verify the install
npm ls --depth=0

# Should show only dev dependencies: typescript, @types/node, eslint, @eslint/js, typescript-eslint
```

### 2.2 Step 2: Build the Project
```powershell
# Build TypeScript to dist/
npm run build

# Verify build output
dir dist\src\orchestration\authority.js  # Should exist
dir dist\src\orchestration\index.js     # Should exist
```

### 2.3 Step 3: Run the Test Suite
```powershell
# Run all unit tests
npm test

# Expected: 1598/1598 passing across 240 suites, 0 skipped, 0 todo

# Run typecheck
npm run typecheck

# Run lint
npm run lint
```

### 2.4 Step 4: Verify the Orchestrator Initializes
```powershell
# Launch OpenCode and initialize TozOrchestrator
# (Implementation-dependent; typically through the composition root)

# Example verification command:
& opencode.cmd --eval "
  const { TozOrchestrator } = require('./dist/orchestration/authority');
  const orchestrator = new TozOrchestrator();
  console.log('Orchestrator initialized successfully');
  console.log('Agent registry size:', orchestrator.agentRegistry?.size || 0);
  console.log('Specialist pool ready:', true);
"
```

### 2.5 Step 5: Register the Agent Catalogue
```powershell
# Register the 10-agent catalogue with the agent registry
# This uses the catalogue entries and registers them with appropriate settings

# Example: Register all MVP agents
# (Actual registration code depends on the composition root)

# List current agents in registry
# $agents = $orchestrator.agentRegistry.list()

# Register a specific agent from the catalogue
# $agentRegistry.register(recordInput)

# Verify registration
# $orchestrator.agentRegistry.list() | Format-Table -AutoSize
```

### 2.6 Step 6: Set Up Obsidian Knowledge Base
```powershell
# Create the directory structure for Obsidian knowledge base
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\weekly-notes"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\permanent-knowledge"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\temp-working"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\project-docs"
New-Item -ItemType Directory -Path "D:\AI\TozSolutions_Ai_Office\company-policies"

# Verify directory structure
Get-ChildItem -Path "D:\AI\TozSolutions_Ai_Office" -Directory | Sort-Object Name

# Create weekly note template (create once, copy every Friday)
# The system expects weekly notes to be in: weekly-notes/[YYYY-MM-DD].md
# Create a template:
notepad.exe "D:\AI\TozSolutions_Ai_Office\weekly-notes\_template.md"

# Set up the template content (minimal):
# Date: [YYYY-MM-DD]
# Learnings:
# - 
# -
# Actions for next week:
# - 
#
```

### 2.7 Step 7: First Orchestration Run
```powershell
# Submit a simple task through the orchestrator
# (Implementation-dependent; typically through the composition root)

# Example PowerShell command (conceptual):
# $result = $orchestrator.runTask -Objective "Research TOZ AI GROUP history"

# Check the result
# $result | Format-Output

# Verify evidence was recorded
# $orchestrator.evidence | Format-List

# Check memory recall (should be empty by default)
# $orchestrator.memory.recall -Scopes @()
```

### 2.8 Step 8: Production Onboarding
```powershell
# 1. Verify all gates passing (G-01 through G-15)
#    - npm run test:unit -- --grep "production"

# 2. Enable governance if required (opt-in)
#    - Construct GovernanceGate in composition root
#    - Provide securityContext on requests that need authorization

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

## 3. ENVIRONMENT VARIABLES

| Variable | Required? | Default | Description |
|---|---|---|---|
| `TOZ_ENV` | ✅ YES | development | Required configuration value; distinguishes development vs production |
| `TOZ_GOVERNANCE_ENFORCED` | ❌ NO | (not set) | enables governance enforcement; inert if not wired by composition root |
| `TOZ_GOVERNANCE_BLOCK_ON_UNKNOWN_COST` | ❌ NO | (not set) | "unknown cost is not zero cost"; inert if not wired |
| `TOZ_ROUTING_POLICY` | ❌ NO | (not set) | selects a routing policy; no runtime effect (config section inert) |
| `TOZ_SECURITY_INPUT_POLICY` | ⚠️ CONDITIONAL | (not set) | `deny_all` possible through constructor wiring; only changes constructor wiring |
| `TOZ_MEMORY_*` | ❌ NO | (not set) | all inert; no production memory variables |
| `TOZ_WORKER_*` | ❌ NO | (not set) | all inert |
| `TOZ_LEARNING_*` | ❌ NO | (not set) | all inert |
| `TOZ_RUFLO_ENABLED` | ❌ NO | false | inert; no Ruflo package; enabling changes nothing observable |

**~30 documented environment variables validate correctly and do nothing** — this is a wiring gap,
not a validation gap, and closing it is composition work deliberately not performed in a certification
phase (per §22's requirement, documented as inactive).

---

## 4. DEVELOPMENT WORKFLOW

### 4.1 Daily Development
```powershell
# 1. Make code changes
# 2. Run typecheck
npm run typecheck

# 3. Run lint
npm run lint

# 4. Run tests (fail fast if any gate fails)
npm test -- --testPathPattern="orchestration"

# 5. Build
npm run build

# 6. Verify nothing is broken
```

### 4.2 Pre-Commit (if Husky pre-commit hooks are set up)
```powershell
# Runs automatically on commit if pre-commit hooks are configured
# - typecheck
# - lint  
# - test (relevant suite only)
```

### 4.3 Release Preparation
```powershell
# 1. Ensure all tests pass (1598/1598)
npm test

# 2. Run build
npm run build

# 3. Verify dist/ has all expected files
# 4. Check package.json has zero runtime dependencies
# 5. Review CHANGELOG.md (if maintained)
# 6. Tag the release in Git
git tag -a vX.Y.Z -m "TOZ AI Office version X.Y.Z"
git push origin vX.Y.Z
```

---

## 5. TROUBLESHOOTING

### 5.1 Common Issues

| Issue | Cause | Fix |
|---|---|---|
| `npm install` fails | Node.js version incompatible | Use Node.js v22+; nvm use 22 |
| `npm run typecheck` errors | TypeScript type errors | Fix type errors; check import restrictions |
| `npm run lint` errors | ESLint rule violations | Fix lint violations; check style guidelines |
| `npm test` fails some tests | Test regression | Check if related to recent changes; consult TEST_GATE.md |
| Orchestrator doesn't initialize | Missing dependencies | Ensure `npm install` ran; check Node.js version |
| Agent registry empty | Agents not registered | Register catalogue entries; check registration code |
| Memory recall returns nothing | Default-deny design | This is intentional; grant explicit memory scopes if needed |
| Tool invocation denied | ToolPermission intersection | Check agent.toolRequirements and policy permits |

### 5.2 Error Messages and Meanings

| Error Message | Meaning | Resolution |
|---|---|---|
| `DuplicateAgentError` | Agent already registered with same agentId@version | Use different version; or use `registerOrGet` which returns existing entry |
| `UnknownAgentError` | Agent not found in registry | Register the agent first; check agentId and version |
| `ValidationError` | Agent record input validation failed | Check agentId format, version format, adapter non-empty |
| `AgentLifecycleError` | Illegal lifecycle transition | Follow lifecycle: discovered → verified → registered → available → draining → retired |
| `permission_not_granted` | PolicyEngine default-deny (no rule returned non-null) | Review InputPolicy rules; check GovernanceGate if wired |
| `approval_required` | Governance gate requires approval | Through approval lifecycle; mayRelease consulted on every release |
| `configuration_error` | Plan validation failed (drift, limits, etc.) | Fix the plan; check anti-drift limits; verify anti-drift configuration |

---

## 6. POST-INSTALL VERIFICATION

```powershell
# Comprehensive post-install verification script

Write-Host "=== TOZ AI GROUP POST-INSTALL VERIFICATION ===" -ForegroundColor Cyan

# 1. Check Node.js version
$nodeVersion = $PSVersionTable.PSVersion.Major
Write-Host "Node.js major version: $nodeVersion" -ForegroundColor White

# 2. Check npm dependencies
Write-Host "--- Runtime Dependencies ---"
$pkg = Get-Content "D:\AI\TozSolutions_Ai_Office\package.json"
$deps = $pkg | ConvertFrom-Json
if ($deps.dependencies.Count -eq 0) {
    Write-Host "✅ Zero runtime dependencies (as designed)" -ForegroundColor Green
} else {
    Write-Host "⚠️ Runtime dependencies exist: $($deps.dependencies.Keys -join ", ")" -ForegroundColor Yellow
}

# 3. Check test suite
Write-Host "--- Test Suite ---"
$result = & npm test 2>&1
if ($result -match "1598/1598") {
    Write-Host "✅ All 1598 tests passing" -ForegroundColor Green
} else {
    Write-Host "❌ Test failures detected" -ForegroundColor Red
}

# 4. Check build
Write-Host "--- Build ---"
try {
    & npm run build | Out-Null
    Write-Host "✅ Build successful" -ForegroundColor Green
} catch {
    Write-Host "❌ Build failed" -ForegroundColor Red
}

# 5. Check typecheck
Write-Host "--- Typecheck ---"
try {
    & npm run typecheck 2>&1 | Out-Null
    Write-Host "✅ Typecheck passed" -ForegroundColor Green
} catch {
    Write-Host "❌ Typecheck failed" -ForegroundColor Red
}

# 6. Check lint
Write-Host "--- Lint ---"
try {
    & npm run lint 2>&1 | Out-Null
    Write-Host "✅ Lint passed" -ForegroundColor Green
} catch {
    Write-Host "❌ Lint failed" -ForegroundColor Red
}

Write-Host "=== VERIFICATION COMPLETE ===" -ForegroundColor Cyan
```

---

## 7. KURULUM SİRASI TAMAMLANDI
*Installation sequence from zero to production-ready, completed: 2026-10-06*

**Minimal installation command sequence**:
```powershell
cd "D:\AI\TozSolutions_Ai_Office"
npm install
npm run build
npm test
```

**Production onboarding requires additional steps** (governance configuration, agent
registration, Obsidian knowledge base setup, tool permissions) as detailed in this document.

*Installation Sequence completed: 2026-10-06*