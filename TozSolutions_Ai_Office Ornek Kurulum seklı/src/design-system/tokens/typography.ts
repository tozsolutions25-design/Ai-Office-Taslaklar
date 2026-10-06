/**
 * Typography scale.
 *
 * Font FAMILIES and the size/weight/line-height ratios live in
 * `styles/tokens.css`. This module owns the role NAMES, so a component asks
 * for `type="h1"` and never for a pixel value.
 *
 * The scale is a modular ratio tuned for a technical B2B audience: display and
 * heading sizes are tight (low letter-spacing) so large text reads as precise
 * rather than loose, while body and caption sizes open up for legibility.
 * `CLAMP_SCALE` documents the fluid range used in CSS via `clamp()` so the
 * smallest and largest viewport values are explicit and reviewable.
 */

export const TYPE_SCALE = [
  "display",
  "h1",
  "h2",
  "h3",
  "h4",
  "body-lg",
  "body",
  "body-sm",
  "caption",
  "label",
  "button",
  "code",
] as const;

export type TypeScale = (typeof TYPE_SCALE)[number];

/** Numeric properties TypeScript needs, for example inline SVG sizing. */
export interface TypeMetrics {
  /** `rem` size at the smallest supported viewport. */
  readonly minRem: number;
  /** `rem` size at a wide viewport. */
  readonly maxRem: number;
  readonly weight: number;
  /** Multiplier of the font size. */
  readonly lineHeight: number;
  /** `em` letter-spacing. Negative tightens. */
  readonly letterSpacing: number;
}

/**
 * The scale.
 *
 * `minRem`/`maxRem` are the clamped endpoints implemented in
 * `tokens.css`; they are recorded here so a consumer that needs the numbers in
 * JavaScript (for example an inline SVG `viewBox` calculation) does not have
 * to parse CSS. The CSS remains authoritative for rendering.
 */
export const TYPE_METRICS: Readonly<Record<TypeScale, TypeMetrics>> = {
  display: { minRem: 2.25, maxRem: 3.5, weight: 700, lineHeight: 1.06, letterSpacing: -0.03 },
  h1: { minRem: 1.875, maxRem: 2.75, weight: 700, lineHeight: 1.12, letterSpacing: -0.025 },
  h2: { minRem: 1.5, maxRem: 2.125, weight: 650, lineHeight: 1.18, letterSpacing: -0.02 },
  h3: { minRem: 1.25, maxRem: 1.625, weight: 650, lineHeight: 1.28, letterSpacing: -0.015 },
  h4: { minRem: 1.0625, maxRem: 1.3125, weight: 600, lineHeight: 1.36, letterSpacing: -0.01 },
  "body-lg": { minRem: 1.0625, maxRem: 1.1875, weight: 400, lineHeight: 1.65, letterSpacing: -0.005 },
  body: { minRem: 1, maxRem: 1.0625, weight: 400, lineHeight: 1.7, letterSpacing: 0 },
  "body-sm": { minRem: 0.875, maxRem: 0.9375, weight: 400, lineHeight: 1.6, letterSpacing: 0 },
  caption: { minRem: 0.75, maxRem: 0.8125, weight: 500, lineHeight: 1.5, letterSpacing: 0.01 },
  label: { minRem: 0.8125, maxRem: 0.875, weight: 600, lineHeight: 1.4, letterSpacing: 0.005 },
  button: { minRem: 0.9375, maxRem: 0.9375, weight: 600, lineHeight: 1.2, letterSpacing: 0.005 },
  code: { minRem: 0.875, maxRem: 0.9375, weight: 500, lineHeight: 1.6, letterSpacing: 0 },
};

/** Font family stacks exposed as CSS custom properties. */
export const FONT_FAMILIES = ["sans", "mono"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

/** Text alignment. */
export const TEXT_ALIGNMENTS = ["start", "center", "end"] as const;
export type TextAlign = (typeof TEXT_ALIGNMENTS)[number];

/** Text colour roles. Components use these instead of colour tokens directly. */
export const TEXT_TONES = [
  "default",
  "muted",
  "subtle",
  "primary",
  "success",
  "warning",
  "destructive",
  "info",
  "on-accent",
] as const;
export type TextTone = (typeof TEXT_TONES)[number];

/** Font weight roles. */
export const FONT_WEIGHTS = ["regular", "medium", "semibold", "bold"] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

/**
 * Minimum rendered text size, in `rem`, that the design system permits.
 *
 * Enforced so no future component can introduce text smaller than the caption
 * step, which is the point below which the palette stops being readable.
 */
export const MIN_TEXT_REM = TYPE_METRICS.caption.minRem;
