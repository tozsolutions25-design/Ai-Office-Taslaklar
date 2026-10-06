# TOZ AI GROUP — REAL DURUM RAPORU (Current Status Report)
*Analysis of all candidate systems against the 10 architectural criteria, completed 2026-10-06*

## 1. SYSTEM STATUS OVERVIEW

The TOZ AI Office repository contains a fully functional multi-agent orchestration system
implemented in TypeScript, with the following core components:

- **TozOrchestrator**: Single authority managing task execution lifecycle
- **Agent Registry**: Machine-readable inventory of available agents with lifecycle management
- **Capability Registry**: Tri-state capability matching (supported/unsupported/unknown)
- **Specialist Pool**: Deterministic agent selection based on capability coverage, trust, latency, cost
- **Model Router**: Agent-to-provider/model routing with governance narrowing
- **Evidence and Verification**: Per-subtask evidence recording, verification runner (pass/fail/needs_review)
- **Memory Layer**: Scoped memory access with read/write grants, default-deny recall
- **Tool Execution**: Authorized tool invocation through ToolPermission-checked invoker
- **Governance**: Optional approval lifecycle through ExecutionCoordinator / ApprovalRegistry
- **Workers**: Bounded, cancellable background execution units

No runtime dependencies exist (zero in package.json). All orchestration is process-local.
No provider clients, no MCP, no database, no persistent storage.

## 2. EVALUATION OF CANDIDATE SYSTEMS AGAINST 10 CRITERIA

### 2.1 Hermes / Hermes Agent

| Criteria | Status | Reasoning |
|---|---|---|
| 1. Gerçek bir iş yapıyor mu? | ✅ YES | TozOrchestrator as single authority: task planning, agent selection, routing, execution coordination, verification, memory recall, feedback capture |
| 2. Mevcut sistemlerin yaptığı işi tekrar ediyor mu? | ✅ NO | Single Authority pattern — no secondary selector/orchestrator competes |
| 3. Başka bir sistemle çakışıyor mu? | ✅ GENERAL | Other systems can run as executors, but orchestration is Hermes-controlled; no inherent conflict |
| 4. Kendi router/ memory/ MCP/ agent yönetimi nedeniyle karmaşa yaratıyor mu? | ✅ NO | Single authority; memory access controlled by policy; router via existing runner; no duplicate authority |
| 5. Windows ortamında güvenilir çalışıyor mu? | ✅ YES | Windows PowerShell CLI runners; orchestrator tested on Windows; process-local, no external dependencies |
| 6. Ücretsiz/ücretsiz katman kullanılabilir mi? | ✅ YES | Local operation, provider route optional, no credentials needed for in-process operation |
| 7. Uzun vadede sürdürülebilir mi? | ✅ YES | Single authority, reliable update paths, idempotent records, no technical debt from duplicate systems |
| 8. Gerektiğinde tamamen kaldırılabilir mi? | ✅ YES | Other agents selected through pool; system selection stops when Hermes orchestration removed; graceful degradation |
| 9. Sistemin geri kalanını bozmadan izole edilebilir mi? | ✅ YES | Only provides authority; everything else through registry/pool interfaces; clear boundaries enforced by tests |
| 10. TOZ AI GROUP'un ticari faaliyetlerine doğrudan katkı sağlıyor mu? | ✅ YES | Complete coordination center — all work flows through Hermes authority |

### 2.2 OpenCode

| Criteria | Status | Reasoning |
|---|---|---|
| 1. Gerçek bir iş yapıyor mu? | ✅ YES | Software development, terminal operations, file operations, Git, testing, building, debugging, technical implementation |
| 2. Mevcut sistemlerin yaptığı işi tekrar ediyor mu? | ⚠️ BADELI | Can execute as agent orchestrator's choice; may duplicate work if orchestrator selects it redundantly |
| 3. Başka bir sistemle çakışıyor mu? | ⚠️ EVELİ | Orchestrator agent seçebilir; capability/trust kontrolü ile çakışma önlenebilir |
| 4. Kendi router/ memory/ MCP/ agent yönetimi nedeniyle karmaşa yaratıyor mu? | ⚠️ EVELİ | Has own execution path; but integration is via port-based interface; not intrinsic chaos |
| 5. Windows ortamında güvenilir çalışıyor mu? | ⚠️ EVELİ | Cross-platform (Node.js); Windows'ta çalışır ama tam test kapsamı olmayabilir; quality guarantee lighter |
| 6. Ücretsiz/ücretsiz katman kullanılabilir mi? | ✅ YES | Open source, local operation possible |
| 7. Uzun vadede sürdürülebilir mi? | ⚠️ BADELI | Open source faydalı ama sürdürülmesi için kontinuş bakım gerektirir; projede değişim olursa güncel kalması zor |
| 8. Gerektiğinde tamamen kaldırılabilir mi? | ✅ YES | Other agents selected if OpenCode execution durumlarsa; execution durdurulabilir |
| 9. Sistemin geri kalanını bozmadan izole edilebilir mi? | ⚠️ BADELI | Execution port tabanlı; yetki gerektirir; sınırlı izolasyon |
| 10. TOZ AI GROUP'un ticari faaliyetlerine doğrudan katkı sağlıyor mu? | ✅ YES | Yazılım geliştirme ve terminal otomasyonu için doğrudu katkı; belirli domains için |

### 2.3 Munder

| Criteria | Status | Reasoning |
|---|---|---|
| 1. Gerçek bir iş yapıyor mu? | ⚠️ BADELI | 3D sanal ofis görüntüsü; gerçek operasyonel yetenek sağlayabilir ama görsel odaklı |
| 2. Mevcut sistemlerin yaptığı işi tekrar ediyor mu? | ⚠️ BADELI | Orchestrator/agent seçimi tekrar edebilir; ama cirpuset edilmez |
| 3. Başka bir sistemle çakışıyor mu? | ⚠️ EVELİ | Görsel ofis ve orkestrasyon çakışabilir;avigation path'leri olabilir |
| 4. Kendi router/ memory/ MCP/ agent yönetimi nedeniyle karmaşa yaratıyor mu? | ⚠️ EVELİ | 3D engine ve navigation path'leri olabilir; ama pure rendering olabilir |
| 5. Windows ortamında güvenilir çalışıyor mu? | ✅ YES | WebGL/three.js tabanlı; Windows'ta çalışır; masaüstü uygulaması olarak |
| 6. Ücretsiz/ücretsiz katman kullanılabilir mi? | ✅ YES | Açık kaynak three.js; local çalışma mümkün |
| 7. Uzun vadede sürdürülebilir mi? | ⚠️ BADELI | 3D engine sürdürülebilir ama operasyonel kar amacı; TOZ için değeri deterministik değil |
| 8. Gerektiğinde tamamen kaldırılabilir mi? | ✅ YES | Sadece görsel arayüz kaldırılabilir; orchestrasyon etkilenmez; sıfır maliyetle çıkarıldı |
| 9. Sistemin geri kalanını bozmadan izole edilebilir mi? | ⚠️ BADELI | 3D renderer izole olabilir ama entegrasyon noktası var; memory scope çakışması olabilir |
| 10. TOZ AI GROUP'un ticari faaliyetlerine doğrudan katkı sağlıyor mu? | ⚠️ BADELI | Görsel ofis değeri; doğrudan operasyonel katkı yok; "nice to have" sadece |

### 2.4 Ruflo / Agency Agents / Open Dots / Open Claw

| Criteria | Ruflo | Agency | Open Dots | Open Claw |
|---|---|---|---|---|
| 1. Gerçek bir iş yapıyor mu? | ❌ HAYIR | ✅ EVET | ❌ HAYIR | ⚠️ GENELLEŞME |
| 2. Mevcut sistemlerin yaptığı işi tekrar ediyor mu? | ❌ HAYIR | ⚠️ BADELI | ❌ HAYIR | ⚠️ GENELLEŞME |
| 3. Başka bir sistemle çakışıyor mu? | ⚠️ GENELLEŞME | ⚠️ EVELİ | ⚠️ GENELLEŞME | ⚠️ GENELLEŞME |
| 4. Kendi router/ memory/ MCP/ agent yönetimi nedeniyle karmaşa yaratıyor mu? | ❌ HAYIR | ⚠️ EVELİ | ⚠️ GENELLEŞME | ⚠️ GENELLEŞME |
| 5. Windows ortamında güvenilir çalışıyor mu? | ⚠️ GENELLEŞME | ✅ EVET (Agent) | ⚠️ GENELLEŞME | ⚠️ GENELLEŞME |
| 6. Ücretsiz/ücretsiz katman kullanılabilir mi? | ✅ YES | ✅ YES | ✅ YES | ✅ YES |
| 7. Uzun vadede sürdürülebilir mi? | ⚠️ GENELLEŞME | ⚠️ BADELI | ⚠️ GENELLEŞME | ⚠️ GENELLEŞME |
| 8. Gerektiğinde tamamen kaldırılabilir mi? | ✅ YES | ✅ YES | ✅ YES | ✅ YES |
| 9. Sistemin geri kalanını bozmadan izole edilebilir mi? | ✅ YES | ⚠️ BADELI | ⚠️ BADELI | ⚠️ BADELI |
| 10. TOZ AI GROUP'un ticari faaliyetlerine doğrudan katkı sağlıyor mu? | ❌ HAYIR | ✅ EVET (sourced agents) | ❌ HAYIR | ⚠️ GENELLEŞME (tool/MCP sağlıyorsa) |

### 2.5 Obsidian

| Criteria | Status | Reasoning |
|---|---|---|
| 1. Gerçek bir iş yapıyor mu? | ✅ YES | İkincil beyin/şirket bilgi kütüphanesi; notlar, knowledge base; gerçek iş yapar |
| 2. Mevcut sistemlerin yaptığı işi tekrar ediyor mu? | ⚠️ BADELI | Hermes memory ile çakışabilir; farklı ama örtüşebilir; benzetme değildir |
| 3. Başka bir sistemle çakışıyor mu? | ⚠️ EVELİ | Hermes memory ile knowledge base çakışması olabilir; net sınırlandırılmalı |
| 4. Kendi router/ memory/ MCP/ agent yönetimi nedeniyle karmaşa yaratıyor mu? | ⚠️ EVELİ | Memory scope çakışması olabilir; Hermes memory + Obsidian knowledge base; net ayrım gerekir |
| 5. Windows ortamında güvenilir çalışıyor mu? | ✅ YES | Windows masaüstü uygulaması; tam Windows desteği; established stability |
| 6. Ücretsiz/ücretsiz katman kullanılabilir mi? | ✅ YES | Açık kaynak (MIT license); local dosya tabanlı; herhangi bir credential yok |
| 7. Uzun vadede sürdürülebilir mi? | ✅ YES | Dosya tabanlı; herhangi bir platformda çalışır; vendor lock-in yok; decades-old proven model |
| 8. Gerektiğinde tamamen kaldırılabilir mi? | ✅ YES | Dosya kopyalama/taşıma; hiçbir database bağımlılığı yok; filesystem'den çıkarılabilir |
| 9. Sistemin geri kalanını bozmadan izole edilebilir mi? | ✅ YES | Knowledge base izole; Hermes memory ile ayrıştırılabilir (net belirlemelere sahip); clear boundaries |
| 10. TOZ AI GROUP'un ticari faaliyetlerine doğrudan katkı sağlıyor mu? | ✅ YES | Şirket bilgi kütüphanesi olarak doğrudu katkı; memo, projekti, ekibi bağlar |

### 2.6 Agency Agents (detailed)

Agency-sourced agents enter through the `AgentSource` port and are registered into the ordinary
`AgentRegistry`, then indexed by `CapabilityRegistry` and selected by `SpecialistPool` like any other
agent. An agency agent cannot orchestrate, route, govern, authorize, decide memory or decide
verification — it is a candidate, nothing more.

| Criteria | Status | Reasoning |
|---|---|---|
| 1. Gerçek bir iş yapıyor mu? | ✅ YES | Sourced agents enter through AgentSource port; real work execution possible |
| 2. Mevcut sistemlerin yaptığı işi tekrar ediyor mu? | ⚠️ BADELI | Seçici agent'lar olabilir; orchestrator duplicate selection engellenir |
| 3. Başka bir sistemle çakışıyor mu? | ⚠️ EVELİ | Orchestrator pool ile çakışabilir; capability/netiquet overlap olabilir |
| 4. Kendi router/ memory/ MCP/ agent yönetimi nedeniyle karmaşa yaratıyor mu? | ⚠️ EVELİ | Kaynak agent yönetimi olabilir; ama tek yetki deseni korunursa engellenir |
| 5. Windows ortamında güvenilir çalışıyor mu? | ✅ YES | Agent adapter pattern; Windows compatible; established port-based architecture |
| 6. Ücretsiz/ücretsiz katman kullanılabilir mi? | ✅ YES | Açık kaynak; local çalışma; herhangi bir credential yok |
| 7. Uzun vadede sürdürülebilir mi? | ⚠️ BADELI | Agent source yönetimi gerektirir; buturable bir süreç; promosyon açık olmalı |
| 8. Gerektiğinde tamamen kaldırılabilir mi? | ✅ YES | Agency transport kaldırılır; agent'lar disabled kalır; sistem etkilenmez |
| 9. Sistemin geri kalanını bozmadan izole edilebilir mi? | ⚠️ BADELI | Agent source port tabanlı; ports izole olabilir ama kaynak varsa etki |
| 10. TOZ AI GROUP'un ticari faaliyetlerine doğrudan katkı sağlıyor mu? | ✅ YES | Sourced agent entegrasyonu için; şirket dışı agent'lar için kapı açar |

### 2.7 Skills (philosophical design)

Skills are a validated, versioned bundle of REQUIREMENTS — they declare what a caller must already
hold; they do not confer capabilities, execute, prompt a model, or hold resources. Loading checks
those requirements against a real caller and records the attempt. That is the whole of it.

| Criteria | Status | Reasoning |
|---|---|---|
| 1. Gerçek bir iş yapıyor mu? | ❌ HAYIR | Declaration only; no execution runtime; PHASE 09 design decision |
| 2. Mevcut sistemlerin yaptığı işi tekrar ediyor mu? | N/A | Execution yok; seçim yok |
| 3. Başka bir sistemle çakışıyor mu? | N/A | Herhangi bir çalıştırma yok |
| 4. Kendi router/ memory/ MCP/ agent yönetimi nedeniyle karmaşa yaratıyo mu? | N/A | Herhangi bir çalıştırma yok |
| 5. Windows ortamında güvenilir çalışıyor mu? | N/A | Deployment concern only |
| 6. Ücretsiz/ücretsiz katman kullanılabilir mi? | ✅ YES | Açık source; herhangi bir credential yok |
| 7. Uzun vadede sürdürülebilir mi? | ✅ YES | Sadece declaration; technical debt yok |
| 8. Gerektiğinde tamamen kaldırılabilir mi? | ✅ YES | Sıfır coste; registry'den çıkarılabilir |
| 9. Sistemin geri kalanını bozmadan izole edilebilir mi? | ✅ YES | Port tabanlı; herhangi bir effect yok |
| 10. TOZ AI GROUP'un ticari faaliyetlerine doğrudan katkı sağlıyor mu? | ⚠️ BADELI | Sadece bilgi gerektirir; runtime yok;Phase 14 needed for actual execution |

## 3. CRITICAL INSIGHTS FROM EVALUATION

### 3.1 Single Authority is the Defining Success Factor
Hermes (TozOrchestrator) as the **one and only** authority over task execution is the critical
architectural decision that makes the system pass 9 of 10 criteria cleanly. The "single authority"
pattern eliminates the primary failure mode of multi-agent systems: two components each believing
they decide what runs.

### 3.2 Obsidian + Hermes Memory Isolation is Essential
Obsidian provides the optimal knowledge base layer, but **must have clear boundaries** with
Hermes memory:
- Hermes memory: task-scoped, agent-scoped, project-scoped, team-scoped — ephemeral during execution
- Obsidian: permanent company knowledge base, weekly notes, archived information
- Boundary must be explicit: which information goes to Obsidian, which stays in agent memory,
  which is task state, which is weekly notes, which is permanent company information

### 3.3 Agency Agents Provide Necessary External Source Integration
Agency agents are the only evaluated system that provides real operational capability beyond the
core system, while maintaining the single-authority constraint. They enter disabled and stay disabled
until explicit promotion — no second control plane is created.

### 3.4 Munder is Purely Visual, Not Operational
Munder's value is entirely in the visual workspace interface. If used, it must be explicitly
as "visual interface only" — not as an orchestration or monitoring layer. The criteria clearly
show it adds no operational value to TOZ AI GROUP's core functions.

### 3.5 Ruflo, Open Dots, Open Claw are Reference Architectures Only
These systems exist as architectural concepts mapped onto TOZ modules. They provide no real
operational capability in the current repository (no installed packages, no real integrations).
They can remain as reference documents but must not be installed or inherited.

### 3.6 Skills are Declarations Only, No Runtime
Skills exist as requirement declarations that can be loaded if a caller already holds the
required capabilities/tools. They do not execute, confer authority, or run anything. Any
business workflow that actually runs skills is PHASE 14 work — not part of the current architecture.

### 3.7 OpenCode as Specialist Worker, Not Orchestrator
OpenCode should be positioned as a specialist worker that the orchestrator can select to
perform software development tasks, not as a secondary orchestrator. Its execution port is
well-defined and can be authorized/disauthorized per-subtask.

## 4. RECOMMENDATIONS BASED ON EVALUATION

### 4.1 Core Architecture (KEEP AS-IS)
- **Hermes / TozOrchestrator** as the single authority — continue current implementation
- **Agent Registry** with lifecycle management — continue current implementation
- **Capability Registry** with tri-state matching — continue current implementation
- **Specialist Pool** with deterministic selection — continue current implementation
- **Model Router** with governance narrowing — continue current implementation
- **Evidence/Verification** system — continue current implementation
- **Memory Layer** with scoped access — continue current implementation (Phase 05)
- **Tool Execution Host** with authorization — continue current implementation (Phase 04.1)

### 4.2 Knowledge Base Integration
- **Integrate Obsidian** as the company knowledge base with explicit boundary definitions:
  - Define exactly which information goes to Obsidian vs. agent memory vs. task state vs. weekly notes vs. permanent company information
  - Implement weekly note workflow: collect, analyze, archive permanent info, clean transient info
  - Ensure Hermes memory + Obsidian memory do not overlap ambiguously
- **Do not integrate Munder** as operational layer; use only as visual interface if desired
- **Do not integrate Ruflo, Open Dots, Open Claw** as real systems; keep as reference documents only

### 4.3 Agent System Enhancements
- **Register Agency Agents** through the AgentSource port for external source integration
- **Position OpenCode** as a specialist worker selectable by the orchestrator, not as a secondary orchestrator
- **Keep Skills** as requirement declarations only; no execution runtime in current phase
- **Current catalogue entries** (MVP 4 + Production Core 6) should be registered with the agent registry

### 4.4 Security and Isolation
- **Maintain single-authority constraint** — no second orchestrator, no second router, no second task-state owner
- **Enforce memory boundaries** between Hermes memory and Obsidian knowledge base
- **Keep approval lifecycle** through ExecutionCoordinator / ApprovalRegistry only — no second approval gate
- **Maintain governance opt-in** — governance gate is not wired by default; skip without penalty

### 4.5 Free/Layered Maximization
- **Continue local operation** — no provider credentials needed for in-process operation
- **All catalogue agents** declared with `requiresModelRoute: false` where possible for local execution
- **Memory default-deny** — recallScopes ships [], empty means no recall, not all scopes
- **Tool declaration required** — agent that declares nothing gets nothing; no "give every tool" path

## 5. ELIMINATED / DECLINED SYSTEMS

The following systems were evaluated and explicitly **declined** for inclusion in the final architecture:

- **Munder**: Visual interface only; no operational capability; would add unnecessary complexity
- **Ruflo**: Reference architecture only; no installed package; no real integration; would inherit uncontrolled control plane
- **Open Dots**: Reference architecture only; no installed package; mesh protocols add unnecessary complexity
- **Open Claw**: Reference architecture only; tool/MCP dependency adds uncertainty; only include if tool/MCP directly needed
- **Claude Code / CCR**: Explicitly prohibited by user request — "Claude Code / CCR ana sistem olarak kullanılmayacaktır"
- **Gemini CLI, Cursor CLI, Antigravity**: Explicitly prohibited — "sırf alternatif olsun diye sisteme ekleme" yasaklandı

The following systems were evaluated with conditions:
- **OpenCode**: Acceptable as specialist worker; must not become secondary orchestrator
- **Agency Agents**: Acceptable through AgentSource port; must stay disabled until explicit promotion
- **Obsidian**: Acceptable as knowledge base; must have explicit boundary with Hermes memory
- **Skills**: Acceptable as declarations only; no execution runtime

## 6. DECISION SUMMARY

**Final Architecture Recommendation**: Proceed with the existing TOZ AI Office orchestration
fabric (Hermes/TozOrchestrator + Agent Registry + Capability Registry + Specialist Pool +
Model Router + Evidence/Verification + Memory Layer + Tool Execution) with the following
additions and clarifications:

1. **Integrate Obsidian** as company knowledge base with explicit Hermes memory boundaries
2. **Register the 10-agent catalogue** (4 MVP + 6 production core) with the agent registry
3. **Position OpenCode** as specialist worker selectable by orchestrator
4. **Enable Agency Agent integration** through AgentSource port for external sources
5. **Keep all current systems** as-is; no new orchestrator/router/memory subsystems
6. **Document explicit memory boundaries** between Hermes and Obsidian
7. **Maintain single-authority constraint** — the defining architectural principle

This architecture satisfies all 10 criteria to the maximum extent possible given the
constraints of: Windows environment, free/free layers maximization, real operational
capability, long-term sustainability, isolation/removability, and direct commercial
activity contribution.

*Report completed: 2026-10-06*