/**
 * Site-level content model.
 *
 * Content is DATA, not markup, for three reasons:
 *
 *  1. The content-integrity test can assert that no fabricated claim reaches the
 *     page, because the claims are inspectable in one place.
 *  2. The navigation is derived from the section list, so a link can never point
 *     at a section that does not exist.
 *  3. Sections stay pure renderers with no copy embedded, so the same section
 *     could render a different market or locale later.
 *
 * CONTENT INTEGRITY: no customer names, logos, testimonials, awards,
 * certifications, revenue, user counts, performance or uptime figures, case
 * study results, years of experience, partnerships, media coverage, regulatory
 * claims, or enterprise customer references appear anywhere in this file or in
 * any section. Copy is capability-oriented and describes what the architecture is
 * built to do. Where a capability is designed but not yet implemented, the copy
 * says so rather than implying availability.
 */

import type { StatusTone } from "../design-system/tokens/colors.js";

export const SITE_NAME = "TOZ AI Office" as const;

/**
 * Canonical origin.
 *
 * The repository contains no verified production domain, so this is a neutral
 * placeholder used only to form the canonical URL. It is deliberately not
 * presented to visitors as a real address anywhere on the page.
 */
export const CANONICAL_ORIGIN = "https://example.invalid" as const;

export const DEFAULT_LOCALE = "en" as const;

/** Section ids. The single source for both section anchors and navigation. */
export const SECTION_IDS = {
  hero: "hero",
  capabilities: "capabilities",
  howItWorks: "how-it-works",
  architecture: "architecture",
  reliability: "reliability",
  next: "next",
} as const;

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS];

/** Every route the site serves. The not-found page is deliberately registered. */
export const ROUTE_PATHS = {
  home: "/",
  about: "/about",
  capabilities: "/capabilities",
  contact: "/contact",
  projects: "/projects",
  blog: "/blog",
  notFound: "/404",
} as const;

/** Prefix for a capability detail page. Kept here so no route is spelled twice. */
export const CAPABILITY_PATH_PREFIX = "/capabilities/" as const;

/**
 * An anchor on the HOMEPAGE, spelled so it resolves from any page.
 *
 * PHASE 04 (inner pages) FIX. The header and footer are shared by every page, but
 * their links were bare fragments — `#hero`, `#architecture` — which resolve only
 * on the page they were written on. On `/about` every one of them was a dead link.
 *
 * The old link check missed it: it validated an anchor against the HOMEPAGE's
 * ids, which was correct while the homepage was the only page. On a site with
 * more than one page it is the wrong check, and the new one validates an anchor
 * against the page actually carrying it.
 *
 * One helper, so the `/#` spelling exists in exactly one place.
 */
export function homeAnchor(sectionId: SectionId): string {
  return `/#${sectionId}`;
}

/** The absolute path of one capability's detail page. */
export function capabilityPath(capabilityId: string): string {
  return `${CAPABILITY_PATH_PREFIX}${capabilityId}`;
}

export interface NavItem {
  readonly label: string;
  /**
   * A link target, which is EITHER an in-page anchor or a registered route.
   *
   * A new inner-page item is registered alongside the page it links to, in the
   * same change. That is the rule: a navigation entry never points at a route
   * that does not exist, which is why `site.content.test.ts` resolves every
   * target against both the section ids and the route table.
   */
  readonly href: string;
  /**
   * The homepage section this item targets, when it targets one.
   *
   * Optional because inner-page items target a page, not a section. It is `null`
   * rather than a placeholder string so "targets a section" stays a checkable
   * fact instead of a convention.
   */
  readonly sectionId: SectionId | null;
}


export interface NavModel {
  readonly items: readonly NavItem[];
  readonly primaryCta: { readonly label: string; readonly href: string };
  readonly ariaLabel: string;
}

/**
 * Navigation.
 *
 * Two kinds of entry, and the distinction is deliberate:
 *
 *   - In-page anchors to homepage sections, which is what PHASE 03 shipped.
 *   - Links to inner pages, which exist now that §13's inner pages are built.
 *
 * Every entry resolves. A nav item may point at a real section or a registered
 * route, and `site.content.test.ts` checks both, so adding a page and linking to
 * it in the same change is the only way an entry can exist.
 */
export const NAVIGATION: NavModel = {
  ariaLabel: "Primary",
  items: [
    { label: "Capabilities", href: ROUTE_PATHS.capabilities, sectionId: null },
    { label: "How it works", href: homeAnchor(SECTION_IDS.howItWorks), sectionId: SECTION_IDS.howItWorks },
    { label: "Architecture", href: homeAnchor(SECTION_IDS.architecture), sectionId: SECTION_IDS.architecture },
    { label: "Reliability", href: homeAnchor(SECTION_IDS.reliability), sectionId: SECTION_IDS.reliability },
    { label: "About", href: ROUTE_PATHS.about, sectionId: null },
  ],
  primaryCta: { label: "Contact", href: ROUTE_PATHS.contact },
};

/**
 * Footer navigation.
 *
 * Separate from the primary bar because a footer is a site index, not a reading
 * path: it lists the surfaces a visitor uses to orient themselves, including the
 * two pages that exist but hold no content yet (§13 K-09, K-10).
 */
export const FOOTER_NAVIGATION: readonly NavItem[] = [
  { label: "Home", href: ROUTE_PATHS.home, sectionId: null },
  { label: "About", href: ROUTE_PATHS.about, sectionId: null },
  { label: "Capabilities", href: ROUTE_PATHS.capabilities, sectionId: null },
  { label: "Contact", href: ROUTE_PATHS.contact, sectionId: null },
  { label: "Projects", href: ROUTE_PATHS.projects, sectionId: null },
  { label: "Blog", href: ROUTE_PATHS.blog, sectionId: null },
];

export interface HeroContent {
  readonly eyebrow: string;
  readonly headline: string;
  readonly summary: string;
  readonly primaryCta: { readonly label: string; readonly href: string };
  readonly secondaryCta: { readonly label: string; readonly href: string };
}

export const HERO: HeroContent = {
  eyebrow: "AI orchestration infrastructure",
  headline: "AI infrastructure that turns complex workflows into coordinated execution.",
  summary:
    "TOZ AI Office coordinates agents, models and providers behind a single control " +
    "plane. Work is queued, matched to capabilities, executed under explicit limits, " +
    "and recorded for audit — so automation is designed rather than improvised.",
  primaryCta: { label: "Explore the platform", href: `#${SECTION_IDS.capabilities}` },
  secondaryCta: { label: "See how it works", href: `#${SECTION_IDS.howItWorks}` },
};

export interface ValueItem {
  readonly title: string;
  readonly body: string;
}

export const VALUE_PROPOSITION: {
  readonly eyebrow: string;
  readonly headline: string;
  readonly summary: string;
  readonly items: readonly ValueItem[];
} = {
  eyebrow: "Why it matters",
  headline: "Automation fails quietly when the underlying decisions are implicit.",
  summary:
    "Most automation breaks not because a model is weak, but because nobody can say " +
    "why a particular route, provider or retry was chosen, or whether the system was " +
    "healthy at the time. TOZ AI Office makes those decisions explicit and inspectable.",
  items: [
    {
      title: "Decisions are recorded, not assumed",
      body:
        "Every routing, retry and fallback decision produces a structured event, so " +
        "execution history can be reconstructed instead of guessed at.",
    },
    {
      title: "Limits are enforced, not suggested",
      body:
        "Concurrency, queue depth and retry budgets are bounded in code. Backpressure " +
        "propagates instead of degrading into unbounded work.",
    },
    {
      title: "Uncertainty is never rounded up",
      body:
        "Capabilities carry an explicit unknown state. A provider that has not been " +
        "verified is not treated as capable, which prevents confident wrong routing.",
    },
  ],
};

/**
 * Capability cards.
 *
 * `status` states what exists, not what is promised. `building` marks a
 * capability that is architecturally planned but not yet implemented, so the page
 * never implies availability it cannot back up.
 */
export interface CapabilityItem {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly status: "available" | "building";
  readonly statusLabel: string;
  readonly tone: StatusTone;
}

export const CAPABILITIES: readonly CapabilityItem[] = [
  {
    id: "orchestration",
    title: "Agent orchestration",
    body:
      "Coordinate specialised agents and the work they own. Tasks move through an " +
      "explicit state machine rather than an ad-hoc sequence of calls.",
    status: "available",
    statusLabel: "Core architecture",
    tone: "success",
  },
  {
    id: "routing",
    title: "Model and provider routing",
    body:
      "Match a workload to model and provider capabilities, context requirements and " +
      "health, with a deterministic filter before any scoring is applied.",
    status: "available",
    statusLabel: "Core architecture",
    tone: "success",
  },
  {
    id: "workflow",
    title: "Workflow automation",
    body:
      "Carry work through a fixed pipeline — queue, schedule, limit, select, execute, " +
      "validate, record — with the same guarantees on every run.",
    status: "available",
    statusLabel: "Core architecture",
    tone: "success",
  },
  {
    id: "software",
    title: "Software engineering support",
    body:
      "Represent coding, debugging, testing and documentation as first-class workloads " +
      "with their own capability and tool requirements.",
    status: "available",
    statusLabel: "Core architecture",
    tone: "success",
  },
  {
    id: "observability",
    title: "Observability and control",
    body:
      "Track task state, provider health, failure classification and resource pressure " +
      "through a single event stream.",
    status: "available",
    statusLabel: "Core architecture",
    tone: "success",
  },
  {
    id: "knowledge",
    title: "Knowledge systems",
    body:
      "A defined port for document and retrieval systems, so contextual knowledge can " +
      "be attached without becoming a dependency of the orchestrator.",
    status: "building",
    statusLabel: "Boundary defined",
    tone: "info",
  },
  {
    id: "external",
    title: "External automation",
    body:
      "A defined port for scheduled and event-driven workflow engines, kept optional so " +
      "the core runs independently of any external system.",
    status: "building",
    statusLabel: "Boundary defined",
    tone: "info",
  },
];

export interface ProcessStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export const HOW_IT_WORKS: {
  readonly eyebrow: string;
  readonly headline: string;
  readonly summary: string;
  readonly steps: readonly ProcessStep[];
} = {
  eyebrow: "How it works",
  headline: "One pipeline, applied to every request.",
  summary:
    "Each request follows the same ordered path. The stages are independent, so a " +
    "failure is attributed to one stage rather than to the system as a whole.",
  steps: [
    {
      id: "request",
      title: "Request",
      body: "Work is submitted with an explicit task identifier and an input that carries no secrets.",
    },
    {
      id: "analysis",
      title: "Task analysis",
      body: "The request is classified into a workload with its own capability, context and reliability requirements.",
    },
    {
      id: "matching",
      title: "Capability matching",
      body: "Requirements are checked against what each candidate is verified to support. Unverified capabilities are not treated as support.",
    },
    {
      id: "selection",
      title: "Agent and provider selection",
      body: "Eligible candidates are ordered deterministically by recorded facts, never by list position or round robin.",
    },
    {
      id: "execution",
      title: "Execution",
      body: "The task runs under enforced physical limits, with a lease that must be released explicitly.",
    },
    {
      id: "validation",
      title: "Validation",
      body: "Results are checked and failures are classified, so a retry decision is based on cause rather than on symptom.",
    },
    {
      id: "result",
      title: "Result and audit",
      body: "The outcome, its duration and the reason for every decision along the way are recorded as structured events.",
    },
  ],
};

/**
 * Architecture layers.
 *
 * `sourcePath` points at the real module that implements each layer. The test
 * suite asserts every path exists, which is what stops this from becoming a
 * diagram disconnected from the implementation.
 */
export interface ArchitectureLayer {
  readonly id: string;
  readonly name: string;
  readonly body: string;
  /** Real directory under `src/` that implements this layer, relative to the repo root. */
  readonly sourcePath: string;
  readonly optional: boolean;
}

export const ARCHITECTURE: {
  readonly eyebrow: string;
  readonly headline: string;
  readonly summary: string;
  readonly layers: readonly ArchitectureLayer[];
} = {
  eyebrow: "Architecture",
  headline: "Layered so that each concern can change without rewriting the others.",
  summary:
    "The system is built as a set of boundaries rather than a single pipeline. That " +
    "is what allows a new provider, a new model or a new knowledge source to be " +
    "added without touching the orchestration core.",
  layers: [
    {
      id: "orchestration",
      name: "Orchestration",
      body: "Coordinates work: task state, scheduling and the execution pipeline.",
      sourcePath: "src/queue",
      optional: false,
    },
    {
      id: "intelligence",
      name: "Intelligence",
      body: "Provider and model registries, capability matching and routing decisions.",
      sourcePath: "src/routing",
      optional: false,
    },
    {
      id: "execution",
      name: "Execution",
      body: "Concurrency limits, retries and failover under a single, explicit policy.",
      sourcePath: "src/concurrency",
      optional: false,
    },
    {
      id: "knowledge",
      name: "Knowledge",
      body: "An optional port for retrieval and document context. The core runs without it.",
      sourcePath: "src/knowledge",
      optional: true,
    },
    {
      id: "observability",
      name: "Observability",
      body: "Structured audit events and a provider health model that can influence selection.",
      sourcePath: "src/audit",
      optional: false,
    },
  ],
};

export interface ReliabilityPrinciple {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export const RELIABILITY: {
  readonly eyebrow: string;
  readonly headline: string;
  readonly summary: string;
  readonly principles: readonly ReliabilityPrinciple[];
} = {
  eyebrow: "Reliability",
  headline: "Engineering principles, not marketing claims.",
  summary:
    "The following are properties of the architecture. Each is enforced in code " +
    "rather than described in documentation, and each is covered by an automated test.",
  principles: [
    {
      id: "controlled-execution",
      title: "Controlled execution",
      body: "Task state changes only along declared transitions. No code path can set an arbitrary status.",
    },
    {
      id: "bounded-retries",
      title: "Bounded retries",
      body: "Retry budgets are validated to a fixed ceiling. Permanent failures are never retried, so no configuration can create an infinite loop.",
    },
    {
      id: "fallback",
      title: "Provider fallback",
      body: "Quota exhaustion escalates to a fallback candidate instead of consuming the remaining attempts against an exhausted provider.",
    },
    {
      id: "capability-routing",
      title: "Capability-aware routing",
      body: "A candidate that is not verified to support a required capability is withheld from production routing, not optimistically selected.",
    },
    {
      id: "health-aware",
      title: "Health-aware selection",
      body: "Health is a first-class input to eligibility, timestamped so a stale reading cannot masquerade as a current one.",
    },
    {
      id: "auditability",
      title: "Auditability",
      body: "Every lifecycle transition, retry, fallback and result is recorded as a structured event with a timestamp and duration.",
    },
    {
      id: "human-approval",
      title: "Human approval",
      body: "A provider cannot reach the production pool without passing through an explicit approval state.",
    },
    {
      id: "modularity",
      title: "Modularity",
      body: "Provider specifics are isolated behind an adapter interface, so adding a provider does not require editing the core.",
    },
  ],
};

export const NEXT_STEP: {
  readonly eyebrow: string;
  readonly headline: string;
  readonly body: string;
  readonly actions: readonly { readonly label: string; readonly href: string; readonly primary: boolean }[];
} = {
  eyebrow: "Next",
  headline: "Start with the architecture you can inspect.",
  body:
    "The platform is built to be examined before it is trusted. Review how work is " +
    "classified, how a route is chosen and what is recorded when something fails.",
  actions: [
    { label: "Review the architecture", href: `#${SECTION_IDS.architecture}`, primary: true },
    { label: "See how work is routed", href: `#${SECTION_IDS.howItWorks}`, primary: false },
  ],
};

export const FOOTER: {
  readonly description: string;
  readonly groups: readonly { readonly heading: string; readonly items: readonly NavItem[] }[];
  /** Omitted entirely: no verified contact details exist in the repository. */
  readonly showContact: false;
} = {
  description:
    "AI orchestration infrastructure for coordinated, auditable and bounded execution.",
  showContact: false,
  groups: [
    {
      heading: "Platform",
      items: [
        { label: "Capabilities", href: homeAnchor(SECTION_IDS.capabilities), sectionId: SECTION_IDS.capabilities },
        { label: "How it works", href: homeAnchor(SECTION_IDS.howItWorks), sectionId: SECTION_IDS.howItWorks },
      ],
    },
    {
      heading: "Technical",
      items: [
        { label: "Architecture", href: homeAnchor(SECTION_IDS.architecture), sectionId: SECTION_IDS.architecture },
        { label: "Reliability", href: homeAnchor(SECTION_IDS.reliability), sectionId: SECTION_IDS.reliability },
      ],
    },
  ],
};
