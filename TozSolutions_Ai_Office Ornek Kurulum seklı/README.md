# TOZ AI Office

Core agent-orchestration infrastructure, a reusable design system, and the
primary marketing site.

**Current phase: PHASE 04.1** — Agency / Ruflo / fabric integration. See
`PROJECT_STATE.md` for scope, decisions and known issues, `ARCHITECTURE.md` for the
long-form reference, and `docs/PHASE04_MAP.md` plus `docs/PHASE041_GAP_MATRIX.md`
for the audits. Note that this repository's own plan also called PHASE 04
"inner pages"; that work is still outstanding (`PROJECT_STATE.md` §13).

## Status

**Core (PHASE 01)** — infrastructure only, no provider integrated:

- centralised, validated configuration (env + explicit object)
- provider registry with a controlled lifecycle
- model registry with referential integrity
- tri-state capability model and deterministic capability matching
- workload / task-requirement model
- bounded task queue with a controlled task state machine
- logical vs physical concurrency, with a hierarchical concurrency limiter
- retry / failover with permanent errors that can never be retried
- provider health model and monitor
- routing: hard deterministic filter + weight-free deterministic scorer
- audit event model with secret redaction
- namespaced, versioned state store
- optional knowledge-layer port (boundary only; no implementation)

**Design system (PHASE 02)** — framework-agnostic, server-renderable:

- semantic token system (colour, typography, spacing, radius, elevation,
  borders, motion, breakpoints) with dark-first and light themes
- layout primitives: container, section, main, grid, stack, cluster, centred
- components: button, link, card, badge, media, nav, form, feedback, status,
  overlay
- accessibility built into the structure: labels by id, `aria-invalid`,
  live-region roles, native `<dialog>`, skip link, visible focus
- **no provider is integrated or registered; the registries ship empty**

**Site (PHASE 03)** — server-rendered, zero JavaScript:

- homepage route and a not-found page, via a minimal route table
- hero, value proposition, capabilities, how-it-works, architecture,
  reliability, next step and footer
- inline SVG diagrams: no asset request, no WebGL, no 3D
- capability-oriented copy with no invented statistics, customers or awards
- responsive from 320px upward, with reduced-motion support

**Orchestration fabric (PHASE 04)** — one authority, everything else subordinate:

- `TozOrchestrator`: the only component that may advance a task; every early
  exit ends in a terminal state with a classified error and a reason
- agent registry with an explicit lifecycle, plus an `AgentAdapter` port that is
  a leaf (a future Ruflo or remote adapter implements it; none ships)
- open capability names: an agent may declare `web_research` or
  `entity_extraction` without a change to the core
- specialist pool: hard filter, then deterministic order, with a reason for every
  selected *and* rejected candidate
- team and swarm runtime over six topologies, choosing the smallest sufficient
  one and propagating failure to everything downstream
- evidence and verification as separate types: `pass` / `fail` / `needs_review`,
  where "cannot tell" escalates and never reads as "passed"
- scoped memory with separate read and write grants, tools with explicit
  invocation permission, outcome records that are deliberately **not** fed back
  into selection
- anti-drift limits, input/output policy seams, bounded background workers,
  resource attribution, and an extension registry that refuses a second
  orchestrator
- **no Ruflo package is installed, and no provider is integrated**

**PHASE 04.1 integration** — one-way, leaf-shaped, and honest about what is absent:

- agent sources: external rosters are normalised onto the same contract as native
  agents, and an ingested agent arrives **disabled** — a source cannot hand the
  system something that runs
- agency agents are a capability source and nothing else; the adapter is inert
  until a transport is attached, and reports a classified error rather than
  pretending to have executed
- a routed provider is only recorded when a provider adapter exists to serve it
- tool calls are authorised, bounded and recorded as evidence; an agent may call
  only what it declared
- subtask `maxRetries` is honoured, and only transient failures are retried;
  credential and quota failures escalate instead
- evidence carries provenance: which attempt, which sequence, which agent
- learning signals are opt-in, tiebreak-only, and can never change eligibility
- model QA checks that the output agrees with the record that describes it
- **no agency transport, no provider adapter, and no Ruflo package exist** — the
  boundaries are complete, the integrations are not, and nothing pretends

**Not implemented, by design:** provider adapters, live discovery, inner pages,
AnythingLLM, n8n, owner console, lead capture, 3D and scroll choreography.

## Requirements

- Node.js >= 22 (developed on v24.21.0)
- npm 11.x
- OpenCode 1.18.32 (see `PROJECT_STATE.md` for the toolchain constraint)

On Windows PowerShell, use `npm.cmd` / `npx.cmd` rather than `npm` / `npx`:
the `.ps1` wrappers are blocked by the machine execution policy, which is
deliberately left unmodified.

## Commands

| Command | Purpose |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (type-aware) |
| `npm run build` | Compile to `dist/`, then copy CSS assets |
| `npm test` | Build, then run the full test suite |
| `npm run test:unit` | Run tests against the existing `dist/` |
| `npm run validate` | typecheck + lint + tests |
| `npm run config:validate` | Validate configuration (`-- --defaults` for shipped defaults) |
| `npm run ui:preview` | Build and render the component gallery to `dist/preview/index.html` |
| `npm run site:build` | Render the site to `dist/site/index.html` and `404.html` |

`app.environment` (`TOZ_ENV`) is the only required configuration value. Copy
`.env.example` to `.env` for local settings; `.env` is git-ignored and must
never be committed.

## Four trees, one direction

The package exposes **four** entry points, and the reason matters:

```ts
// Headless core. No UI, no DOM, no CSS.
import { createCore } from "toz-ai-office";

// Design system. Strings to HTML, plus CSS.
import { button, card, container } from "toz-ai-office/design-system";

// Marketing site. Consumes the design system and nothing else.
import { renderHome } from "toz-ai-office/site";

// Orchestration fabric. Composes the core into an execution.
import { TozOrchestrator } from "toz-ai-office/orchestration";
```

The dependency direction is strictly one-way:

```
core  ←  design-system  ←  site
core  ←  orchestration
```

Nothing in the core imports the design system, the site or the orchestration
layer; nothing in the design system imports any of them. The site may use the
design system but must not reach into the orchestration core, so a marketing page
never ends up behind the runtime. `tests/designSystem.phase01Isolation.test.ts`
and `tests/site.architecture.test.ts` enforce this by resolving every import in
all four trees.

## Design system at a glance

Components return HTML **strings**, not a framework tree, and there is no UI
dependency at all. That keeps output server-renderable and makes the components
testable without a DOM — no jsdom, no browser, no test framework.

Load the four stylesheets in cascade order:

```
/design-system/styles/tokens.css      # colour, type, spacing, motion values
/design-system/styles/base.css        # element defaults, focus, typography
/design-system/styles/layout.css      # container, section, grid, stack
/design-system/styles/components.css  # component classes
```

Or let the design system assemble the document shell:

```ts
import { htmlDocument, skipLink, main, container, button } from "toz-ai-office/design-system";

const page = htmlDocument({ title: "TOZ AI Office", theme: "dark" });
// ... splice skipLink() + main() + content into <body>
```

Theme is CSS-only: `[data-theme="light"]` overrides the dark `:root` palette.
Switching needs no JavaScript. This phase ships no visible theme switcher, by
design — the brief asks for the foundation, not the feature.

Open `dist/preview/index.html` after `npm run ui:preview` to review every
component in a browser. It is a development gallery containing no product or
marketing content.

## Secrets

No secret value is stored in source, configuration, provider records, state, or
audit events. Credentials are referenced by variable name via `SecretRef`, and
resolved only at a provider-adapter boundary. The audit layer additionally
redacts credential-shaped values and sensitive field names on the way in.

## Architecture

`src/index.ts` is the core API. `createCore()` in `src/core/composition.ts` is
the single composition root; everything else takes its collaborators as
constructor arguments, which keeps the core testable and keeps provider specifics
at the edges.

`src/design-system/` is self-contained: `utils/` (escaping, class composition),
`tokens/` (token names and scale), `styles/` (token values and component CSS),
`layout/`, `primitives/`, `theme/`.

`src/orchestration/` is the orchestration fabric: `authority.ts` (the single
authority), `agent/`, `capabilities/`, `pool/`, `task/`, `team/`, `model/`,
`evidence/`, `verification/`, `memory/`, `tools/`, `feedback/`, `workers/`,
`observability/`, `policy/`, `extensions/`, `config/`. It composes the core's
registries, router and audit log; it never reimplements them.

`src/site/` is the marketing site: `content.ts` (copy as data, so claims are
inspectable and testable), `routes.ts` (route table and document rendering),
`meta.ts` (title, description, canonical, Open Graph), `home/` (one file per
section), `visuals/` (inline SVG), `styles/site.css` (page composition only —
it redefines no token).

## Building and viewing the site

```
npm run site:build
```

Then open `dist/site/index.html` directly, or serve `dist/site/` with any static
file server. The build is plain HTML and CSS with **no JavaScript at all**:
navigation uses a native `<details>` disclosure and the diagrams are inline SVG.

To check the site against the design system itself, `npm run ui:preview` renders
a component gallery to `dist/preview/index.html`.

**No browser automation is installed** (no Playwright, Puppeteer or Cypress),
so responsive and contrast behaviour is verified statically — see K-11 in
`PROJECT_STATE.md`. The rendered pages should be opened in a browser before
relying on them.
