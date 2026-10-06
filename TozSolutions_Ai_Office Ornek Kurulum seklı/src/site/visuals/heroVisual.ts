/**
 * Hero visual: an abstract orchestration diagram.
 *
 * Deliberately inline SVG rather than an image or a canvas scene:
 *
 *  - No asset request, so the hero paints as soon as the HTML arrives.
 *  - It scales with the viewport via `viewBox` and no fixed dimensions, so it
 *    cannot cause horizontal overflow on a narrow screen.
 *  - It needs no JavaScript, so it cannot block or intercept interaction.
 *  - It is meaningful rather than decorative, so it is exposed to assistive
 *    technology with a title and a description.
 *
 * The diagram shows the real shape of the system: a request entering a control
 * plane, capability matching fanning out to several candidate providers, and a
 * result returning through an audit trail. It names no vendor and no model.
 *
 * Generated SVG fragments are wrapped in `raw()` because the `html` tag escapes
 * string interpolations; without that they would appear as literal text.
 */

import { html, raw, type RawHtml } from "../../design-system/utils/html.js";
import { colorVar, type ColorToken } from "../../design-system/tokens/colors.js";

function stroke(token: ColorToken): string {
  return colorVar(token);
}

const VIEW_BOX = "0 0 640 420";

/** Escapes SVG text content, which is separate from attribute escaping. */
function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function node(cx: number, cy: number, r: number, token: ColorToken, label: string): string {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${stroke("surface-elevated")}" ` +
    `stroke="${stroke(token)}" stroke-width="1.5" />` +
    `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="10" ` +
    `fill="${stroke("foreground-muted")}">${text(label)}</text>`
  );
}

export interface HeroVisualOptions {
  /** Adds the restrained connector draw-in. Disabled by reduced-motion CSS. */
  readonly animated?: boolean;
  readonly class?: string;
}

export function heroVisual(options: HeroVisualOptions = {}): RawHtml {
  const request = node(60, 210, 24, "info", "REQ");

  const controlPlane =
    `<rect x="146" y="150" width="168" height="120" rx="14" ` +
    `fill="${stroke("surface-elevated")}" stroke="${stroke("primary")}" stroke-width="1.5" />` +
    `<text x="230" y="186" text-anchor="middle" font-size="12" font-weight="600" fill="${stroke("foreground")}">Control plane</text>` +
    ["queue", "limits", "matching", "retry policy"]
      .map((line, index) => {
        const y = 206 + index * 16;
        return `<text x="230" y="${y}" text-anchor="middle" font-size="10" fill="${stroke("foreground-muted")}">${text(line)}</text>`;
      })
      .join("");

  // The branches are deliberately uneven: only one candidate is selected, and
  // the others are shown as considered-and-declined.
  const branches =
    `<line x1="314" y1="190" x2="392" y2="88" stroke="${stroke("primary")}" stroke-width="1.5" />` +
    [
      [196, 176],
      [204, 264],
      [210, 352],
    ]
      .map(
        ([y1, y2]) =>
          `<line x1="314" y1="${y1}" x2="392" y2="${y2}" stroke="${stroke("border-strong")}" ` +
          `stroke-width="1.5" stroke-dasharray="4 4" />`,
      )
      .join("");

  const providers = [
    node(420, 88, 26, "primary", "P1"),
    node(420, 176, 26, "info", "P2"),
    node(420, 264, 26, "info", "P3"),
    node(420, 352, 26, "info", "P4"),
  ].join("");

  const selected =
    `<line x1="446" y1="88" x2="524" y2="88" stroke="${stroke("primary")}" stroke-width="1.5" />` +
    node(556, 88, 24, "success", "OUT");

  const audit =
    `<rect x="404" y="300" width="176" height="76" rx="12" fill="${stroke("surface-muted")}" ` +
    `stroke="${stroke("border")}" stroke-width="1" />` +
    `<text x="416" y="326" font-size="11" font-weight="600" fill="${stroke("foreground")}">Audit trail</text>` +
    ["route decision", "attempt + classification", "duration + result"]
      .map((line, index) => {
        const y = 344 + index * 14;
        return `<text x="416" y="${y}" font-size="9.5" fill="${stroke("foreground-muted")}">${text(line)}</text>`;
      })
      .join("");

  return html`<svg
    class="toz-hero-visual${options.animated === true ? " toz-hero-visual--animated" : ""}${options.class === undefined ? "" : ` ${options.class}`}"
    viewBox="${VIEW_BOX}"
    role="img"
    aria-labelledby="hero-visual-title hero-visual-desc"
    preserveAspectRatio="xMidYMid meet"
    focusable="false"
  >
    <title id="hero-visual-title">Orchestration control plane</title>
    <desc id="hero-visual-desc">A request enters a central control plane. Capability matching compares it against several candidate providers, one of which is selected for execution, and the outcome is written to an audit trail.</desc>
    <defs>
      <linearGradient id="toz-hero-fade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${stroke("primary")}" stop-opacity="0.5" />
        <stop offset="100%" stop-color="${stroke("info")}" stop-opacity="0.2" />
      </linearGradient>
    </defs>
    <g class="toz-hero-visual__flow">${raw(request)}<line x1="84" y1="210" x2="146" y2="210" stroke="url(#toz-hero-fade)" stroke-width="1.5" /></g>
    <g>${raw(controlPlane)}</g>
    <g class="toz-hero-visual__branches">${raw(branches)}</g>
    <g>${raw(providers)}</g>
    <g class="toz-hero-visual__flow">${raw(selected)}</g>
    <g>${raw(audit)}</g>
  </svg>`;
}
