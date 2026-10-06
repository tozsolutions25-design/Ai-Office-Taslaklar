/**
 * Corner radius tokens.
 *
 * Restrained by intent: the brief is a precise, professional B2B surface, not
 * an overly rounded consumer UI. Only `pill` is fully round, and it exists for
 * badges and status dots where a circular form is meaningful.
 *
 * Mirrored in `tokens.css`; the parity test asserts agreement.
 */

export const RADIUS_STEPS = ["none", "small", "medium", "large", "card", "button", "pill"] as const;
export type RadiusStep = (typeof RADIUS_STEPS)[number];

export const RADIUS: Readonly<Record<RadiusStep, string>> = {
  none: "0",
  small: "0.25rem",
  medium: "0.5rem",
  large: "0.75rem",
  card: "1rem",
  button: "0.625rem",
  pill: "9999px",
};

export function radius(step: RadiusStep): string {
  return RADIUS[step];
}

/** Semantic alias so components express intent rather than a shape. */
export const CONTROL_RADIUS = "button" as const satisfies RadiusStep;
export const CONTAINER_RADIUS = "card" as const satisfies RadiusStep;
