/**
 * Semantic colour tokens.
 *
 * VALUE OWNERSHIP: the actual colour values live in
 * `src/design-system/styles/tokens.css` as CSS custom properties. This module
 * owns the token NAMES and nothing else. That single-source split is deliberate:
 *
 *  - CSS needs the values (for gradients, borders, shadows, focus rings).
 *  - TypeScript needs the names (so a component cannot reference a raw hex).
 *  - Keeping values in CSS means light/dark theming needs no JS at all.
 *
 * `tests/designSystem.tokens.test.ts` asserts that every name exported here is
 * defined in the CSS and vice versa, so the two cannot silently drift.
 *
 * No component may hardcode a colour literal; it must use one of these names.
 */

export const COLOR_TOKENS = [
  // Surfaces
  "background",
  "surface",
  "surface-elevated",
  "surface-muted",
  "surface-inset",
  "overlay-scrim",
  // Foreground
  "foreground",
  "foreground-muted",
  "foreground-subtle",
  "foreground-on-accent",
  // Borders
  "border",
  "border-strong",
  "border-muted",
  // Brand / action
  "primary",
  "primary-hover",
  "primary-foreground",
  "primary-subtle",
  "secondary",
  "secondary-hover",
  "secondary-foreground",
  "secondary-subtle",
  "accent",
  "accent-hover",
  "accent-foreground",
  "accent-subtle",
  // Status
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "destructive",
  "destructive-hover",
  "destructive-foreground",
  "info",
  "info-foreground",
  "processing",
  "processing-foreground",
  // Effects
  "focus-ring",
  "selection-background",
  "selection-foreground",
  "gradient-brand",
  "gradient-surface",
  "shadow-color",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/** CSS custom-property reference for a colour token. */
export function colorVar(token: ColorToken): string {
  return `var(--toz-${token})`;
}

/**
 * Status vocabulary shared by badges, status dots, health indicators and
 * alerts.
 *
 * Intentionally declared here rather than imported from `src/health` or
 * `src/audit`: the design system must not depend on the core, so that UI work
 * can never couple orchestration to presentation. The vocabulary mirrors the
 * core's semantics, and `tests/designSystem.phase01Isolation.test.ts` enforces
 * the absence of the import.
 */
export const STATUS_TONES = [
  "neutral",
  "info",
  "success",
  "warning",
  "error",
  "processing",
] as const;

export type StatusTone = (typeof STATUS_TONES)[number];

/** Health vocabulary, aligned with the core health model. */
export const HEALTH_STATES = [
  "unknown",
  "healthy",
  "degraded",
  "unavailable",
  "disabled",
] as const;

export type HealthState = (typeof HEALTH_STATES)[number];

/** Maps a health state onto a status tone, so health never invents a colour. */
export function healthTone(state: HealthState): StatusTone {
  switch (state) {
    case "healthy":
      return "success";
    case "degraded":
      return "warning";
    case "unavailable":
      return "error";
    case "disabled":
      return "neutral";
    case "unknown":
      return "info";
  }
}

/** True when a health state should be treated as non-operational. */
export function isRoutableHealth(state: HealthState): boolean {
  return state === "healthy" || state === "degraded" || state === "unknown";
}
