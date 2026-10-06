/**
 * Value proposition, capabilities, process, reliability and next-step sections.
 *
 * Each is a pure renderer over its content record. They share a small set of
 * local helpers for the repeated section chrome so the vertical rhythm is
 * identical everywhere.
 *
 * CHILD COMPOSITION: every `children` value is an ARRAY of fragments, never a
 * `.join("")` string. The design system escapes string children by design, so a
 * joined string would render the section as literal escaped markup. Arrays are
 * passed straight through.
 */

import { card } from "../../design-system/primitives/card.js";
import { badge } from "../../design-system/primitives/status.js";
import { button } from "../../design-system/primitives/button.js";
import { centered, cluster, container, grid, section, stack } from "../../design-system/layout/primitives.js";
import { html, type RawHtml } from "../../design-system/utils/html.js";
import {
  CAPABILITIES,
  HOW_IT_WORKS,
  NEXT_STEP,
  RELIABILITY,
  SECTION_IDS,
  VALUE_PROPOSITION,
  type CapabilityItem,
  type ProcessStep,
  type ReliabilityPrinciple,
} from "../content.js";

/** Shared section chrome, so the rhythm is consistent across the page. */
function sectionHead(eyebrow: string, headline: string, summary: string, headingId: string): RawHtml {
  return centered({
    children: stack({
      align: "center",
      gap: "4",
      children: [
        html`<p class="toz-type-label toz-text-primary toz-site-eyebrow">${eyebrow}</p>`,
        html`<h2 class="toz-type-h1 toz-text-default" id="${headingId}">${headline}</h2>`,
        html`<p class="toz-type-body-lg toz-text-muted">${summary}</p>`,
      ],
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Value proposition                                                   */
/* ------------------------------------------------------------------ */

export function valueProposition(): RawHtml {
  return section({
    spacing: "lg",
    tone: "muted",
    ariaLabelledby: "value-heading",
    children: container({
      children: stack({
        gap: "12",
        children: [
          sectionHead(
            VALUE_PROPOSITION.eyebrow,
            VALUE_PROPOSITION.headline,
            VALUE_PROPOSITION.summary,
            "value-heading",
          ),
          grid({
            columns: 3,
            children: VALUE_PROPOSITION.items.map((item) =>
              card({
                as: "article",
                headingLevel: 3,
                title: item.title,
                children: html`<p class="toz-type-body-sm toz-text-muted">${item.body}</p>`,
              }),
            ),
          }),
        ],
      }),
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Capabilities                                                        */
/* ------------------------------------------------------------------ */

function capabilityCard(item: CapabilityItem): RawHtml {
  return card({
    as: "article",
    headingLevel: 3,
    interactive: true,
    // A `RawHtml` is passed straight through. Converting it to a string first
    // would make the design system escape it.
    status: badge({ tone: item.tone, children: item.statusLabel }),
    title: item.title,
    children: html`<p class="toz-type-body-sm toz-text-muted">${item.body}</p>`,
    class: "toz-site-capability",
  });
}

export function capabilities(): RawHtml {
  return section({
    id: SECTION_IDS.capabilities,
    spacing: "lg",
    ariaLabelledby: "capabilities-heading",
    children: container({
      children: stack({
        gap: "12",
        children: [
          sectionHead(
            "Capabilities",
            "Infrastructure for the whole execution path.",
            "Each capability is a boundary in the architecture rather than a promise " +
              "about future delivery. Where a capability is not yet implemented, it is " +
              "labelled as a defined boundary.",
            "capabilities-heading",
          ),
          grid({
            columns: "auto",
            class: "toz-site-capability-grid",
            children: CAPABILITIES.map(capabilityCard),
          }),
        ],
      }),
    }),
  });
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

function processStep(step: ProcessStep, index: number): RawHtml {
  return html`<li class="toz-site-step">
    <span class="toz-site-step__index" aria-hidden="true">${index + 1}</span>
    <div class="toz-site-step__body">
      <h3 class="toz-type-h4 toz-text-default">${step.title}</h3>
      <p class="toz-type-body-sm toz-text-muted">${step.body}</p>
    </div>
  </li>`;
}

export function howItWorks(): RawHtml {
  return section({
    id: SECTION_IDS.howItWorks,
    spacing: "lg",
    tone: "muted",
    ariaLabelledby: "how-it-works-heading",
    children: container({
      children: stack({
        gap: "12",
        children: [
          sectionHead(
            HOW_IT_WORKS.eyebrow,
            HOW_IT_WORKS.headline,
            HOW_IT_WORKS.summary,
            "how-it-works-heading",
          ),
          html`<ol class="toz-site-steps">${HOW_IT_WORKS.steps.map(processStep)}</ol>`,
        ],
      }),
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Reliability                                                         */
/* ------------------------------------------------------------------ */

function principleRow(principle: ReliabilityPrinciple): RawHtml {
  return html`<li class="toz-site-principle">
    <h3 class="toz-type-h4 toz-text-default">${principle.title}</h3>
    <p class="toz-type-body-sm toz-text-muted">${principle.body}</p>
  </li>`;
}

export function reliability(): RawHtml {
  return section({
    id: SECTION_IDS.reliability,
    spacing: "lg",
    ariaLabelledby: "reliability-heading",
    children: container({
      children: stack({
        gap: "12",
        children: [
          sectionHead(
            RELIABILITY.eyebrow,
            RELIABILITY.headline,
            RELIABILITY.summary,
            "reliability-heading",
          ),
          html`<ul class="toz-site-principles">${RELIABILITY.principles.map(principleRow)}</ul>`,
        ],
      }),
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Next step                                                           */
/* ------------------------------------------------------------------ */

export function nextStep(): RawHtml {
  return section({
    id: SECTION_IDS.next,
    spacing: "lg",
    tone: "muted",
    ariaLabelledby: "next-heading",
    children: container({
      children: centered({
        children: stack({
          align: "center",
          gap: "6",
          children: [
            html`<p class="toz-type-label toz-text-primary toz-site-eyebrow">${NEXT_STEP.eyebrow}</p>`,
            html`<h2 class="toz-type-h1 toz-text-default" id="next-heading">${NEXT_STEP.headline}</h2>`,
            html`<p class="toz-type-body-lg toz-text-muted">${NEXT_STEP.body}</p>`,
            cluster({
              justify: "center",
              gap: "3",
              children: NEXT_STEP.actions.map((action) =>
                button({
                  children: action.label,
                  href: action.href,
                  variant: action.primary ? "primary" : "outline",
                  size: "lg",
                }),
              ),
            }),
          ],
        }),
      }),
    }),
  });
}
