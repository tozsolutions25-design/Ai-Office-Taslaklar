/**
 * Navigation primitives.
 *
 * These provide the STRUCTURE only: a header shell, a nav landmark with a list
 * of links, and a mobile disclosure. The final navigation experience — which
 * links exist, what the brand says, whether a CTA is present — is deliberately
 * not decided here; that belongs to the pages that use it.
 *
 * The mobile menu uses the native `<details>` disclosure. It is keyboard
 * operable, exposes its own expanded state to assistive technology, and needs
 * no JavaScript, which keeps the whole navigation functional if a script fails
 * to load.
 */

import { cn } from "../utils/cn.js";
import { attrs, html, raw, type HtmlChild, type RawHtml } from "../utils/html.js";
import { icon } from "./button.js";
import { link, type LinkOptions } from "./link.js";

/**
 * The skip link.
 *
 * Must be the first focusable element on the page, and must target the main
 * content region. This is the single most effective mitigation for keyboard
 * users forced to tab through a large header on every page.
 */
export function skipLink(options: { targetId?: string; label?: string } = {}): RawHtml {
  return html`<a class="toz-skip-link" href="#${options.targetId ?? "main-content"}">${options.label ?? "Skip to main content"}</a>`;
}

export interface HeaderOptions {
  readonly children: HtmlChild;
  /** Sticky by default. Set false for a page that manages its own stickiness. */
  readonly sticky?: boolean;
  readonly class?: string;
  readonly id?: string;
}

/** Page header shell. Wrap the brand and nav in it via `headerContent`. */
export function header(options: HeaderOptions): RawHtml {
  const { children, class: className, ...rest } = options;
  return html`<header${raw(
    attrs({
      class: cn("toz-header", rest.sticky === false ? "toz-header--static" : undefined, className),
      id: rest.id,
    }),
  )}><div class="toz-header__inner">${children}</div></header>`;
}

/** The horizontal bar with the brand on the left and actions on the right. */
export function headerContent(options: {
  readonly brand?: HtmlChild;
  readonly nav?: HtmlChild;
  readonly actions?: HtmlChild;
  readonly class?: string;
}): RawHtml {
  return html`${options.brand ?? ""}
    <div class="toz-cluster" data-justify="end" data-gap="3">
      ${options.nav ?? ""}${options.actions ?? ""}
    </div>`;
}

export interface BrandOptions {
  readonly name: string;
  readonly href?: string;
  /** Optional mark. A gradient block is rendered when omitted, so no asset is
   * required and the brand renders correctly before any logo exists. */
  readonly mark?: HtmlChild;
  readonly class?: string;
}

export function brand(options: BrandOptions): RawHtml {
  const mark = options.mark ?? html`<span class="toz-brand__mark" aria-hidden="true"></span>`;
  const content = html`${mark}<span class="toz-brand__text">${options.name}</span>`;
  if (options.href === undefined) {
    return html`<span${raw(attrs({ class: cn("toz-brand", options.class) }))}>${content}</span>`;
  }
  return html`<a class="toz-brand" href="${options.href}" aria-label="${options.name}">${content}</a>`;
}

export interface NavOptions {
  /** DOM id of the nav landmark. */
  readonly id: string;
  readonly children: HtmlChild;
  readonly ariaLabel: string;
  /**
   * Adds `toz-nav--responsive`, which hides the list below the tablet
   * breakpoint. Required so the mobile disclosure is the only visible menu.
   */
  readonly responsive?: boolean;
  readonly class?: string;
}

/**
 * A `<nav>` landmark containing a list.
 *
 * The `aria-label` is required: a page with more than one nav region (header
 * and footer, for instance) is otherwise ambiguous to a screen-reader user.
 */
export function nav(options: NavOptions): RawHtml {
  const { children, class: className, ...rest } = options;
  return html`<nav${raw(
    attrs({
      class: cn("toz-nav", rest.responsive === true ? "toz-nav--responsive" : undefined, className),
      id: rest.id,
      "aria-label": rest.ariaLabel,
    }),
  )}><ul class="toz-nav__list">${children}</ul></nav>`;
}

/** One navigation item. Wraps `link` so the list structure is guaranteed. */
export function navItem(options: Omit<LinkOptions, "variant"> & { variant?: "nav" | "standard" }): RawHtml {
  return html`<li>${link({ ...options, variant: options.variant ?? "nav" })}</li>`;
}

export interface MobileNavOptions {
  /** Unique id; the `<details>` element is referenced by nothing else, but a
   * stable id keeps it addressable and testable. */
  readonly id?: string;
  readonly label: string;
  readonly children: HtmlChild;
  /** Rendered inside the panel, below the links, e.g. a CTA. */
  readonly actions?: HtmlChild;
  readonly class?: string;
}

/**
 * The small-viewport navigation disclosure.
 *
 * Native `<details>`/`<summary>`: the expanded state is announced by the
 * platform, the trigger is focusable and Enter-activatable, and it degrades to
 * an always-open list if CSS fails.
 */
export function mobileNav(options: MobileNavOptions): RawHtml {
  return html`<details${raw(
    attrs({ class: cn("toz-mobile-nav", options.class), id: options.id }),
  )}>
    <summary class="toz-mobile-nav__trigger">
      ${icon("menu", "1.25rem")}<span>${options.label}</span>
    </summary>
    <div class="toz-mobile-nav__panel">
      <ul class="toz-nav__list">${options.children}</ul>
      ${options.actions === undefined ? "" : html`<div class="toz-cluster" data-justify="stretch" data-gap="2">${options.actions}</div>`}
    </div>
  </details>`;
}

/**
 * A navigation link labelled as the current page.
 *
 * A thin wrapper over `navItem` that makes the intent explicit at the call
 * site, since forgetting `aria-current` is the common failure.
 */
export function currentNavItem(options: Omit<LinkOptions, "variant" | "current">): RawHtml {
  return navItem({ ...options, variant: "nav", current: true });
}
