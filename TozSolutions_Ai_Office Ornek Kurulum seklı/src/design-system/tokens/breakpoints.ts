/**
 * Responsive breakpoints.
 *
 * Four named ranges, chosen for content behaviour rather than device names:
 *
 *  - `sm`  480px  large phone. Two-up card grids start to fit.
 *  - `md`  768px  tablet. Navigation switches from the disclosure pattern to a
 *                 horizontal bar; multi-column grids open up.
 *  - `lg`  1024px desktop. Full sidebar and dense data layouts appear.
 *  - `xl`  1280px large desktop. Content widths stop growing; density
 *                 increases instead.
 *
 * The design is mobile-first, so `sm` is the floor and every rule above it is
 * additive. `lg` is treated as the design reference, but nothing assumes a
 * 1440px viewport: content width is capped, and cards collapse gracefully at
 * every step down to a 320px phone.
 */

export const BREAKPOINTS = ["sm", "md", "lg", "xl"] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

/** Minimum viewport width in pixels, inclusive. */
export const BREAKPOINT_MIN_WIDTH: Readonly<Record<Breakpoint, number>> = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
};

/** The `min-width` media query for a breakpoint. */
export function mediaQuery(breakpoint: Breakpoint): string {
  return `(min-width: ${BREAKPOINT_MIN_WIDTH[breakpoint]}px)`;
}

/**
 * Content width constraints, in `rem`.
 *
 * `prose` is for long-form reading (documentation, marketing copy) and is
 * narrower than the general container, because a comfortable measure is about
 * 60-75 characters per line.
 */
export const CONTENT_WIDTHS = {
  /** Default page container. */
  default: "72rem",
  /** Long-form reading measure. */
  prose: "46rem",
  /** Narrow forms and single-column flows. */
  narrow: "32rem",
  /** Dashboards and data-dense tables. */
  wide: "96rem",
} as const;

export type ContentWidth = keyof typeof CONTENT_WIDTHS;

/**
 * The narrowest viewport the design system is built to support.
 *
 * Anything below this is out of scope; the layout does not attempt to
 * accommodate sub-320px screens.
 */
export const MIN_SUPPORTED_WIDTH_PX = 320;
