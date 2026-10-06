/**
 * Layout primitives.
 *
 * These carry spacing and alignment only. A page composes them instead of
 * writing its own layout CSS, which is what keeps vertical rhythm consistent
 * across marketing pages, dashboards and documentation.
 *
 * Every primitive accepts a spacing SCALE STEP rather than an arbitrary value,
 * so an ad-hoc `padding: 13px` can never enter the codebase.
 */

import type { ContentWidth } from "../tokens/breakpoints.js";
import type { SpacingStep } from "../tokens/spacing.js";
import { attrs, html, raw, type HtmlChild, type RawHtml } from "../utils/html.js";
import { cn } from "../utils/cn.js";

/* ------------------------------------------------------------------ */
/* Container                                                           */
/* ------------------------------------------------------------------ */

export interface ContainerOptions {
  /** Constrains the content width. `default` unless stated. */
  readonly width?: ContentWidth;
  /** Set false for edge-to-edge sections that manage their own padding. */
  readonly gutter?: boolean;
  readonly id?: string;
  readonly class?: string;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly children?: HtmlChild;
}

/** Horizontal page container with a max width and fluid gutters. */
export function container(options: ContainerOptions = {}): RawHtml {
  const { children, class: className, ...rest } = options;
  return html`<div${raw(
    attrs({
      class: cn("toz-container", className),
      "data-width": rest.width ?? "default",
      "data-gutter": rest.gutter === false ? "none" : undefined,
      id: rest.id,
      role: rest.role,
      "aria-label": rest.ariaLabel,
    }),
  )}>${children ?? ""}</div>`;
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

export const SECTION_SPACING_OPTIONS = ["sm", "md", "lg", "xl"] as const;
export type SectionSpacingOption = (typeof SECTION_SPACING_OPTIONS)[number];

export const SECTION_TONES = ["default", "muted", "elevated", "inset"] as const;
export type SectionTone = (typeof SECTION_TONES)[number];

export interface SectionOptions {
  readonly spacing?: SectionSpacingOption;
  readonly tone?: SectionTone;
  /** Draws a hairline above the section to separate it from the previous one. */
  readonly divider?: boolean;
  readonly id?: string;
  readonly class?: string;
  readonly ariaLabel?: string;
  readonly ariaLabelledby?: string;
  readonly children?: HtmlChild;
}

/**
 * A full-width vertical band.
 *
 * Use `tone="muted"` to alternate section backgrounds. This is cheaper and
 * calmer than inserting decorative dividers.
 */
export function section(options: SectionOptions = {}): RawHtml {
  const { children, class: className, ...rest } = options;
  return html`<section${raw(
    attrs({
      class: cn("toz-section", className),
      "data-spacing": rest.spacing ?? "md",
      "data-tone": rest.tone === undefined || rest.tone === "default" ? undefined : rest.tone,
      "data-divider": rest.divider === true ? "true" : undefined,
      id: rest.id,
      "aria-label": rest.ariaLabel,
      "aria-labelledby": rest.ariaLabelledby,
    }),
  )}>${children ?? ""}</section>`;
}

/* ------------------------------------------------------------------ */
/* Stack                                                               */
/* ------------------------------------------------------------------ */

export const STACK_ALIGN = ["stretch", "start", "center", "end"] as const;
export type StackAlign = (typeof STACK_ALIGN)[number];

export interface StackOptions {
  /** Vertical gap between children. Defaults to the `4` step. */
  readonly gap?: SpacingStep;
  /** Cross-axis alignment. Defaults to `stretch`. */
  readonly align?: StackAlign;
  readonly class?: string;
  readonly id?: string;
  readonly children?: HtmlChild;
}

/** Vertical flow with a consistent gap. The workhorse for content blocks. */
export function stack(options: StackOptions = {}): RawHtml {
  const { children, class: className, ...rest } = options;
  return html`<div${raw(
    attrs({
      class: cn("toz-stack", className),
      "data-align": rest.align ?? "stretch",
      id: rest.id,
    }),
  )} style="--toz-stack-gap: var(--toz-space-${rest.gap ?? "4"})">${children ?? ""}</div>`;
}

/* ------------------------------------------------------------------ */
/* Cluster                                                             */
/* ------------------------------------------------------------------ */

export const CLUSTER_ALIGN = ["center", "start", "end", "stretch"] as const;
export type ClusterAlign = (typeof CLUSTER_ALIGN)[number];

export const CLUSTER_JUSTIFY = ["start", "center", "end", "between"] as const;
export type ClusterJustify = (typeof CLUSTER_JUSTIFY)[number];

export interface ClusterOptions {
  /** Inline gap between items. Defaults to the `3` step. */
  readonly gap?: SpacingStep;
  readonly align?: ClusterAlign;
  readonly justify?: ClusterJustify;
  readonly class?: string;
  readonly id?: string;
  readonly children?: HtmlChild;
}

/** Wrapping inline group, for button rows and tag lists. */
export function cluster(options: ClusterOptions = {}): RawHtml {
  const { children, class: className, ...rest } = options;
  return html`<div${raw(
    attrs({
      class: cn("toz-cluster", className),
      "data-align": rest.align ?? "center",
      "data-justify": rest.justify ?? "start",
      id: rest.id,
    }),
  )} style="--toz-cluster-gap: var(--toz-space-${rest.gap ?? "3"})">${children ?? ""}</div>`;
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

export const GRID_COLUMNS = [1, 2, 3, 4] as const;
export type GridColumns = (typeof GRID_COLUMNS)[number];

/**
 * `auto` uses `auto-fit` with a readable minimum, so columns reflow by
 * available width instead of by breakpoint. Prefer it for card collections.
 */
export type GridLayout = "auto" | GridColumns;

export interface GridOptions {
  readonly columns?: GridLayout;
  readonly gap?: SpacingStep;
  readonly class?: string;
  readonly id?: string;
  /** Renders as a semantic list when set. */
  readonly as?: "div" | "ul";
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly children?: HtmlChild;
}

/** Responsive grid. Correct at 320px; columns open up as space allows. */
export function grid(options: GridOptions = {}): RawHtml {
  const { children, class: className, as = "div", ...rest } = options;
  const tag = as === "ul" ? "ul" : "div";
  const listReset = as === "ul" ? ' style="margin:0;padding:0;list-style:none"' : "";
  return html`<${raw(tag)}${raw(
    attrs({
      class: cn("toz-grid", className),
      "data-columns": rest.columns === "auto" ? "auto" : String(rest.columns ?? 2),
      id: rest.id,
      role: rest.role,
      "aria-label": rest.ariaLabel,
    }),
  )} style="--toz-grid-gap: var(--toz-space-${rest.gap ?? "6"})${listReset}">${children ?? ""}</${raw(tag)}>`;
}

/** A single grid cell. Applies the list-item reset when inside a `ul` grid. */
export function gridItem(options: { class?: string; id?: string; children?: HtmlChild } = {}): RawHtml {
  return html`<li${raw(
    attrs({ class: cn("toz-grid__item", options.class), id: options.id }),
  )} style="min-width:0">${options.children ?? ""}</li>`;
}

/* ------------------------------------------------------------------ */
/* Main region                                                         */
/* ------------------------------------------------------------------ */

/** The id the skip link targets by default. */
export const MAIN_CONTENT_ID = "main-content";

export interface MainOptions {
  readonly children: HtmlChild;
  /**
   * Defaults to the skip link's target id. Override only if the page provides
   * its own `id="main-content"` landmark.
   */
  readonly id?: string;
  readonly class?: string;
  readonly ariaLabel?: string;
}

/**
 * The main content landmark.
 *
 * A page needs exactly one, and it must be the skip link's destination — a
 * skip link pointing at a missing id is worse than none, because the control
 * appears and then does nothing. Rendering the landmark and the skip link
 * through the same token keeps them in step.
 */
export function main(options: MainOptions): RawHtml {
  return html`<main${raw(
    attrs({
      class: cn("toz-main", options.class),
      id: options.id ?? MAIN_CONTENT_ID,
      "aria-label": options.ariaLabel,
    }),
  )}>${options.children}</main>`;
}

/* ------------------------------------------------------------------ */
/* Centred content                                                     */
/* ------------------------------------------------------------------ */

export interface CenteredOptions {
  readonly width?: ContentWidth;
  readonly class?: string;
  readonly children?: HtmlChild;
}

/** A centred, width-constrained column. Use for hero and introduction copy. */
export function centered(options: CenteredOptions = {}): RawHtml {
  const { children, class: className, ...rest } = options;
  return html`<div${raw(
    attrs({
      class: cn("toz-centered", className),
      "data-width": rest.width ?? "prose",
    }),
  )}>${children ?? ""}</div>`;
}

/** Utility classes for conditional responsive visibility. */
export function hideBelow(options: { breakpoint: "md" | "lg" | "xl"; inline?: boolean }): string {
  return options.inline === true && options.breakpoint === "md"
    ? "toz-hide-below-md-inline"
    : `toz-hide-below-${options.breakpoint}`;
}
