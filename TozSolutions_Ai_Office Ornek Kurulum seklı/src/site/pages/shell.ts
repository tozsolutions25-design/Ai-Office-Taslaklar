/**
 * Shared chrome for inner pages.
 *
 * Every inner page is assembled from these three pieces, so a page author cannot
 * accidentally produce a page that lacks a `<main>` landmark, a breadcrumb trail
 * or a heading hierarchy: the shell supplies them.
 *
 * Composed from PHASE 02 design-system primitives only, exactly as the homepage
 * is. Nothing here imports the PHASE 01 core - a marketing page describes the
 * product, it does not run it.
 */

import { container, main, section, stack } from "../../design-system/layout/primitives.js";
import { skipLink } from "../../design-system/primitives/nav.js";
import { html, type RawHtml } from "../../design-system/utils/html.js";
import { siteHeader } from "../home/header.js";
import { siteFooter } from "../home/footer.js";

export interface Crumb {
  readonly label: string;
  /** Omitted on the final crumb, which is the current page. */
  readonly href?: string;
}

export interface PageShellOptions {
  readonly title: string;
  /** Route path of the current page, used to mark the breadcrumb's final crumb. */
  readonly path: string;
  readonly breadcrumbs?: readonly Crumb[];
  /** Rendered inside the shell, after the breadcrumb. */
  readonly children: RawHtml;
}

/**
 * The page body: skip link, header, `<main>`, footer.
 *
 * The skip link and the `<main>` landmark are placed here for the same reason as
 * on the homepage - immediately inside the page, so the header is the only thing
 * before them and a keyboard user reaches the content in one keystroke.
 */
export function pageShell(options: PageShellOptions): RawHtml {
  return html`${skipLink()}
${siteHeader({ currentPath: options.path })}
${main({ children: html`${breadcrumb(options.breadcrumbs ?? [])}
${options.children}` })}
${siteFooter({ year: new Date().getUTCFullYear() })}`;
}

/**
 * Breadcrumb trail.
 *
 * Rendered as a real `<nav aria-label="Breadcrumb">` with an ordered list, and
 * marked up to match the BreadcrumbList structured data emitted alongside it, so
 * the visible trail and the machine-readable trail cannot describe different
 * hierarchies.
 *
 * The final crumb is the current page: it is text, not a link, and carries
 * `aria-current="page"`. A crumb that linked to itself would invite a reader to
 * click the page they are already on.
 */
export function breadcrumb(crumbs: readonly Crumb[]): RawHtml {
  if (crumbs.length === 0) {
    return html``;
  }
  return html`<nav class="toz-type-body-sm toz-site-breadcrumb" aria-label="Breadcrumb">
  <ol class="toz-site-breadcrumb-list">
    ${crumbs.map((crumb, index) => {
      const isLast = index === crumbs.length - 1;
      const label = isLast
        ? html`<span aria-current="page">${crumb.label}</span>`
        : html`<a href="${crumb.href ?? "/"}">${crumb.label}</a>`;
      return html`<li class="toz-site-breadcrumb-item">${label}</li>`;
    })}
  </ol>
</nav>`;
}

export interface PageHeaderOptions {
  readonly eyebrow?: string;
  readonly title: string;
  /** One sentence. Used for the page description and rendered as the lede. */
  readonly summary: string;
}

/**
 * The standard top-of-page block: eyebrow, one `<h1>`, summary.
 *
 * Exactly one `<h1>` per page, and it is the page's own title. Inner pages have
 * no section-heading soup, so a page that forgot its title would produce a
 * heading-less document - which the render tests reject.
 */
export function pageHeader(options: PageHeaderOptions): RawHtml {
  return html`<header class="toz-site-page-header">
  ${options.eyebrow === undefined ? html`` : html`<p class="toz-type-label toz-site-eyebrow">${options.eyebrow}</p>`}
  <h1 class="toz-type-display toz-site-page-title">${options.title}</h1>
  <p class="toz-type-body-lg toz-site-page-summary">${options.summary}</p>
</header>`;
}

/** A content band, so vertical rhythm is set in one place. */
export function pageSection(options: {
  readonly id?: string;
  readonly ariaLabel?: string;
  readonly children: RawHtml;
}): RawHtml {
  return section({
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.ariaLabel === undefined ? {} : { ariaLabel: options.ariaLabel }),
    children: container({ children: options.children }),
    class: "toz-site-page-section",
  });
}

/** Vertical stack, the default arrangement for a column of blocks. */
export function pageStack(children: readonly RawHtml[]): RawHtml {
  return stack({ children, gap: "8" });
}
