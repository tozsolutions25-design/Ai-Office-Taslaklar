/**
 * Motion foundation.
 *
 * Two families:
 *  - DURATIONS: how long something takes.
 *  - EASINGS: how it moves.
 *
 * Restrained on purpose. The brief explicitly rules out an animation
 * showcase, and excessive motion is an accessibility and professionalism
 * problem. Durations stay between 60ms and 420ms: long enough to read as
 * intentional, short enough never to delay interaction.
 *
 * `prefers-reduced-motion` is handled in CSS, not here: reduced-motion users
 * receive effectively-instant transitions while retaining state changes, so
 * no information is conveyed by animation alone. See `styles/tokens.css`.
 *
 * Mirrored in `tokens.css`; the parity test asserts agreement.
 */

export const MOTION_DURATIONS = ["instant", "fast", "normal", "slow"] as const;
export type MotionDuration = (typeof MOTION_DURATIONS)[number];

export const MOTION_MS: Readonly<Record<MotionDuration, number>> = {
  instant: 0,
  fast: 120,
  normal: 220,
  slow: 420,
};

/** Named easings, each with a documented purpose. */
export const MOTION_EASINGS = [
  /** No easing. For instant, deterministic changes. */
  "linear",
  /** Decelerating. Default for elements entering the viewport. */
  "standard",
  /** Accelerating. Default for elements leaving. */
  "accelerate",
  /** Symmetric. For elements moving within the viewport. */
  "emphasized",
  /** Overshoots slightly. Reserved for deliberate emphasis. */
  "spring",
] as const;

export type MotionEasing = (typeof MOTION_EASINGS)[number];

/** Semantic motion roles used by components. */
export const MOTION_ROLES = {
  enter: { duration: "normal", easing: "standard" },
  exit: { duration: "fast", easing: "accelerate" },
  emphasis: { duration: "normal", easing: "emphasized" },
  press: { duration: "instant", easing: "linear" },
  reveal: { duration: "slow", easing: "standard" },
} as const satisfies Record<string, { readonly duration: MotionDuration; readonly easing: MotionEasing }>;

export type MotionRole = keyof typeof MOTION_ROLES;

export function durationMs(duration: MotionDuration): number {
  return MOTION_MS[duration];
}

/**
 * The query that identifies users who have asked for reduced motion.
 *
 * Exported so server-rendered pages can emit a `prefers-reduced-motion`
 * override without hardcoding the string.
 */
export const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

/** Media query selecting the reduced-motion rules from `tokens.css`. */
export const REDUCED_MOTION_RULE = `@media ${REDUCED_MOTION_MEDIA_QUERY}`;
