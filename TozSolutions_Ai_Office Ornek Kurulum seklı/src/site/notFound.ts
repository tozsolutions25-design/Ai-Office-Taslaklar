/**
 * Not-found page.
 *
 * Exists so an unknown path renders a real page rather than a broken one. It is
 * deliberately minimal and carries `noindex`, so it is not a thin page competing
 * with the homepage in search results.
 */

import { button } from "../design-system/primitives/button.js";
import { main } from "../design-system/layout/primitives.js";
import { skipLink } from "../design-system/primitives/nav.js";
import { centered, container, section, stack } from "../design-system/layout/primitives.js";
import { html, type RawHtml } from "../design-system/utils/html.js";
import { ROUTE_PATHS, SITE_NAME } from "./content.js";
import { siteHeader } from "./home/header.js";
import { siteFooter } from "./home/footer.js";

export function notFoundBody(): RawHtml {
  return html`${skipLink()}
${siteHeader()}
${main({
  children: section({
    spacing: "xl",
    children: container({
      children: centered({
        children: stack({
          align: "center",
          gap: "6",
          children: [
            html`<p class="toz-type-label toz-text-primary toz-site-eyebrow">404</p>`,
            html`<h1 class="toz-type-h1 toz-text-default">This page does not exist.</h1>`,
            html`<p class="toz-type-body-lg toz-text-muted">
              The address you followed is not part of ${SITE_NAME}. Nothing has been lost —
              the page simply has not been built.
            </p>`,
            button({ children: "Back to home", href: ROUTE_PATHS.home, size: "lg" }),
          ],
        }),
      }),
    }),
  }),
})}
${siteFooter({ year: new Date().getUTCFullYear() })}`;
}
