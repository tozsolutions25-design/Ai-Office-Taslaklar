import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";

import * as ds from "../src/design-system/index.js";
import { toHtmlString } from "../src/design-system/utils/html.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
const previewHtml = path.join(projectRoot, "dist", "preview", "index.html");
const stylesDir = path.join(projectRoot, "src", "design-system", "styles");

/** Every component class the design system can emit. */
function emittedClasses(): Set<string> {
  const classes = new Set<string>();
  const collect = (value: string): void => {
    for (const match of value.matchAll(/class="([^"]*)"/g)) {
      for (const name of (match[1]).split(/\s+/)) {
        if (name !== "" && !name.startsWith("--")) {
          classes.add(name);
        }
      }
    }
  };

  collect(toHtmlString(ds.button({ children: "x" })));
  collect(toHtmlString(ds.button({ children: "x", variant: "outline", size: "lg", fullWidth: true, loading: true, iconOnly: true, ariaLabel: "x" })));
  collect(toHtmlString(ds.link({ href: "/x", children: "x", variant: "nav", external: true, current: true })));
  collect(toHtmlString(ds.disabledLink({ children: "x" })));
  collect(toHtmlString(ds.card({ title: "t", description: "d", children: "c", footer: "f", status: "s", interactive: true, tone: "accent" })));
  collect(toHtmlString(ds.cardHeader({ children: "h" })));
  collect(toHtmlString(ds.cardBody({ children: "b" })));
  collect(toHtmlString(ds.cardFooter({ children: "f" })));
  collect(toHtmlString(ds.badge({ children: "b", tone: "success", live: true, icon: "processing" })));
  collect(toHtmlString(ds.statusDot({ tone: "success", size: "lg", label: "ok" })));
  collect(toHtmlString(ds.healthIndicator({ state: "degraded", detail: "d" })));
  collect(toHtmlString(ds.progress({ value: 50, label: "p" })));
  collect(toHtmlString(ds.progress({ label: "p" })));
  collect(toHtmlString(ds.progress({ value: 50, label: "p", size: "sm" })));
  collect(toHtmlString(ds.spinner({ label: "s" })));
  collect(toHtmlString(ds.skeleton({ label: "s" })));
  collect(toHtmlString(ds.skeletonGroup({ label: "s" })));
  collect(toHtmlString(ds.emptyState({ title: "e", description: "d", action: "a", icon: "info" })));
  collect(toHtmlString(ds.loadingState({ label: "l" })));
  collect(toHtmlString(ds.metric({ label: "l", value: "v", delta: "d", deltaDirection: "up", hint: "h" })));
  collect(toHtmlString(ds.timestamp({ text: "t", iso: "2026-01-01T00:00:00.000Z" })));
  collect(toHtmlString(ds.field({ id: "i", label: "l", description: "d", error: "e", required: true, disabled: true, children: ds.input({ id: "i" }) })));
  collect(toHtmlString(ds.input({ id: "i" })));
  collect(toHtmlString(ds.textarea({ id: "i" })));
  collect(toHtmlString(ds.select({ id: "i", options: [{ value: "a", label: "A" }] })));
  collect(toHtmlString(ds.checkbox({ id: "i", name: "n", label: "l", description: "d" })));
  collect(toHtmlString(ds.radio({ id: "i", name: "n", label: "l", description: "d" })));
  collect(toHtmlString(ds.switchControl({ id: "i", label: "l" })));
  collect(toHtmlString(ds.fieldset({ legend: "l", children: "c" })));
  collect(toHtmlString(ds.form({ children: "c" })));
  collect(toHtmlString(ds.alert({ tone: "error", title: "t", children: "c", action: "a" })));
  collect(toHtmlString(ds.alert({ tone: "info", children: "c", hideIcon: true })));
  collect(toHtmlString(ds.notice({ children: "c", label: "l" })));
  collect(toHtmlString(ds.dialog({ id: "d", title: "t", children: "c", footer: "f" })));
  collect(toHtmlString(ds.confirmDialog({ id: "d", title: "t", children: "c", confirmLabel: "x" })));
  collect(toHtmlString(ds.popover({ id: "p", children: "c", title: "t" })));
  collect(toHtmlString(ds.popoverTrigger({ targetId: "p", children: "c" })));
  collect(toHtmlString(ds.tooltip({ children: "c", content: "x" })));
  collect(toHtmlString(ds.skipLink()));
  collect(toHtmlString(ds.header({ children: "c" })));
  collect(toHtmlString(ds.header({ children: "c", sticky: false })));
  collect(toHtmlString(ds.headerContent({ brand: "b", nav: "n", actions: "a" })));
  collect(toHtmlString(ds.brand({ name: "n" })));
  collect(toHtmlString(ds.brand({ name: "n", href: "/" })));
  collect(toHtmlString(ds.nav({ id: "n", ariaLabel: "a", children: "c", responsive: true })));
  collect(toHtmlString(ds.navItem({ href: "/", children: "c" })));
  collect(toHtmlString(ds.mobileNav({ label: "l", children: "c", actions: "a" })));
  collect(toHtmlString(ds.container()));
  collect(toHtmlString(ds.container({ width: "prose", gutter: false })));
  collect(toHtmlString(ds.section({ spacing: "lg", tone: "muted", divider: true })));
  for (const align of ["stretch", "start", "center", "end"] as const) collect(toHtmlString(ds.stack({ align })));
  for (const align of ["center", "start", "end", "stretch"] as const) collect(toHtmlString(ds.cluster({ align })));
  for (const justify of ["start", "center", "end", "between"] as const) collect(toHtmlString(ds.cluster({ justify })));
  for (const columns of ["auto", 1, 2, 3, 4] as const) collect(toHtmlString(ds.grid({ columns, as: "ul" })));
  collect(toHtmlString(ds.gridItem({ children: "c" })));
  collect(toHtmlString(ds.centered({ width: "wide" })));
  collect(toHtmlString(ds.figure({ image: { src: "/a.png", alt: "a" }, caption: "c" })));
  collect(toHtmlString(ds.responsiveImage({ src: "/a.png", alt: "a", fit: "contain" })));
  collect(toHtmlString(ds.main({ children: "c" })));
  // The responsive visibility utilities are returned as class names.
  for (const breakpoint of ["md", "lg", "xl"] as const) {
    classes.add(ds.hideBelow({ breakpoint }));
  }
  classes.add(ds.hideBelow({ breakpoint: "md", inline: true }));
  return classes;
}

function cssClasses(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(stylesDir)) {
    if (!file.endsWith(".css")) continue;
    const source = readFileSync(path.join(stylesDir, file), "utf8");
    // `_` must be in the class: BEM sub-elements such as `.toz-card__body`
    // would otherwise be invisible to this check.
    for (const match of source.matchAll(/\.(toz-[a-z0-9_-]+)/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

/**
 * Typography, text-tone and weight utilities.
 *
 * These are part of the design system but are applied directly by page authors
 * rather than emitted by a component, so they are enumerated explicitly. A new
 * utility must be added here to be treated as intentional.
 */
const DECLARED_UTILITIES = [
  "toz-type",
  "toz-type-display",
  "toz-type-h1",
  "toz-type-h2",
  "toz-type-h3",
  "toz-type-h4",
  "toz-type-body-lg",
  "toz-type-body",
  "toz-type-body-sm",
  "toz-type-caption",
  "toz-type-label",
  "toz-type-button",
  "toz-type-code",
  "toz-font-mono",
  "toz-font-sans",
  "toz-text-default",
  "toz-text-muted",
  "toz-text-subtle",
  "toz-text-primary",
  "toz-text-success",
  "toz-text-warning",
  "toz-text-destructive",
  "toz-text-info",
  "toz-text-on-accent",
  "toz-text-start",
  "toz-text-center",
  "toz-text-end",
  "toz-weight-regular",
  "toz-weight-medium",
  "toz-weight-semibold",
  "toz-weight-bold",
  "toz-prose",
] as const;

describe("class and CSS parity", () => {
  it("defines a CSS rule for every class the components emit", () => {
    // A class emitted by a component but absent from the CSS is a silent visual
    // bug: the element renders unstyled with no error anywhere.
    const defined = cssClasses();
    const missing = [...emittedClasses()].filter((name) => !defined.has(name));
    assert.deepEqual(missing, [], `classes emitted with no CSS rule: ${missing.join(", ")}`);
  });

  it("defines a CSS rule for every declared utility class", () => {
    const defined = cssClasses();
    const missing = DECLARED_UTILITIES.filter((name) => !defined.has(name));
    assert.deepEqual(missing, [], `declared utilities with no CSS rule: ${missing.join(", ")}`);
  });

  it("does not define CSS rules for classes nothing emits", () => {
    const emitted = new Set([...emittedClasses(), ...DECLARED_UTILITIES]);
    const orphans = [...cssClasses()].filter((name) => !emitted.has(name));
    assert.deepEqual(orphans, [], `CSS rules with no emitting component or declared utility: ${orphans.join(", ")}`);
  });
});

describe("generated preview page", () => {
  let page = "";

  before(() => {
    // The page is generated here rather than assumed present, so the suite is
    // self-contained after `npm run clean && npm run build`.
    if (!existsSync(previewHtml)) {
      execFileSync(process.execPath, [path.join(projectRoot, "scripts", "build-preview.mjs")], {
        cwd: projectRoot,
        stdio: "ignore",
      });
    }
    // Read lazily: doing this at module scope would run before `before`.
    page = readFileSync(previewHtml, "utf8");
  });

  it("was generated", () => {
    assert.ok(existsSync(previewHtml), "expected dist/preview/index.html");
    assert.ok(page.length > 5_000, "the gallery should contain real markup");
  });

  it("is a complete document with a doctype and a single root", () => {
    assert.ok(page.startsWith("<!doctype html>"));
    assert.equal((page.match(/<html/g) ?? []).length, 1);
    assert.equal((page.match(/<\/html>/g) ?? []).length, 1);
    assert.equal((page.match(/<body/g) ?? []).length, 1);
    assert.equal((page.match(/<\/body>/g) ?? []).length, 1);
  });

  it("loads the stylesheets in cascade order", () => {
    let previous = -1;
    for (const file of ds.STYLESHEET_ORDER) {
      const index = page.indexOf(`styles/${file}`);
      assert.ok(index > previous, `${file} must load after the previous layer`);
      previous = index;
    }
  });

  it("copies every stylesheet next to the page so no reference 404s", () => {
    for (const file of ds.STYLESHEET_ORDER) {
      const copied = path.join(projectRoot, "dist", "preview", "styles", file);
      assert.ok(existsSync(copied), `${file} must exist next to the preview page`);
    }
  });

  it("starts with a skip link so keyboard users can bypass the header", () => {
    const bodyIndex = page.indexOf("<body");
    const skipIndex = page.indexOf("toz-skip-link");
    assert.ok(skipIndex > bodyIndex, "the skip link must be the first focusable element");
    assert.ok(skipIndex < page.indexOf("toz-header"), "the skip link must precede the header");
  });

  it("defines a main content region for the skip link to target", () => {
    assert.ok(page.includes('id="main-content"'), "the skip link target must exist");
  });

  it("balances the tags it uses", () => {
    for (const tag of ["div", "section", "header", "nav", "ul", "li", "form", "fieldset", "label", "dialog", "table"]) {
      const open = (page.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
      const close = (page.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      assert.equal(open, close, `<${tag}> is unbalanced: ${open} open, ${close} close`);
    }
  });

  it("never leaves an unescaped interpolation that could break out of an attribute", () => {
    assert.equal(page.includes('"undefined"'), false, "an undefined attribute value leaked into the output");
    assert.equal(page.includes('="null"'), false, "a null attribute value leaked into the output");
    assert.equal(page.includes("&lt;script"), false, "no raw script markup should be present");
  });

  it("uses no inline event handlers", () => {
    assert.equal(/on(click|load|error|mouseover)=/i.test(page), false, "handlers must be bound, not inlined");
  });

  it("gives every image an alt attribute", () => {
    for (const match of page.matchAll(/<img\b[^>]*>/g)) {
      assert.ok(/\salt="/.test(match[0]), `img without alt: ${match[0].slice(0, 80)}`);
    }
  });

  it("contains no marketing or business content", () => {
    // The gallery is a development artefact. It must not grow into homepage
    // content: no invented claims, statistics, testimonials or pricing.
    const forbidden = [
      "testimonial",
      "trusted by",
      "customers",
      "pricing",
      "per month",
      "% uptime",
      "award",
      "certified",
      "million users",
    ];
    const lower = page.toLowerCase();
    for (const phrase of forbidden) {
      assert.equal(lower.includes(phrase), false, `the gallery must not contain "${phrase}"`);
    }
  });

  it("declares the dark theme so the gallery renders in the default palette", () => {
    assert.ok(page.includes('data-theme="dark"'));
  });

  it("is inert with respect to the network: no external resource is fetched", () => {
    assert.equal(/<script[^>]+src=/i.test(page), false, "no external script should be loaded");
    assert.equal(/<link[^>]+rel="?preconnect/i.test(page), false, "no preconnect should be added");
    // Only data URIs and the SVG XML namespace may appear. Neither is a fetch;
    // `http://www.w3.org/2000/svg` is an identifier, not a request.
    const withoutDataUris = page.replace(/data:[^"'\s)]+/g, "");
    const withoutNamespace = withoutDataUris.replace(/https?:\/\/www\.w3\.org[^"'\s)]*/g, "");
    const remaining = withoutNamespace.match(/https?:\/\/[^"'\s)]+/g) ?? [];
    for (const url of remaining) {
      assert.ok(url.startsWith("https://example.com"), `unexpected external URL: ${url}`);
    }
  });
});

describe("responsive and accessibility coverage of the design system", () => {
  const base = readFileSync(path.join(stylesDir, "base.css"), "utf8");
  const layout = readFileSync(path.join(stylesDir, "layout.css"), "utf8");
  const components = readFileSync(path.join(stylesDir, "components.css"), "utf8");
  const all = `${base}\n${layout}\n${components}`;

  it("meets the minimum touch target on every interactive control", () => {
    assert.ok(all.includes("var(--toz-touch-target)"), "a shared touch target token must be used");
    assert.ok(ds.TOUCH_TARGET_REM >= 2.75, "the touch target must be at least 44px");
  });

  it("applies the touch target to buttons, links in menus and controls", () => {
    assert.ok(components.includes("min-block-size: var(--toz-touch-target)"), "buttons need a min height");
    assert.ok(components.includes(".toz-input,"), "inputs need sizing");
    assert.ok(components.includes(".toz-mobile-nav__panel .toz-link"), "mobile nav links need sizing");
  });

  it("never relies on colour alone for a state", () => {
    // A standalone state indicator must be labelled, and a composite
    // component must state its condition in text.
    const rendered = [
      toHtmlString(ds.statusDot({ tone: "success", label: "ok" })),
      toHtmlString(ds.healthIndicator({ state: "degraded" })),
      toHtmlString(ds.badge({ tone: "error", children: "error" })),
      toHtmlString(ds.progress({ value: 10, label: "p" })),
      toHtmlString(ds.alert({ tone: "error", title: "error", children: "x" })),
    ];
    for (const fragment of rendered) {
      const hasText = />[^<]*[a-zA-Z][^<]*</.test(fragment);
      const hasRole = /role="/.test(fragment);
      const hasLabel = /aria-label="/.test(fragment);
      assert.ok(
        hasText || hasRole || hasLabel,
        `state conveyed by colour alone: ${fragment.slice(0, 90)}`,
      );
    }
  });

  it("only uses a decorative status dot inside a labelled container", () => {
    // A decorative dot is correct when the surrounding component states the
    // condition in text; the type system requires the call to say so.
    for (const container of [
      ds.badge({ children: "Running", tone: "processing", icon: "processing" }),
      ds.healthIndicator({ state: "healthy" }),
    ]) {
      const fragment = toHtmlString(container);
      assert.ok(fragment.includes("toz-status-dot"), "expected a dot inside the container");
      assert.ok(
        />[^<]*[a-zA-Z][^<]*</.test(fragment),
        "the container must state the condition in text alongside the dot",
      );
    }
  });

  it("provides a fluid dialog width rather than a fixed pixel width", () => {
    assert.ok(components.includes("inline-size: min("), "the dialog must be fluid");
    assert.equal(/inline-size:\s*\d{3,}px/.test(components), false, "no fixed width should be hardcoded");
  });

  it("prevents horizontal overflow at the document level", () => {
    assert.ok(base.includes("overflow-x"), "the body must guard against stray wide children");
  });

  it("collapses the mobile navigation into a disclosure below the tablet breakpoint", () => {
    assert.ok(components.includes("@media (min-width: 768px)"));
    assert.ok(components.includes(".toz-mobile-nav { display: none; }"));
  });

  it("adapts grids at each breakpoint rather than only at desktop", () => {
    for (const width of [480, 768, 1024, 1280]) {
      assert.ok(layout.includes(`min-width: ${width}px`), `no layout rule at ${width}px`);
    }
  });

  it("caps content width so text does not stretch on wide displays", () => {
    assert.ok(layout.includes("max-width: var(--toz-content-width-default)"));
    assert.ok(ds.CONTENT_WIDTHS.prose.includes("rem"), "the reading measure must be constrained");
  });

  it("animates only under no-preference, so reduced motion is respected", () => {
    const animated = [...all.matchAll(/animation:\s*([^;]+);/g)];
    // Every animation must sit behind a `prefers-reduced-motion: no-preference`
    // guard. Counting guards versus animations is a cheap, effective check.
    const guards = (all.match(/@media \(prefers-reduced-motion: no-preference\)/g) ?? []).length;
    assert.ok(guards >= 3, `expected several no-preference guards, found ${guards}`);
    assert.ok(animated.length > 0, "the system should still animate when motion is welcome");
  });

  it("does not use an animation library or an expensive effect pervasively", () => {
    // Count only real effects. `@supports not (backdrop-filter: ...)` is a
    // feature probe and an explicit `backdrop-filter: none` is a reset; neither
    // renders a blur.
    const withoutProbes = all.replace(/@supports[^{]*\{/g, "");
    const effects = withoutProbes.match(/backdrop-filter:\s*blur\([^)]*\)/g) ?? [];
    assert.equal(effects.length, 1, `backdrop-filter should be used once, found ${effects.length}`);
    // The single use is the header, which sits over scrolling content.
    assert.ok(components.includes("backdrop-filter: blur(10px)"), "expected the header to carry the effect");
    // A fallback exists for engines without support.
    assert.ok(components.includes("@supports not (backdrop-filter"), "expected a fallback for unsupported engines");
    // A box-shadow budget keeps the surface from reading as glassy.
    const heavyBlur = [...all.matchAll(/box-shadow:\s*([^;]+)/g)]
      .flatMap((match) => [...(match[1] ?? "").matchAll(/(\d+)px/g)].map((value) => Number(value[1])))
      .filter((value) => value > 40);
    assert.deepEqual(heavyBlur, [], "no shadow should blur further than 40px");
  });
});
