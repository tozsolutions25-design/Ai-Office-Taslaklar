import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  COLOR_TOKENS,
  ELEVATION,
  ELEVATION_LEVELS,
  HEALTH_STATES,
  MOTION_DURATIONS,
  MOTION_MS,
  RADIUS,
  RADIUS_STEPS,
  REDUCED_MOTION_MEDIA_QUERY,
  SPACING,
  SPACING_STEPS,
  STATUS_TONES,
  TYPE_METRICS,
  TYPE_SCALE,
  healthTone,
  isRoutableHealth,
  space,
} from "../src/design-system/tokens/index.js";
import { BREAKPOINTS, BREAKPOINT_MIN_WIDTH, mediaQuery } from "../src/design-system/tokens/breakpoints.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = path.resolve(here, "..", "..", "src", "design-system", "styles");

function readStyle(file: string): string {
  return readFileSync(path.join(stylesDir, file), "utf8");
}

const tokensCss = readStyle("tokens.css");
const baseCss = readStyle("base.css");
const layoutCss = readStyle("layout.css");
const componentsCss = readStyle("components.css");

/** All custom properties declared in a file. */
function declaredProperties(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((match) => match[1]));
}

/**
 * Index of the light-theme rule.
 *
 * Matched as a selector, not as a bare substring: `[data-theme="light"]` also
 * appears in the file's leading comment, and matching that occurrence would make
 * the "dark" block cover only the comment.
 */
const lightThemeIndex = tokensCss.search(/^\[data-theme="light"\]\s*\{/m);
const reducedMotionIndex = tokensCss.search(/^@media \(prefers-reduced-motion: reduce\)\s*\{/m);

describe("colour tokens: TypeScript and CSS agree", () => {
  const declared = declaredProperties(tokensCss);

  it("finds a distinct dark and light theme block", () => {
    assert.ok(lightThemeIndex > 0, "the light theme rule must exist");
    assert.ok(reducedMotionIndex > lightThemeIndex, "the reduced-motion block must follow the light theme");
  });

  it("declares every colour token the TypeScript layer exports", () => {
    const missing = COLOR_TOKENS.filter((token) => !declared.has(`--toz-${token}`));
    assert.deepEqual(missing, [], `colour tokens missing from tokens.css: ${missing.join(", ")}`);
  });

  it("defines each colour token in both themes", () => {
    const darkBlock = tokensCss.slice(0, lightThemeIndex);
    const lightBlock = tokensCss.slice(lightThemeIndex, reducedMotionIndex);
    const darkDeclared = declaredProperties(darkBlock);
    const lightDeclared = declaredProperties(lightBlock);
    assert.ok(darkDeclared.size > 20, `the dark block should declare many tokens, found ${darkDeclared.size}`);
    assert.ok(lightDeclared.size > 20, `the light block should declare many tokens, found ${lightDeclared.size}`);
    for (const token of COLOR_TOKENS) {
      assert.ok(darkDeclared.has(`--toz-${token}`), `${token} is not defined for the dark theme`);
      assert.ok(lightDeclared.has(`--toz-${token}`), `${token} is not defined for the light theme`);
    }
  });

  it("gives the light theme a distinct value for every surface and text role", () => {
    // If light simply reused dark values the two themes would be identical,
    // which would mean the light theme is decorative rather than real.
    const split = lightThemeIndex;
    const valueOf = (css: string, name: string): string | undefined => {
      const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
      return match;
    };
    for (const token of ["background", "surface", "foreground", "primary", "destructive"] as const) {
      const dark = valueOf(tokensCss.slice(0, split), `--toz-${token}`);
      const light = valueOf(tokensCss.slice(split, reducedMotionIndex), `--toz-${token}`);
      assert.ok(dark, `dark value missing for ${token}`);
      assert.ok(light, `light value missing for ${token}`);
      assert.notEqual(dark, light, `${token} is identical in both themes`);
    }
  });

  it("uses a dark navy as the dark background rather than pure black", () => {
    const match = /--toz-background:\s*(#[0-9a-f]{6})/i.exec(tokensCss);
    assert.ok(match, "expected a hex background for the dark theme");
    const hex = match[1];
    const r = parseInt(hex.slice(1, 3), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Pure black is #000000. A navy foundation has measurable blue.
    assert.ok(b > r, "the dark background should be bluer than it is red (navy, not neutral)");
    assert.ok(r < 32, "the dark background should be genuinely dark");
  });

  it("keeps component rules free of raw colour literals", () => {
    // Colours must flow from tokens so theming stays a single-file change.
    const literals = [...componentsCss.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0]);
    assert.deepEqual(literals, [], `components.css must not hardcode colours, found: ${literals.join(", ")}`);
  });
});

describe("typography tokens", () => {
  const declared = declaredProperties(tokensCss);

  it("defines a size, line height and family for every type role", () => {
    for (const role of TYPE_SCALE) {
      assert.ok(declared.has(`--toz-font-size-${role}`), `missing font size for ${role}`);
      assert.ok(declared.has(`--toz-line-height-${role}`), `missing line height for ${role}`);
    }
    assert.ok(declared.has("--toz-font-sans"));
    assert.ok(declared.has("--toz-font-mono"));
  });

  it("applies the documented size for every role", () => {
    const sizeOf = (role: string): string | undefined =>
      new RegExp(`--toz-font-size-${role}:\\s*([^;]+);`).exec(tokensCss)?.[1]?.trim();
    assert.equal(sizeOf("body"), "clamp(1rem, 0.97rem + 0.15vw, 1.0625rem)");
    assert.equal(sizeOf("button"), "0.9375rem");
  });

  it("keeps the scale monotonically non-increasing from display to caption", () => {
    const order: Array<keyof typeof TYPE_METRICS> = [
      "display",
      "h1",
      "h2",
      "h3",
      "h4",
      "body-lg",
      "body",
      "body-sm",
      "caption",
    ];
    for (let i = 1; i < order.length; i += 1) {
      const previous = TYPE_METRICS[order[i - 1]];
      const current = TYPE_METRICS[order[i]];
      assert.ok(
        current.maxRem <= previous.maxRem,
        `${order[i]} (${current.maxRem}rem) must not exceed ${order[i - 1]} (${previous.maxRem}rem)`,
      );
    }
  });

  it("never drops below a readable minimum size", () => {
    for (const role of TYPE_SCALE) {
      assert.ok(TYPE_METRICS[role].minRem >= 0.75, `${role} falls below 12px at the smallest viewport`);
    }
  });

  it("gives every role a usable line height", () => {
    for (const role of TYPE_SCALE) {
      assert.ok(TYPE_METRICS[role].lineHeight >= 1, `${role} needs a line height of at least 1`);
      assert.ok(TYPE_METRICS[role].lineHeight <= 2, `${role} line height is too loose`);
    }
  });
});

describe("spacing, radius and elevation tokens", () => {
  const declared = declaredProperties(tokensCss);

  it("defines every spacing step in CSS", () => {
    for (const step of SPACING_STEPS) {
      assert.ok(declared.has(`--toz-space-${step}`), `missing spacing token for step ${step}`);
    }
  });

  it("keeps CSS spacing in sync with the TypeScript scale", () => {
    for (const step of SPACING_STEPS) {
      const match = new RegExp(`--toz-space-${step}:\\s*([^;]+);`).exec(tokensCss)?.[1]?.trim();
      assert.equal(match, `${SPACING[step]}rem`, `spacing step ${step} disagrees between TS and CSS`);
    }
  });

  it("is built on a 4px base grid", () => {
    for (const step of SPACING_STEPS) {
      const px = SPACING[step] * 16;
      assert.equal(Math.round(px) % 4, 0, `spacing step ${step} is ${px}px, not a multiple of 4`);
    }
  });

  it("formats spacing as rem", () => {
    assert.equal(space("4"), "1rem");
    assert.equal(space("0"), "0rem");
  });

  it("defines every radius step in CSS", () => {
    for (const step of RADIUS_STEPS) {
      assert.ok(declared.has(`--toz-radius-${step}`), `missing radius token ${step}`);
    }
  });

  it("keeps radii restrained: only the pill is fully round", () => {
    assert.equal(RADIUS.pill, "9999px");
    for (const step of RADIUS_STEPS) {
      if (step === "pill" || step === "none") continue;
      const value = RADIUS[step];
      const rem = Number.parseFloat(value);
      assert.ok(rem <= 1, `${step} radius of ${value} is too round for a technical B2B surface`);
    }
  });

  it("orders radii from small to large", () => {
    const steps: Array<keyof typeof RADIUS> = ["small", "medium", "large", "card"];
    for (let i = 1; i < steps.length; i += 1) {
      const previous = Number.parseFloat(RADIUS[steps[i - 1]]);
      const current = Number.parseFloat(RADIUS[steps[i]]);
      assert.ok(current > previous, `${steps[i]} must be larger than ${steps[i - 1]}`);
    }
  });

  it("defines all five elevation levels, with none as the floor", () => {
    assert.equal(ELEVATION_LEVELS.length, 5);
    assert.equal(ELEVATION.none, "none");
    assert.ok(declared.has("--toz-elevation-card"));
    assert.ok(declared.has("--toz-elevation-modal"));
  });

  it("increases shadow intensity with elevation", () => {
    // Measured as the largest blur radius, which is the value that actually
    // reads as depth. Counting `px` occurrences would not distinguish levels,
    // since several levels use a two-layer shadow.
    const maxBlur = (level: keyof typeof ELEVATION): number => {
      const values = [...ELEVATION[level].matchAll(/(-?\d+(?:\.\d+)?)px/g)]
        .map((match) => Math.abs(Number(match[1])))
        .filter((value) => Number.isFinite(value));
      return values.length === 0 ? 0 : Math.max(...values);
    };
    assert.equal(maxBlur("none"), 0);
    const order: Array<keyof typeof ELEVATION> = ["subtle", "card", "elevated", "modal"];
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(
        maxBlur(order[i]) > maxBlur(order[i - 1]),
        `${order[i]} must have a larger blur than ${order[i - 1]}`,
      );
    }
  });
});

describe("motion tokens", () => {
  const declared = declaredProperties(tokensCss);

  it("defines every duration in CSS", () => {
    for (const duration of MOTION_DURATIONS) {
      assert.ok(declared.has(`--toz-duration-${duration}`), `missing duration token ${duration}`);
    }
  });

  it("keeps CSS durations in sync with TypeScript", () => {
    for (const duration of MOTION_DURATIONS) {
      const match = new RegExp(`--toz-duration-${duration}:\\s*([^;]+);`).exec(tokensCss)?.[1]?.trim();
      assert.equal(match, `${MOTION_MS[duration]}ms`);
    }
  });

  it("keeps durations short enough to never delay interaction", () => {
    assert.ok(MOTION_MS.slow <= 500, "the slowest transition must stay under half a second");
    assert.ok(MOTION_MS.fast >= 80, "instant-fast transitions below 80ms read as a flicker");
  });

  it("orders durations from instant to slow", () => {
    assert.equal(MOTION_MS.instant, 0);
    assert.ok(MOTION_MS.fast < MOTION_MS.normal);
    assert.ok(MOTION_MS.normal < MOTION_MS.slow);
  });

  it("respects prefers-reduced-motion by collapsing durations", () => {
    assert.ok(tokensCss.includes(REDUCED_MOTION_MEDIA_QUERY), "the reduced-motion query must be present");
    const block = tokensCss.slice(tokensCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const duration of MOTION_DURATIONS) {
      if (duration === "instant") continue;
      assert.ok(
        new RegExp(`--toz-duration-${duration}:\\s*0\\.01ms`).test(block),
        `${duration} must be collapsed under reduced motion`,
      );
    }
  });

  it("stops looping animations under reduced motion", () => {
    const block = tokensCss.slice(tokensCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.ok(block.includes("animation-iteration-count: 1"), "looping animations must be stopped");
  });
});

describe("responsive tokens", () => {
  it("declares four ascending breakpoints", () => {
    assert.equal(BREAKPOINTS.length, 4);
    for (let i = 1; i < BREAKPOINTS.length; i += 1) {
      assert.ok(
        BREAKPOINT_MIN_WIDTH[BREAKPOINTS[i]] >
          BREAKPOINT_MIN_WIDTH[BREAKPOINTS[i - 1]],
        `${BREAKPOINTS[i]} must be wider than ${BREAKPOINTS[i - 1]}`,
      );
    }
  });

  it("starts at a small phone, not a tablet", () => {
    assert.ok(BREAKPOINT_MIN_WIDTH.sm <= 480, "the base breakpoint must suit a small phone");
  });

  it("covers tablet, desktop and large desktop", () => {
    assert.equal(BREAKPOINT_MIN_WIDTH.md, 768);
    assert.equal(BREAKPOINT_MIN_WIDTH.lg, 1024);
    assert.equal(BREAKPOINT_MIN_WIDTH.xl, 1280);
  });

  it("builds min-width media queries", () => {
    assert.equal(mediaQuery("md"), "(min-width: 768px)");
  });

  it("uses these breakpoints in the CSS", () => {
    for (const width of [480, 768, 1024, 1280]) {
      assert.ok(
        layoutCss.includes(`min-width: ${width}px`) || componentsCss.includes(`min-width: ${width}px`),
        `no layout rule responds at ${width}px`,
      );
    }
  });
});

describe("status vocabulary", () => {
  it("covers every status tone the components accept", () => {
    assert.deepEqual([...STATUS_TONES], ["neutral", "info", "success", "warning", "error", "processing"]);
  });

  it("maps every health state onto a tone", () => {
    for (const state of HEALTH_STATES) {
      assert.ok(STATUS_TONES.includes(healthTone(state)), `${state} has no tone`);
    }
  });

  it("maps health states to the expected tones", () => {
    assert.equal(healthTone("healthy"), "success");
    assert.equal(healthTone("degraded"), "warning");
    assert.equal(healthTone("unavailable"), "error");
    assert.equal(healthTone("disabled"), "neutral");
    assert.equal(healthTone("unknown"), "info");
  });

  it("never treats disabled or unavailable as routable", () => {
    assert.equal(isRoutableHealth("healthy"), true);
    assert.equal(isRoutableHealth("degraded"), true);
    assert.equal(isRoutableHealth("unknown"), true);
    assert.equal(isRoutableHealth("unavailable"), false);
    assert.equal(isRoutableHealth("disabled"), false);
  });
});

describe("base stylesheet accessibility", () => {
  it("provides a visible focus indicator", () => {
    assert.ok(baseCss.includes(":focus-visible"), "a focus-visible rule is required");
    assert.ok(baseCss.includes("outline:"), "the focus ring must be drawn with outline");
  });

  it("never removes focus indication without a replacement", () => {
    const index = baseCss.indexOf(":focus:not(:focus-visible)");
    assert.ok(index > -1, "expected a :focus:not(:focus-visible) rule");
    const snippet = baseCss.slice(index, index + 120);
    assert.ok(snippet.includes("outline: none"), "expected the outline to be scoped to mouse focus only");
  });

  it("honours forced-colours mode", () => {
    assert.ok(baseCss.includes("@media (forced-colors: active)"));
  });

  it("provides a visually hidden utility that screen readers still see", () => {
    assert.ok(baseCss.includes(".toz-visually-hidden"));
    assert.ok(baseCss.includes("clip-path"), "modern visually-hidden uses clip-path");
  });

  it("provides a skip link that becomes visible on focus", () => {
    assert.ok(baseCss.includes(".toz-skip-link"));
    assert.ok(baseCss.includes(".toz-skip-link:focus-visible"));
  });

  it("prevents smooth scrolling when reduced motion is requested", () => {
    assert.ok(baseCss.includes("@media (prefers-reduced-motion: no-preference)"));
  });
});
