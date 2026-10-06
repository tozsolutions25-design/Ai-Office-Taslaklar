/**
 * Structured data.
 *
 * JSON-LD, emitted alongside the page's ordinary metadata so a crawler and a
 * reader are told the same thing.
 *
 * THE RULE: every field below is derived from data already in this repository.
 * Nothing is invented, and the schemas chosen are the ones the content can
 * actually support.
 *
 * DELIBERATELY ABSENT, because the repository does not contain the facts:
 *
 *   - No `aggregateRating` or `review`. No review exists.
 *   - No `offers` or `price`. No pricing exists.
 *   - No `address`, `geo`, `openingHoursSpecification` or `telephone`. The
 *     project publishes no location or contact details.
 *   - No `award`, `numberOfEmployees`, or `customerCount`.
 *   - No `Organization`, because an `Organization` schema invites exactly the
 *     address, logo-size and contact fields this project cannot fill in
 *     honestly. A `WebSite` and a `Service` describe this site accurately on
 *     their own, and a partial `Organization` is how fabricated business facts
 *     get published by accident.
 *
 * A missing field here is a fact about the project, not an omission.
 */

import { ARCHITECTURE, CANONICAL_ORIGIN, CAPABILITIES, SITE_NAME, capabilityPath, type CapabilityItem } from "./content.js";
import { ABOUT } from "./pages/content.js";

/** One JSON-LD graph node, expressed as a plain object for clarity. */
export type JsonLd = Readonly<Record<string, unknown>>;

export interface StructuredDataOptions {
  readonly origin?: string;
}

function origin(options: StructuredDataOptions): string {
  return (options.origin ?? CANONICAL_ORIGIN).replace(/\/$/, "");
}

/**
 * The `WebSite` node.
 *
 * Used on every page, so the site itself is described once and consistently
 * rather than re-derived per route.
 */
export function webSiteNode(options: StructuredDataOptions = {}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: `${origin(options)}/`,
    description:
      "Reference documentation and architecture record for TOZ AI Office, an agent " +
      "orchestration system built around a single execution authority.",
  };
}

/**
 * The `WebPage` node for one route.
 *
 * The breadcrumb is NOT nested here. A `BreadcrumbList` as its own graph node is
 * the shape consumers expect and the one the documentation describes, and
 * nesting it inside `WebPage.breadcrumb` produces a graph where a reader looking
 * for the trail has to know which node holds it.
 */
export function webPageNode(options: {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly origin?: string;
}): JsonLd {
  const base = origin({ ...(options.origin === undefined ? {} : { origin: options.origin }) });
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: options.title,
    description: options.description,
    url: `${base}${options.path}`,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${base}/` },
  };
}

/**
 * A `BreadcrumbList` node.
 *
 * Built from the SAME trail the page renders, so the visible breadcrumbs and the
 * machine-readable ones cannot describe different hierarchies. Positions are
 * 1-based, as the specification requires.
 */
export function breadcrumbNode(
  crumbs: readonly { readonly label: string; readonly path: string }[],
  options: StructuredDataOptions | string = {},
): JsonLd {
  const base = typeof options === "string" ? options : origin(options);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      item: `${base}${crumb.path === "/" ? "" : crumb.path}`,
    })),
  };
}

/**
 * A `Service` node for one capability.
 *
 * `provider` is deliberately omitted. Naming a provider organisation would be a
 * business claim, and there is only one party here — the project itself.
 */
export function serviceNode(capability: CapabilityItem, options: StructuredDataOptions = {}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: capability.title,
    description: capability.body,
    serviceType: capability.title,
    url: `${origin(options)}${capabilityPath(capability.id)}`,
    provider: { "@type": "Organization", name: SITE_NAME },
  };
}

/**
 * A `FAQPage` node, from the About page's question list.
 *
 * The answers are the ones the page displays, verbatim. A schema that claimed
 * more than the page says would be the classic case of structured data
 * describing something the site does not.
 */
export function faqPageNode(options: StructuredDataOptions = {}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: `${origin(options)}/about`,
    mainEntity: ABOUT.faq.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

/** A `ItemList` of the capabilities, for the index page. */
export function capabilityListNode(options: StructuredDataOptions = {}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Capabilities",
    numberOfItems: CAPABILITIES.length,
    itemListElement: CAPABILITIES.map((capability, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: capability.title,
      url: `${origin(options)}${capabilityPath(capability.id)}`,
    })),
  };
}

/**
 * Every node a page should emit, as a single `@graph`.
 *
 * Grouped rather than as separate top-level scripts: one script tag per page
 * keeps the head small, and a graph lets the nodes reference each other instead
 * of repeating `WebSite` text.
 */
export function graph(nodes: readonly JsonLd[]): JsonLd {
  return { "@context": "https://schema.org", "@graph": nodes };
}

/**
 * Escapes a JSON string for safe embedding in a `<script>` element.
 *
 * `<` is escaped as well as the quote characters, because the one sequence that
 * can terminate a script block early is `</script`, and `<\/script` prevents it
 * while remaining valid JSON.
 */
export function toJsonLdScript(nodes: readonly JsonLd[]): string {
  return JSON.stringify(nodes.length === 1 ? nodes[0] : graph(nodes))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/** The architecture layers, for callers that want the layer list as data. */
export function architectureLayers(): readonly { readonly name: string; readonly sourcePath: string }[] {
  return ARCHITECTURE.layers.map((layer) => ({ name: layer.name, sourcePath: layer.sourcePath }));
}
