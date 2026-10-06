/**
 * Architecture section.
 *
 * The diagram and the layer list are generated from the same
 * `ARCHITECTURE.layers` records, so the visual and the text cannot disagree. The
 * content test asserts each layer's `sourcePath` exists in the repository, which
 * keeps the section tied to the real module boundaries rather than to an
 * illustration of them.
 */

import { card } from "../../design-system/primitives/card.js";
import { badge } from "../../design-system/primitives/status.js";
import { grid, section, stack, container, centered } from "../../design-system/layout/primitives.js";
import { html, type RawHtml } from "../../design-system/utils/html.js";
import { ARCHITECTURE, SECTION_IDS } from "../content.js";
import { architectureDiagram } from "../visuals/architectureDiagram.js";

export function architecture(): RawHtml {
  const layers = ARCHITECTURE.layers;

  return section({
    id: SECTION_IDS.architecture,
    spacing: "lg",
    ariaLabelledby: "architecture-heading",
    children: container({
      children: stack({
        gap: "12",
        children: [
          centered({
            children: stack({
              align: "center",
              gap: "4",
              children: [
                html`<p class="toz-type-label toz-text-primary toz-site-eyebrow">${ARCHITECTURE.eyebrow}</p>`,
                html`<h2 class="toz-type-h1 toz-text-default" id="architecture-heading">${ARCHITECTURE.headline}</h2>`,
                html`<p class="toz-type-body-lg toz-text-muted">${ARCHITECTURE.summary}</p>`,
              ],
            }),
          }),
          html`<div class="toz-site-architecture">
            <div class="toz-site-architecture__visual">${architectureDiagram({ layers })}</div>
            <div class="toz-site-architecture__list">
              ${grid({
                columns: "auto",
                children: layers.map((layer) =>
                  card({
                    as: "article",
                    headingLevel: 3,
                    status: badge({
                      tone: layer.optional ? "info" : "success",
                      children: layer.optional ? "Optional" : "Required",
                    }),
                    title: layer.name,
                    children: html`<p class="toz-type-body-sm toz-text-muted">${layer.body}</p>`,
                  }),
                ),
              })}
            </div>
          </div>`,
        ],
      }),
    }),
  });
}
