/**
 * Inner-page bodies.
 *
 * Each function returns the page's `<main>` content, wrapped in the shared shell
 * so every inner page gets the same landmarks, breadcrumb and heading structure.
 *
 * The capability pages are generated from `CAPABILITIES` in `content.ts` — the
 * same data the homepage renders. One source, so the homepage and the capability
 * pages cannot disagree about what the product does.
 *
 * NOT INVENTED, and deliberately so: no capability-to-architecture-layer mapping.
 * The two data sets do not share a key, and asserting one would be a fabricated
 * architectural claim. The architecture is presented on its own page instead,
 * with the real `sourcePath` of each layer.
 */

import { button } from "../../design-system/primitives/button.js";
import { card } from "../../design-system/primitives/card.js";
import { link } from "../../design-system/primitives/link.js";
import { html, type RawHtml } from "../../design-system/utils/html.js";
import {
  ARCHITECTURE,
  CAPABILITIES,
  RELIABILITY,
  ROUTE_PATHS,
  capabilityPath,
  type CapabilityItem,
} from "../content.js";
import { ABOUT, CONTACT, EMPTY_SURFACES } from "./content.js";
import { pageHeader, pageSection, pageShell, pageStack } from "./shell.js";

/* -------------------------------------------------------------------------- */
/* About                                                                       */
/* -------------------------------------------------------------------------- */

export function aboutPageBody(): RawHtml {
  return pageShell({
    title: "About",
    path: ROUTE_PATHS.about,
    breadcrumbs: [
      { label: "Home", href: ROUTE_PATHS.home },
      { label: "About" },
    ],
    children: html`${pageSection({
      children: pageHeader({
        eyebrow: ABOUT.eyebrow,
        title: ABOUT.title,
        summary: ABOUT.summary,
      }),
    })}
${pageSection({
      ariaLabel: "What this system is",
      children: html`<div class="toz-site-prose">
${ABOUT.paragraphs.map((paragraph) => html`<p>${paragraph}</p>`)}
</div>`,
    })}
${pageSection({
      ariaLabel: "Common questions",
      children: html`<h2 class="toz-type-h2">Common questions</h2>
<dl class="toz-site-faq">
${ABOUT.faq.map(
  (entry) => html`<div class="toz-site-faq-entry">
  <dt class="toz-site-faq-question">${entry.question}</dt>
  <dd class="toz-site-faq-answer">${entry.answer}</dd>
</div>`,
)}
</dl>`,
    })}
${pageSection({
      ariaLabel: "Reliability principles",
      children: html`<h2 class="toz-type-h2">${RELIABILITY.headline}</h2>
<p>${RELIABILITY.summary}</p>
${stackCards(
  RELIABILITY.principles.map((principle) => ({ title: principle.title, body: principle.body })),
)}`,
    })}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Capabilities index                                                          */
/* -------------------------------------------------------------------------- */

export function capabilitiesIndexBody(): RawHtml {
  return pageShell({
    title: "Capabilities",
    path: ROUTE_PATHS.capabilities,
    breadcrumbs: [
      { label: "Home", href: ROUTE_PATHS.home },
      { label: "Capabilities" },
    ],
    children: html`${pageSection({
      children: pageHeader({
        eyebrow: "Capabilities",
        title: "What the system does",
        summary:
          "Each capability has one authority and one place in the sequence. The pages " +
          "below describe what each one decides, and what it refuses to decide.",
      }),
    })}
${pageSection({
      ariaLabel: "All capabilities",
      children: html`<div class="toz-site-grid-cards">
${CAPABILITIES.map((capability) => capabilityCard(capability))}
</div>`,
    })}
${pageSection({
      ariaLabel: "Architecture",
      children: html`<h2 class="toz-type-h2">${ARCHITECTURE.headline}</h2>
<p>${ARCHITECTURE.summary}</p>
${stackCards(
  ARCHITECTURE.layers.map((layer) => ({
    title: layer.optional ? `${layer.name} (optional)` : layer.name,
    body: `${layer.body} Implemented in ${layer.sourcePath}.`,
  })),
)}`,
    })}`,
  });
}

function capabilityCard(capability: CapabilityItem): RawHtml {
  return card({
    as: "article",
    // h2, because on the capabilities index these cards are the page's
    // top-level content. h3 here produced an h1 -> h3 jump with no h2 between,
    // which is a heading-structure failure rather than a style choice.
    headingLevel: 2,
    title: capability.title,
    children: html`<p class="toz-type-body-sm toz-text-muted">${capability.body}</p>
<p class="toz-site-card-action">${link({
  href: capabilityPath(capability.id),
  children: `How ${capability.title.toLowerCase()} works`,
  variant: "standard",
})}</p>`,
  });
}

/* -------------------------------------------------------------------------- */
/* Capability detail                                                           */
/* -------------------------------------------------------------------------- */

export function capabilityDetailBody(capability: CapabilityItem): RawHtml {
  const others = CAPABILITIES.filter((candidate) => candidate.id !== capability.id);
  return pageShell({
    title: capability.title,
    path: capabilityPath(capability.id),
    breadcrumbs: [
      { label: "Home", href: ROUTE_PATHS.home },
      { label: "Capabilities", href: ROUTE_PATHS.capabilities },
      { label: capability.title },
    ],
    children: html`${pageSection({
      children: pageHeader({
        eyebrow: capability.statusLabel,
        title: capability.title,
        summary: capability.body,
      }),
    })}
${pageSection({
      ariaLabel: "What this capability decides",
      children: html`<div class="toz-site-prose">
<h2 class="toz-type-h2">What it decides</h2>
<p>${capability.body}</p>
<h2 class="toz-type-h2">What it does not do</h2>
<p>${capabilityBoundary(capability)}</p>
</div>`,
    })}
${pageSection({
      ariaLabel: "Other capabilities",
      children: html`<h2 class="toz-type-h2">Other capabilities</h2>
<ul class="toz-site-list-links">
${others.map(
  (item) => html`<li>${link({ href: capabilityPath(item.id), children: item.title })}</li>`,
)}
</ul>`,
    })}
${pageSection({
      ariaLabel: "Next step",
      children: html`<div class="toz-site-page-cta">
${button({ children: "Contact", href: ROUTE_PATHS.contact })}
${button({ children: "All capabilities", href: ROUTE_PATHS.capabilities, variant: "secondary" })}
</div>`,
    })}`,
  });
}

/**
 * The boundary statement for a capability.
 *
 * Written per capability, because a generic sentence would be a claim about
 * nothing. Each names the thing that capability is structurally prevented from
 * doing, which is the fact a reader evaluating the system actually needs.
 */
function capabilityBoundary(capability: CapabilityItem): string {
  switch (capability.id) {
    case "orchestration":
      return "It does not choose which model or provider runs a subtask, and it cannot " +
        "mark a result verified. Selecting an agent is its own decision, made against " +
        "the specialist pool.";
    case "routing":
      return "It does not decide whether work may run at all. An authorization decision " +
        "is made before routing and can remove candidates, but routing never grants or " +
        "refuses permission.";
    case "workflow":
      return "It does not advance a task on its own. A workflow describes a sequence; the " +
        "orchestrator decides when each step runs, and each step's state changes only " +
        "along declared transitions.";
    case "software":
      return "It does not execute code. It represents engineering work as a workload with " +
        "its own capability and tool requirements, and execution is delegated like any " +
        "other.";
    case "observability":
      return "It does not decide anything. It records what happened, and a recorded event " +
        "is not evidence that an outcome was correct.";
    case "knowledge":
      return "It does not learn from an unverified run, and it does not grant itself " +
        "access to a memory scope. Both are separate decisions with separate owners.";
    case "external":
      return "It does not invent an integration. An external system that is not connected " +
        "is reported as unavailable rather than simulated.";
    default:
      return `${capability.title} has one authority and no second.`;
  }
}

/* -------------------------------------------------------------------------- */
/* Contact                                                                     */
/* -------------------------------------------------------------------------- */

export function contactPageBody(): RawHtml {
  return pageShell({
    title: "Contact",
    path: ROUTE_PATHS.contact,
    breadcrumbs: [
      { label: "Home", href: ROUTE_PATHS.home },
      { label: "Contact" },
    ],
    children: html`${pageSection({
      children: pageHeader({
        eyebrow: CONTACT.eyebrow,
        title: CONTACT.title,
        summary: CONTACT.summary,
      }),
    })}
${pageSection({
      ariaLabel: "Ways to reach the project",
      children: pageStack(
        CONTACT.channels.map(
          (channel) => html`<div class="toz-site-prose">
<h2 class="toz-type-h2">${channel.heading}</h2>
<p>${channel.body}</p>
<p>${link({ href: channel.route, children: channel.linkLabel })}</p>
</div>`,
        ),
      ),
    })}
${pageSection({
      ariaLabel: "What is not available",
      children: html`<h2 class="toz-type-h2">What is not available</h2>
<p>Stated plainly rather than left to be inferred:</p>
<ul class="toz-site-list-plain">
${CONTACT.unavailable.map((item) => html`<li>${item}</li>`)}
</ul>`,
    })}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Empty surfaces: projects and blog                                          */
/* -------------------------------------------------------------------------- */

/**
 * Renders a surface that exists as a route but holds no entries.
 *
 * `noindex` lives in the page's metadata rather than here, so the visible page and
 * the crawler instruction cannot disagree about the same fact.
 */
export function emptySurfaceBody(kind: keyof typeof EMPTY_SURFACES): RawHtml {
  const surface = EMPTY_SURFACES[kind];
  const path = kind === "projects" ? ROUTE_PATHS.projects : ROUTE_PATHS.blog;
  return pageShell({
    title: surface.title,
    path,
    breadcrumbs: [
      { label: "Home", href: ROUTE_PATHS.home },
      { label: surface.title },
    ],
    children: html`${pageSection({
      children: pageHeader({
        eyebrow: surface.eyebrow,
        title: surface.title,
        summary: surface.summary,
      }),
    })}
${pageSection({
      ariaLabel: surface.heading,
      children: html`<div class="toz-site-prose">
<h2 class="toz-type-h2">${surface.heading}</h2>
<p>${surface.body}</p>
<p>${link({ href: surface.route, children: surface.linkLabel })}</p>
</div>`,
    })}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

function stackCards(items: readonly { readonly title: string; readonly body: string }[]): RawHtml {
  return html`<div class="toz-site-stack-cards">
${items.map(
  (item) => card({
    as: "article",
    headingLevel: 3,
    title: item.title,
    children: html`<p class="toz-type-body-sm toz-text-muted">${item.body}</p>`,
  }),
)}
</div>`;
}
