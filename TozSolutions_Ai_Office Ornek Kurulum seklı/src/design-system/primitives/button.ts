/**
 * Button.
 *
 * Renders a real `<button>`, or an `<a>` when `href` is supplied. That
 * distinction matters for accessibility: a button performs an action, a link
 * navigates. Callers choose explicitly rather than the component guessing.
 *
 * States (hover, active, focus-visible, disabled) are expressed in CSS from the
 * element itself, so no extra state classes exist to fall out of sync.
 */

import { cn } from "../utils/cn.js";
import { attrs, html, raw, type HtmlChild, type RawHtml } from "../utils/html.js";

export const BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const BUTTON_SIZES = ["sm", "md", "lg"] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

export interface ButtonOptions {
  /** Visible label. Required: an icon alone does not give an accessible name. */
  readonly children: HtmlChild;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Present for navigation; renders an `<a>`. Omit for actions. */
  readonly href?: string;
  readonly type?: "button" | "submit" | "reset";
  readonly disabled?: boolean;
  /**
   * Marks the control busy. The label stays in the DOM and an accessible
   * status is announced, so a screen-reader user is not left with a silent
   * control. Implies `aria-disabled` and blocks activation.
   */
  readonly loading?: boolean;
  /** Announced while `loading`. Defaults to "Working". */
  readonly loadingLabel?: string;
  /** Stretches to the container width. Needed for full-width mobile CTAs. */
  readonly fullWidth?: boolean;
  readonly name?: string;
  readonly value?: string;
  /** Hides the label visually while keeping it for assistive technology. */
  readonly iconOnly?: boolean;
  readonly ariaLabel?: string;
  readonly ariaControls?: string;
  readonly ariaExpanded?: boolean;
  readonly class?: string;
  readonly id?: string;
}

export function button(options: ButtonOptions): RawHtml {
  const {
    children,
    href,
    disabled = false,
    loading = false,
    iconOnly = false,
    class: className,
    loadingLabel,
    ...rest
  } = options;

  // A busy control must not be activatable, even if its markup still renders.
  const inert = disabled || loading;

  const shared = {
    class: cn("toz-button", className),
    "data-variant": rest.variant ?? "primary",
    "data-size": rest.size ?? "md",
    "data-full": rest.fullWidth === true ? "true" : undefined,
    "data-loading": loading === true ? "true" : undefined,
  } as const;

  const label = html`<span class="toz-button__label">${children}</span>`;
  const spinner = loading
    ? html`<span class="toz-button__spinner" aria-hidden="true"></span><span class="toz-visually-hidden">${loadingLabel ?? "Working"}</span>`
    : null;

  if (href !== undefined) {
    return html`<a${raw(
      attrs({
        ...shared,
        href: inert ? undefined : href,
        role: "button",
        "aria-disabled": inert ? "true" : undefined,
        "aria-busy": loading === true ? "true" : undefined,
        "aria-label": iconOnly ? (rest.ariaLabel ?? undefined) : undefined,
        "aria-controls": rest.ariaControls,
        "aria-expanded": rest.ariaExpanded,
        id: rest.id,
      }),
    )}>${spinner ?? ""}${label}</a>`;
  }

  return html`<button${raw(
    attrs({
      ...shared,
      type: rest.type ?? "button",
      disabled: inert,
      "aria-busy": loading === true ? "true" : undefined,
      "aria-label": iconOnly ? (rest.ariaLabel ?? undefined) : undefined,
      "aria-controls": rest.ariaControls,
      "aria-expanded": rest.ariaExpanded,
      name: rest.name,
      value: rest.value,
      id: rest.id,
    }),
  )}>${spinner ?? ""}${label}</button>`;
}

/**
 * A button with no visible label.
 *
 * `ariaLabel` is required at the type level because an icon-only control with
 * no accessible name is unusable with a screen reader. This is the smallest
 * possible inline SVG system: no icon dependency, no sprite sheet, and every
 * glyph is a plain path.
 */
export interface IconButtonOptions extends Omit<ButtonOptions, "children"> {
  readonly ariaLabel: string;
  readonly icon: string;
}

export function iconButton(options: IconButtonOptions): RawHtml {
  const { icon, ariaLabel, ...rest } = options;
  return button({
    ...rest,
    iconOnly: true,
    ariaLabel,
    children: html`<svg
      class="toz-icon"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >${raw(icon)}</svg>`,
  });
}

/** Shared stroke-based icon geometry, so no component carries its own SVG. */
export const ICON_PATHS = {
  chevronRight: '<path d="M9 5l7 7-7 7" />',
  chevronDown: '<path d="M5 9l7 7 7-7" />',
  close: '<path d="M6 6l12 12M18 6L6 18" />',
  menu: '<path d="M3 6h18M3 12h18M3 18h18" />',
  check: '<path d="M20 6L9 17l-5-5" />',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />',
  info: '<circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />',
  warning: '<path d="M12 3l9 16H3l9-16z" /><path d="M12 9v4M12 16h.01" />',
  error: '<circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" />',
  success: '<circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" />',
  search: '<circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />',
  arrowRight: '<path d="M4 12h16M14 6l6 6-6 6" />',
  refresh: '<path d="M20 12a8 8 0 11-2.3-5.6M20 4v4h-4" />',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Inline SVG for a named icon. Always decorative; the label carries meaning. */
export function icon(name: IconName, sizeRem = "1em"): RawHtml {
  return html`<svg
    class="toz-icon"
    viewBox="0 0 24 24"
    width="${sizeRem}"
    height="${sizeRem}"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >${raw(ICON_PATHS[name])}</svg>`;
}

/** The alert icon matching a status tone. */
export function toneIcon(tone: "info" | "success" | "warning" | "error"): RawHtml {
  const map = { info: "info", success: "success", warning: "warning", error: "error" } as const;
  return icon(map[tone]);
}
