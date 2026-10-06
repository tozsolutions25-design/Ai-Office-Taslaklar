/**
 * Homepage.
 *
 * Composes the sections into a single page fragment. Section order is the
 * narrative order the page is meant to be read in:
 *
 *   header -> hero -> value -> capabilities -> how it works ->
 *   architecture -> reliability -> next step -> footer
 *
 * The skip link and the `<main>` landmark are placed here, immediately inside
 * the page, so the header is the only thing before them and keyboard users reach
 * the content in one keystroke.
 */

import { main } from "../../design-system/layout/primitives.js";
import { skipLink } from "../../design-system/primitives/nav.js";
import { html, type RawHtml } from "../../design-system/utils/html.js";
import { architecture } from "./architecture.js";
import { siteFooter } from "./footer.js";
import { siteHeader } from "./header.js";
import { hero } from "./hero.js";
import { capabilities, howItWorks, nextStep, reliability, valueProposition } from "./sections.js";

export interface HomeOptions {
  /** Sticky header by default. */
  readonly stickyHeader?: boolean;
}

/** The homepage body: everything between `</head>` and `</body>`. */
export function homePageBody(options: HomeOptions = {}): RawHtml {
  return html`${skipLink()}
${siteHeader({ sticky: options.stickyHeader })}
${main({
  children: html`${hero()}
${valueProposition()}
${capabilities()}
${howItWorks()}
${architecture()}
${reliability()}
${nextStep()}`,
})}
${siteFooter({ year: new Date().getUTCFullYear() })}`;
}
