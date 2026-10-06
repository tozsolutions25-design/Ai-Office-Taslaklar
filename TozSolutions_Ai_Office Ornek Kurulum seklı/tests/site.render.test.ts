import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HOME_META,
  NOT_FOUND_META,
  REGISTERED_PATHS,
  ROUTES,
  canonicalUrl,
  headFor,
  matchRoute,
  normalisePath,
  renderHome,
  renderRoute,
  renderTitle,
} from "../src/site/index.js";
import { toHtmlString } from "../src/design-system/utils/html.js";

const home = renderHome();
const notFound = renderRoute("/404");

/** Every href in a document. */
function hrefs(document: string): string[] {
  return [...document.matchAll(/\shref="([^"]*)"/g)].map((match) => match[1]);
}

/** Every element id in a document. */
function ids(document: string): Set<string> {
  return new Set([...document.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
}

/** The homepage's element ids, for resolving `/#anchor` links from any page. */
const homeIds = ids(home);

function attributeValues(document: string, attribute: string): string[] {
  return [...document.matchAll(new RegExp(`\\s${attribute}="([^"]*)"`, "g"))].map((match) => match[1]);
}

describe("routing", () => {
  it("resolves the homepage", () => {
    assert.equal(matchRoute("/").path, "/");
  });

  it("resolves the not-found page", () => {
    assert.equal(matchRoute("/404").path, "/404");
  });

  it("resolves an unknown path to the not-found page rather than throwing", () => {
    // A site that throws on an unknown path returns a stack trace to a visitor.
    assert.equal(matchRoute("/does-not-exist").path, "/404");
    assert.equal(matchRoute("/services/anything").path, "/404");
  });

  it("normalises trailing slashes so one page has one URL", () => {
    assert.equal(normalisePath("/"), "/");
    assert.equal(normalisePath("//"), "/");
    assert.equal(normalisePath("/404/"), "/404");
    assert.equal(normalisePath("404"), "/404");
  });

  it("resolves a normalised trailing-slash path", () => {
    assert.equal(matchRoute("/404/").path, "/404");
  });

  it("exposes the registered paths", () => {
    assert.ok(REGISTERED_PATHS.has("/"));
    assert.equal(REGISTERED_PATHS.size, ROUTES.length);
  });

  it("declares the section ids each route provides", () => {
    const homeRoute = ROUTES.find((route) => route.path === "/");
    assert.ok(homeRoute);
    assert.ok(homeRoute.sectionIds.includes("hero"));
    assert.ok(homeRoute.sectionIds.includes("capabilities"));
  });
});

describe("link integrity", () => {
  /**
   * Classifies every href on a page.
   *
   * Stylesheet and canonical links are EXCLUDED: they are asset and metadata
   * references, not navigation, and a navigation check that fails on
   * `tokens.css` would be reporting the wrong thing.
   */
  function brokenLinks(document: string): string[] {
    const present = ids(document);
    const broken: string[] = [];
    const stylesheets = new Set(
      [...document.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    );
    const canonical = new Set(
      [...document.matchAll(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    );

    for (const href of hrefs(document)) {
      if (href === "" || stylesheets.has(href) || canonical.has(href)) continue;
      if (href.startsWith("#")) {
        if (!present.has(href.slice(1))) broken.push(`${href} (no element with that id)`);
        continue;
      }
      if (/^https?:\/\//.test(href)) continue;
      // A home-prefixed anchor, e.g. `/#architecture`, navigates to the homepage
      // and then to a section of it. It resolves if the page exists AND the id
      // exists there, so both are checked rather than treating the whole href as
      // an unknown path.
      if (href.startsWith("/#")) {
        if (!REGISTERED_PATHS.has("/")) {
          broken.push(`${href} (anchors the homepage, which is not registered)`);
        } else if (!homeIds.has(href.slice(2))) {
          broken.push(`${href} (no element with id ${href.slice(2)} on the homepage)`);
        }
        continue;
      }
      if (!REGISTERED_PATHS.has(href)) broken.push(`${href} (not a registered route)`);
    }
    return broken;
  }

  it("resolves every navigation link on the homepage", () => {
    // The core "no broken links" guarantee: every navigational href is an
    // in-page anchor with a matching id, or a registered route.
    const broken = brokenLinks(home);
    assert.deepEqual(broken, [], `broken links on the homepage:\n${broken.join("\n")}`);
  });

  it("resolves every link on the not-found page", () => {
    // The not-found page renders the site header and footer, whose links are
    // in-page anchors to sections that exist on the HOMEPAGE. So an anchor is
    // valid if its target exists on the homepage, which is where the header
    // actually lives. A link with no target anywhere would still be caught.
    const homepageIds = ids(home);
    const own = ids(notFound);
    const present = new Set([...homepageIds, ...own]);
    const broken = brokenLinks(notFound).filter((entry) => {
      const target = entry.split(" ")[0]?.replace("#", "") ?? "";
      return !present.has(target);
    });
    assert.deepEqual(broken, [], "broken links on the not-found page");
  });

  it("sends the not-found page back to the homepage", () => {
    assert.ok(hrefs(notFound).includes("/"), "a visitor must be able to get back to the homepage");
  });

  it("resolves the stylesheet references the document declares", () => {
    // The static build rewrites these to relative paths; they must point at
    // files the build actually writes, or the page renders unstyled.
    const relative = renderRoute("/", { stylesheetBasePath: "styles" });
    for (const file of ["tokens.css", "base.css", "layout.css", "components.css"]) {
      assert.ok(relative.includes(`href="styles/${file}"`), `${file} must be referenced relatively`);
    }
    assert.ok(relative.includes('href="/site/styles/site.css"'), "the site stylesheet must be referenced");
  });

  it("has no link to a route that has not been built", () => {
    // REPLACED the previous list, which asserted the homepage links to neither
    // `/about` nor `/contact`. Those pages now exist (PROJECT_STATE.md §13), so
    // the test is restated as the rule it was enforcing: no link to a route that
    // is NOT registered. The set below is the "never built, and should stay that
    // way" list — a login, a pricing page or a docs tree that this site does not
    // serve and must not pretend to.
    const notBuilt = ["/services", "/pricing", "/login", "/docs", "/admin", "/careers"];
    for (const route of notBuilt) {
      assert.equal(REGISTERED_PATHS.has(route), false, `${route} must not be a registered route`);
      assert.equal(hrefs(home).includes(route), false, `the homepage must not link to ${route}`);
    }
  });

  it("links to the inner pages it now serves", () => {
    // The complement of the check above, and the reason it was rewritten: a page
    // that exists but is unreachable from anywhere is a dead end.
    for (const route of ["/about", "/capabilities", "/contact"]) {
      assert.ok(REGISTERED_PATHS.has(route), `${route} is a real route`);
      assert.ok(hrefs(home).includes(route), `the homepage must link to ${route}`);
    }
  });

  it("offers no dead anchor masquerading as a link", () => {
    // `disabledLink` renders a span, so an unavailable destination can be shown
    // without producing a dead anchor.
    assert.equal(home.includes('aria-disabled="true"'), false, "the homepage needs no disabled links");
    for (const href of hrefs(home)) {
      assert.notEqual(href, "#", "an empty anchor target is a dead link");
      assert.notEqual(href, "javascript:void(0)", "a javascript pseudo-link is a dead link");
    }
  });
});

describe("document structure", () => {
  it("is a complete HTML document", () => {
    assert.ok(home.startsWith("<!doctype html>"));
    assert.equal((home.match(/<html/g) ?? []).length, 1);
    assert.equal((home.match(/<body/g) ?? []).length, 1);
  });

  it("has exactly one h1", () => {
    assert.equal((home.match(/<h1[ >]/g) ?? []).length, 1);
  });

  it("does not skip a heading level", () => {
    // Collect heading levels in document order and assert each step down is by
    // at most one, so the outline is navigable.
    const levels = [...home.matchAll(/<h([1-6])[ >]/g)].map((match) => Number(match[1]));
    assert.ok(levels.length > 5, "the page should have a real heading structure");
    assert.equal(levels[0], 1, "the first heading must be the h1");
    for (let i = 1; i < levels.length; i += 1) {
      const previous = levels[i - 1];
      const current = levels[i];
      assert.ok(
        current <= previous + 1,
        `heading level jumped from h${previous} to h${current}`,
      );
    }
  });

  it("places the skip link before the header", () => {
    const skipIndex = home.indexOf("toz-skip-link");
    const headerIndex = home.indexOf("<header");
    assert.ok(skipIndex > -1 && headerIndex > -1);
    assert.ok(skipIndex < headerIndex, "the skip link must be the first focusable element");
  });

  it("gives the skip link a target that exists", () => {
    assert.ok(ids(home).has("main-content"), "the skip link target must exist on the page");
  });

  it("wraps content in a single main landmark", () => {
    assert.equal((home.match(/<main/g) ?? []).length, 1);
    assert.equal((home.match(/<\/main>/g) ?? []).length, 1);
  });

  it("uses exactly one header and one footer landmark", () => {
    assert.equal((home.match(/<header[\s>]/g) ?? []).length, 1, "exactly one header landmark");
    assert.equal((home.match(/<footer[\s>]/g) ?? []).length, 1, "exactly one footer landmark");
  });

  it("labels every nav landmark", () => {
    const navLabels = attributeValues(home, "aria-label");
    const navCount = (home.match(/<nav/g) ?? []).length;
    assert.ok(navCount >= 1, "the page should contain a nav landmark");
    // Each nav plus the labelled controls must be named.
    assert.ok(navLabels.length >= navCount, "every nav landmark needs an accessible name");
  });

  it("labels every section that references a heading", () => {
    for (const match of home.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)) {
      const target = match[1];
      assert.ok(ids(home).has(target), `aria-labelledby="${target}" points at a missing id`);
    }
  });

  it("balances the container elements it uses", () => {
    for (const tag of ["div", "section", "main", "header", "footer", "nav", "ul", "ol", "li", "article", "span", "svg", "p", "a", "button", "h1", "h2", "h3"]) {
      const open = (home.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
      const close = (home.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      assert.equal(open, close, `<${tag}> is unbalanced: ${open} open, ${close} close`);
    }
  });

  it("leaks no undefined or null attribute value", () => {
    assert.equal(home.includes('"undefined"'), false);
    assert.equal(home.includes('="null"'), false);
    assert.equal(home.includes("[object Object]"), false);
  });

  it("leaks no escaped markup", () => {
    // A fragment that was escaped instead of rendered appears as literal text.
    // This is the failure mode when a string is passed where a fragment is
    // expected, so it is asserted explicitly.
    const escapedMarkup = home.match(/&lt;\/?(div|p|span|section|svg|article|button|a)\b/g) ?? [];
    assert.deepEqual(escapedMarkup, [], `escaped markup leaked into the page: ${escapedMarkup.slice(0, 5).join(", ")}`);
  });

  it("uses no inline event handlers", () => {
    assert.equal(/\son(click|load|error|input|submit)=/i.test(home), false);
  });
});

describe("page metadata", () => {
  it("has a meaningful title", () => {
    assert.ok(HOME_META.title.includes("TOZ AI Office"));
    assert.ok(HOME_META.title.length > 20 && HOME_META.title.length < 70, "title length should be readable in a SERP");
  });

  it("renders the title into the document", () => {
    assert.ok(home.includes(`<title>${renderTitle(HOME_META)}</title>`));
  });

  it("has a meta description of a usable length", () => {
    assert.ok(HOME_META.description.length > 70, "a short description wastes the snippet");
    assert.ok(HOME_META.description.length < 200, "the description will be truncated");
  });

  it("renders the description, canonical and robots tags", () => {
    assert.ok(home.includes('name="description"'));
    assert.ok(home.includes('rel="canonical"'));
    assert.ok(home.includes('name="robots"'));
  });

  it("declares a responsive viewport", () => {
    assert.ok(home.includes('name="viewport"'));
    assert.ok(home.includes("width=device-width"));
  });

  it("builds an absolute canonical URL", () => {
    assert.match(canonicalUrl(HOME_META), /^https:\/\/[^/]+\/$/);
  });

  it("marks the not-found page noindex so it cannot compete with the homepage", () => {
    assert.equal(NOT_FOUND_META.noIndex, true);
    assert.ok(notFound.includes("noindex, follow"));
  });

  it("does not mark the homepage noindex", () => {
    assert.notEqual(HOME_META.noIndex, true);
    assert.ok(home.includes("index, follow"));
  });

  it("keeps Open Graph values consistent with the standard ones", () => {
    assert.ok(home.includes(`property="og:title" content="${renderTitle(HOME_META)}"`));
    assert.ok(home.includes(`property="og:description" content="${HOME_META.description}"`));
  });

  it("emits only head elements", () => {
    for (const tag of headFor(HOME_META)) {
      const rendered = toHtmlString(tag);
      assert.ok(
        /^<(meta|link)\b/.test(rendered),
        `headFor must emit only meta or link elements, got: ${rendered.slice(0, 40)}`,
      );
    }
  });

  it("declares structured data, and only schemas the content supports", () => {
    // REPLACES "declares no structured data, which would be a later-phase concern".
    //
    // That test asserted structured data was ABSENT, deferring the question to a
    // later phase. This is that phase, so absence is no longer the correct
    // expectation. But its underlying concern was always right: structured data
    // must not assert facts the site does not have.
    //
    // So the assertion is inverted AND STRENGTHENED. It now requires the markup
    // to be present, to be parseable JSON-LD, and to carry none of the schema
    // properties that invite a fabricated business fact.
    const blocks = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(blocks.length > 0, "the homepage declares structured data");

    const forbidden = [
      "aggregateRating", "review", "ratingValue", "reviewCount",
      "offers", "price", "priceCurrency",
      "address", "geo", "telephone", "openingHours",
      "award", "numberOfEmployees", "customerCount",
    ];
    for (const [, payload] of blocks) {
      const parsed: unknown = JSON.parse(payload);
      assert.ok(typeof parsed === "object" && parsed !== null, "the block is a JSON object");
      const serialised = JSON.stringify(parsed);
      for (const key of forbidden) {
        assert.equal(
          serialised.includes(`"${key}"`),
          false,
          `structured data must not claim ${key}: the repository has no such fact`,
        );
      }
    }
  });

  it("contains no hidden text", () => {
    assert.equal(/display:\s*none/i.test(home), false, "hidden text must not be used for SEO");
    assert.equal(/visibility:\s*hidden/i.test(home), false);
    assert.equal(/font-size:\s*0/i.test(home), false, "zero-size text is hidden text");
  });

  it("does not repeat the product name beyond reasonable brand use", () => {
    // The name legitimately appears in the header, footer, title and metadata.
    // A high count in the BODY would indicate keyword stuffing.
    const body = home.slice(home.indexOf("<body"));
    const occurrences = (body.match(/TOZ AI Office/gi) ?? []).length;
    assert.ok(
      occurrences <= 6,
      `the product name appears ${occurrences} times in the body, which reads as stuffing`,
    );
  });
});

describe("visuals", () => {
  it("renders the hero diagram with an accessible name and description", () => {
    assert.ok(home.includes("<title id=\"hero-visual-title\">"));
    assert.ok(home.includes("<desc id=\"hero-visual-desc\">"));
    assert.ok(home.includes('role="img"'));
  });

  it("renders the architecture diagram with an accessible name and description", () => {
    assert.ok(home.includes("<title id=\"architecture-diagram-title\">"));
    assert.ok(home.includes("<desc id=\"architecture-diagram-desc\">"));
  });

  it("scales diagrams with a viewBox and no fixed pixel width", () => {
    for (const match of home.matchAll(/<svg[^>]*>/g)) {
      const svg = match[0];
      assert.ok(svg.includes("viewBox="), "every diagram must scale via viewBox");
      assert.equal(/\swidth="\d+px"/.test(svg), false, "no fixed pixel width on an svg");
    }
  });

  it("requests no third-party resource", () => {
    // The canonical URL is a metadata declaration, not a fetch. Stylesheets and
    // images are asserted separately, and neither may point off-origin.
    assert.equal(/<script[^>]+src=/i.test(home), false, "no external script");
    assert.equal(/<img[^>]+src="https?:/i.test(home), false, "no remote image");
    const stylesheets = [...home.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.ok(stylesheets.length > 0, "the page must load its stylesheets");
    for (const href of stylesheets) {
      assert.equal(/^https?:/i.test(href), false, `stylesheet must be first-party: ${href}`);
    }
  });

  it("ships no executable JavaScript", () => {
    // RENAMED from "ships no JavaScript at all". The homepage needs no client-side
    // code: the design system is server-rendered and the navigation uses a native
    // disclosure. That invariant is preserved and is about EXECUTABLE script.
    //
    // A `type="application/ld+json"` block is an inert data island — a browser
    // parses and ignores it, and no code runs. Treating its presence as a
    // JavaScript regression would mean removing correct structured data to satisfy
    // a test that was written before structured data existed.
    //
    // What is still forbidden: any external script, any inline executable script,
    // and any inline event handler (asserted separately).
    const executable = [...home.matchAll(/<script\b([^>]*)>/g)]
      .filter(([, attributes]) => !/type="application\/ld\+json"/i.test(attributes))
      .map(([tag]) => tag);
    assert.deepEqual(executable, [], `the page must ship no executable script, found: ${executable.join(", ")}`);
    assert.equal(/<script[^>]+\bsrc=/i.test(home), false, "no external script may be loaded");
    assert.equal(/javascript:/i.test(home), false, "no javascript: URL may appear");
  });

  it("renders the mobile navigation as a native disclosure", () => {
    assert.ok(home.includes("<details"), "mobile navigation must work without JavaScript");
    assert.ok(home.includes("<summary"));
  });

  it("gives every navigation link a meaningful label", () => {
    const emptyLinks = [...home.matchAll(/<a[^>]*>\s*<\/a>/g)];
    assert.deepEqual(emptyLinks, [], "no link may be empty; use an accessible name instead");
  });

  it("gives every button a name", () => {
    const emptyButtons = [...home.matchAll(/<button[^>]*>\s*<\/button>/g)];
    assert.deepEqual(emptyButtons, [], "no button may be empty");
  });

  it("shows the current year in the footer so it cannot go stale", () => {
    // `&copy;` is the escaped form the design system emits; the literal ©
    // character never appears in the output because it is HTML-escaped.
    const year = new Date().getUTCFullYear();
    assert.ok(home.includes(`&copy; ${year}`), "the footer must show the current year");
  });

  it("has no form on the homepage, because lead capture is a later phase", () => {
    assert.equal(/<form\b/i.test(home), false, "no lead form belongs on the homepage yet");
    assert.equal(/<input\b/i.test(home), false);
  });
});

describe("styling", () => {
  it("loads the design system stylesheets in cascade order, with site styles last", () => {
    const order = ["tokens.css", "base.css", "layout.css", "components.css", "site.css"];
    let previous = -1;
    for (const file of order) {
      const index = home.indexOf(`href="/design-system/styles/${file}"`) >= 0
        ? home.indexOf(`href="/design-system/styles/${file}"`)
        : home.indexOf(`href="/site/styles/${file}"`);
      assert.ok(index > previous, `${file} must load after the previous layer`);
      previous = index;
    }
  });

  it("supports a relative stylesheet base for a static build", () => {
    const relative = renderHome({ stylesheetBasePath: "styles" });
    assert.ok(relative.includes('href="styles/tokens.css"'));
    assert.equal(relative.includes("/design-system/styles"), false);
  });
});
