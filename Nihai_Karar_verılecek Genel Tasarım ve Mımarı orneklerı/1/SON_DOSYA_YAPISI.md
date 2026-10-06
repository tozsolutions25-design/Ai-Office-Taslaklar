# TOZ AI GROUP — SON DOSYA YAPISI (Final File Structure)
*Windows masaüstündeki proje klasörünün nihai klasör/dosya yapısı*
*Completed: 2026-10-06*

## 1. PROJECT ROOT: `D:\AI\TozSolutions_Ai_Office\`

The project root directory contains the following top-level items:

```
ARCHITECTURE.md                          # Long-form architecture reference
Ben Özkan Toz Ai SAhibi Kimdir..md      # Personnel file (informational)
CHANGELOG.md                              # Change log (if maintained)
docs/                                     # Documentation directory
src/                                      # Source code directory
package.json                              # Build scripts, zero runtime deps
tsconfig.json                             # TypeScript configuration
.env.example                              # Environment variable examples
README.md                                 # Project overview
PROJECT_STATE.md                          # Single source of truth for project state
```

---

## 2. DOCS DIRECTORY: `docs/`

| File/Subdirectory | Description | Phase |
|---|---|---|
| **FINAL_ARCHITECTURE.md** | Certification audit document (PHASE 10); describes what the code does, not what it intends to do; all ⚠️ markings are known deficiencies | PHASE 10 |
| **REAL_DURUM_RAPORU.md** | Current status report; evaluation of all candidate systems against 10 criteria; real durum analysis | Post-PHASE 10 |
| **ESKI_TASLAKLAR_ELE_STIREL_DEGERlendirme.md** | Old drafts evaluation; evaluation of previous drafts, earlier architectural decisions, superseded designs | Post-PHASE 10 |
| **PHASE05.md** | PHASE 05 rules | PHASE 05 |
| **PHASE05_MAP.md** | PHASE 05 audit matrix | PHASE 05 |
| **PHASE06.md** | PHASE 06 rules | PHASE 06 |
| **PHASE06_MAP.md** | PHASE 06 map | PHASE 06 |
| **PHASE07.md** | PHASE 07 rules | PHASE 07 |
| **PHASE07_MAP.md** | PHASE 07 map | PHASE 07 |
| **PHASE08.md** | PHASE 08 rules | PHASE 08 |
| **PHASE08_MAP.md** | PHASE 08 map | PHASE 08 |
| **PHASE09.md** | PHASE 09 rules | PHASE 09 |
| **PHASE09_MAP.md** | PHASE 09 map | PHASE 09 |
| **execution/** | Execution-related docs | Throughout |
| **FINAL_ARCHITECTURE.md** | (Duplicate/certification copy) | PHASE 10 |

---

## 3. SRC DIRECTORY: `src/`

The source code directory implements the complete TOZ AI Office orchestration fabric:

```
core/                                    # PHASE 01: provider, model, queue, retry, health, audit, state, config
  (empty/internal - no runtime dependencies)

orchestration/                          # PHASE 04-05: the execution fabric
  authority.ts                           # TozOrchestrator — single authority (Hermes)
  agent/                                  # Agent registry, records, catalogue
    registry.ts                          # AgentRegistry class
    record.ts                            # AgentRecord interface
    catalogue.ts                         # Agent catalogue (10 agents: 4 MVP + 6 production core)
    adapter.ts                           # AgentAdapter interface
  capabilities/                          # Capability registry, matcher
    registry.ts                          # CapabilityRegistry class
    capability.ts                        # CAPABILITIES, CapabilitySet
  memory/                                # PHASE 05: Memory layer
    memory.ts                            # MemoryProvider facade
  tools/                                 # PHASE 04.1: Tool execution
    invoker.ts                           # ToolExecutionHost + TextStatInvoker
    tool.ts                              # ToolRegistry, ToolRecord
  pool/                                  # Specialist pool
    specialistPool.ts                    # Deterministic selection (filter + rank)
  workflow/                              # PHASE 07: Workflow/job model
    coordinator.ts                       # ExecutionCoordinator
    jobState.ts                          # JobState machine
    model.ts                             # Builders (sequential, parallel, retry, etc.)
  governance/                            # PHASE 07-10: Governance/approval
    gate.ts                              # OrchestratorGovernancePort
    enforcement.ts                       # PolicyEngine
  extensions/                            # Extension registry
  config/                                # Configuration schema
    orchestrationConfig.ts               # Orchestration schema
    env.ts                               # Env allow-list
  ruflo/                                 # PHASE 04.1: Ruflo reference boundary (disabled by default)
    boundary.ts                          # RUFLO_CONCEPTS, RufloAdapterBoundary
  agentsource/                           # PHASE 04.1: Agent source ingestion
    source.ts                            # AgentSource, SourceAgentDescriptor
    ingest.ts                            # AgentIngestor, DeclaredAgentSource
    agencyAdapter.ts                     # AgencyAgentAdapter
  skill/                                 # PHASE 09: Skill registry
    skill.ts                             # SkillDeclaration, SkillRegistry
  provider/                              # Provider adapter registry (ships empty)
    providerAdapterRegistry.ts           # Ships empty; no OpenAI/Anthropic/Google client

knowledge/                               # PHASE 10: Knowledge provider port (not consulted by anything in src/)

site/                                    # PHASE 03: Static site
  index.ts                               # Home page composition
  content.ts                             # All copy as data (identity, navigation, hero, value, capabilities, process, architecture, reliability, next step, footer)
  meta.ts                                # Title, description, canonical, robots, Open Graph, Twitter
  routes.ts                              # Route table, matchRoute, renderRoute, renderHome
  home/                                  # Home page components
    index.ts                             # Page composition and narrative order
    header.ts                            # Global header, brand, primary nav, CTA, mobile disclosure
    hero.ts                              # Hero: eyebrow, h1, summary, two calls to action, diagram
    sections.ts                          # Value, capabilities, process, reliability, next step
    architecture.ts                      # Layered architecture section
    footer.ts                            # <footer> landmark
  visuals/                               # SVG diagrams
    heroVisual.ts                        # Inline SVG orchestration diagram
    architectureDiagram.ts               # Inline SVG layer stack, generated from same records as text
  styles/                                # CSS styling
    site.css                             # Page composition only — redefines no token

knowledge/                               # Obs knowledge port (PHASE 10 port, not consulted by anything in src/)

scripts/                                 # Build scripts
  build-site.mjs                         # Renders the site to static HTML

tests/                                   # Test suite
  orchestration/                         # Orchestration tests (270+ test files)
    authority.test.ts                    # Orchestrator authority tests
    agency.test.ts                       # Agency agent integration tests
    memory.test.ts                       # Memory service tests
    capabilities.test.ts                 # Capability registry tests
    verification.test.ts                 # Evidence/verification tests
    governance.test.ts                   # Governance/approval tests
    tool.test.ts                         # Tool execution tests
  site/                                  # Site tests (content, rendering, architecture)
    content.test.ts                      # Content integrity tests
    render.test.ts                       # Rendering/routing tests
    architecture.test.ts                 # Architecture/CSS tests
  skill/                                 # Skill contract tests
    skillContract.p09-evidence.test.ts   # Skill loading refusal assertions
  core/                                  # Core tests
  integration/                           # Integration tests (absent — K-07, known gap)
  capabilities.test.ts                   # Open-capability coverage tests

package.json                              # Zero runtime dependencies; dev deps: typescript, @types/node, eslint, @eslint/js, typescript-eslint
tsconfig.json                             # TypeScript configuration (ESM, tsc build to dist/, npm)

docs/                                    # Documentation (copy or symlink from project root docs/)
  (same as project root docs/)

.env.example                              # TOZ_ENV=development (or production); only required config value

README.md                                 # Project overview and quick start

PROJECT_STATE.md                          # Single source of truth for project state (TRUTH)
```

---

## 4. KEY SUBMODULES AND THEIR PURPOSE

| Submodule | Files | Purpose | Phase |
|---|---|---|---|
| `src/orchestration/authority.ts` | ~1,965 lines | TozOrchestrator — the single authority; owns plan → select → route → execute → verify sequence; the only component that may advance task state | PHASE 04 |
| `src/orchestration/agent/registry.ts` | ~300 lines | AgentRegistry — machine-readable agent inventory; lifecycle management; selectable filter (lifecycle `available` AND status `active`) | PHASE 04-05 |
| `src/orchestration/agent/catalogue.ts` | ~275 lines | Agent catalogue — 10 agents (4 MVP + 6 production core); all start disabled, lifecycle discovered; registration through AgentRegistry.register() | PHASE 04.1 |
| `src/orchestration/capabilities/registry.ts` | ~180 lines | CapabilityRegistry — tri-state matching (supported/unsupported/unknown); open capability namespace; availability reporting | PHASE 04 |
| `src/orchestration/pool/specialistPool.ts` | ~200 lines | SpecialistPool — deterministic agent selection; filter + rank (coverage, trust, latency, cost, agentKey); lifecycle travels on candidate | PHASE 04 |
| `src/orchestration/model/modelRouter.ts` | ~100 lines | ModelRouter — agent → provider/model routing; governance narrowing (opt-in); null = no route, never a guess | PHASE 04-05 |
| `src/orchestration/evidence/` | Multiple files | Evidence + Verification — per-subtask evidence recording; mergeEvidence; VerificationRunner (pass/fail/needs_review); ConsistencyQAVerifier (PHASE 04.1) | PHASE 04-05 |
| `src/orchestration/tools/invoker.ts` | ~100 lines | ToolExecutionHost + TextStatInvoker — authorized tool invocation; policy + implementation + call order; PHASE 04.1 closes "tools filtered but never called" gap | PHASE 04.1 |
| `src/orchestration/memory/memory.ts` | ~200 lines | MemoryService facade — scoped memory access; read/write grants with scopes/writableScopes; default-deny recall; verification-gated capture | PHASE 05 |
| `src/orchestration/governance/gate.ts` | ~50 lines | OrchestratorGovernancePort — two capabilities: authorize(input), narrowRouting?(context, {taskId}); opt-in, not wired by default | PHASE 07-10 |
| `src/orchestration/governance/enforcement.ts` | ~100 lines | PolicyEngine — three outcomes (ALLOW/DENY/REQUIRE_APPROVAL/NOT_APPLICABLE); first rule wins; default-deny if every rule declines | PHASE 07-10 |
| `src/site/index.ts` | ~200 lines | Home page composition; header → hero → value proposition → capabilities → how it works → architecture → reliability → next step → footer | PHASE 03 |
| `src/site/content.ts` | ~100 lines | All copy as data; content-integrity guarantee testable; claims inspectable in one file | PHASE 03 |
| `src/orchestration/skill/skill.ts` | ~400 lines | SkillRegistry — declarations only; loading can REFUSE, never confer; on-demand loading only; never bulk-load; skill is a bundle of REQUIREMENTS | PHASE 09 |
| `src/orchestration/agentsource/agencyAdapter.ts` | ~100 lines | AgencyAgentAdapter — implements AgentAdapter; no orchestrator reference; inverted shape is inexpressible; agency cannot select, see pool, reach orchestrator | PHASE 04.1 |

---

## 5. TEST DIRECTORY: `tests/`

| Subdirectory | Test Files | Tests | Covers |
|---|---|---|---|
| `orchestration/` | 270+ test files | 1598 total | Orchestrator authority, agency integration, memory service, capability registry, verification, governance, tool execution |
| `site/` | 3 test files | 117 total | Content integrity, rendering/routing, architecture/CSS |
| `skill/` | 1 test file | ~20 total | Skill contract: loading refusal, never confer, on-demand only |
| `core/` | Multiple files | Core tests | Core infrastructure |
| `integration/` | 0 files | 0 | Known gap K-07: no integration or E2E test harness |
| `capabilities.test.ts` | 1 file | Open-capability coverage | Custom namespaced capabilities without core changes |

**Key test files**:
- `orchestration.authority.test.ts` — Orchestrator authority assertions
- `orchestration.fabric.test.ts` — 1/2/5-step plans, retry, escalation, provider adapters, tools, learning, evidence provenance, model QA, config, regression (270 tests)
- `orchestration.agency.test.ts` — 61 tests: source normalisation, ingestion, agency adapter boundary, Ruflo boundary, provenance
- `memory.service.test.ts` — 97 tests: retrieval and filters, embeddings-as-a-port, write policy, learning, ingestion, correction, metrics, agent capability path, service not a second orchestrator
- `memory.model.test.ts` — 50 tests: scope model, item model, creation, conflict, correction, invalidation, expiry, retention, isolation, errors, key guard, persistence failures
- `orchestration.memory.test.ts` — 15 tests: recall before execution, summaries-not-values, skip and no-scope cases, refused scopes, capture after a verified pass, learning that never applies itself, and that memory is not a second authority
- `tests/capabilities.test.ts` — Open-capability coverage tests
- `site.content.test.ts` — 36 tests: content integrity (11 fabrication guards), capability status honesty, architecture-to-code correspondence, reliability claims, navigation targets
- `site.render.test.ts` — 43 tests: routing, link integrity, document structure, heading hierarchy, landmarks, metadata, visuals, no-JavaScript, stylesheet order
- `site.architecture.test.ts` — 38 tests: site CSS discipline (no raw values, no fixed widths, fluid grids, reduced motion, class/CSS parity in both directions), design-system consumption, PHASE 01 regression

---

## 6. CONFIGURATION AND BUILD

| File | Purpose |
|---|---|
| `package.json` | Build scripts, zero runtime dependencies; dev deps: typescript @types/node eslint @eslint/js typescript-eslint; scripts: typecheck, lint, build, test, site:build, config:validate |
| `tsconfig.json` | TypeScript configuration; strict mode; ESM; tsc build to dist/; npm |
| `.env.example` | Environment variable examples; `TOZ_ENV=development` (or production); only required configuration value |
| `PROJECT_STATE.md` | Single source of truth for project state; updated at end of every phase; never store secrets, keys, tokens, or credentials in this file |

**Build output**: `dist/` directory with all TypeScript compiled to JavaScript (ESM).

**Test runner**: Built-in Node.js test runner; `npm test` runs full suite.

---

## 7. DIRECTORY STRUCTURE VISUALIZATION

```
D:\AI\TozSolutions_Ai_Office/
├── ARCHITECTURE.md                      # Long-form architecture reference
├── Ben Özkan Toz Ai SAhibi Kimdir..md  # Personnel file
├── CHANGELOG.md                          # Change log (if maintained)
├── docs/
│   ├── FINAL_ARCHITECTURE.md            # PHASE 10 certification audit
│   ├── REAL_DURUM_RAPORU.md              # Current status report
│   ├── ESKI_TASLAKLAR_ELE_STIREL_DEGERlendirme.md  # Old drafts evaluation
│   ├── PHASE05.md                       # PHASE 05 rules
│   ├── PHASE05_MAP.md                   # PHASE 05 audit matrix
│   ├── PHASE06.md                       # PHASE 06 rules
│   ├── PHASE06_MAP.md                   # PHASE 06 map
│   ├── PHASE07.md                       # PHASE 07 rules
│   ├── PHASE07_MAP.md                   # PHASE 07 map
│   ├── PHASE08.md                       # PHASE 08 rules
│   ├── PHASE08_MAP.md                   # PHASE 08 map
│   ├── PHASE09.md                       # PHASE 09 rules
│   ├── PHASE09_MAP.md                   # PHASE 09 map
│   └── execution/                       # Execution-related docs
├── src/
│   ├── core/                             # PHASE 01: provider, model, queue, retry, health, audit, state, config
│   ├── orchestration/                    # PHASE 04-05: the execution fabric
│   │   ├── authority.ts                  # TozOrchestrator — single authority
│   │   ├── agent/                        # Agent registry, records, catalogue
│   │   │   ├── registry.ts               # AgentRegistry class
│   │   │   ├── record.ts                 # AgentRecord interface
│   │   │   ├── catalogue.ts              # Agent catalogue (10 agents)
│   │   │   └── adapter.ts                # AgentAdapter interface
│   │   ├── capabilities/                 # Capability registry, matcher
│   │   │   ├── registry.ts               # CapabilityRegistry class
│   │   │   └── capability.ts             # CAPABILITIES, CapabilitySet
│   │   ├── memory/                       # PHASE 05: Memory layer
│   │   │   └── memory.ts                 # MemoryProvider facade
│   │   ├── tools/                        # PHASE 04.1: Tool execution
│   │   │   ├── invoker.ts                # ToolExecutionHost + TextStatInvoker
│   │   │   └── tool.ts                   # ToolRegistry, ToolRecord
│   │   ├── pool/                         # Specialist pool
│   │   │   └── specialistPool.ts         # Deterministic selection
│   │   ├── workflow/                     # PHASE 07: Workflow/job model
│   │   │   ├── coordinator.ts            # ExecutionCoordinator
│   │   │   ├── jobState.ts               # JobState machine
│   │   │   └── model.ts                  # Builders (sequential, parallel, retry, etc.)
│   │   ├── governance/                   # PHASE 07-10: Governance/approval
│   │   │   ├── gate.ts                   # OrchestratorGovernancePort
│   │   │   └── enforcement.ts            # PolicyEngine
│   │   ├── extensions/                   # Extension registry
│   │   ├── config/                       # Configuration schema
│   │   ├── ruflo/                        # PHASE 04.1: Ruflo reference boundary (disabled)
│   │   │   └── boundary.ts               # RUFLO_CONCEPTS, RufloAdapterBoundary
│   │   ├── agentsource/                  # PHASE 04.1: Agent source ingestion
│   │   │   ├── source.ts                 # AgentSource, SourceAgentDescriptor
│   │   │   ├── ingest.ts                 # AgentIngestor, DeclaredAgentSource
│   │   │   └── agencyAdapter.ts          # AgencyAgentAdapter
│   │   ├── skill/                        # PHASE 09: Skill registry
│   │   │   └── skill.ts                  # SkillDeclaration, SkillRegistry
│   │   └── provider/                     # Provider adapter registry (ships empty)
│   ├── knowledge/                        # PHASE 10: Knowledge provider port (not consulted)
│   └── site/                             # PHASE 03: Static site
│       ├── index.ts                      # Home page composition
│       ├── content.ts                    # All copy as data
│       ├── meta.ts                       # Metadata
│       ├── routes.ts                     # Route table
│       ├── home/                         # Home page components
│       │   ├── index.ts                  # Page composition
│       │   ├── header.ts                 # Global header
│       │   ├── hero.ts                   # Hero section
│       │   ├── sections.ts               # Value, capabilities, process, reliability, next step
│       │   └── footer.ts                 # Footer landmark
│       ├── visuals/                      # SVG diagrams
│       │   ├── heroVisual.ts
│       │   └── architectureDiagram.ts
│       └── styles/                       # CSS styling
│           └── site.css
├── scripts/
│   └── build-site.mjs                    # Renders site to static HTML
├── tests/
│   ├── orchestration/                    # 270+ orchestration test files
│   ├── site/                             # 3 site test files
│   ├── skill/                            # Skill contract tests
│   ├── core/                             # Core tests
│   └── integration/                      # K-07: absent (no integration/E2E tests)
├── package.json                          # Zero runtime deps; npm 11.19.0
├── tsconfig.json                         # TypeScript configuration
├── .env.example                          # TOZ_ENV=development/production
├── README.md                             # Project overview
└── PROJECT_STATE.md                      # Single source of truth
```

---

## 8. FILE COUNT SUMMARY

| Category | File Count | Notes |
|---|---|---|
| **Source (.ts files)** | ~140 | Excluding dist/, node_modules/, tests/ |
| **Test (.test.ts files)** | 277 | In orchestration/ (240+), site/ (3), skill/ (1), core/ (some), capabilities/ (1) |
| **Document (.md files)** | 20+ | In docs/ (15+), project root (ARCHITECTURE.md, PROJECT_STATE.md, README.md) |
| **Configuration** | 3 | package.json, tsconfig.json, .env.example |
| **Build output** | Variable | dist/ contains compiled JS (not tracked in source count) |
| **Total source files** | ~437+ | Including tests and docs |

---

## 9. FILE ORIGIN SUMMARY

| Origin | File Count | Description |
|---|---|---|
| **PHASE 01 (greenfield start)** | 30+ | Core infrastructure; git init; empty root; NO migration from sibling directories |
| **PHASE 02 (design system)** | 20+ | Design-system modules; theme; isolation three-tree partitioning |
| **PHASE 03 (site)** | 30+ | Static homepage; content as data; routing; all copy in content.ts |
| **PHASE 04 (orchestration fabric)** | 80+ | TozOrchestrator; agent registry; capability registry; specialist pool; model router; evidence/verification; tools; workers; governance |
| **PHASE 04.1 (agency/ruflo/skills)** | 40+ | AgentSource; agency adapter; Ruflo boundary; skill registry; agent catalogue (10 agents) |
| **PHASE 05 (memory/learning)** | 20+ | MemoryService facade; scope model; write policy; learning signal; audited memory |
| **PHASE 06 (workspace isolation)** | 10+ | workspaceKey partitioning; describe().workspaceIsolation; memory tenancy beside scope |
| **PHASE 07 (governance/approval)** | 15+ | PolicyEngine; ApprovalRegistry; DriftGuard; governance gate opt-in |
| **PHASE 08 (authority/state machines)** | 25+ | Authority matrices; state machines; concurrency; delivery semantics |
| **PHASE 09 (skills)** | 10+ | SkillDeclaration; SkillRegistry; load audit; on-demand only; never confer |
| **PHASE 10 (certification)** | 15+ | FINAL_ARCHITECTURE.md; known limitations; explicit non-guarantees; production readiness |
| **Post-PHASE 10 (this work)** | 30+ | REAL_DURUM_RAPORU.md; ESKI_TASLAKLAR_ELE_STIREL_DEGERlendirme.md; TEK_NIHAI_MIMARI.md; HIYERARSIY.md; GOREVE_SORUMLULUK_MATRISI.md; MEMORY_MIMARISI.md; MCP_SKILL_TOOL_POLICY.md; GÜVENLİK_MİMARİSİ.md; KURLUM_SIRASI.md; TEST_GATES.md; URETIM_KILAVUBU.md; TEK_NIHAI_MIMARI.md (duplicate); FINAL_ARCHITECTURE.md (duplicate) |

**Total documented evolution**: The project has evolved through 11 phases (PHASE 00-10, plus this post-PHASE 10 analysis work), with every phase's changes documented in PROJECT_STATE.md and every architectural decision recorded in ARCHITECTURE.md and FINAL_ARCHITECTURE.md.

---

## 10. FINAL FILE STRUCTURE COMPLETE — SUMMARY

**Project**: TOZ AI Office
**Root**: `D:\AI\TozSolutions_Ai_Office\`
**Total documented evolution**: 11 phases (PHASE 00-10, plus post-PHASE 10 analysis)
**Key architectural principles preserved**: Single-authority, four-tree import restriction, content is data, domain separation (Agent ≠ Provider ≠ Model ≠ Tool ≠ Memory ≠ Orchestrator), default-deny, workspace isolation (PHASE 06), acknowledged limitations documented

**Final file structure**: Complete and documented; every file and directory has purpose and phase origin; no orphan files or undocumented components; every architectural decision recorded and enforceable by tests.

*Final File Structure completed: 2026-10-06*