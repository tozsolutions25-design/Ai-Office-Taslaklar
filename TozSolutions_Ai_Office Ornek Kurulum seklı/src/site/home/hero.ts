/**
 * Hero section.
 *
 * Establishes identity, category, proposition and action in one screen, and
 * leads with the diagram. The order is deliberate: eyebrow, headline, summary,
 * actions, then the visual — so the visual supports the proposition instead of
 * competing with it.
 *
 * Exactly one `<h1>` on the page; every other heading drops to `h2` or below.
 */

import { button } from "../../design-system/primitives/button.js";
import { centered, cluster, container, grid, section, stack } from "../../design-system/layout/primitives.js";
import { html, type RawHtml } from "../../design-system/utils/html.js";
import { HERO, SECTION_IDS } from "../content.js";
import { heroVisual } from "../visuals/heroVisual.js";

export function hero(): RawHtml {
  return section({
    id: SECTION_IDS.hero,
    spacing: "lg",
    class: "toz-site-hero",
    ariaLabelledby: "hero-heading",
    children: container({
      children: grid({
        columns: "auto",
        class: "toz-site-hero__grid",
        children: html`<div class="toz-site-hero__copy">
          ${centered({
            width: "wide",
            class: "toz-site-hero__intro",
            children: stack({
              align: "center",
              gap: "6",
              // An ARRAY of fragments, never `.join("")`. A joined string is
              // escaped by the design system, which is correct behaviour but
              // would render this copy as literal markup.
              children: [
                html`<p class="toz-type-label toz-text-primary toz-site-eyebrow">${HERO.eyebrow}</p>`,
                html`<h1 class="toz-type-display toz-text-default" id="hero-heading">${HERO.headline}</h1>`,
                html`<p class="toz-type-body-lg toz-text-muted">${HERO.summary}</p>`,
              ],
            }),
          })}
          ${cluster({
            justify: "center",
            gap: "3",
            class: "toz-site-hero__actions",
            children: [
              button({ children: HERO.primaryCta.label, href: HERO.primaryCta.href, size: "lg" }),
              button({ children: HERO.secondaryCta.label, href: HERO.secondaryCta.href, variant: "outline", size: "lg" }),
            ],
          })}
        </div>
        <div class="toz-site-hero__visual">
          ${heroVisual({ animated: true })}
          ${html`<p class="toz-site-hero__caption toz-type-caption toz-text-subtle">A request is matched against candidate providers, executed under explicit limits, and recorded.</p>`}
        </div>`,
      }),
    }),
  });
}
