import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  brand,
  currentNavItem,
  header,
  headerContent,
  mobileNav,
  nav,
  navItem,
  skipLink,
} from "../src/design-system/primitives/nav.js";
import { container, grid, gridItem, hideBelow, section, stack, cluster, centered } from "../src/design-system/layout/primitives.js";
import {
  DEFAULT_LANG,
  STYLESHEET_ORDER,
  THEMES,
  documentAttributes,
  htmlDocument,
  isTheme,
  stylesheetLinks,
} from "../src/design-system/theme/theme.js";
import { html, toHtmlString } from "../src/design-system/utils/html.js";

const out = (value: { toString(): string }): string => toHtmlString(value as never);

describe("skip link", () => {
  it("targets the main content region by default", () => {
    assert.ok(out(skipLink()).includes('href="#main-content"'));
  });

  it("is rendered before anything else so it is the first tab stop", () => {
    const rendered = out(skipLink());
    assert.ok(rendered.indexOf("toz-skip-link") >= 0);
    assert.ok(rendered.includes("Skip to main content"));
  });

  it("accepts a custom target and label", () => {
    const rendered = out(skipLink({ targetId: "content", label: "Skip to content" }));
    assert.ok(rendered.includes('href="#content"'));
    assert.ok(rendered.includes("Skip to content"));
  });
});

describe("header and navigation", () => {
  it("renders a header landmark", () => {
    assert.match(out(header({ children: "x" })), /^<header/);
  });

  it("can opt out of sticky positioning", () => {
    assert.ok(out(header({ children: "x", sticky: false })).includes("toz-header--static"));
  });

  it("groups brand, nav and actions", () => {
    const rendered = out(
      headerContent({ brand: "<span>B</span>", nav: "<nav>N</nav>", actions: "<button>A</button>" }),
    );
    for (const fragment of ["B", "N", "A"]) {
      assert.ok(rendered.includes(fragment), `missing ${fragment}`);
    }
  });

  it("renders a nav landmark with a list", () => {
    // Children are passed as a fragment, not a raw string: a string would be
    // escaped, which is the intended defence.
    const rendered = out(nav({ id: "primary", ariaLabel: "Primary", children: html`<li>Home</li>` }));
    assert.ok(rendered.includes("<nav"));
    assert.ok(rendered.includes('aria-label="Primary"'), "a nav landmark needs a name");
    assert.ok(rendered.includes("<ul"));
    assert.ok(rendered.includes("<li>Home</li>"));
  });

  it("escapes a string child so raw markup cannot be injected", () => {
    const rendered = out(nav({ id: "n", ariaLabel: "Primary", children: "<li>Injected</li>" }));
    assert.equal(rendered.includes("<li>Injected</li>"), false, "string children must be escaped");
    assert.ok(rendered.includes("&lt;li&gt;"));
  });

  it("marks the responsive bar so the disclosure is the only small-screen menu", () => {
    assert.ok(out(nav({ id: "n", ariaLabel: "Primary", children: "", responsive: true })).includes("toz-nav--responsive"));
  });

  it("wraps a nav item in a list element", () => {
    const rendered = out(navItem({ href: "/a", children: "A" }));
    assert.match(rendered, /^<li>/);
    assert.ok(rendered.includes('data-variant="nav"'));
  });

  it("marks the current page in the navigation", () => {
    const rendered = out(currentNavItem({ href: "/a", children: "A" }));
    assert.ok(rendered.includes('aria-current="page"'));
  });

  it("renders a brand with a generated mark so no logo asset is required", () => {
    const rendered = out(brand({ name: "TOZ AI Office" }));
    assert.ok(rendered.includes("toz-brand__mark"));
    assert.ok(rendered.includes("TOZ AI Office"));
  });

  it("renders the brand as a link when given an href", () => {
    const rendered = out(brand({ name: "TOZ", href: "/" }));
    assert.ok(rendered.includes('<a class="toz-brand" href="/"'));
    assert.ok(rendered.includes('aria-label="TOZ"'));
  });

  it("renders the brand as text when there is no destination", () => {
    assert.match(out(brand({ name: "TOZ" })), /^<span/);
  });
});

describe("mobile navigation", () => {
  it("uses a native details disclosure so it works without JavaScript", () => {
    const rendered = out(mobileNav({ label: "Menu", children: "<li>Home</li>" }));
    assert.ok(rendered.includes("<details"));
    assert.ok(rendered.includes("<summary"), "the trigger must be a summary element");
    assert.equal(rendered.includes("onclick"), false, "no inline handler should be required");
  });

  it("labels the trigger", () => {
    assert.ok(out(mobileNav({ label: "Menu", children: "" })).includes("Menu"));
  });

  it("renders the links inside the panel", () => {
    const rendered = out(mobileNav({ label: "Menu", children: "<li>Docs</li>", actions: "<button>Start</button>" }));
    assert.ok(rendered.includes("toz-mobile-nav__panel"));
    assert.ok(rendered.includes("Docs"));
    assert.ok(rendered.includes("Start"));
  });

  it("hides the details marker so the trigger is not doubled up", () => {
    const rendered = out(mobileNav({ label: "Menu", children: "" }));
    assert.ok(rendered.includes("toz-mobile-nav__trigger"));
  });
});

describe("layout primitives", () => {
  it("renders a container with a default width", () => {
    const rendered = out(container());
    assert.ok(rendered.includes("toz-container"));
    assert.ok(rendered.includes('data-width="default"'));
  });

  it("supports each content width", () => {
    for (const width of ["default", "narrow", "prose", "wide"] as const) {
      assert.ok(out(container({ width })).includes(`data-width="${width}"`));
    }
  });

  it("can drop the gutter for edge-to-edge sections", () => {
    assert.ok(out(container({ gutter: false })).includes('data-gutter="none"'));
  });

  it("renders a section with a spacing step", () => {
    for (const spacing of ["sm", "md", "lg", "xl"] as const) {
      assert.ok(out(section({ spacing })).includes(`data-spacing="${spacing}"`));
    }
  });

  it("omits the default tone so the selector does not match unnecessarily", () => {
    assert.equal(out(section({})).includes("data-tone"), false);
  });

  it("applies a non-default tone", () => {
    assert.ok(out(section({ tone: "muted" })).includes('data-tone="muted"'));
  });

  it("can draw a hairline divider", () => {
    assert.ok(out(section({ divider: true })).includes('data-divider="true"'));
  });

  it("supports section labelling by label or labelledby", () => {
    assert.ok(out(section({ ariaLabel: "Pricing" })).includes('aria-label="Pricing"'));
    assert.ok(out(section({ ariaLabelledby: "h" })).includes('aria-labelledby="h"'));
  });

  it("maps a stack gap onto a spacing token rather than a raw value", () => {
    const rendered = out(stack({ gap: "6" }));
    assert.ok(rendered.includes("--toz-stack-gap: var(--toz-space-6)"));
  });

  it("defaults the stack gap and alignment", () => {
    const rendered = out(stack({}));
    assert.ok(rendered.includes("var(--toz-space-4)"));
    assert.ok(rendered.includes('data-align="stretch"'));
  });

  it("supports every stack alignment", () => {
    for (const align of ["stretch", "start", "center", "end"] as const) {
      assert.ok(out(stack({ align })).includes(`data-align="${align}"`));
    }
  });

  it("maps a cluster gap onto a spacing token", () => {
    assert.ok(out(cluster({ gap: "2" })).includes("--toz-cluster-gap: var(--toz-space-2)"));
  });

  it("supports cluster justification", () => {
    assert.ok(out(cluster({ justify: "between" })).includes('data-justify="between"'));
  });

  it("renders a grid with column and gap tokens", () => {
    const rendered = out(grid({ columns: 3, gap: "8" }));
    assert.ok(rendered.includes('data-columns="3"'));
    assert.ok(rendered.includes("--toz-grid-gap: var(--toz-space-8)"));
  });

  it("supports the auto-fit layout for card collections", () => {
    assert.ok(out(grid({ columns: "auto" })).includes('data-columns="auto"'));
  });

  it("renders a grid as a list with a reset", () => {
    const rendered = out(grid({ as: "ul", children: "" }));
    assert.match(rendered, /^<ul/);
    assert.ok(rendered.includes("list-style:none"));
  });

  it("renders a grid item as a list item", () => {
    assert.match(out(gridItem({ children: "x" })), /^<li/);
  });

  it("renders centred content with a width constraint", () => {
    assert.ok(out(centered({ width: "narrow" })).includes('data-width="narrow"'));
  });

  it("exposes responsive visibility helpers", () => {
    assert.equal(hideBelow({ breakpoint: "md" }), "toz-hide-below-md");
    assert.equal(hideBelow({ breakpoint: "lg" }), "toz-hide-below-lg");
    assert.equal(hideBelow({ breakpoint: "md", inline: true }), "toz-hide-below-md-inline");
  });
});

describe("theme architecture", () => {
  it("is dark by default", () => {
    assert.equal(documentAttributes()["data-theme"], "dark");
    assert.deepEqual(THEMES, ["dark", "light"]);
  });

  it("emits the theme and language on the root element", () => {
    const attributes = documentAttributes({ theme: "light", lang: "en-GB" });
    assert.equal(attributes["data-theme"], "light");
    assert.equal(attributes.lang, "en-GB");
  });

  it("defaults the language", () => {
    assert.equal(documentAttributes().lang, DEFAULT_LANG);
  });

  it("passes through extra root attributes", () => {
    assert.equal(documentAttributes({ extra: { "data-nosnippet": "true" } })["data-nosnippet"], "true");
  });

  it("validates a theme value", () => {
    assert.equal(isTheme("dark"), true);
    assert.equal(isTheme("light"), true);
    assert.equal(isTheme("neon"), false);
  });

  it("builds a complete document with the stylesheets in cascade order", () => {
    const rendered = toHtmlString(htmlDocument({ title: "TOZ AI Office" }));
    assert.ok(rendered.startsWith("<!doctype html>"));
    assert.ok(rendered.includes('data-theme="dark"'));
    assert.ok(rendered.includes("<title>TOZ AI Office</title>"));
    let previous = -1;
    for (const file of STYLESHEET_ORDER) {
      const index = rendered.indexOf(file);
      assert.ok(index > previous, `${file} must load after the previous layer`);
      previous = index;
    }
  });

  it("includes a responsive viewport meta tag", () => {
    const rendered = toHtmlString(htmlDocument({ title: "x" }));
    assert.ok(rendered.includes('name="viewport"'));
    assert.ok(rendered.includes("width=device-width"));
  });

  it("includes a character set declaration", () => {
    assert.ok(toHtmlString(htmlDocument({ title: "x" })).includes('<meta charset="utf-8" />'));
  });

  it("escapes the document title", () => {
    const rendered = toHtmlString(htmlDocument({ title: "<script>x</script>" }));
    assert.equal(rendered.includes("<script>"), false);
  });

  it("exposes the stylesheet links for a custom head", () => {
    const links = stylesheetLinks("/assets").map((link) => toHtmlString(link));
    assert.equal(links.length, STYLESHEET_ORDER.length);
    assert.ok(links[0]?.includes("/assets/tokens.css"));
  });
});
