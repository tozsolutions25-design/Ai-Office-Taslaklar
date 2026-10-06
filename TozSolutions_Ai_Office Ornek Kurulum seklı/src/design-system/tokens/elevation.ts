/**
 * Elevation tokens.
 *
 * Five levels only, and deliberately restrained. A dark navy interface relies
 * on borders and tonal surface shifts for separation; heavy drop shadows read
 * as dated and reduce information density. Shadows are tinted with the brand
 * shadow colour rather than pure black so they sit correctly on dark surfaces.
 *
 * Mirrored in `tokens.css`; the parity test asserts agreement.
 */

export const ELEVATION_LEVELS = ["none", "subtle", "card", "elevated", "modal"] as const;
export type ElevationLevel = (typeof ELEVATION_LEVELS)[number];

export const ELEVATION: Readonly<Record<ElevationLevel, string>> = {
  none: "none",
  subtle: "0 1px 2px 0 var(--toz-shadow-color)",
  card: "0 2px 8px -2px var(--toz-shadow-color), 0 1px 3px -1px var(--toz-shadow-color)",
  elevated: "0 8px 24px -6px var(--toz-shadow-color), 0 2px 6px -2px var(--toz-shadow-color)",
  modal: "0 24px 64px -12px var(--toz-shadow-color), 0 8px 16px -8px var(--toz-shadow-color)",
};

/** Border widths, in `px`. Hairlines only; thick borders read as heavy. */
export const BORDER_WIDTHS = {
  none: "0",
  hairline: "1px",
  thick: "2px",
} as const;

export type BorderWidth = keyof typeof BORDER_WIDTHS;

/** Border styles. */
export const BORDER_STYLES = ["solid", "dashed", "dotted"] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

export function elevation(level: ElevationLevel): string {
  return ELEVATION[level];
}
