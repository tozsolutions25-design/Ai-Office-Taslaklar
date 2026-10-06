/**
 * Spacing scale.
 *
 * A 4px base grid. Values are `rem` so they respect the user's browser font
 * size, which is an accessibility requirement rather than a preference.
 *
 * Unlike colours, spacing values are needed in TypeScript (for example gap
 * arithmetic), so they live here and are mirrored in `tokens.css`. The parity
 * test asserts the two agree.
 */

export const SPACING_STEPS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "8",
  "10",
  "12",
  "14",
  "16",
  "20",
  "24",
  "28",
  "32",
] as const;

export type SpacingStep = (typeof SPACING_STEPS)[number];

/** The scale, in `rem`. */
export const SPACING: Readonly<Record<SpacingStep, number>> = {
  "0": 0,
  "1": 0.25,
  "2": 0.5,
  "3": 0.75,
  "4": 1,
  "5": 1.25,
  "6": 1.5,
  "8": 2,
  "10": 2.5,
  "12": 3,
  "14": 3.5,
  "16": 4,
  "20": 5,
  "24": 6,
  "28": 7,
  "32": 8,
};

/** Returns a spacing value as a CSS length. */
export function space(step: SpacingStep): string {
  return `${SPACING[step]}rem`;
}

/**
 * Spacing aliases for layout intent.
 *
 * Components accept steps, not arbitrary numbers, so rhythm is preserved.
 */
export const SECTION_SPACING = {
  sm: "12",
  md: "16",
  lg: "24",
  xl: "32",
} as const satisfies Record<string, SpacingStep>;

export type SectionSpacing = keyof typeof SECTION_SPACING;

/** Minimum interactive target size, in `rem`. */
export const TOUCH_TARGET_REM = 2.75;
