/**
 * TOZ AI Office — design system.
 *
 * A framework-agnostic, server-renderable design system.
 *
 * Import it as a SECONDARY entry point (`toz-ai-office/design-system`) rather
 * than through the main entry. That separation is deliberate: the core in
 * `src/core`, `src/queue`, `src/routing` and friends must never depend on
 * presentation, and keeping the design system out of `src/index.ts` means a
 * headless consumer can install and use the core without pulling in any UI.
 *
 * Nothing in this module imports from the core. Status vocabularies are declared
 * locally and mirror the core's semantics; the boundary is enforced by
 * `tests/designSystem.phase01Isolation.test.ts`.
 */

export * from "./utils/index.js";
export * from "./tokens/index.js";
export * from "./layout/index.js";
export * from "./primitives/index.js";
export * from "./theme/index.js";

/** Version of the design system, independent of the package version. */
export const DESIGN_SYSTEM_VERSION = "0.1.0" as const;
