/**
 * Architecture visual: a layered stack.
 *
 * The layers rendered here are the same records the architecture section renders
 * as text, from the same source. There is no second, hand-drawn version of the
 * architecture that could disagree with the real module boundaries —
 * `tests/site.content.test.ts` asserts each layer's `sourcePath` exists in the
 * repository.
 *
 * Inline SVG for the same reasons as the hero visual: no asset request, no
 * JavaScript, fluid scaling, and an accessible name and description.
 */

import { html, raw, type RawHtml } from "../../design-system/utils/html.js";
import { colorVar } from "../../design-system/tokens/colors.js";
import { type ArchitectureLayer } from "../content.js";

const LAYER_HEIGHT = 62;
const LAYER_GAP = 10;
const WIDTH = 560;
const PADDING = 8;

export interface ArchitectureDiagramOptions {
  readonly layers: readonly ArchitectureLayer[];
  readonly class?: string;
}

/** Optional layers are dashed, which is how the diagram distinguishes them. */
function accentFor(layer: ArchitectureLayer): { colour: string; dash: string } {
  return layer.optional
    ? { colour: colorVar("info"), dash: ' stroke-dasharray="5 4"' }
    : { colour: colorVar("primary"), dash: "" };
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shorten(body: string): string {
  const limit = 58;
  return body.length <= limit ? body : `${body.slice(0, limit - 1).trimEnd()}…`;
}

function band(layer: ArchitectureLayer, index: number): string {
  const y = PADDING + index * (LAYER_HEIGHT + LAYER_GAP);
  const { colour, dash } = accentFor(layer);
  return (
    `<g>` +
    `<rect x="${PADDING}" y="${y}" width="${WIDTH - PADDING * 2}" height="${LAYER_HEIGHT}" rx="10" ` +
    `fill="${colorVar("surface-elevated")}" stroke="${colour}" stroke-width="1.25"${dash} />` +
    `<rect x="${PADDING}" y="${y}" width="4" height="${LAYER_HEIGHT}" rx="2" fill="${colour}" />` +
    `<text x="${PADDING + 22}" y="${y + 26}" font-size="13" font-weight="600" fill="${colorVar("foreground")}">${escapeText(layer.name)}</text>` +
    `<text x="${PADDING + 22}" y="${y + 45}" font-size="10.5" fill="${colorVar("foreground-muted")}">${escapeText(shorten(layer.body))}</text>` +
    `<text x="${WIDTH - PADDING - 16}" y="${y + 26}" text-anchor="end" font-size="9.5" fill="${colorVar("foreground-subtle")}">${layer.optional ? "optional" : "required"}</text>` +
    `</g>`
  );
}

export function architectureDiagram(options: ArchitectureDiagramOptions): RawHtml {
  const layers = options.layers;
  const height = layers.length * (LAYER_HEIGHT + LAYER_GAP) - LAYER_GAP + PADDING * 2;
  const bands = layers.map(band).join("");
  const summary = `The platform is composed of ${layers.length} layers: ${layers
    .map((layer) => layer.name)
    .join(", ")}. Layers marked optional are not required for the core to run.`;

  return html`<svg
    class="toz-architecture-diagram${options.class === undefined ? "" : ` ${options.class}`}"
    viewBox="0 0 ${WIDTH} ${height}"
    role="img"
    aria-labelledby="architecture-diagram-title architecture-diagram-desc"
    preserveAspectRatio="xMidYMid meet"
    focusable="false"
  >
    <title id="architecture-diagram-title">Layered architecture</title>
    <desc id="architecture-diagram-desc">${summary}</desc>
    ${raw(bands)}
  </svg>`;
}
