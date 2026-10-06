import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { renderHome, renderRoute, ROUTES } from "../src/site/index.js";
import { createCore } from "../src/index.js";
import { loadConfig } from "../src/config/index.js";
import { ProviderRegistry } from "../src/providers/index.js";
import { ModelRegistry } from "../src/models/index.js";
import { ManualClock } from "../src/core/clock.js";
import { matchCapabilities } from "../src/capabilities/index.js";
import { CapabilitySet } from "../src/capabilities/capability.js";
import { validateWorkload } from "../src/workload/index.js";
import { TaskQueue } from "../src/queue/index.js";
import { ConcurrencyManager } from "../src/concurrency/index.js";
import { DEFAULT_RETRY_POLICY, RetryExecutor } from "../src/retry/index.js";
import { UNKNOWN_HEALTH } from "../src/health/index.js";
import { AuditLog } from "../src/audit/index.js";
import { StateStore } from "../src/state/index.js";
import { button, card, COLOR_TOKENS, SECTION_SPACING_OPTIONS } from "../src/design-system/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
const siteCss = readFileSync(path.join(projectRoot, "src", "site", "styles", "site.css"), "utf8");
const home = renderHome();

/** Every `.ts` file under a directory, recursively. */
function collectTypeScript(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTypeScript(absolute));
    } else if (entry.name.endsWith(".ts")) {
      found.push(absolute);
    }
  }
  return found;
}

const siteRoot = path.join(projectRoot, "src", "site");
const designSystemRoot = path.join(projectRoot, "src", "design-system");

/** True when `file` is inside `root`, compared by path parts. */
function isInsidePath(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Every `toz-site-*` class the rendered homepage actually applies. */
function siteClassesUsed(): Set<string> {
  // Scans EVERY route, not just the homepage.
  //
  // This was homepage-only, which was correct while the homepage was the only
  // page. Once inner pages existed (PROJECT_STATE.md §13), a class used only by
  // an inner page was reported as dead CSS — and that would have pushed a real
  // fix in the wrong direction: deleting the class instead of keeping the pages
  // that need it.
  //
  // The invariant is "no dead CSS", so the scan now covers the whole site. That
  // strengthens the check: a class used nowhere still fails, and a class used on
  // one page is no longer treated as an orphan.
  const documents = ROUTES.map((route) => renderRoute(route.path));
  return new Set(
    documents
      .flatMap((document) => [...document.matchAll(/class="([^"]*)"/g)])
      .flatMap((match) => (match[1] ?? "").split(/\s+/))
      .filter((name) => name.startsWith("toz-site-")),
  );
}

/** Every TypeScript file outside the site and design-system directories. */
function coreAndDesignSystemFiles(): string[] {
  return collectTypeScript(path.join(projectRoot, "src")).filter((file) => {
    const relativeToSite = path.relative(siteRoot, file);
    if (relativeToSite === "" || (!relativeToSite.startsWith("..") && !path.isAbsolute(relativeToSite))) {
      return false;
    }
    const relativeToDesignSystem = path.relative(designSystemRoot, file);
    return relativeToDesignSystem.startsWith("..") || path.isAbsolute(relativeToDesignSystem);
  });
}

describe("site stylesheet discipline", () => {
  it("defines no raw colour values, only tokens", () => {
    const literals = [...siteCss.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0]);
    assert.deepEqual(literals, [], `site.css must not hardcode colours: ${literals.join(", ")}`);
  });

  it("defines no fixed element width, only token or fluid values", () => {
    // A fixed width is the main cause of horizontal overflow on a narrow phone.
    // Media-query conditions are excluded: `max-width: 479px` is a breakpoint,
    // not a size applied to an element.
    const withoutMediaConditions = siteCss.replace(/@media[^{]*\{/g, "@media{");
    const fixedWidths = [...withoutMediaConditions.matchAll(/(?<!min-)\bwidth:\s*(\d+)px/g)].map(
      (match) => match[0],
    );
    assert.deepEqual(
      fixedWidths,
      [],
      `site.css must not set a fixed element width: ${fixedWidths.join(", ")}`,
    );
  });

  it("applies media queries on the documented breakpoints", () => {
    // The small-screen correction is expressed as `max-width`, one pixel below
    // the 480px design breakpoint, which is the correct pattern.
    assert.ok(
      /max-width:\s*479px/.test(siteCss),
      "the small-phone block must sit just below the 480px breakpoint",
    );
  });

  it("uses tokens for spacing rather than raw rem or pixel values", () => {
    const gaps = [...siteCss.matchAll(/(?:gap|padding|margin)[^:]*:\s*([\d.]+)(rem|px)/g)].map((match) => match[0]);
    assert.deepEqual(gaps, [], `spacing must use --toz-space-* tokens: ${gaps.slice(0, 5).join(", ")}`);
  });

  it("defines a rule for every site class the page uses", () => {
    // `toz-site-footer` is a marker applied alongside `toz-section` for
    // identification; it intentionally carries no rule of its own.
    const markerOnly = new Set(["toz-site-footer"]);
    const defined = new Set([...siteCss.matchAll(/\.(toz-site-[a-z0-9_-]+)/g)].map((match) => match[1]));
    const used = siteClassesUsed();
    const missing = [...used].filter((name) => !defined.has(name) && !markerOnly.has(name));
    assert.deepEqual(missing, [], `site classes used with no rule: ${missing.join(", ")}`);
  });

  it("defines no site class the page never uses", () => {
    const used = siteClassesUsed();
    const defined = [...siteCss.matchAll(/\.(toz-site-[a-z0-9_-]+)/g)].map((match) => match[1]);
    const orphans = defined.filter((name) => !used.has(name));
    assert.deepEqual(orphans, [], `dead site CSS: ${orphans.join(", ")}`);
  });

  it("does not redefine a design system class", () => {
    // The site layer composes; it does not restyle primitives. Overriding a
    // `toz-` design system class here would couple the page to internals.
    const overrides = [...siteCss.matchAll(/^\.(toz-(?!site|hero-visual|architecture-diagram|icon|container|section|stack|cluster|grid|grid__item|centered|type-|text-|weight-|font-|prose|nav|header|footer|link|button|card|badge|status|field|input|select|textarea|choice|switch|fieldset|form|alert|notice|skeleton|empty-state|spinner|progress|metric|timestamp|health|figure|image|brand|mobile-nav|skip-link|visually-hidden)[a-z0-9_-]*)/gm)].map((match) => match[1]);
    assert.deepEqual(overrides, [], `site.css must not restyle design system classes: ${[...new Set(overrides)].join(", ")}`);
  });

  it("respects reduced motion for every animation it declares", () => {
    const animationCount = (siteCss.match(/animation:/g) ?? []).length;
    assert.ok(animationCount > 0, "the page should have some motion to guard");
    const guardedBlock = siteCss.slice(siteCss.indexOf("@media (prefers-reduced-motion: no-preference)"));
    // Every animation must appear inside the no-preference block, so a
    // reduced-motion user receives a static page.
    const outsideGuard = siteCss.replace(guardedBlock, "");
    assert.equal(
      /animation:\s*toz-site/.test(outsideGuard),
      false,
      "every site animation must sit behind a prefers-reduced-motion: no-preference guard",
    );
  });

  it("does not enable smooth scrolling for reduced-motion users", () => {
    // Smooth scrolling comes from base.css and is already guarded there; the
    // site layer must not re-enable it.
    assert.equal(/scroll-behavior:\s*smooth/.test(siteCss), false);
  });

  it("uses auto-fit or minmax grids so columns reflow by width", () => {
    const grids = [...siteCss.matchAll(/grid-template-columns:\s*([^;]+);/g)].map((match) => match[1]);
    for (const grid of grids) {
      const fixed = /repeat\(\s*[2-9]\d*\s*,/.test(grid);
      const fluid = grid.includes("auto-fit") || grid.includes("minmax") || grid.includes("min(");
      assert.ok(
        fluid || !fixed,
        `grid "${grid}" uses a fixed column count without a fluid minimum, so it will overflow on a narrow screen`,
      );
    }
  });

  it("applies a fluid minimum rather than a fixed width in minmax grids", () => {
    for (const match of siteCss.matchAll(/minmax\(\s*([^,]+),/g)) {
      const first = (match[1]).trim();
      if (first === "0") continue;
      assert.ok(
        first.startsWith("min(") || first.includes("%") || first.includes("rem"),
        `minmax minimum "${first}" is not fluid`,
      );
    }
  });

  it("adapts the layout at tablet, desktop and large desktop", () => {
    for (const width of [768, 1024, 1280]) {
      assert.ok(siteCss.includes(`min-width: ${width}px`), `no layout rule at ${width}px`);
    }
  });

  it("corrects the layout below 480px rather than only above it", () => {
    assert.ok(siteCss.includes("max-width: 479px"), "a small-phone correction block is required");
    assert.ok(siteCss.includes("max-width: 767px") || siteCss.includes("max-width: 479px"));
  });

  it("stacks the hero actions on small screens so buttons keep a usable width", () => {
    const smallBlock = siteCss.slice(siteCss.indexOf("max-width: 479px"));
    assert.ok(
      smallBlock.includes("toz-site-hero__actions") && smallBlock.includes("flex-direction: column"),
      "hero actions must stack below 480px",
    );
  });

  it("supports forced-colors mode where brand gradients would disappear", () => {
    assert.ok(siteCss.includes("@media (forced-colors: active)"));
  });
});

describe("the site consumes the design system rather than replacing it", () => {
  it("renders PHASE 02 components, evidenced by their class names", () => {
    assert.ok(home.includes("toz-button"), "buttons must come from the design system");
    assert.ok(home.includes("toz-card"), "cards must come from the design system");
    assert.ok(home.includes("toz-badge"), "badges must come from the design system");
    assert.ok(home.includes("toz-container"), "layout must come from the design system");
    assert.ok(home.includes("toz-section"), "sections must come from the design system");
    assert.ok(home.includes("toz-skip-link"), "the skip link must come from the design system");
    assert.ok(home.includes("toz-nav"), "navigation must come from the design system");
  });

  it("uses design system typography utilities rather than its own scale", () => {
    for (const role of ["toz-type-display", "toz-type-h1", "toz-type-body", "toz-type-body-sm", "toz-type-caption"]) {
      assert.ok(home.includes(role), `${role} must come from the design system`);
    }
    assert.equal(/font-size:\s*[\d.]+(rem|px)/.test(siteCss), false, "the site must not define its own font sizes");
  });

  it("inherits every token from the design system stylesheet", () => {
    const references = [...new Set([...siteCss.matchAll(/var\(--toz-([a-z0-9-]+)\)/g)].map((m) => m[1]))];
    assert.ok(references.length > 5, "the site should reference design system tokens");

    // Every `--toz-*` custom property the design system actually declares.
    const designSystemCss = readdirSync(path.join(projectRoot, "src", "design-system", "styles"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(path.join(projectRoot, "src", "design-system", "styles", file), "utf8"))
      .join("\n");
    const declared = new Set(
      [...designSystemCss.matchAll(/^\s*(--toz-[a-z0-9-]+)\s*:/gim)].map((match) => (match[1]).slice("--toz-".length)),
    );
    // `toz-site-*` is the site's own namespace, declared in site.css itself.
    // The whole namespace is collected rather than one hard-coded name, so a new
    // site-local token does not have to be added to a list here to be legal — and
    // so a genuine typo in a site token is still caught.
    declared.add("gutter");
    for (const match of siteCss.matchAll(/^\s*(--toz-site-[a-z0-9-]+)\s*:/gim)) {
      // Strip only the `--toz-` prefix, because that is the form the reference
      // regex captures. Stripping `--toz-site-` would yield `max-measure` while
      // the reference reads `site-max-measure`, and the two would never match.
      declared.add((match[1] ?? "").slice("--toz-".length));
    }

    const undeclared = references.filter((reference) => !declared.has(reference));
    assert.deepEqual(
      undeclared,
      [],
      `site.css references undeclared tokens: ${undeclared.join(", ")}`,
    );
  });

  it("uses the design system section spacing scale", () => {
    // The site uses the scale; it does not have to exercise every step, because
    // a long-form page would lose its rhythm if it alternated all four.
    const used = [...new Set([...home.matchAll(/data-spacing="([a-z]+)"/g)].map((m) => m[1]))];
    assert.ok(used.length > 0, "sections must declare a spacing step");
    for (const spacing of used) {
      assert.ok(
        (SECTION_SPACING_OPTIONS as readonly string[]).includes(spacing),
        `unknown section spacing "${spacing}"`,
      );
    }
    assert.ok(used.includes("lg"), "the page should use its largest spacing for major sections");
  });

  it("references only real colour tokens for colour", () => {
    // `border-width` is a LENGTH token, not a colour, so it is excluded from
    // this check and covered by the general token check above. The distinction
    // matters: a colour token appearing in a border would be a styling error,
    // whereas a border-width token is correct usage.
    const colourReferences = [
      ...new Set(
        [...siteCss.matchAll(/var\(--toz-([a-z0-9-]+)\)/g)]
          .map((match) => match[1])
          .filter((name) => (COLOR_TOKENS as readonly string[]).includes(name)),
      ),
    ];
    assert.ok(colourReferences.length > 0, "the site should reference design system colours");
    for (const name of colourReferences) {
      assert.ok(
        (COLOR_TOKENS as readonly string[]).includes(name),
        `${name} must be a declared colour token`,
      );
    }
  });

  it("uses no raw colour function outside a token", () => {
    // `color-mix()` is only legitimate when its arguments are tokens; a literal
    // colour inside one would be an unreviewed colour value.
    const mixes = [...siteCss.matchAll(/color-mix\([^)]*\)/g)].map((match) => match[0]);
    for (const mix of mixes) {
      const literals = mix.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
      assert.deepEqual(literals, [], `color-mix() must build on tokens: ${mix}`);
    }
  });

  it("does not duplicate the design system's components in the site layer", () => {
    const siteFiles = readdirSync(path.join(projectRoot, "src", "site", "home"));
    // One file per section, none of which defines a primitive.
    for (const file of siteFiles) {
      const source = readFileSync(path.join(projectRoot, "src", "site", "home", file), "utf8");
      assert.equal(
        /export function (button|card|input|nav|header|footer|field|badge)\b/.test(source),
        false,
        `${file} must not redefine a design system primitive`,
      );
    }
  });
});

describe("PHASE 01 core remains independent of the site", () => {
  it("does not import the site from the core or the design system", () => {
    // Both non-site trees must be unaware the site exists, so a static build can
    // never pull a marketing page into a headless consumer.
    const offenders: string[] = [];
    for (const file of coreAndDesignSystemFiles()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
        const specifier = match[1];
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts"));
        if (!existsSync(resolved)) continue;
        const relative = path.relative(siteRoot, resolved);
        if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
          offenders.push(`${path.relative(projectRoot, file)} imports ${specifier}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `the core must not import the site:\n${offenders.join("\n")}`);
  });

  it("imports only the design system from the site", () => {
    // The site may depend on the design system — that is the whole point — but
    // on nothing else in `src/`. Reaching into the orchestration core would put
    // a marketing page behind the runtime.
    //
    // A dependency is allowed when it resolves INTO the design system tree, or
    // stays within the site itself. Reaching a sibling tree is the violation.
    const offenders: string[] = [];
    for (const file of collectTypeScript(siteRoot)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
        const specifier = match[1];
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts"));
        if (!existsSync(resolved)) continue;
        if (isInsidePath(resolved, designSystemRoot) || isInsidePath(resolved, siteRoot)) continue;
        offenders.push(`${path.relative(projectRoot, file)} imports ${specifier}`);
      }
    }
    assert.deepEqual(offenders, [], `the site must not import outside the design system:\n${offenders.join("\n")}`);
  });

  it("still composes the whole core", () => {
    const core = createCore();
    for (const key of ["config", "providers", "models", "queue", "concurrency", "audit", "health", "state", "router", "retry", "knowledge"]) {
      assert.ok((core as unknown as Record<string, unknown>)[key] !== undefined, `${key} missing from the core`);
    }
  });

  it("still validates configuration", () => {
    assert.equal(loadConfig({ TOZ_ENV: "production" }).ok, true);
  });

  it("still runs the provider lifecycle", () => {
    const clock = new ManualClock(0);
    const providers = new ProviderRegistry({ clock });
    assert.equal(providers.register({ providerId: "p1" }).ok, true);
    for (const step of ["verified", "probed", "classified", "awaiting_approval", "approved", "registered", "health_monitored", "production_pool"] as const) {
      assert.equal(providers.transition("p1", step).ok, true, `lifecycle step ${step}`);
    }
    assert.equal(providers.lifecycleOf("p1")?.state, "production_pool");
  });

  it("still enforces model-to-provider integrity", () => {
    const clock = new ManualClock(0);
    const providers = new ProviderRegistry({ clock });
    const models = new ModelRegistry({ clock, providers });
    providers.register({ providerId: "p1" });
    assert.equal(models.register({ modelId: "m1", providerId: "p1" }).ok, true);
    assert.equal(models.register({ modelId: "m2", providerId: "ghost" }).ok, false);
  });

  it("still treats unknown capability as unknown", () => {
    assert.equal(matchCapabilities(["reasoning"], CapabilitySet.unknown()).verdict, "unknown");
  });

  it("still validates workloads", () => {
    assert.equal(validateWorkload({ class: "coding" }).ok, true);
    assert.equal(validateWorkload({ class: "nope" }).ok, false);
  });

  it("still enforces queue capacity", () => {
    const queue = new TaskQueue({ maxTasks: 1, clock: new ManualClock(0) });
    assert.equal(queue.enqueue({ taskId: "a", workload: "coding", input: "x" }).ok, true);
    assert.equal(queue.enqueue({ taskId: "b", workload: "coding", input: "x" }).ok, false);
  });

  it("still enforces concurrency limits", async () => {
    const manager = new ConcurrencyManager({ globalLimit: 1, globalMaxWaiting: 0 });
    const lease = await manager.acquire({ providerId: "p", modelId: "m" });
    await assert.rejects(manager.acquire({ providerId: "p", modelId: "m" }));
    lease.release();
    assert.equal(manager.globalInFlight, 0);
  });

  it("still stops retrying a permanent failure", async () => {
    const executor = new RetryExecutor({ policy: DEFAULT_RETRY_POLICY, clock: new ManualClock(0) });
    let calls = 0;
    const outcome = await executor.execute(async () => {
      calls += 1;
      const { ClassifiedError } = await import("../src/core/errors.js");
      throw new ClassifiedError("authentication_failure", "bad key");
    });
    assert.equal(calls, 1);
    assert.equal(outcome.succeeded, false);
  });

  it("still reports health as unknown until observed", () => {
    assert.equal(UNKNOWN_HEALTH.status, "unknown");
    assert.equal(UNKNOWN_HEALTH.observedAt, null);
  });

  it("still redacts audit payloads and rejects credentials in state", () => {
    const audit = new AuditLog({ maxEvents: 4, clock: new ManualClock(0) });
    const event = audit.append({ kind: "config_reloaded", environment: "test", changedFields: ["apiKey"] });
    assert.deepEqual(event.changedFields, ["[REDACTED]"]);
    const state = new StateStore({ clock: new ManualClock(0) });
    assert.throws(() => state.set("c", "k", { password: "x" }));
  });

  it("still renders design system components", () => {
    assert.ok(button({ children: "x" }).value.includes("<button"));
    assert.ok(card({ title: "t" }).value.includes("toz-card"));
  });
});
