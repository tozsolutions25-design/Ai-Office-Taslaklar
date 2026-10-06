# TOZ AI OFFICE — PROJECT STATE

> Single source of truth for project state.
> Update at the end of every phase.
> **Never store secrets, keys, tokens, or credentials in this file.**

---

## 1. IDENTITY

| Field | Value |
|---|---|
| System name | TOZ AI Office |
| Project root | `D:\AI\TozSolutions_Ai_Office` |
| OpenCode version | `1.18.32` |
| **Project status** | **CLOSED** — all planned work delivered; see §22 for the closure record |
| Final commit | `c17bed2` (product surface) on top of `141db40` (PHASE 10 certification) |
| Phase status | **PHASE 01–10 complete, and the §13 inner pages delivered. There is no PHASE 11.** |
| Canonical architecture | **`docs/FINAL_ARCHITECTURE.md`** |
| PHASE 00 status | PASS |
| PHASE 01 status | PASS |
| PHASE 02 status | PASS |
| PHASE 03 status | PASS |
| PHASE 04 (orchestration) status | **PASS** — typecheck, lint, 906/906 tests |
| PHASE 04.1 (integration) status | **PASS** — typecheck, lint, 1093/1093 tests |
| PHASE 05 (memory/learning) status | **PASS** — commit `c8648a6` |
| PHASE 06 (routing) status | **PASS** — commit `5d0fce0` |
| PHASE 07 (workflow/background) status | **PASS** — commit `5d0fce0` |
| PHASE 08 (governance/control plane) status | **PASS** — commit `db05b24` |
| PHASE 09 (production hardening) status | **PASS** — commit `b9409f1` |
| PHASE 10 (certification) status | **PASS** — commit `141db40` (4 defects fixed, 16 limitations documented) |
| Product surface (§13 inner pages) status | **PASS** — commits `17f2ead`, `c17bed2` |
| Latest validated test count | **1598/1598** across 240 suites, 0 skipped, 0 todo |
| Open known gaps | **5** — K-09, K-10, K-11, K-12, K-13 (see §13.3 and §22.2) |
| Last updated | 2026-09-29 |

### 1.1 The one-line state of the system

> Governance is **ENFORCED** in the execution path (PHASE 09). PHASE 10 audited
> the whole system, found and **fixed a fail-open cross-job approval bypass**,
> closed a class of job-identity defects, fixed three test-integrity blockers
> found in PHASE 09's own suite, and certified the result. The system is **not
> multi-tenant safe**, has **no persistence**, and **~30 documented configuration
> settings are inert** — all classified in `docs/FINAL_ARCHITECTURE.md`.

---

## 2. PHASE 00 BASELINE (retained)

The project root was **empty** at the start of PHASE 00 (`0 File(s) 0 bytes`,
created `2026-09-28 17:09:48`, not a symlink, not a Git repository). All three
subsequent phases proceeded as greenfield builds, on explicit instruction. No
migration was performed, simulated, or implied.

Sibling directories under `D:\AI` were never read from, copied, or used as a
source. **K-01 remains open on the record** in case a prior codebase was ever
expected here.

---

## 3. ENVIRONMENT

| Tool | Version | Notes |
|---|---|---|
| OpenCode | `1.18.32` | via `opencode.cmd` |
| Node.js | `v24.21.0` | |
| npm | `11.19.0` | use `npm.cmd` |
| Git | `2.55.0.windows.3` | |

`Get-ExecutionPolicy` → `Undefined`, **not modified**. `npm.cmd`, `npx.cmd` and
`opencode.cmd` are used to avoid the blocked `.ps1` wrappers.

**Still absent:** pnpm, yarn, bun, Docker, and any browser or DOM automation
(Playwright, Puppeteer, Cypress, jsdom). None is required, and none was added in
PHASE 03 — see AD-27.

Requirements: Windows, PowerShell 5.1, Node.js >= 22, npm 11.x, OpenCode
`1.18.32`. `TOZ_ENV` is the only required configuration value.

---

## 4. ARCHITECTURE

Language **TypeScript** (strict), runtime **Node.js 22+**, ESM, `tsc` build to
`dist/`, npm. Tests use the built-in Node test runner.

**Runtime dependencies: none.** Dev dependencies unchanged since PHASE 01:
`typescript`, `@types/node`, `eslint`, `@eslint/js`, `typescript-eslint`. PHASE
04 added no runtime dependency and no Ruflo package.

The tree partition is resolved by test (`designSystem.phase01Isolation.test.ts`),
so the fourth tree is enforced rather than documented.

### 4.1 Four trees, one direction

```
core  ←?  design-system  ←?  site
core  ←?  orchestration
```

| Tree | Entry point | May import |
|---|---|---|
| Core (PHASE 01) | `toz-ai-office` | nothing internal |
| Design system (PHASE 02) | `toz-ai-office/design-system` | nothing internal |
| Site (PHASE 03) | `toz-ai-office/site` | the design system only |
| Orchestration (PHASE 04) | `toz-ai-office/orchestration` | core, design system |

The site deliberately does **not** import the core: a marketing page must never
sit behind the orchestration runtime, and the core must stay importable from a
static build. Enforced by resolving every import in all four trees.

### 4.2 Site module map

| Module | Responsibility |
|---|---|
| `src/site/content.ts` | All copy as **data**: identity, navigation, hero, value, capabilities, process, architecture, reliability, next step, footer |
| `src/site/meta.ts` | Title, description, canonical, robots, Open Graph, Twitter |
| `src/site/routes.ts` | Route table, `matchRoute`, `renderRoute`, `renderHome` |
| `src/site/home/index.ts` | Page composition and narrative order |
| `src/site/home/header.ts` | Global header, brand, primary nav, CTA, mobile disclosure |
| `src/site/home/hero.ts` | Hero: eyebrow, h1, summary, two calls to action, diagram |
| `src/site/home/sections.ts` | Value, capabilities, process, reliability, next step |
| `src/site/home/architecture.ts` | Layered architecture section |
| `src/site/home/footer.ts` | `<footer>` landmark |
| `src/site/notFound.ts` | Not-found page (`noindex`) |
| `src/site/visuals/heroVisual.ts` | Inline SVG orchestration diagram |
| `src/site/visuals/architectureDiagram.ts` | Inline SVG layer stack, generated from the same records as the text |
| `src/site/styles/site.css` | Page composition only — redefines no token |

### 4.3 Orchestration module map

| Module | Responsibility |
|---|---|
| `src/orchestration/authority.ts` | `TozOrchestrator` — the single component that may advance a task |
| `src/orchestration/agent/{record,registry,adapter,trust}.ts` | Agent inventory, lifecycle, adapter port, trust floors |
| `src/orchestration/capabilities/registry.ts` | Capability index and availability reporting |
| `src/orchestration/pool/specialistPool.ts` | Filter then deterministic order, with a reason per candidate |
| `src/orchestration/task/{state,plan}.ts` | Orchestration state machine, plan validation, dependency graph |
| `src/orchestration/team/{topology,team}.ts` | Topology choice and the bounded execution runtime |
| `src/orchestration/model/modelRouter.ts` | Thin adapter over the existing `ProviderRouter` |
| `src/orchestration/evidence/evidence.ts` | Per-execution records and `mergeEvidence` for multi-agent tasks |
| `src/orchestration/verification/verifier.ts` | `pass` / `fail` / `needs_review`, read from evidence |
| `src/orchestration/memory/memory.ts` | Scopes, read/write grants, in-memory and disabled providers |
| `src/orchestration/tools/tool.ts` | Tool registry and explicit invocation permission |
| `src/orchestration/feedback/feedback.ts` | Outcome records; deliberately NOT fed back into selection |
| `src/orchestration/workers/worker.ts` | Bounded, cancellable, restartable background work |
| `src/orchestration/observability/trace.ts` | Trace records and attributable resource usage |
| `src/orchestration/policy/{antiDrift,security}.ts` | Drift limits and the input/output policy seam |
| `src/orchestration/extensions/extension.ts` | Extension registry that refuses a second authority |
| `src/orchestration/config/{orchestrationConfig,env}.ts` | Orchestration schema and env allow-list |
| `src/orchestration/agentsource/{source,ingest,agencyAdapter}.ts` | PHASE 04.1: agent sources, normalisation, ingestion, the agency boundary |
| `src/orchestration/ruflo/boundary.ts` | PHASE 04.1: the Ruflo reference boundary, disabled by default |
| `src/orchestration/provider/providerAdapterRegistry.ts` | PHASE 04.1: where provider adapters would be held; ships empty |
| `src/orchestration/tools/invoker.ts` | PHASE 04.1: authorised tool execution and its evidence |
| `src/orchestration/feedback/learningSignal.ts` | PHASE 04.1: opt-in, tiebreak-only learning signal |

`ARCHITECTURE.md` is the long-form reference; `docs/PHASE04_MAP.md` records the
audit that preceded the build.

---

## 5. HOMEPAGE

**Route:** `/` (the only page). Plus `/404` for unknown paths.

**Sections, in narrative order:** header → hero → value proposition →
capabilities → how it works → architecture → reliability → next step → footer.

**Interactions:** all of them native and JavaScript-free.

- Header navigation: in-page anchors, `aria-current` for the active section
- Mobile navigation: native `<details>` disclosure, keyboard operable
- All calls to action: in-page anchors to sections that exist
- Hero and architecture diagrams: inline SVG with `<title>` and `<desc>`

**No JavaScript ships on the homepage.** Asserted by test.

### 5.1 Content integrity

The page makes **no** claim that the repository cannot verify. A test suite
scans the copy for percentages, multipliers, customer and user counts, revenue,
testimonials, ratings, awards, certifications, partnerships, media coverage,
tenure, contact details and vendor names — all absent. The hero headline is
"AI infrastructure that turns complex workflows into coordinated execution."

Capabilities carry a status: `Core architecture` where implemented, `Boundary
defined` where only a port exists. Nothing is presented as available when it is
not. The reliability section describes eight principles that are enforced in
code and covered by tests, with no numerical reliability figure.

No inner pages exist, so no navigation entry points at one. Every navigation
item and call to action is an in-page anchor.

---

## 6. KEY DECISIONS (PHASE 03)

### AD-27 — No browser automation was added
The brief forbids installing a browser stack unless the architecture requires it.
The design system is server-rendered with no JavaScript, so **no browser is
required to build or serve the site**; the deliverable is HTML and CSS.
Responsive and contrast behaviour are therefore verified **statically**:
no fixed element widths, fluid `minmax`/`auto-fit` grids, breakpoints present at
each documented step, a small-screen correction block, and every class the page
uses having a rule. See K-11 — the rendered pages should still be opened in a
browser before being relied on.

### AD-28 — Content is data, not markup
All copy lives in `src/site/content.ts` as typed records. This makes the
content-integrity guarantee testable (claims are inspectable in one file), makes
navigation derivable so a link cannot point at a missing section, and keeps
section renderers free of embedded copy.

### AD-29 — The architecture section is tied to the real code
Each architecture layer declares a `sourcePath` pointing at the real module that
implements it, and a test asserts every path exists. The diagram and the text
are generated from the same records, so they cannot disagree, and neither can
drift away from the repository.

### AD-30 — No route for a page that does not exist
Only `/` and `/404` are registered. Inner pages belong to PHASE 04, and linking
to one today would be a broken link today. A link-integrity test resolves every
navigational `href` on both pages.

### AD-31 — The site imports the design system, never the core
Keeps a marketing page out of the runtime dependency graph, and lets the core
and design system be consumed by a headless or static build independently.

### AD-32 — Fragments pass through as fragments
The design system escapes string children by design. Several sections initially
passed `.join("")`, and two passed `toHtmlString(...)`, both of which convert a
fragment back to a string — so whole sections rendered as literal escaped
markup. Every `children` value is now an array of fragments. A test asserts
that no escaped markup appears in the output, so the mistake cannot recur
silently.

---

## 7. VALIDATION RESULTS (PHASE 03)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS**, 0 errors |
| Lint | `npm run lint` | **PASS**, 0 errors |
| Build | `npm run build` | **PASS** — 5 CSS assets copied |
| Unit tests | `npm run test:unit` | **PASS**, 634/634, 0 failed, 0 skipped |
| PHASE 01 regression | 12 original test files | **PASS**, 232/232 |
| PHASE 02 regression | 8 design-system test files | **PASS**, 285/285 |
| Site build | `npm run site:build` | **PASS** — `index.html` 32,275 bytes, `404.html` 6,030 bytes |
| Config validation | `npm run config:validate -- --defaults` | **PASS** |
| Integration tests | — | Not present (K-07) |
| Browser / E2E | — | Not present, and none installed (K-11, AD-27) |

### 7.1 Test coverage

117 new tests in 3 files, bringing the total from 517 to 634.

| File | Tests | Covers |
|---|---|---|
| `site.content.test.ts` | 36 | Content integrity (11 fabrication guards), capability status honesty, architecture-to-code correspondence, reliability claims, navigation targets |
| `site.render.test.ts` | 43 | Routing, link integrity, document structure, heading hierarchy, landmarks, metadata, visuals, no-JavaScript, stylesheet order |
| `site.architecture.test.ts` | 38 | Site CSS discipline (no raw values, no fixed widths, fluid grids, reduced motion, class/CSS parity in both directions), design-system consumption, PHASE 01 regression |

The link-integrity test resolves every navigational `href` on both pages: each
must be an in-page anchor with a matching `id`, or a registered route.

### 7.2 Issues found and fixed during PHASE 03

All PHASE 03 issues. No pre-existing failure was found; the PHASE 01 and
PHASE 02 suites pass unchanged.

1. **Every section rendered as escaped markup.** Sections passed `.join("")` as
   `children`, producing a string, which the design system escapes by design. The
   entire page body was visible as literal HTML. Fixed by passing arrays (AD-32).
2. **The footer was a `<section>`, not a `<footer>`.** A footer rendered as a
   plain section is invisible as a landmark to assistive technology. Rewritten
   to use a real `<footer>` element.
3. **Capability status badges were escaped.** `toHtmlString(badge(...))`
   converted a fragment to a string, so status labels showed as raw markup.
4. **Both inline SVG diagrams were escaped.** Generated SVG fragments were
   interpolated as strings. Rewritten to pass them through `raw()`.
5. **`normalisePath("//")` returned `""`** instead of `"/"`, so a doubled slash
   resolved to a page whose body had been dropped.
6. **The not-found page's header links appeared broken.** They are in-page
   anchors whose targets live on the homepage, where the header actually renders.
   The link check now resolves against the union of both pages' ids.
7. **The site CSS was not a superset of the design system.** It defined no rule
   for `toz-site-footer`, which it applied as a marker. Documented as
   intentionally rule-free rather than given an empty rule.
8. The PHASE 02 isolation test partitioned the source tree as
   "design system" versus "everything else", so PHASE 03's `src/site` was
   classified as core. Now partitioned into three explicit trees, with an
   assertion that the partition is disjoint.

Nine of my own test assertions were also wrong about correct behaviour and were
corrected: substring matching flagged "arr" in "array" and "review" in
"reviewed"; `&copy;` rather than `©`; media-query `max-width` read as a fixed
element width; a `noindex` substring check; a site token check that included the
non-colour `border-width`; and a keyword-stuffing count over the whole document
rather than the body.

---

## 8. FILES CHANGED (PHASE 03)

### Modified
- `package.json` — added the `./site` export and the `site:build` script
- `src/design-system/theme/theme.ts` — **extended, not replaced**: `htmlDocument`
  now accepts `stylesheetBasePath` and emits its links via the existing
  `stylesheetLinks` helper, so a static build can use relative asset paths
- `tests/designSystem.phase01Isolation.test.ts` — three-tree partitioning
- `README.md` — rewritten for PHASE 03
- `PROJECT_STATE.md` — this file

### Created — site source (14)
`src/site/index.ts`, `content.ts`, `meta.ts`, `routes.ts`, `notFound.ts`
`src/site/home/`: `index.ts`, `header.ts`, `hero.ts`, `sections.ts`,
`architecture.ts`, `footer.ts`
`src/site/visuals/`: `heroVisual.ts`, `architectureDiagram.ts`
`src/site/styles/site.css`

### Created — scripts (1)
- `scripts/build-site.mjs` — renders the site to static HTML

### Created — tests (3)
`tests/site.content.test.ts`, `tests/site.render.test.ts`,
`tests/site.architecture.test.ts`

### Not modified
Any file under `src/` outside `src/site/` and the single `htmlDocument`
extension above. **No PHASE 01 core file was modified.**

---

## 9. KNOWN ISSUES

### Pre-existing

| # | Severity | Issue | Status |
|---|---|---|---|
| K-01 | Low | PHASE 00 root was empty; an expected prior codebase is still absent. | Open for the record |
| K-06 | Medium | No persistence. Registries, state and audit log are in-memory only. | Open |
| K-07 | Medium | No integration or end-to-end test harness. | Open |
| K-10 | Low | Retry `jitterRatio` defaults to `0`. | Open |
| K-12 | Low | `HealthProbe` and `ScoreFactor` are unimplemented interfaces. | Deferred by design |
| K-13 | Medium | Contrast ratios chosen by construction, not measured against WCAG. | Open |
| K-14 | Low | `color-mix()` fallback on very old engines (cosmetic). | Accepted |
| K-15 | Low | The dialog opener script must be injected by a consuming page. | Documented |
| K-16 | Low | CSS is copied to `dist/` by a build script rather than imported. | Documented |

### Introduced by PHASE 03

| # | Severity | Issue | Impact | Status |
|---|---|---|---|---|
| K-11 | **Medium** | **No real browser render.** No Playwright, Puppeteer or Cypress exists and none was installed (AD-27). Validation is static. | A defect that only appears when painted — a specific colour pair below 4.5:1, a z-index collision, an unexpected text wrap, a sticky-header overlap — would not be caught. **Open `dist/site/index.html` and `dist/preview/index.html` in a browser at 360, 390, 768, 1024, 1280 and 1440px before PHASE 04 builds on this.** | Open — needs human review |
| K-17 | Medium | The architecture section describes layers that are mostly **designed, not all implemented**. `Orchestration`, `Intelligence` and `Execution` are real PHASE 01 modules; the *end-to-end* system they describe is not yet wired together. | The page could be read as claiming a working end-to-end system. Mitigated by capability status labels, but the distinction between "module exists" and "system runs" deserves a PHASE 04 review of the copy. | Open |
| K-18 | Low | The canonical URL uses `https://example.invalid`, a reserved non-resolvable TLD, because no verified production domain exists in the repository. | Correct for now. Must be replaced with a real origin before launch, or the canonical tag will point at an invalid host. | Open — needs the real domain |
| K-19 | Low | There is no contact or lead-capture path, because no verified contact details exist and the lead backend belongs to a later phase. | The primary CTA leads to a section rather than to a conversation. Acceptable, but it is a genuine gap in the conversion path. | Open by design |
| K-20 | Low | No server. The site is emitted as static HTML; there is no request handling, no 404 status code emission, and no redirect handling. | Adequate for review and for a static host. A real deployment needs host configuration to serve `404.html` with a 404 status. | Open — a deployment concern |
| K-21 | Low | `dist/site/index.html` is not minified. | ~32KB uncompressed, which gzips to roughly 6KB. No optimisation needed yet. | Accepted |

---

## 10. PHASE 04 READINESS

Before or during PHASE 04:

1. **Open `dist/site/index.html` in a real browser at 360, 390, 768, 1024, 1280
   and 1440px** (K-11). Highest-value action available; needs no code change.
2. Verify contrast of the specific text and token pairs the inner pages will
   use (K-13).
3. Decide the real canonical origin and replace `example.invalid` (K-18).
4. Review whether a contact path is wanted now or should wait for the lead
   phase (K-19), and review the architecture copy against K-17.

Inner pages should be added as real routes in `src/site/routes.ts` with real
content records, reusing the existing section renderers. **No route should be
registered before the page behind it renders.**

---

## 11. NEXT PHASE

**PHASE 04 (remainder) — Inner Pages + Content Architecture**, plus a decision
from the owner on the phase-numbering conflict recorded in §12.1.

**Do not begin without an explicit instruction.**

---

## 12. PHASE 04 (ORCHESTRATION FABRIC)

### 12.1 Scope note

This repository's own plan (§10) defined PHASE 04 as **Inner Pages + Content
Architecture**. The work recorded here is the **orchestration fabric**, delivered
under explicit instruction as PHASE 04. Both are recorded rather than merged: the
inner-page plan is unchanged and still outstanding, and the phase number is now
ambiguous in this file. Resolving that is a decision for the owner, not something
to quietly rewrite.

### 12.2 What was built

A fourth tree, `src/orchestration`, that composes the PHASE 01 infrastructure
into an execution. Nothing existing was replaced: the provider registry, model
registry, router, audit log, capability matcher, config schema and error
taxonomy are all reused as they were.

The load-bearing rules, and where each is enforced:

| Rule | Enforced by |
|---|---|
| One component may advance a task | `TozOrchestrator`; an extension claiming authority is rejected at registration |
| The orchestrator is the only decision maker | It builds the `TeamRuntime` and supplies the executor; nothing else is handed one |
| Agent ≠ provider ≠ model ≠ tool ≠ memory | Separate types, separate registries; `ARCHITECTURE.md` §3 |
| A claim is not a verified fact | `Evidence` and `VerificationResult` are separate; a required check cannot complete without `pass` |
| Cannot tell ≠ passed | `needs_review` escalates; an unrecognised verification kind escalates too |
| Nothing granted is not granted | Memory read and write are separate grants; a missing grant rejects an agent or refuses a write |
| Unmeasured is not zero | Latency, cost and token figures stay `null`; totals exclude what was not measured |
| Explain every selection | Every candidate, selected or rejected, carries a rationale; the team reason includes the first failure's message |

### 12.3 Key decisions

**AD-33 — Ruflo is a reference, not a dependency.** No Ruflo package is
installed, required, or wrapped. What was taken is architectural: router-driven
execution, capability-based selection, specialists, swarm and team topology,
memory, learning from outcomes, workers, MCP, observability, cost and
extensibility. What was refused: installing it, inheriting its control plane,
mirroring its type names, federation, neural routing, vector infrastructure,
CRDTs, QUIC, and a large MCP surface. A future `RufloAdapter` would implement
`AgentAdapter` — a leaf with no reference to the orchestrator — and none ships,
because a fake integration is worse than an absent one.

**AD-34 — The orchestrator executes plans; a runtime supplied from outside
would not.** `OrchestratorOptions` takes `team` **settings**, not a
`TeamRuntime` instance. An injected runtime would have to be handed an executor
that already knew agent selection, routing and adapter invocation, which is a
second way in. Selection, routing and execution happen per subtask, not once per
task.

**AD-35 — Orchestration milestones get their own audit kind.** They were being
written as `task_transition` to `running`, which asserted a state change that
never happened and collapsed selection, topology, evidence, verification and
completion into one indistinguishable record. `orchestration_event` was added to
the PHASE 01 audit union, carrying the specific step, and the trace id keeps the
two histories correlated.

**AD-36 — Memory read and write are different permissions.** `MemoryGrant` now
carries `scopes` and `writableScopes` separately, and the scoped write checks
write permission. It previously checked read permission, so any subject allowed
to see a scope could also overwrite it. A grant with no writable scopes is an
observer, which is the safe direction.

**AD-37 — A refused memory write is a reported outcome, not a throw.** The work
is already done and verified; a bookkeeping failure must not lose it, and
`execute` promises that expected failures come back as values. The refusal is
recorded in the run's steps.

**AD-38 — Capability ranking uses absolute coverage, not a ratio.** Every
candidate is assessed against the same required set, so a coverage ratio is
identical for all of them and cannot break a tie. The absolute count can, and
the agent key is the final term, which makes the order total.

**AD-39 — Configuration is centralised, with an honest seam.** `AppConfig` now
carries an `orchestration` section so there is one configuration object rather
than two that can drift. The core validates only that it is an object: validating
those fields would mean importing the orchestration layer and inverting the
dependency direction. `orchestrationConfigFromApp` applies the real schema and
returns the issues. Unknown keys inside a section are reported, because a
misspelled limit that looks configured and is not fails open.

**AD-40 — The capability union is open, the list is not.** `Capability` is
`BuiltinCapability | (string & {})`, so an agent can declare `web_research` or
`entity_extraction` without a change to the core, while `CAPABILITIES` remains
the finite built-in list. Custom names must be namespaced and lowercase, so a
typo is caught at registration rather than producing a capability nothing can
match.

### 12.4 Validation results (PHASE 04)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS**, 0 errors |
| Lint | `npm run lint` | **PASS**, 0 errors |
| Build | `npm run build` | **PASS** |
| Full suite | `npm run test:unit` | **PASS**, 904/904, 0 failed |
| PHASE 01–03 regression | existing 24 test files | **PASS**, unchanged |
| Runtime dependencies | `package.json` | **PASS**, still none |
| Integration tests | — | Not present (K-07) |
| Browser / E2E | — | Not present, and none installed (K-11, AD-27) |

### 12.5 Defects found and fixed during PHASE 04

Every one of these was found by writing a test that asserted the intended
behaviour, not by reading the code carefully.

1. **The orchestrator ran only the first subtask of a plan.** A five-step plan
   executed one step and reported success. Selection, routing, adapter
   invocation, per-subtask evidence and the output screen are now per subtask,
   with a `TeamRuntime` the orchestrator builds, and the result carries the
   team outcome and every participant.
2. **The orchestrator's own default plan failed validation.** It generated
   subtask ids containing `#`, which the plan validator rejects — so a
   single-agent task, the most common case, always failed with "invalid plan".
3. **A memory write consulted the provider as its access policy.** The call
   typechecked only because both arguments were structurally loose, and would
   have checked a grant that did not exist.
4. **A memory write failure escaped `execute` as a thrown error**, breaking the
   promise that expected failures are returned.
5. **A scoped memory write checked read permission, not write permission.**
6. **Output-policy refusal was classified as `"policy_error" as ErrorClass`** —
   a value that is not in the error taxonomy at all.
7. **A failed plan was reported with no reason a caller could act on** —
   "1 subtask(s) failed" named no subtask and no cause.
8. **The pool could not distinguish two versions of one agent.** Lifecycle was
   looked up by agent id, so `researcher@1.0.0` being available masked
   `researcher@2.0.0` still being only registered. Lifecycle now travels on the
   candidate.
9. **Every orchestration milestone was audited as `task_transition` to
   `running`**, inventing a transition and flattening the history.
10. **A successfully executed multi-agent task could not be verified.**
    Merged evidence named no single producing agent, so the integrity check
    that a success must be attributable to somebody failed it. Evidence now
    carries every participant, and names one only when there is one.
11. **The default `rank` treated an unmeasured cost class as cheap** and an
    unmeasured latency as unmeasured-but-equal; coverage was ranked by a ratio
    that was identical for every candidate and so could never break a tie.
12. **The verification gate was reached after the state had already left
    `running`**, and a `verifying` task could be marked complete in the same
    breath it was verified.
13. **A requested verification kind this build did not recognise was silently
    dropped** — a missing capability turned into a green result.
14. **Feedback records never stored the agent version**, even though the record
    type had the field and the orchestrator knew the version.
15. **Config typos were ignored**: `maxDepth` instead of `maxPlanDepth` produced
    no issue and no effect.

Eleven of my own test assertions were also wrong about correct behaviour and
were corrected: an agent record defaulting to `disabled` is intentional; a
re-index test cannot register the same `agentId@version` twice; `require-await`
is not a defect in a synchronous in-memory implementation; `agents` must be
checked rather than `agentId` for a merged record; `String(value)` on a
rejected config value is `[object Object]`, not the value; and a worker has no
orchestrator field to assert the absence of.

### 12.6 Files changed (PHASE 04)

**Modified**
- `src/capabilities/capability.ts` — open `Capability` union, `isBuiltinCapability`, `isCapabilityName`
- `src/capabilities/index.ts` — exports for the above
- `src/config/schema.ts` — `AppConfig.orchestration` section
- `src/config/validate.ts` — passthrough validation of that section
- `src/audit/events.ts` — `orchestration_event` audit kind
- `src/workload/workload.ts` — printable rejection message for an unknown capability
- `tests/capabilities.test.ts` — open-capability coverage

**Added**
- `ARCHITECTURE.md`, `docs/PHASE04_MAP.md`
- `src/orchestration/` — the whole tree, listed in §4.3
- `src/orchestration/index.ts` — the public surface
- `tests/contracts/contracts.ts` — reusable `assertOk` / `assertErr`
- `tests/helpers/{localAgentAdapter,orchestrationHarness}.ts`
- `tests/orchestration.{agent,pool,task,authority,subsystems}.test.ts` — 270 tests

---

## 13. PHASE 04 (INNER PAGES) - DELIVERED

**Status: PASS.** Delivered as part of the product-surface completion phase
(§21). This section was the repository's last outstanding item and is now
closed. The historical record for PHASE 01-04.1 above is unchanged.

```
The original PHASE 04 plan in §10 is unchanged and undone. Inner pages belong in
`src/site/routes.ts` as real routes with real content records, reusing the
existing section renderers. **No route should be registered before the page
behind it renders.**
```

Both constraints were kept. Routes live in `src/site/routes.ts`; capability detail
routes are GENERATED from `CAPABILITIES`, so a capability cannot exist without a
page and no route is registered before its page renders.

### 13.1 What shipped

| Surface | Route | Content source | Indexed |
|---|---|---|---|
| Home | `/` | existing | yes |
| About | `/about` | `pages/content.ts` ABOUT + FAQ + reliability data | yes |
| Capabilities index | `/capabilities` | `CAPABILITIES` + `ARCHITECTURE` | yes |
| Capability detail | `/capabilities/:id` | generated per `CAPABILITY_ITEM` | yes |
| Contact | `/contact` | `pages/content.ts` CONTACT | yes |
| Projects | `/projects` | none - empty surface | **no** (K-09) |
| Blog | `/blog` | none - empty surface | **no** (K-10) |
| Not found | `/404` | existing | **no** |

Plus `sitemap.xml` and `robots.txt`, both generated from the route table.

### 13.2 Defects found and fixed while building it

| Defect | Why it mattered |
|---|---|
| **Header and footer used bare `#anchor` links** | Every shared header/footer link was a DEAD LINK on every inner page. The existing check missed it because it validated anchors against the HOMEPAGE's ids, which was correct only while the homepage was the sole page. Fixed with a `homeAnchor()` helper, and the check now validates an anchor against the page carrying it. |
| **Capability index skipped a heading level (h1 -> h3)** | A WCAG 1.3.1 failure. Card headings are now `h2`, which is correct: on that page the cards ARE the top-level content. |
| **`toz-page-cta` class in markup did not match its CSS rule** | Caught by the design system's own "no dead CSS" test. Class namespaces realigned to `toz-site-*`. |
| **Site CSS referenced three non-existent tokens** | `--toz-color-text-muted`, `--toz-color-border` do not exist. Caught by the token test; replaced with `--toz-foreground-muted` and `--toz-border`. |
| **Site CSS defined its own font sizes** | Forbidden by `site.architecture.test.ts`. Typography now comes from `toz-type-*` utilities applied in markup. |
| **JSON-LD was HTML-escaped** | The `html` tag escapes interpolations, so every `"` became `&quot;` and no crawler could parse the block. Now injected with `raw()`, after `toJsonLdScript` has escaped `<`. |
| **`BreadcrumbList` was nested inside `WebPage`** | Emitted as its own graph node instead, which is the shape consumers expect. |

### 13.3 K-* known gaps

| Gap | Detail |
|---|---|
| **K-09 Projects** | The route exists and renders an honest "nothing published yet" page. It carries NO case studies, because the repository contains no client, metric or outcome to report and inventing one is prohibited. `noindex`, excluded from the sitemap. |
| **K-10 Blog** | Same treatment. No articles exist, so none were written. `noindex`, excluded from the sitemap. |
| **K-11 Visual / viewport QA** | Responsive behaviour is implemented BY CONSTRUCTION - `auto-fit` grids with a `minmax` floor, so layouts are correct from 320px upward with no breakpoint. But **no browser or real viewport was used**. Verification is structural (CSS review, overflow rules, wrap on long titles), not visual. A human should open the pages at 375px, 768px and 1440px before release. |
| **K-12 Crawler validation** | `sitemap.xml` and `robots.txt` are checked structurally (well-formed, no duplicates, membership matches `noindex`, absolute URLs). They have **not** been submitted to or validated by a real search engine. |
| **K-13 Social preview image** | `og:image` is deliberately **not** emitted, because the repository contains no image asset. A fabricated or missing-asset preview is worse than none. Adding one is a content task, not a code task. |

---

## 14. PHASE 04.1 — AGENCY / RUFLO / REGISTRY / SPECIALIST / ROUTING / TEAM / MEMORY / LEARNING / TOOLS / WORKERS / OBSERVABILITY INTEGRATION

### 14.1 Scope, and the conflict it inherits

This repository's own plan (§10, §11) defined PHASE 04 as **Inner Pages + Content
Architecture**. The work in §12 is the **orchestration fabric**. This section is
**PHASE 04.1**: the integration of Agency Agents, the Ruflo boundary, the
registries, specialist selection, routing, team runtime, memory, learning, tools,
workers and observability — as a distinct increment on top of the fabric.

The historical record is preserved. §10 and §11 are unchanged and the inner-page
work is still outstanding (§13). No phase number has been redefined; the
numbering conflict from §12.1 stands and is an owner decision, not something to
quietly rewrite.

### 14.2 What the audit found before any code was written

Recorded in full in `docs/PHASE041_GAP_MATRIX.md`. The findings that shaped the
work:

1. **No Agency Agent roster exists in this repository.** The only occurrences of
   "Agency" are forward-looking prose in `ARCHITECTURE.md`. No manifest, no
   descriptor, no roster file, no external source material. Rules 16 and 17
   therefore forbid inventing one. **Zero agents were fabricated.**
2. **No Ruflo package, and no Ruflo source material** beyond the concept list
   already recorded in `ARCHITECTURE.md` §21. Nothing beyond that list is claimed.
3. **No provider adapter implementation exists.** `src/providers/provider.ts`
   declares the port and documents that PHASE 01 ships none. Rule 15 forbids
   faking an OpenAI/Anthropic integration, so none was added.
4. **The routed provider was never used to execute anything.** The orchestrator
   routed a provider, recorded it in evidence, and then executed through the AGENT
   adapter. This was the single largest architectural gap.
5. **`SubTaskLimits.maxRetries` was declared, validated, drift-checked, and then
   never used.** A failed subtask was never retried.
6. **Tools were filtered on but never invoked.** Nothing called them during
   execution.
7. **Every subtask required a provider route**, which made a self-hosted
   specialist inexecutable by construction.

### 14.3 What existed before

Everything in §12: the orchestrator, agent and capability registries, the
specialist pool, the model router, the team runtime, evidence and verification,
memory, feedback, tools, workers, observability, anti-drift, security policies,
the extension registry, and the centralised configuration seam.

### 14.4 What was added

| Area | Addition | Why it was needed |
|---|---|---|
| Agent record | `source` (provenance) and `requiresModelRoute` | A self-hosted specialist could not be represented, so the whole class was inexecutable |
| Agent sources | `AgentSource`, `SourceAgentDescriptor`, `CapabilityMapper` (identity + explicit alias), `normaliseSourceAgent` | A place external agents come from, held to the same rules as native ones |
| Ingestion | `AgentIngestor`, `DeclaredAgentSource`, `IngestReport` | The only path by which an external agent enters, always reported |
| Agency | `AgencyAgentAdapter`, `AgencyTransport` port, `classifyAgencyError` | The execution boundary, honestly inert with no transport |
| Ruflo | `RUFLO_CONCEPTS`, `RufloAdapterBoundary`, `translateRufloOutcome` | The reference relationship, recorded and enforced, without a dependency |
| Providers | `ProviderAdapterRegistry` | Somewhere to ask whether a route can actually be served |
| Orchestrator | Route gating, per-subtask route decision, `model_routed` events | Closes the "route recorded but unused" gap |
| Tools | `ToolExecutionHost`, `TextStatInvoker` | Closes the "tools filtered but never called" gap |
| Team | Bounded retry, escalation, `attempts`, `escalated`, retry/escalation events | Closes the "maxRetries ignored" gap |
| Evidence | `EvidenceProvenance` (attempt, sequence), `provenanceOf` | A retried subtask produced indistinguishable records |
| Learning | `LearningSignalSource`, `FeedbackLearningSource`, `signalWeight` | Optional learning, tiebreak-only, provably unable to change eligibility |
| Verification | `ConsistencyQAVerifier` (model QA) | Output-versus-evidence agreement, distinct from record integrity |
| Observability | 11 new event kinds | Tool, memory, routing, team, retry and escalation had no kind |
| Configuration | `agents`, `ruflo`, `tools`, `learning` sections and env vars | Centralised, all shipped switched off |

### 14.5 What was intentionally NOT added

- **No Agency agent roster.** No agency exists in this repository to describe.
- **No Ruflo dependency, and no `RufloAdapter` claiming a live integration.**
  Nothing is installed to call.
- **No OpenAI / Anthropic / Google / Qwen / DeepSeek / OpenRouter adapter.** The
  registry and the port exist; a fabricated wire format would be a fabricated
  integration, and would need credentials to be exercised at all.
- **No SEO, marketing or content agent, and no `seo.*` capability.** The
  repository's own capability vocabulary is the PHASE 01 built-in list plus the
  names already used in `docs/PHASE04_MAP.md`. Section 5's examples are
  explicitly "capability examples, NOT permission to invent arbitrary Agency
  Agents".
- **No second orchestration path, no global selection, no provider-specific logic
  in the orchestrator.**
- **No automatic learning into selection.** The signal is opt-in and tiebreak-only.
- **No auto-promotion of ingested agents.** Off by default, because promotion is a
  trust decision and a source that could promote itself could choose what runs.

### 14.6 Ruflo dependency decision

**No Ruflo package is installed, and none is required.** Verified: `node_modules`
contains no `ruflo`, and `npm ls --depth=0` lists only the five dev dependencies
that have existed since PHASE 01. The relationship is a reference, and the
boundary is a disabled-by-default object whose `status()` reports `not_installed`
even when enabled. Constructing one that claims orchestration authority throws. A
test asserts TOZ behaves identically with the boundary present and with no
boundary object in existence at all.

### 14.7 Agency Agents' role

**Specialist and capability source. Nothing else.** The flow is one-way:

```
external source -> SourceAgentDescriptor -> normalise -> AgentRecordInput
                -> AgentRegistry -> CapabilityRegistry -> SpecialistPool
                -> Toz dynamic selection -> TozOrchestrator -> execution
```

An agency cannot select an agent, cannot see the pool, and cannot reach the
orchestrator — because `AgencyAgentAdapter` implements `AgentAdapter`, an
interface with no orchestrator reference, so the inverted shape is inexpressible
rather than merely discouraged. Ingestion registers and reports; it never
enables, selects or schedules. An external agent arrives `disabled`.

### 14.8 Toz authority

`TozOrchestrator` remains the only component that may advance task state. It
builds the `TeamRuntime` and supplies the executor, because agent selection,
routing and adapter invocation are decisions only it may make. The new
subsystems are all subordinate and all leaf-shaped: `AgentIngestor` (registers),
`AgencyAgentAdapter` (executes one agent), `ToolExecutionHost` (performs one
authorised call), `RufloAdapterBoundary` (refuses), `WorkerHost` (runs one unit
of work). A test asserts a worker host holds no collaborators at all, and another
that it exposes no `execute`.

### 14.9 Defects found and fixed during PHASE 04.1

Every one found by writing a test that asserted the intended behaviour.

1. **The routed provider was recorded but never used.** A task could be reported
   as having run on a provider that had no adapter behind it. Now gated.
2. **`maxRetries` was declared, validated and ignored.** Implemented, bounded by
   the plan, limited to transient classes.
3. **A self-hosted specialist was inexecutable**, because every subtask demanded a
   provider route. `requiresModelRoute` added.
4. **A scoped memory write checked read permission** — already fixed in §12, and
   re-tested here as regression.
5. **Every orchestration milestone was audited as `task_transition` to
   `running`** — already fixed in §12, and re-tested.
6. **Tool filtering existed with no invocation path.**
7. **Evidence records from a retried subtask were indistinguishable and
   unordered** — no attempt or sequence.
8. **A `configuration_error` was escalated rather than failed**, which changed an
   already-validated PHASE 04 outcome. Reverted: escalation is reserved for
   `authentication_failure`, `quota_exhausted` and `invalid_model`.

Five of my own test assertions were also wrong, and are recorded because they were
as informative as the defects:

1. `"warp_drive"` and `"not_a_capability"` are **valid** capability names under
   the PHASE 04 open-union rule (namespaced, lowercase, two or more segments), so
   a test asserting they are unmappable asserted something false. Only an
   unnamespaced single word is unmappable.
2. An `AgentSource` `role` was being validated as an `AgentType`, so a source
   describing itself as "auditor" was rejected over a label. `role` is now free
   text kept as metadata; a separate `type` field is the tested declaration.
3. A test asserting "which subtasks ran" by counting executions failed once retry
   was real, because a transient failure is executed twice. It now compares the
   distinct set.
4. A test asserting `constructor.length === 2` to prove a class reads no memory
   failed, because a defaulted parameter is not counted. Replaced with a check
   that the module does not import memory at all — a stronger property.
5. An event-sequence assertion omitted the terminal failure event, which
   correctly repeats the attempt it ended on.

### 14.10 Validation results (PHASE 04.1)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS**, 0 errors |
| Lint | `npm run lint` | **PASS**, 0 errors |
| Build | `npm run build` | **PASS** |
| Full suite | `npm test` | **PASS**, 1093/1093, 0 failed, 0 skipped |
| PHASE 01 regression | 12 files | **PASS**, 235/235 |
| PHASE 02 regression | 8 files | **PASS**, 287/287 |
| PHASE 03 regression | 3 files | **PASS**, 117/117 |
| PHASE 04 + 04.1 | 9 files | **PASS**, 454/454 |
| Config validation | `npm run config:validate -- --defaults` | **PASS**, VALID |
| Site build | `npm run site:build` | **PASS**, unchanged output |
| Preview build | `npm run ui:preview` | **PASS** |
| Runtime dependencies | `npm ls --depth=0` | **PASS**, none |
| Ruflo installed | filesystem and `npm ls` | **PASS**, not installed |

Integration and browser/E2E tests remain absent (K-07, K-11). No browser or test
framework was added, because none is required by anything delivered here.

### 14.11 New test files

| File | Tests | Covers |
|---|---|---|
| `orchestration.agency.test.ts` | 61 | Source normalisation, ingestion, agency adapter boundary, Ruflo boundary, provenance |
| `orchestration.fabric.test.ts` | 74 | 1/2/5-step plans, retry, escalation, provider adapters, tools, learning, evidence provenance, model QA, config, regression |
| `orchestration.authority41.test.ts` | 18 | Self-hosted execution, route gating, agency end-to-end, audit kinds |
| `orchestration.runtime41.test.ts` | 34 | Workers, memory permissions, observability inventory, ingestion-is-not-a-decision |

### 14.12 Remaining limitations

1. **No agency transport exists**, so the agency execution path is untestable
   against a real agency. The boundary, the normalisation, the selection and the
   honest failure are all tested; the remote call is not.
2. **No provider adapter exists**, so the model-route gate is tested with a test
   double. No real provider has ever been called by this system.
3. **No Ruflo package**, so the boundary is a compatibility shape, not an
   integration.
4. **No MCP client.** `ToolInvoker` is a port with one local implementation.
5. **No browser or E2E tests** (K-11, K-07), unchanged from PHASE 03.
6. **Inner pages remain outstanding** (§13).

None of these is a PASS/FAIL question about PHASE 04.1. Each is the absence of an
external integration that this repository does not have, reported rather than
faked.

---

## PHASE 05 - Memory, Knowledge and Learning

**Delivered.** 1258/1258 tests pass; typecheck, lint and build clean. No new
runtime dependency. See `docs/PHASE05.md` for the rules that decide behaviour and
`docs/PHASE05_MAP.md` for the pre-implementation audit this was built from.

### 15.1 What shipped

A typed, auditable memory layer behind a single `MemoryService` facade, wired into
the orchestrator for exactly two things: recall relevant memory before execution
and hand it to the agents, and capture a *verified* outcome after verification.
`MemoryItem`, `MemoryStore` (versioned, one current belief per key, superseded
history retained), `RetrievalEngine` with an `EmbeddingProvider` port, an auditable
`DefaultWritePolicy`, a bounded `LearningEventStore`, and `KnowledgeIngestion`
with static and unreachable adapters.

Optional and additive throughout: a deployment with no `memoryService` behaves
exactly as it did in PHASE 04.1, down to the absence of a `context` key on the
agent execution request.

### 15.2 Defects found and fixed while building it

Each of these was found by a test that failed, and each is now held by a named
regression test.

| Defect | Consequence had it shipped |
|---|---|
| Recall was computed and never forwarded to any agent | Memory did nothing. The single most important wiring gap in the phase. |
| `recalled` was collected internally and never surfaced on `OrchestrationResult` | A run that consulted memory could not be audited. |
| The write policy read an unstated importance as `0` | The entire default write path was refused. |
| Recency alone made an item a retrieval candidate | Every memory matched every query: noise, ranked. |
| `recallScopes` defaulted to `["task", "project"]` | A standing read grant shipped to every deployment, contradicting "empty means no recall". |
| `stringArray` accepted any string as a scope | A typo'd grant silently recalled nothing while looking configured. |
| A key the storage port rejects was accepted into the index | A memory readable now and gone next process start. |
| Persistence failure escaped as an unhandled rejection | A storage fault failed an unrelated test, three frames from its cause. |
| A non-finite importance was read as zero | A memory was refused as worthless for stating no number. |
| `num()` in the env reader returned a raw string | A reader could not tell what a memory authority grant was parsed as. |

### 15.3 Test files

| File | Tests | Covers |
|---|---|---|
| `memory.model.test.ts` | 50 | Scope model, item model, creation, conflict, correction, invalidation, expiry, retention, isolation, errors, key guard, persistence failures |
| `memory.service.test.ts` | 97 | Retrieval and filters, embeddings-as-a-port, write policy, learning, ingestion, correction, metrics, the agent capability path, and that the service is not a second orchestrator |
| `orchestration.memory.test.ts` | 15 | Recall before execution, summaries-not-values, skip and no-scope cases, refused scopes, capture after a verified pass, learning that never applies itself, and that memory is not a second authority |

### 15.4 Remaining limitations

1. **No persistent `MemoryProvider`**, so nothing here has yet survived a process
   restart. `MemoryStore.load()` rehydrates from any port; no durable port ships.
2. **No embedding provider**, so semantic retrieval is covered through the port
   and its unavailable path only.
3. **No document connectors.** Ingestion accepts already-extracted text.
4. **No browser or E2E tests** (K-07, K-11), unchanged since PHASE 03.
5. **Inner pages remain outstanding.**

None is a PASS/FAIL question about PHASE 05. Each is the absence of an external
integration this repository does not have, reported rather than faked.

---

## PHASE 06 - Provider / Model Routing and Intelligent Model Selection

**Delivered.** 1322/1322 tests pass; typecheck, lint and build clean. No new
runtime dependency. See `docs/PHASE06.md` for the rules that decide behaviour and
`docs/PHASE06_MAP.md` for the pre-implementation audit.

### 16.1 The finding that shaped the phase

Most of what this phase asks for already existed, built in PHASE 01 and never
wired to the orchestrator: the provider and model registries, the record models
with their "null means not verified" discipline, the filter-then-score routing
pipeline with twelve named rejection reasons, the four-state health model, and
the workload requirements. The work was integration, not construction, and the
discipline that mattered was refusing to build a second routing authority.
`evaluateCandidate` remains the only hard eligibility filter; a policy can only
order candidates that already survived it.

### 16.2 What shipped

`src/routing/policy.ts` (named, configurable, explainable policies),
`src/routing/fallback.ts` (bounded chains, cooldown, loop prevention),
`src/routing/usage.ts` (the honest cost ledger), an optional `plan()` on
`ModelRoutingPort`, four new observability kinds in the one shared history, and a
`routing` config section with an env allow-list.

Policies are **ordered recorded facts compared lexicographically**, not weighted
scores. Weights would encode a trade-off nobody here has evidence for; an order
only claims what the operator asked to prioritise. A `null` fact wins nothing in
either direction, so an unmeasured provider cannot beat a measured one on latency
and an unpriced one cannot beat a priced one on cost.

There is **no quality benchmark** in this repository, so `quality-first` reads an
operator-declared tier and, when none exists, states that it cannot rank on
quality rather than pretending. There is **no price table**, so cost preference
runs on the pre-existing `costClass` declaration.

### 16.3 Defects found and fixed while building it

| Defect | Consequence had it shipped |
|---|---|
| The cost scale ran as goodness while the comparator ran as `lower_is_better` | `premium` ranked as the cheapest option in the system. The exact inversion the policy exists to prevent. |
| An undeclared quality tier read as `0`, the bottom of the scale | "Nobody stated a tier" was reported as "worst tier", rather than as unknown. |
| An amount with no currency was accepted into a financial field | An uninterpretable number reaches a cost report looking like a real cost. |
| Mixed currencies were summed | `1 USD + 2 EUR` was reported as one number. |
| A planning failure could have propagated | An optional capability would have been able to fail a route that had already been decided. |
| The new `routing` section was missing from the known-sections allow-list | Every routing setting was rejected as an unknown setting, making the whole section unreachable. The unit tests missed it because they only asserted that a BAD policy was reported, never that a good one was accepted. |
| The `routing` section had no per-key allow-list | A typo such as `defaultPolciy` would have been silently ignored and the default policy used, which looks identical to the setting having worked. |
| The `validate-config` CLI was made to validate orchestration config, then reverted | `src/cli` is core-layer; a `phase01Isolation` test correctly failed because core must not import orchestration. The guarantee now lives in `orchestrationConfigFromApp`, which returns `{ config, issues }`, and the missing composition root is recorded as a limitation. |

### 16.4 Test files

| File | Tests | Covers |
|---|---|---|
| `routing.phase06.test.ts` | 41 | Policy configurability and the absence of a global preference, unknown data never winning a comparison, explainability, determinism, fallback preserving requirements, cooldown and loop prevention, usage recorded and never invented, incompatible models never substituted |
| `orchestration.routing.test.ts` | 18 | Adapter registration and duplicate refusal, routes only where something can serve, fallback availability reported before an outage, background work not spending fallback, an agent unable to select its own provider, a planning failure not failing a run |
| `orchestration.fabric.test.ts` | +5 | The `routing` config section, its env allow-list, and rejection of a policy that does not exist |

### 16.5 Remaining limitations

1. **No provider client is integrated.** `ProviderAdapter` is a port; the
   orchestrator refuses a route with no adapter behind it, so nothing has ever
   called a model through this path. The adapters in the tests are doubles.
2. **No quality or cost data exists**, so two of the five policies have nothing
   real to rank on in the shipped state, and both say so.
3. **No live health probe.** `HealthProbe` is a port; nothing schedules one.
4. **No streaming implementation**, and no `stream` surface was added.
5. **No `format` script** exists in `package.json`. Adding a formatter would be a
   new dev dependency and a toolchain change, so `lint` is the enforcing gate and
   the gap is reported rather than papered over.
6. **No real MCP client**, and **no browser or E2E tests** (K-07, K-11), unchanged
   since PHASE 03.
7. **Inner pages remain outstanding.**

None is a PASS/FAIL question about PHASE 06. Each is the absence of an external
integration this repository does not have, reported rather than faked.

---

## PHASE 07 - Autonomous Workflows / Background Workers

**Delivered.** 1441/1441 tests, 210 suites, typecheck, lint and build clean. No
new runtime dependency. See `docs/PHASE07.md` and `docs/PHASE07_MAP.md`.

### 17.1 The finding that shaped the phase

Almost every primitive already existed: `TaskQueue`, two validated state
machines, `RetryExecutor` with structured failure classification, dependency
semantics in `team.ts`, `ConcurrencyManager`, `WorkerHost`, `StateStore`. PHASE 07
is mostly integration, and the discipline that mattered was refusing duplicates.

### 17.2 One orchestration authority, enforced structurally

`ExecutionCoordinator` holds no provider registry, no model registry, no router,
no agent registry, no memory service and no reference to the orchestrator. It
reaches execution through one port whose production implementation forwards to
`TozOrchestrator.execute`. "A worker picked its own provider" is therefore not a
rule that could be broken - the coordinator has no mechanism for learning a
provider's name. Asserted by a test that inspects the coordinator for those
fields, and by an integration test that drives a real job through the real
orchestrator.

### 17.3 Three state machines, one authority per scope

`queue/taskState.ts` and `orchestration/task/state.ts` are UNCHANGED. A job gets
its own machine because a job must be pausable and may wait on a human for an
unbounded time - neither is an in-run state. `orchestration.task.test.ts` asserts
`paused` does not exist, and that deliberate PHASE 04 decision was not weakened.

### 17.4 Defects found and fixed while building it

| Defect | Consequence had it shipped |
|---|---|
| Job creation recorded `queued -> queued` | Job creation threw on every single job. Creation is `null -> queued`, not a transition |
| Attempts were indexed by execution id while `attemptsOf` read by task id | Attempt history silently returned nothing for tasks it had recorded |
| A **completed** dependency counted as a blocker | The second task of every sequential pair was skipped, so no multi-step workflow could ever finish |
| `unreachableTasks` did not propagate through tasks it had already decided | Only the task directly behind a failure was skipped; a three-deep chain hung forever |
| The cost budget refused the FIRST attempt because nothing was measured | A job carrying a cost budget could never take its first step - a budget that can never pass |
| `running -> running` was attempted on every second wave and every settle | Any second wave of a running job threw |
| The conditional guard was read but `continue`d past the rest of the release logic | The applicable branch was never released, so a conditional ran neither branch |
| `verificationKinds` was dropped between the workflow and the request | No background task could ever obtain a passing verification, so none could complete |
| The worker registry's capability filter asked for a capability to be both present and absent | Every worker that declared any capability was rejected, so none was ever eligible |

### 17.5 Test files

| File | Tests | Covers |
|---|---|---|
| `workflow.model.test.ts` | 61 | Job and task creation, workflow composition, dependency semantics, validated transitions, claims and duplicate delivery, idempotency, approval gates, checkpoints and recovery |
| `workflow.execution.test.ts` | 45 | Sequential and bounded-parallel execution, dependency skipping, worker execution, failure isolation, retry, attempt exhaustion, backoff, cancellation and the stale-result race, timeouts, approval blocking, budgets, the verification boundary, the PHASE 06 boundary, authorisation, the worker registry, and the production adapter |
| `workflow.integration.test.ts` | 10 | Conditional branch selection, a branch that cannot be evaluated, restart and recovery, claim recovery after a crash, and a real job executed through the real orchestrator and PHASE 06 routing |

### 17.6 Remaining limitations

1. **A job's state lives in memory.** A process restart loses every job. Recovery
   is tested at the level the repository can support: claim expiry, checkpoint
   plans, and refused stale results. No durable persistence was invented.
2. **No distributed locking.** `ClaimRegistry` gives single-process exclusion with
   an expiry, and `DELIVERY_SEMANTICS.scope` says so in code.
3. **Exactly-once is not claimed.** A crash between applying an external effect and
   recording its idempotency key is a real, open window.
4. **Parallel groups are released in waves, not truly concurrently.** The ceiling
   is enforced and observed; the release loop is sequential so ordering stays
   reproducible.
5. **Conditional predicates are a fixed vocabulary.** Anything else is held, not
   guessed.
6. **A `wait` step records intent; it does not block a thread.** The job waits and
   needs something external to advance it.
7. **No live health probe, no real MCP client, no browser or E2E tests** (K-07,
   K-11) - both unchanged since PHASE 03.
8. **Workflow config is not wired into the CLI**, following the PHASE 06 lesson
   that architectural isolation outranks convenient wiring.
9. **Inner pages remain outstanding.**

None is a PASS/FAIL question about PHASE 07. Each is the absence of an external
infrastructure this repository does not have, reported rather than faked.

---

## PHASE 08 - Governance, Policy, Security and the Control Plane

**Delivered.** 1510/1510 tests, 224 suites, typecheck, lint and build clean. No
new runtime dependency. See `docs/PHASE08.md` and `docs/PHASE08_MAP.md`.

### 18.1 The finding that shaped the phase

Governance was not absent - it was SCATTERED. The audit found six working
authorization surfaces and NO central permission catalogue anywhere. Three
vocabularies decided three different questions: `ToolPermission`, `MemoryGrant`,
and `ProviderRecord.approvalStatus`. And `SecurityDecision` was a BOOLEAN, which
cannot express "a human must decide this first" - so an approval-requiring
operation was forced to allow or deny.

PHASE 08 adds a four-valued decision and leaves `SecurityDecision` alone, because
rewriting it would ripple through the orchestrator's screening step for a need
that screen does not have.

### 18.2 One authority, enforced structurally

`PolicyEngine` holds no agent registry, no provider registry, no model registry,
no router, no memory service and no reference to the orchestrator. It holds a
clock and a list of rules, and returns a decision. "A worker picked its own
provider" is a capability governance does not have, not a rule it could break.

PHASE 07's job state machine is UNCHANGED, `orchestration/task/state.ts` is
UNCHANGED (including its refusal of `paused`), and no PHASE 08 module imports a
router, orchestrator, memory service, verification or tool at runtime - all
asserted by tests that read the source, not by comments.

### 18.3 Defects found and fixed while building it

| Defect | Consequence had it shipped |
|---|---|
| Rules that CONFIRMED a requirement returned `null` (no opinion) | The engine's default-deny then refused properly granted operations - a safety check denying correct behaviour |
| The engine fired default-deny even when rules had returned `ALLOW` | Every correctly granted operation was denied |
| An escalation request was silently CLAMPED by intersection | A caller asking for `shell` and receiving `calculator` may believe it was granted `shell`; now refused outright |
| The governance recorder dereferenced a null context | A malformed request THREW inside the audit path - an outage vector where the refusal looked like it never happened |
| A secret embedded in a decision's free-text reason was redacted but not REPORTED | The decision looked clean when it was not |
| `governance` was missing from the config section allow-list | Every governance setting was rejected as unknown, making the whole section unreachable |
| `nullableNumberOr` did not coerce an env string | `TOZ_GOVERNANCE_MAX_CONCURRENT=8` silently stayed `null` |
| PHASE 07: `TOZ_WORKFLOW_*` were documented in `.env.example` but had no env block | Every documented workflow setting was silently inert |

### 18.4 Test files

| File | Tests | Covers |
|---|---|---|
| `governance.test.ts` | 49 | Four verdicts, determinism, permissions, default-deny, delegation and escalation, the approval bridge, resource limits with unpriced-cost blocking, routing narrowing, audit and redaction, adaptation to the existing binary screen |
| `governance.architecture.test.ts` | 15 | No second orchestrator, no second router, no duplicate memory authority, unchanged state machines, frozen authority, workers cannot bypass governance |
| `orchestration.fabric.test.ts` | +5 | The `governance` config section, its env allow-list, and rejection of an unknown operation, a zero limit and a misspelled key |

### 18.5 Remaining limitations

1. **The governance decision history is in memory** and lost on restart.
2. **Governance is not yet wired into the orchestrator's execution path.** It is a
   complete, tested control plane that subsystems call; wiring it in
   unprompted would change behaviour for every existing deployment.
3. **Approval resolution is governed, not implemented** - governance decides who
   may resolve; PHASE 07's `ApprovalRegistry` records the decision.
4. **Delegation is synchronous and in-process**, with no revocation registry.
5. **No policy composition** - a flat ordered list, no AND/OR or negation.
6. **No central policy store, versioning, or signed bundles; no RBAC primitive; no
   tamper-evident log; no multi-tenant isolation.** `owner` is recorded, not
   enforced.
7. **No live MCP client, no real E2E tests** (K-07, K-11) - unchanged since PHASE 03.
8. **Workflow config is not wired into the CLI**, following the PHASE 06 lesson
   that architectural isolation outranks convenient wiring.
9. **Inner pages remain outstanding.**

### 18.6 PHASE 07 limitations preserved, not silently fixed

Job state is still in memory, there is still no durable persistence or
distributed lock, `DELIVERY_SEMANTICS.scope` is still `single-process`,
exactly-once is still not claimed, parallel groups are still released in waves,
and `wait` still records intent rather than blocking. None was quietly addressed,
because doing so would have meant inventing infrastructure this repository does
not have.

---

## PHASE 09 - Production Hardening: Enforcement, Audit and Honesty

> **Governance is ENFORCED in the execution path.** At the end of PHASE 08 it was
> complete, tested, and unwired. Full evidence: `docs/PHASE09_MAP.md`.

### 19.1 The finding that shaped the phase

PHASE 08 shipped a full control plane and documented, honestly, that it was *not
wired into the orchestrator*. That sentence was the largest open risk in the
system: an authorization subsystem that only runs when someone calls it by hand
depends on every engineer remembering to call it.

PHASE 09's first task was therefore not to write code but to read the execution
path and decide whether a **safe** seam existed.

`TozOrchestrator.execute` already had one, at step 2: the input-policy screen. It
runs after the input check and before classification, planning, memory recall and
execution, and it already refuses through one `#refuse` path with a classified
error. Placing governance there means a denied request never becomes a plan, never
reaches PHASE 06 routing, never recalls memory, and never reaches a worker.

### 19.2 What shipped

- **`OrchestratorGovernancePort`** (`governance/gate.ts`) with exactly two
  capabilities: `authorize` and an optional `narrowRouting`. There is no method to
  select a provider, choose a model, plan, mutate topology, write memory, or
  verify. Those are absent, not forbidden - a gate holding the port has no way to
  do them.
- **Two enforcement boundaries.** `workflow.execute` once, before the request is
  used; `capability.execute` per required capability, immediately before
  `adapter.execute`. The second is not redundant - a job can be permitted while one
  subtask names a capability the policy denies some callers - and it is the last
  point at which an unauthorized call can be stopped *without having invoked a
  provider*.
- **Narrowing before the hard filter.** `ModelRequirements.denied` is applied in
  `ModelRouter.selectRoute` ahead of PHASE 06 `evaluateCandidate`, so governance
  narrows eligibility and `evaluateCandidate` still decides. `RoutingRestriction`
  has no preference, score, priority or replacement field, so it cannot select.
- **Two new error classes.** `authorization_error` and `approval_required`, both
  pinned in `PERMANENT_ERROR_CLASSES`. A policy denial previously had to be
  reported as `configuration_error` or `invalid_request`, and both describe a
  *mistake*; a denial is the correct outcome of a correct request. The two new
  classes are kept distinct because the remedies differ - a denial is final, an
  outstanding approval is waiting.
- **`enforcement.ts`** - the three checks extracted as pure functions. The
  orchestrator still owns state, trace and settlement; it no longer *computes* the
  decision.

### 19.3 What was deliberately NOT done

- **No second approval gate.** `REQUIRE_APPROVAL` returns `approval_required` and
  stops. The orchestrator has no gate; the `ExecutionCoordinator` does. The refusal
  tells the caller to re-drive the work through it. Building one here would have
  created two authorities for one decision.
- **No governance inside `ExecutionCoordinator`.** The seam belongs to TOZ, which
  already had a pre-execution boundary.
- **No invented persistence.** Rules come from an in-process `GovernanceGate`. No
  policy store, no signed log, no RBAC resolver, no multi-tenant isolation.

### 19.4 Defects found and fixed while building it

| Defect | Fix |
|---|---|
| A policy denial had to be reported as `configuration_error` or `invalid_request`, so an operator could not tell "broken" from "refused on purpose" | Added `authorization_error` and `approval_required` to `ERROR_CLASSES` and to `PERMANENT_ERROR_CLASSES` |
| `authority.ts` reached 1581 lines after the wiring | Extracted the three checks to `governance/enforcement.ts`; file returned to 1513 |
| The first step-log line passed a hardcoded `"refused"` in place of the engine's `ReasonCode`, so the trace asserted nothing | `describeExecutionDecision` now carries the engine's reason code and the actor; a test asserts both |
| PowerShell patching added UTF-8 BOMs to six files | Detected against `git show HEAD`, stripped; diff confirmed to be 223 insertions / 8 deletions with no whole-file rewrites |

### 19.5 The mutation test - why the enforcement tests are believed

An enforcement suite can pass while enforcement is absent. That was tested rather
than argued: both enforcement sites were disabled behind a temporary flag, the
project rebuilt, and the suite re-run.

| Configuration | Result |
|---|---|
| Wiring present | **15/15 pass** |
| Both checks neutered | **8 of 9 enforcement tests FAIL** |
| Both checks neutered - the no-governance control | still passes (correct; it asserts the *absence* path) |

The flag was removed and the absence of any remnant verified. This is the check
that separates "available" from "enforced".

### 19.6 Test files

- `tests/governance.enforcement.test.ts` - 15 tests, 3 suites. Every test asserts
  on observable effects (was the adapter called, did routing run, what did the run
  claim, where did state settle), because a test that only checked "a DENY can be
  produced" would have passed against the PHASE 08 code unchanged.
- `tests/helpers/orchestrationHarness.ts` - gained an optional `governance`
  option, **absent by default**, so the whole existing suite still runs against the
  deployment shape in which governance is not installed.

### 19.7 Repo-wide audit and remaining limitations

Audit across all 142 `src` and all test TypeScript files:

| Check | Result |
|---|---|
| Files over 1000 lines | 4 - `authority.ts` (1513), `coordinator.ts` (1343), 2 test files |
| Duplicated 8-line blocks | 8 clusters, all pre-existing, all in settle/record paths |
| Empty or swallowed `catch` | **none** |
| Always-true / always-false conditions | **none** |
| Exported-but-never-imported | 420 - **heuristic, not confirmed dead code**; mostly discriminated-union members and public API surface, left alone |

Limitations that remain, stated plainly:

1. **No persistent policy store.** Rules are in-process.
2. **No cryptographic tamper-evidence.** The audit log is redacting and in-process.
3. **No RBAC primitive.** Roles and grants are data; resolution is the caller's.
4. **A throwing `narrowRouting` fails open** to no-narrowing. Contained and
   tested, and the hard filter still applies, so it is a limitation rather than a
   hole - but revisit it if a restriction ever becomes a security boundary rather
   than a cost/control one.
5. **`authority.ts` and `coordinator.ts` are still over 1000 lines.** Both were
   already over before PHASE 09. Splitting the settle paths is a refactor with real
   regression risk and no bearing on enforcement; deferred rather than smuggled in.
6. **All PHASE 07 delivery limits stand** - in-memory job state, single-process
   scope, no distributed lock, no exactly-once claim, bounded waves.
7. **No live provider, MCP, or external E2E.** Every test uses local doubles.
8. **Multi-tenant isolation is not implemented.** `SecurityContext` carries a
   principal and a team; nothing enforces separation between tenants yet.

**Proposed PHASE 10:** durable job state and a policy store, tamper-evident audit,
multi-tenant isolation, and splitting the two oversized orchestrators. The two
architectural authorities most at risk are (5) and (8), not (1)-(4).
---

## PHASE 10 - Final Integration, Architecture Certification & Release Gate

> **Canonical architecture: `docs/FINAL_ARCHITECTURE.md`.**
> PHASE 10 was not a feature phase. It audited the system, fixed what was
> genuinely broken, and documented what is not what it claims.

### 20.1 What the audit found

The audit was code-over-documentation: git, then the docs, then the actual
implementations, then live probes against running code. Findings were verified by
execution rather than accepted from reading, and two of them were significant
enough that the only trustworthy response was to probe them.

#### 🔴 A fail-open cross-job approval bypass (FIXED — most serious finding)

Every job-scoped store in PHASE 07 was keyed by `taskId` **alone**. A `taskId` is
unique only *within* a job, so two jobs containing a task called `"step-1"`
collided, and last write won.

In `ApprovalRegistry` that produced a genuine security hole, demonstrated against
the pre-fix build:

| Gate open order | Job A (approved by operator) | Job B (never approved) | Result |
|---|---|---|---|
| A opens last | released | **released** | fail-OPEN bypass |
| A opens first | **blocked** | blocked | fail-closed |

An operator approving job A released job B's identically-named task with nobody
having approved it. Nothing validated global taskId uniqueness, and colliding
names like `"step-1"` are entirely ordinary to write.

#### 🔴 A class of job-identity defects behind it (FIXED)

The same root cause corrupted data and, in one place, returned wrong answers:

| Store | Was | Consequence |
|---|---|---|
| `ApprovalRegistry.#byTask` | `taskId` | the bypass above |
| `CheckpointStore.#byTask` | `taskId` | checkpoints from two jobs interleaved into one sequence |
| `ClaimRegistry` | `taskId` | one job's claim refused another's |
| `ExecutionCoordinator.#results` | `taskId` | `idempotent_replay` could return **another job's result** |
| `#executions`, `#attempts`, `#verdicts` | `taskId` | merged attempt history; wrong verdict lookup |
| `executionId` | `exec-${taskId}-${n}` | two jobs produced the **same** execution id and overwrote each other |

All are now keyed by a single `taskKey(jobId, taskId)` helper — one spelling, one
owner. `ExecutionAttempt` gained a `jobId` field for the same reason. 9 regression
tests in `tests/workflow.jobscope.test.ts`, each written to fail on the old code.

#### 🔴 Three test-integrity blockers in PHASE 09's own suite (FIXED)

Found by mutation-testing PHASE 09's claims rather than trusting them:

| Defect | Proof |
|---|---|
| `"narrows the REAL router"` used `FixedModelRouter` (which ignores `denied`) while its comment claimed the production router, and asserted only that the hook was *called* | neutering `applyRoutingRestriction` left **all 1,527 tests green** |
| The capability-boundary test's fixture default-denied at the *request* boundary first, so `authorizeSubtask` was never reached | neutering `authorizeSubtask` left **all 1,527 tests green** |
| `"keeps a policy denial and a configuration fault on opposite sides"` compared two string **literals** — a constant `true` — while asserting both were on the *same* side | could never fail |

All three rewritten. The replacement routing test is built so the answer is
unambiguous: it proves the banned provider *is* selectable without governance,
then denies it and requires that the only eligible provider yields **no route at
all** — an outcome the router's own preferences cannot produce. Both mutations
now fail at least one test.

#### 🔴 Redaction gaps and a drifted duplicate list (FIXED)

- `connectionString`, `connection_string`, `connstr`, `dsn` and `bearer` were
  absent from the sensitive-key denylist. `bearer` was covered only as a *value*
  shape, so a field named `bearer` holding a raw token was recorded verbatim.
- `state/store.ts` held a **second, hand-maintained copy** of that list, already
  missing six entries. It now defers entirely to `isSensitiveKey`.
- `config/validate.ts` interpolated `JSON.stringify(value)` into a validation
  message printed by the CLI. Now passed through `redactString`.

#### 🔴 All twelve orchestration config sections are inert (DOCUMENTED, not fixed)

Validated, defaulted, normalised, re-exported — and read by **no production
code**. There is no orchestration composition root; `orchestrationConfigFromApp`
is called only from tests. Around 30 documented environment variables validate
correctly and do nothing, including `TOZ_GOVERNANCE_ENFORCED` and
`TOZ_GOVERNANCE_BLOCK_ON_UNKNOWN_COST`.

The tests that appear to cover them assert only that the config *object* is
produced. Closing this is composition work, not certification work, so it is
documented as **inactive** in `docs/FINAL_ARCHITECTURE.md` §17 as §22 requires.

#### 🔴 Multi-tenant classification: D — unsafe for multi-tenant deployment

Unpartitioned **and** undeclared. No tenant id exists anywhere in `src/`;
`Job.owner` is write-only (its comment claiming it was "used for scoping" has
been corrected here, because a false claim at the point of use is the real
hazard); every registry is a flat process-global map; `SecurityContext` has no
tenant field; `AuditSink.read()` takes no filter. Full analysis and the six-step
structural fix required are in `docs/FINAL_ARCHITECTURE.md` §23.

#### ⚠️ Dead enforcement function (DOCUMENTED, not deleted)

`authoriseExecution` (`workflow/worker.ts`) is exported, unit-tested in five
places, and **called by nothing** — `ExecutionCoordinator.executeTask`
re-implements its checks inline. Tested-but-unused enforcement is a specific trap:
a reader reasoning about "where is execution authorised?" lands there first. It is
now labelled at the definition rather than deleted, because removing an exported
symbol is a wider decision than a certification phase should take.

#### ⚠️ Other documented findings

Observability is materially weaker than its types suggest (`errorClass` and
`durationMs` are never populated; `traceId` does not cross the workflow
boundary; 15 of 49 event kinds are never emitted; `TraceRecorder.#events` is
unredacted). Cancellation does not actually abort in-flight work. Budgets are
checked but not reserved. "Parallel" waves execute sequentially. The core config
layer accepts unknown sections and keys silently, contradicting the stricter
orchestration layer in the same repository. All in §24 of the final document.

### 20.2 Files changed

| File | Change |
|---|---|
| `src/orchestration/workflow/gates.ts` | `taskKey()` added; `ApprovalRegistry`, `CheckpointStore` keyed by job+task (the security fix) |
| `src/orchestration/workflow/coordinator.ts` | stores keyed by job+task; `executionId` includes jobId; readers take `jobId` |
| `src/orchestration/workflow/claims.ts` | `ClaimRegistry` keyed by job+task |
| `src/orchestration/workflow/model.ts` | `ExecutionAttempt.jobId` added; false `owner` scoping claim corrected |
| `src/orchestration/workflow/worker.ts` | dead `authoriseExecution` labelled |
| `src/audit/redaction.ts` | `bearer`, `connectionString`, `connstr`, `dsn` added |
| `src/state/store.ts` | drifted duplicate denylist removed; defers to `isSensitiveKey` |
| `src/config/validate.ts` | validation message value redacted |
| `tests/workflow.jobscope.test.ts` | **new** — 9 regression tests for the bypass and the class |
| `tests/governance.enforcement.test.ts` | 3 blockers rewritten; now mutation-proven |
| `docs/FINAL_ARCHITECTURE.md` | **new** — canonical architecture, 25 sections |
| `PROJECT_STATE.md` | this section; identity table corrected (it still said PHASE 04.1) |

### 20.3 Mutation verification

The standard PHASE 09 set, extended. Each mutation must fail at least one test.

| Mutation | Before PHASE 10 | After PHASE 10 |
|---|---|---|
| Both governance enforcement sites disabled | 8/9 failed | 8/9 failed (preserved) |
| `applyRoutingRestriction` neutered | 🔴 **all 1,527 passed** | ✅ **1 test fails** |
| `authorizeSubtask` neutered | 🔴 **all 1,527 passed** | ✅ **1 test fails** |
| Cross-job approval collision present | 🔴 **bypass reproduced** | ✅ **1 test fails** |

### 20.4 Large-file assessment (determination, not a refactor)

PHASE 09 flagged `authority.ts` and `coordinator.ts` as over 1,000 lines and
declined to split them, saying the judgement call belonged to a later phase. This
is that phase, so the call was made rather than deferred again.

| File | Lines | Decision |
|---|---|---|
| `orchestration/authority.ts` | 1,513 | **Do not split** |
| `orchestration/workflow/coordinator.ts` | 1,357 | **Do not split** |
| `orchestration/governance/policy.ts` | 652 | fine |

**Conclusion: the size is stylistic, not a correctness or safety risk, so no
split was performed.** The reasoning, since "it is big" is not by itself an
answer:

- **Actual responsibility concentration is coherent.** `authority.ts` is the
  single orchestration entry point and its length is the sequence itself:
  screen → authorize → classify → plan → drift → recall → topology → per-subtask
  → verify → settle. Splitting it would spread one linear decision sequence across
  files, and the PHASE 09 governance seam would no longer be readable inline where
  it matters. The one part that genuinely did not need that context — the
  authorization primitives — was already extracted to
  `governance/enforcement.ts` in PHASE 09, and that is the correct precedent:
  extract when the code needs *different* context, not when the file is long.
- **No hidden authority duplication.** The file's authority is single and
  structural: it is the only caller of `ModelRouter` and of `AgentAdapter.execute`
  in the orchestration path, confirmed by grep and by the architecture tests.
- **No circular dependencies.** `coordinator.ts` imports `gates.ts` and
  `claims.ts` one-way; neither imports back. Governance imports only *types* from
  trust, capability, operations and decision, plus redaction — no router, no
  orchestrator, no memory.
- **Testability is good.** Both are exercised through the real harness, and the
  mutation results in §20.3 show the boundaries are genuinely detected when they
  move.
- **Change risk is high, benefit is low.** The PHASE 10 work already touched
  `coordinator.ts` extensively for the security fix and needed a full-suite run
  each time. A cosmetic split would multiply that risk during a certification
  phase, in a phase whose brief explicitly says not to refactor for style.

The remaining risk is reviewer ergonomics, not correctness, and it is mitigated by
the module headers and by `docs/FINAL_ARCHITECTURE.md` §3 and §12, which give the
ordered walkthrough the file's length otherwise obscures.

### 20.5 Release gate

All 39 gate conditions are recorded in the final report. Summary:

- Phases 01–09 green; typecheck, lint, build clean; **1,537/1,537** tests, 230
  suites, 0 skipped, 0 todo.
- Architecture isolation intact; authority matrix holds; governance enforced;
  **one** approval authority (bypass now closed); **one** routing authority;
  **one** memory authority; **one** verification authority; worker remains
  execution-only; delegation cannot escalate; unknown cost cannot pass as zero.
- Idempotency, concurrency, observability, redaction and configuration all
  audited and classified.
- No fake persistence, distributed lock, exactly-once, health, or MCP. Ruflo
  remains optional; Agency remains specialist-only.
- Multi-tenant status explicitly classified **D**; large-file risk explicitly
  classified; documentation matches the implementation.

**PASS, with the caveat that "PASS" here means the implementation satisfies its
documented architecture and its documented non-guarantees — not that the system
is production-ready. It is a certified library and reference architecture, and
`docs/FINAL_ARCHITECTURE.md` §24–25 say plainly what that excludes.**
---

## 21. PRODUCT SURFACE COMPLETION (delivering the §13 inner pages)

> **Naming.** The brief for this work called it "PHASE 05". In this repository
> **PHASE 05 is already delivered** — it is *Memory, Knowledge and Learning*
> (commit `c8648a6`) — and PHASE 06 through PHASE 10 are complete. Re-using the
> number would have produced two different PHASE 05s in a project that is its own
> source of truth. The owner chose to record this work under its existing
> tracking item, **§13 PHASE 04 (INNER PAGES)**, which is what it actually was.
> Commit prefix: `feat(phase-04-inner-pages)`.
>
> The brief's stated baseline (`e125867`, "1093/1093 tests") was five commits and
> 444 tests behind reality. The audit ran before any edit, which is how the
> discrepancy was caught rather than acted on.

### 21.1 Scope delivered

Full detail, defect log and K-* gaps in **§13**. Summary: 5 new inner page
surfaces, 7 generated capability detail pages, breadcrumbs, a generated sitemap,
robots.txt, JSON-LD structured data, and per-page metadata — built entirely from
design-system primitives, with no new runtime dependency and no change to the
orchestration layer.

### 21.2 Architecture protection — verified, not asserted

| Rule | Result |
|---|---|
| `TozOrchestrator` remains the sole task-state authority | **PASS** — the site layer contains no reference to it, and imports no core module |
| No UI/page/component mutates orchestration state | **PASS** — grep for state APIs in `src/site` and `src/design-system` returns nothing |
| Dynamic agent selection deterministic | **PASS** — untouched; no orchestration code changed |
| Learning opt-in, tie-break-only, OFF by default | **PASS** — untouched |
| Memory read and write permissions remain separate | **PASS** — untouched |
| Agency is a capability source only | **PASS** — no Agency reference anywhere in the site layer |
| Ruflo is not a dependency, brain or orchestrator | **PASS** — no Ruflo reference in the site layer; `dependencies` is still empty |
| No agent, Agency capability or Ruflo capability invented | **PASS** — every capability on the site comes from `CAPABILITIES`; every architecture claim points at a real directory, asserted by test |
| No fabricated external integration | **PASS** — the site names no vendor, model or connected system |
| No bypass of adapters/interfaces | **PASS** — the site layer imports only the design system |
| Backwards compatibility with PHASE 01-04.1 | **PASS** — full suite green, including all pre-existing site tests |

### 21.3 Tests added and changed

**Added** — `tests/site.innerPages.test.ts`, 59 tests across 10 suites: routing
(including the generated detail routes), content, internal linking, metadata,
structured data, sitemap, robots, "no fabricated facts", accessibility, exports.

**Changed** — four pre-existing assertions whose *rule* was correct but whose
*permitted set* had legitimately grown. In each case the invariant was preserved
or strengthened, and the reason is recorded in the test:

| Test | Change |
|---|---|
| `site.content.test.ts` "points every navigation item at a real section" | Now accepts a real section **or** a registered route. The no-unbuilt-route rule is unchanged. |
| `site.content.test.ts` "does not link to any route other than the homepage" | Replaced by "links only to routes that exist" — the same rule, now checkable. |
| `site.render.test.ts` "declares no structured data" | Inverted **and strengthened**: structured data must now be present, parseable, and free of 9 fabricated-fact properties. |
| `site.render.test.ts` "ships no JavaScript at all" | Renamed "ships no executable JavaScript"; a `ld+json` data island is inert. External scripts, inline executable script and `javascript:` URLs are still forbidden. |
| `site.architecture.test.ts` `siteClassesUsed()` | Scans every route instead of the homepage, so an inner-page class is no longer reported as dead CSS. |

No test was deleted. No assertion was weakened to make the suite pass.

### 21.4 Verification

| Gate | Result |
|---|---|
| Unit + integration tests | **1598/1598**, 240 suites, 0 skipped, 0 todo |
| Typecheck | PASS |
| Lint | PASS |
| Build | PASS |
| `config:validate` | PASS |
| `site:build` | PASS — 14 pages, 11 indexable, sitemap + robots emitted |
| `ui:preview` | PASS |
| Route verification | PASS — every route resolves to itself; unknown paths reach 404 |
| Metadata | PASS — unique title + canonical per page; OG and Twitter on every page |
| Sitemap | PASS — covers exactly the indexable routes, no duplicates, absolute URLs |
| Robots | PASS — points at the sitemap; disallows only the error document |
| Structured data | PASS — parseable, graph-shaped, 9 forbidden properties asserted absent |
| Regression vs PHASE 01-04.1 | PASS — including all 31 pre-existing site-content tests and 52 render tests |

Test count: 1537 before this phase, **1598** after (+61).
---

## 22. CLOSURE RECORD

The project is **CLOSED**. This section is the handover: what was built, what
state it is in, what is deliberately unfinished, and what must not be assumed.

### 22.1 Final state

| | |
|---|---|
| Final commit | `c17bed2` |
| Working tree | clean — nothing uncommitted |
| Tests | **1598/1598**, 240 suites, 0 skipped, 0 todo |
| Gates | typecheck, lint, build, `site:build`, `ui:preview`, `config:validate` — all PASS |
| Runtime dependencies | **zero** — `dependencies` is empty |
| Canonical architecture | `docs/FINAL_ARCHITECTURE.md` |
| Phase history | PHASE 00–10, plus §13 inner pages. PHASE 01–04.1 history above is unchanged. |

Delivered across the phases: a single-authority orchestration fabric, agent /
provider / model registries, deterministic capability routing, memory and
learning, background workflows with idempotency and approval gates, a governance
control plane that is **enforced** on the execution path, and a documentation
site with generated routes, sitemap, robots and structured data.

### 22.2 What remains open — read this before using the system

**Five known gaps, all recorded rather than hidden.**

| Gap | What it means |
|---|---|
| **K-11** | The site's responsive layout was never viewed in a real browser or at a real viewport. Verification was structural. **This is the weakest part of the delivery.** Someone should open the pages at 375 / 768 / 1440px before publishing. |
| **K-09 / K-10** | `/projects` and `/blog` are routes with honest empty pages, `noindex`. No case studies or articles were written, because the repository contains no client, metric or article to report. |
| **K-12** | `sitemap.xml` and `robots.txt` are structurally validated only. Never submitted to, or checked by, a real crawler. |
| **K-13** | `og:image` deliberately not emitted — no image asset exists. |

**Sixteen architectural limitations** are catalogued in
`docs/FINAL_ARCHITECTURE.md` §24, with the explicit non-guarantees in §25. The
three that most constrain what this system may be used for:

- 🔴 **No durable persistence.** ~38 process-local stores. A restart loses
  cancellations, budget accounting, idempotency memory and approval state — and
  losing those **removes a safety stop** rather than merely losing history.
- 🔴 **Not multi-tenant safe.** Classification **D** — unpartitioned *and*
  undeclared. Two callers in one process share every registry, every memory
  scope and every job. See `FINAL_ARCHITECTURE.md` §23.
- 🔴 **~30 documented configuration settings are inert.** All twelve
  orchestration config sections validate correctly and are read by no production
  code. See `FINAL_ARCHITECTURE.md` §17.

### 22.3 What this system is, stated precisely

It is a **certified library and reference architecture**, not a service. There is
no HTTP server, no job-running CLI, no database and no provider client.

"PASS" throughout this record means *the implementation satisfies its documented
architecture and its documented non-guarantees*. It does **not** mean
production-ready. `docs/FINAL_ARCHITECTURE.md` §25 lists what is explicitly not
guaranteed, and that list is the honest boundary of the delivery.

### 22.4 If this is picked up again

Start at `docs/FINAL_ARCHITECTURE.md`. §24 and §25 are the two sections that
matter, because they state what the system is not.

The highest-value work, in order:

1. **Multi-tenant isolation** (§23) — the largest structural gap, and the only
   one that makes a deployment actively unsafe rather than merely incomplete.
2. **A composition root for orchestration** (§17) — turns ~30 validated,
   currently inert settings into working configuration.
3. **Durable job state** (§22) — removes the restart hazards above.
4. **K-11** — open the site in a browser. Cheap, and it closes the last gap in
   the delivery.