/**
 * Page metadata.
 *
 * PHASE 03 provides the minimum a correct homepage needs: a meaningful title, a
 * description, a canonical URL and Open Graph tags. This is a foundation, not
 * the dedicated search optimisation work reserved for a later phase — there is
 * no keyword targeting, no structured data, and no claim on the page that is not
 * visible in the content itself.
 */

import { attrs, html, raw, type RawHtml } from "../design-system/utils/html.js";
import { CANONICAL_ORIGIN, DEFAULT_LOCALE, SITE_NAME } from "./content.js";
import { type JsonLd, toJsonLdScript } from "./structuredData.js";

export interface PageMeta {
  readonly title: string;
  /** Site name is appended unless the title already carries it. */
  readonly titleTemplate: string;
  readonly description: string;
  readonly canonicalPath: string;
  readonly locale: string;
  /** Rendered as `noindex` only when explicitly requested. */
  readonly noIndex?: boolean;
  readonly ogImageAlt?: string;
}

export const HOME_META: PageMeta = {
  title: "TOZ AI Office — AI orchestration infrastructure",
  titleTemplate: "%s",
  description:
    "TOZ AI Office coordinates agents, models and providers behind a single control " +
    "plane, with capability-aware routing, enforced limits and a full audit trail.",
  canonicalPath: "/",
  locale: DEFAULT_LOCALE,
  ogImageAlt: "Abstract diagram of an AI orchestration control plane",
};

export const NOT_FOUND_META: PageMeta = {
  title: "Page not found — TOZ AI Office",
  titleTemplate: "%s",
  description: "The requested page does not exist on this site.",
  canonicalPath: "/404",
  locale: DEFAULT_LOCALE,
  noIndex: true,
};

/**
 * Inner-page metadata.
 *
 * Every description is a real summary of the page's own content, written so it
 * can stand alone in a search result. None of them contains a claim the page
 * does not make - in particular no capability page promises availability, an
 * outcome or a metric.
 *
 * `noIndex` is set only on the two surfaces that exist as routes but hold no
 * entries. Those pages are excluded from the sitemap by the same flag, so
 * "may this be indexed" is recorded in exactly one place.
 */
export const ABOUT_META: PageMeta = {
  title: "About",
  titleTemplate: "%s",
  description:
    "How TOZ AI Office is organised around a single execution authority, and why " +
    "each guarantee on this site is enforced in code rather than described in documentation.",
  canonicalPath: "/about",
  locale: DEFAULT_LOCALE,
  ogImageAlt: "Diagram of the TOZ AI Office orchestration architecture",
};

export const CAPABILITIES_META: PageMeta = {
  title: "Capabilities",
  titleTemplate: "%s",
  description:
    "Every capability TOZ AI Office provides, what each one decides, and the one " +
    "authority responsible for it.",
  canonicalPath: "/capabilities",
  locale: DEFAULT_LOCALE,
  ogImageAlt: "Overview of the capabilities in the TOZ AI Office control plane",
};

export const CONTACT_META: PageMeta = {
  title: "Contact",
  titleTemplate: "%s",
  description:
    "How to reach TOZ AI Office, and where to look first depending on whether you are " +
    "evaluating a requirement or reading the architecture.",
  canonicalPath: "/contact",
  locale: DEFAULT_LOCALE,
};

/**
 * Metadata for one capability detail page, derived from the capability's own data.
 *
 * Generated rather than hand-written per capability so a new capability gets a
 * correct description the moment it is added, instead of shipping with a missing
 * or copy-pasted one.
 */
export function capabilityMeta(capability: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}): PageMeta {
  return {
    title: capability.title,
    titleTemplate: "%s",
    description: capability.body,
    canonicalPath: `/capabilities/${capability.id}`,
    locale: DEFAULT_LOCALE,
  };
}

/** The projects surface. Exists as a route; holds no entries yet (K-09). */
export const PROJECTS_META: PageMeta = {
  title: "Projects",
  titleTemplate: "%s",
  description: "Reference deployments of TOZ AI Office. None are published yet.",
  canonicalPath: "/projects",
  locale: DEFAULT_LOCALE,
  noIndex: true,
};

/** The blog surface. Exists as a route; holds no entries yet (K-10). */
export const BLOG_META: PageMeta = {
  title: "Blog",
  titleTemplate: "%s",
  description: "Articles about the design of TOZ AI Office. None are published yet.",
  canonicalPath: "/blog",
  locale: DEFAULT_LOCALE,
  noIndex: true,
};

/** Absolute URL for a canonical path. */
export function canonicalUrl(meta: PageMeta, origin: string = CANONICAL_ORIGIN): string {
  return `${origin.replace(/\/$/, "")}${meta.canonicalPath}`;
}

/** Applies the title template. */
export function renderTitle(meta: PageMeta, siteName: string = SITE_NAME): string {
  const rendered = meta.titleTemplate.replace("%s", meta.title);
  return rendered.includes(siteName) ? rendered : `${rendered} — ${siteName}`;
}

/**
 * The `<head>` contents for a page.
 *
 * Built with the design system's `html` tag, so every value is escaped by the
 * same mechanism as the rest of the page rather than by a local escape function.
 *
 * Open Graph and Twitter tags reuse the standard values instead of carrying
 * separate copy, so the two can never disagree.
 */
export function headFor(meta: PageMeta, origin: string = CANONICAL_ORIGIN): readonly RawHtml[] {
  const title = renderTitle(meta);
  const canonical = canonicalUrl(meta, origin);
  const imageAlt = meta.ogImageAlt ?? `${SITE_NAME} diagram`;

  const metaTag = (attributes: Record<string, string>): RawHtml => html`<meta${raw(attrs(attributes))} />`;

  return [
    metaTag({ name: "description", content: meta.description }),
    html`<link rel="canonical" href="${canonical}" />`,
    metaTag({
      name: "robots",
      content: meta.noIndex === true ? "noindex, follow" : "index, follow",
    }),
    metaTag({ property: "og:type", content: "website" }),
    metaTag({ property: "og:site_name", content: SITE_NAME }),
    metaTag({ property: "og:title", content: title }),
    metaTag({ property: "og:description", content: meta.description }),
    metaTag({ property: "og:url", content: canonical }),
    metaTag({ name: "twitter:card", content: "summary_large_image" }),
    metaTag({ name: "twitter:title", content: title }),
    metaTag({ name: "twitter:description", content: meta.description }),
    metaTag({ name: "twitter:image:alt", content: imageAlt }),
    // `og:image` is deliberately NOT emitted. A social card that points at an
    // asset the repository does not contain is a broken preview, and inventing
    // one to satisfy a checklist is worse than having no preview at all.
  ];
}

/**
 * The `<script type="application/ld+json">` element for a set of nodes.
 *
 * The payload is injected with `raw()` rather than interpolated, because the
 * `html` tag escapes its interpolations - which is correct for text and wrong
 * here: escaping the JSON would turn every `"` into `&quot;` and produce a block
 * no crawler can parse. The escape that IS required - preventing `</script`
 * from terminating the block early - is applied by `toJsonLdScript` before this
 * point, so the string reaching `raw()` has already been made script-safe.
 */
export function jsonLdScript(nodes: readonly JsonLd[]): RawHtml {
  return html`<script type="application/ld+json">${raw(toJsonLdScript(nodes))}</script>`;
}
