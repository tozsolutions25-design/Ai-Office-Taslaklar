/**
 * Global header.
 *
 * Composed entirely from PHASE 02 primitives. The navigation is derived from
 * `NAVIGATION`, whose items are in-page anchors to sections that exist, so a
 * navigation entry cannot point at a route that has not been built.
 *
 * Sticky positioning is intentional: the primary CTA must remain reachable while
 * reading a long page. `scroll-padding-top` in `base.css` keeps anchored
 * sections from landing underneath it.
 */

import { button } from "../../design-system/primitives/button.js";
import { link } from "../../design-system/primitives/link.js";
import { brand, header, headerContent, mobileNav, nav, navItem } from "../../design-system/primitives/nav.js";
import { html, type RawHtml } from "../../design-system/utils/html.js";
import { NAVIGATION, SITE_NAME, homeAnchor } from "../content.js";

export interface SiteHeaderOptions {
  /** Marks a navigation item as the current page section. */
  readonly currentSectionId?: string;
  /**
   * Route path of the page being rendered.
   *
   * Marks the current page with `aria-current="page"`, which is how a screen
   * reader announces position and how a sighted reader sees it. An inner-page
   * item cannot be the current section, so without this a visitor on `/about`
   * had no indication which page they were on.
   */
  readonly currentPath?: string;
  /** Sticky by default, so the primary CTA stays reachable while reading. */
  readonly sticky?: boolean;
  readonly class?: string;
}

export function siteHeader(options: SiteHeaderOptions = {}): RawHtml {
  const items = NAVIGATION.items.map((item) =>
    navItem({
      href: item.href,
      children: item.label,
      current:
        (options.currentSectionId !== undefined && options.currentSectionId === item.sectionId) ||
        isCurrentPage(item, options.currentPath),
    }),
  );

  return header({
    children: headerContent({
      brand: brand({ name: SITE_NAME, href: homeAnchor("hero") }),
      nav: nav({
        id: "primary-navigation",
        ariaLabel: NAVIGATION.ariaLabel,
        responsive: true,
        children: items,
      }),
      actions: html`<div class="toz-hide-below-md-inline">${button({
        children: NAVIGATION.primaryCta.label,
        href: NAVIGATION.primaryCta.href,
        size: "sm",
      })}</div>${mobileNav({
        id: "mobile-navigation",
        label: "Menu",
        children: items,
        actions: button({ children: NAVIGATION.primaryCta.label, href: NAVIGATION.primaryCta.href, fullWidth: true }),
      })}`,
    }),
    class: options.class,
    sticky: options.sticky,
  });
}

/** Convenience for a footer link, which uses the same variant. */
export function footerLink(href: string, label: string): RawHtml {
  return link({ href, children: label, variant: "subtle" });
}

/**
 * Whether a navigation item points at the page currently being rendered.
 *
 * Compared on the PATH, ignoring a trailing slash, because `/about` and `/about/`
 * are the same page and the visitor should see the same highlight. A section
 * anchor never counts as the current page: on an inner page there is no current
 * section, and on the homepage the current page is the brand link.
 */
function isCurrentPage(item: { readonly href: string; readonly sectionId: string | null }, currentPath: string | undefined): boolean {
  if (currentPath === undefined || item.sectionId !== null) {
    return false;
  }
  const here = currentPath.replace(/\/+$/, "") || "/";
  const there = item.href.replace(/\/+$/, "") || "/";
  return here === there;
}
