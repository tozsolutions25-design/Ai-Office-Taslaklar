/**
 * Inner pages: routing, content, metadata, structured data, sitemap and robots.
 *
 * The suite is organised by the guarantee it defends, not by the file it exercises.
 *
 * Two principles run through it:
 *
 *   1. EVERY LINK RESOLVES. Reused for every page rather than checking the
 *      homepage only. A broken link on a page nobody tests is still a broken link.
 *   2. NO FABRICATED FACT. The site describes a real project, so any claim it
 *      publishes must be traceable to something in this repository. The
 *      "no fabricated facts" block is the longest part of this file, and it is
 *      the part that matters most: a confident invented address or metric is
 *      worse than a missing feature.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ABOUT_META,
  BLOG_META,
  CAPABILITIES,
  CAPABILITIES_META,
  CAPABILITY_PATH_PREFIX,
  CONTACT_META,
  HOME_META,
  NAVIGATION,
  NOT_FOUND_META,
  PROJECTS_META,
  REGISTERED_PATHS,
  ROUTES,
  ROUTE_PATHS,
  capabilityPath,
  indexableRoutes,
  matchRoute,
  renderRobots,
  renderRoute,
  renderSitemap,
  sitemapEntries,
  webSiteNode,
} from "../src/site/index.js";
import { ABOUT, CONTACT, EMPTY_SURFACES } from "../src/site/pages/content.js";
import { ARCHITECTURE } from "../src/site/content.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function hrefs(document: string): string[] {
  return [...document.matchAll(/\shref="([^"]*)"/g)].map((match) => match[1]);
}

function ids(document: string): Set<string> {
  return new Set([...document.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
}

const homeDocument = renderRoute("/");
const homeIds = ids(homeDocument);

/**
 * Every href on a page that does not resolve.
 *
 * Mirrors the homepage check in `site.render.test.ts` and is applied to EVERY
 * page, because a link is only known to be good if the page carrying it was
 * actually checked.
 */
function brokenLinks(document: string, ownIds: ReadonlySet<string>): string[] {
  const stylesheets = new Set(
    [...document.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
  );
  const canonical = new Set(
    [...document.matchAll(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
  );
  const broken: string[] = [];
  for (const href of hrefs(document)) {
    if (href === "" || stylesheets.has(href) || canonical.has(href)) continue;
    if (href.startsWith("#")) {
      if (!ownIds.has(href.slice(1))) broken.push(`${href} (no element with that id on this page)`);
      continue;
    }
    if (/^https?:\/\//.test(href)) continue;
    if (href.startsWith("/#")) {
      if (!homeIds.has(href.slice(2))) broken.push(`${href} (no id ${href.slice(2)} on the homepage)`);
      continue;
    }
    if (!REGISTERED_PATHS.has(href)) broken.push(`${href} (not a registered route)`);
  }
  return broken;
}

const innerPages = ROUTES.filter(
  (route) => route.path !== ROUTE_PATHS.home && route.path !== ROUTE_PATHS.notFound,
);

/* -------------------------------------------------------------------------- */
/* A. Routing                                                                  */
/* -------------------------------------------------------------------------- */

describe("inner page routing", () => {
  it("registers every page category the site serves", () => {
    for (const route of ["/about", "/capabilities", "/contact", "/projects", "/blog"]) {
      assert.ok(REGISTERED_PATHS.has(route), `${route} must be registered`);
    }
  });

  it("registers one detail route per capability, generated from the data", () => {
    for (const capability of CAPABILITIES) {
      const route = capabilityPath(capability.id);
      assert.ok(REGISTERED_PATHS.has(route), `${route} must be registered`);
      assert.equal(matchRoute(route).path, route, `${route} must resolve to itself`);
    }
  });

  it("gives each capability a page even if a route were forgotten", () => {
    // The routes are generated from CAPABILITIES, so this is a check that the
    // generation is wired — a capability with no page is the failure mode.
    const withPages = new Set(
      ROUTES.filter((route) => route.path.startsWith(CAPABILITY_PATH_PREFIX)).map((route) => route.path),
    );
    for (const capability of CAPABILITIES) {
      assert.ok(withPages.has(capabilityPath(capability.id)), `${capability.id} needs a page`);
    }
  });

  it("resolves every registered route to itself", () => {
    for (const route of ROUTES) {
      assert.equal(matchRoute(route.path).path, route.path, `${route.path} must resolve to itself`);
    }
  });

  it("resolves an unknown inner path to the not-found page", () => {
    assert.equal(matchRoute("/capabilities/not-a-real-capability").path, "/404");
    assert.equal(matchRoute("/about/team").path, "/404");
  });

  it("normalises a trailing slash on an inner page", () => {
    assert.equal(matchRoute("/about/").path, "/about");
    assert.equal(matchRoute("/capabilities/routing/").path, "/capabilities/routing");
  });

  it("renders every registered route to a document with one h1", () => {
    for (const route of ROUTES) {
      const document = renderRoute(route.path);
      const headings = [...document.matchAll(/<h1\b/g)].length;
      assert.equal(headings, 1, `${route.path} must have exactly one h1, found ${headings}`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* B. Content pages                                                            */
/* -------------------------------------------------------------------------- */

describe("inner page content", () => {
  it("renders each page with its own title, not a generic one", () => {
    for (const route of innerPages) {
      const document = renderRoute(route.path);
      assert.ok(
        document.includes(route.meta.title),
        `${route.path} must show its own title, expected "${route.meta.title}"`,
      );
    }
  });

  it("gives every inner page a breadcrumb trail ending at the current page", () => {
    for (const route of innerPages) {
      const document = renderRoute(route.path);
      assert.ok(document.includes('aria-label="Breadcrumb"'), `${route.path} needs breadcrumbs`);
      // Match the class inside the class ATTRIBUTE, not as the only class: the
      // nav also carries a design-system type utility.
      const trail = document.match(/<nav[^>]*class="[^"]*toz-site-breadcrumb[^"]*"[\s\S]*?<\/nav>/)?.[0] ?? "";
      assert.equal(
        [...trail.matchAll(/aria-current="page"/g)].length,
        1,
        `${route.path} must mark exactly one crumb as current`,
      );
    }
  });

  it("lists every capability on the index and links to each detail page", () => {
    const document = renderRoute(ROUTE_PATHS.capabilities);
    for (const capability of CAPABILITIES) {
      assert.ok(
        hrefs(document).includes(capabilityPath(capability.id)),
        `the index must link to ${capabilityPath(capability.id)}`,
      );
    }
  });

  it("gives each capability page a boundary statement, not a generic one", () => {
    // A page that only restates the homepage copy is a page that says nothing.
    // Each must state what the capability is structurally prevented from doing.
    for (const capability of CAPABILITIES) {
      const document = renderRoute(capabilityPath(capability.id));
      assert.ok(document.includes("What it does not do"), `${capability.id} needs a boundary section`);
      assert.ok(
        document.includes(capability.body),
        `${capability.id} must include its own description`,
      );
    }
  });

  it("cross-links each capability page to the rest and to contact", () => {
    for (const capability of CAPABILITIES) {
      const links = hrefs(renderRoute(capabilityPath(capability.id)));
      assert.ok(links.includes(ROUTE_PATHS.contact), `${capability.id} must offer a route to contact`);
      for (const other of CAPABILITIES) {
        if (other.id === capability.id) continue;
        assert.ok(
          links.includes(capabilityPath(other.id)),
          `${capability.id} should link to ${other.id}`,
        );
      }
    }
  });

  it("routes every call to action to a real page", () => {
    // Stylesheet and canonical references are excluded: they are asset and
    // metadata links, not destinations a reader can be sent to.
    for (const route of innerPages) {
      const document = renderRoute(route.path);
      const assets = new Set([
        ...[...document.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
        ...[...document.matchAll(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
      ]);
      for (const href of hrefs(document)) {
        if (href === "" || assets.has(href)) continue;
        if (href.startsWith("#") || href.startsWith("/#")) continue;
        assert.ok(REGISTERED_PATHS.has(href), `${route.path} CTA points at ${href}, which is not registered`);
      }
    }
  });

  it("keeps the not-found page marked noindex", () => {
    assert.equal(NOT_FOUND_META.noIndex, true, "an error page must not be indexed");
    assert.ok(renderRoute("/404").includes("noindex, follow"));
  });
});

/* -------------------------------------------------------------------------- */
/* C. Internal linking                                                         */
/* -------------------------------------------------------------------------- */

describe("internal linking", () => {
  it("has no broken link on ANY page", () => {
    for (const route of ROUTES) {
      const document = renderRoute(route.path);
      const broken = brokenLinks(document, ids(document));
      assert.deepEqual(broken, [], `broken links on ${route.path}:\n${broken.join("\n")}`);
    }
  });

  it("exposes every inner page from the primary navigation or the footer", () => {
    const reachable = new Set<string>([
      ...NAVIGATION.items.map((item) => item.href),
      NAVIGATION.primaryCta.href,
    ]);
    for (const route of ["/about", "/capabilities", "/contact"]) {
      assert.ok(reachable.has(route), `${route} must be reachable from the header navigation`);
    }
  });

  it("links the homepage to the inner pages", () => {
    const links = hrefs(homeDocument);
    for (const route of ["/about", "/capabilities", "/contact"]) {
      assert.ok(links.includes(route), `the homepage must link to ${route}`);
    }
  });

  it("marks the current page in the navigation for a screen reader", () => {
    const about = renderRoute(ROUTE_PATHS.about);
    assert.ok(about.includes('aria-current="page"'), "the current page must be announced");
  });
});

/* -------------------------------------------------------------------------- */
/* D. Metadata                                                                 */
/* -------------------------------------------------------------------------- */

describe("page metadata", () => {
  const pages = [HOME_META, ABOUT_META, CAPABILITIES_META, CONTACT_META, PROJECTS_META, BLOG_META];

  it("gives every page a title and a description", () => {
    for (const meta of pages) {
      assert.ok(meta.title.length > 0, "a page needs a title");
      assert.ok(meta.description.length > 40, `${meta.canonicalPath} needs a real description`);
      assert.ok(meta.description.length <= 300, `${meta.canonicalPath} description is too long for a snippet`);
    }
  });

  it("gives every page a unique title and canonical path", () => {
    const titles = pages.map((meta) => meta.title);
    assert.equal(new Set(titles).size, titles.length, "titles must be unique");
    const paths = pages.map((meta) => meta.canonicalPath);
    assert.equal(new Set(paths).size, paths.length, "canonical paths must be unique");
  });

  it("emits a canonical URL matching the page's own path", () => {
    for (const route of ROUTES) {
      const document = renderRoute(route.path);
      assert.ok(
        document.includes(`rel="canonical" href="https://example.invalid${route.meta.canonicalPath}"`),
        `${route.path} must declare its own canonical URL`,
      );
    }
  });

  it("emits Open Graph and Twitter tags on every page", () => {
    for (const route of ROUTES) {
      const document = renderRoute(route.path);
      for (const property of ["og:title", "og:description", "og:url", "twitter:card", "twitter:title"]) {
        assert.ok(document.includes(`"${property}"`), `${route.path} must emit ${property}`);
      }
    }
  });

  it("marks exactly the empty surfaces and the 404 page noindex", () => {
    const noIndex = ROUTES.filter((route) => route.meta.noIndex === true).map((route) => route.path);
    assert.deepEqual(
      noIndex.sort(),
      [ROUTE_PATHS.blog, ROUTE_PATHS.notFound, ROUTE_PATHS.projects].sort(),
      "only the empty surfaces and the error page may be noindex",
    );
  });

  it("indexes every page that has real content", () => {
    for (const route of ROUTES) {
      const shouldIndex = ![ROUTE_PATHS.projects, ROUTE_PATHS.blog, ROUTE_PATHS.notFound].includes(
        route.path as never,
      );
      assert.equal(
        route.meta.noIndex === true,
        !shouldIndex,
        `${route.path} indexability does not match whether it has content`,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* E. Structured data                                                          */
/* -------------------------------------------------------------------------- */

describe("structured data", () => {
  /**
   * The nodes a page declares.
   *
   * `renderRoute` emits ONE script per page, holding a `@graph`. Flattening it
   * here means the assertions below read `node["@type"]` directly, and it also
   * asserts the shape a consumer actually receives: a single graph, not a
   * scattering of separate top-level blocks.
   */
  function nodesFor(routePath: string): Record<string, unknown>[] {
    const document = renderRoute(routePath);
    const blocks = [...document.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const nodes: Record<string, unknown>[] = [];
    for (const [, payload] of blocks) {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const graph = parsed["@graph"];
      if (Array.isArray(graph)) {
        nodes.push(...(graph as Record<string, unknown>[]));
      } else {
        nodes.push(parsed);
      }
    }
    return nodes;
  }

  it("emits exactly one script block, shaped as a graph", () => {
    for (const route of ROUTES) {
      const document = renderRoute(route.path);
      const blocks = [...document.matchAll(/<script type="application\/ld\+json">/g)].length;
      assert.equal(blocks, route.meta.noIndex === true ? 0 : 1, `${route.path} script count`);
    }
  });

  it("declares a WebSite and a WebPage on every page that has content", () => {
    for (const route of ROUTES) {
      if (route.meta.noIndex === true) continue;
      const nodes = nodesFor(route.path);
      assert.ok(
        nodes.some((node) => node["@type"] === "WebSite"),
        `${route.path} must declare a WebSite`,
      );
      assert.ok(
        nodes.some((node) => node["@type"] === "WebPage"),
        `${route.path} must declare a WebPage`,
      );
    }
  });

  it("describes the site as a WebSite on the homepage", () => {
    const node = nodesFor("/").find((entry) => entry["@type"] === "WebSite");
    assert.ok(node, "the homepage must declare a WebSite");
    assert.equal(node?.["@context"], "https://schema.org");
    assert.equal(typeof node?.["name"], "string");
    assert.ok((node?.["url"] as string).endsWith("/"), "the WebSite url must be the site root");
  });

  it("emits a Service per capability page", () => {
    for (const capability of CAPABILITIES) {
      const node = nodesFor(capabilityPath(capability.id)).find((entry) => entry["@type"] === "Service");
      assert.ok(node, `${capability.id} must declare a Service`);
      assert.equal(node?.["name"], capability.title);
      assert.equal(
        node?.["description"],
        capability.body,
        "the structured description must be the page's own text, not a variant",
      );
    }
  });

  it("emits a BreadcrumbList that matches the visible trail", () => {
    const node = nodesFor(capabilityPath(CAPABILITIES[0]?.id ?? "")).find(
      (entry) => entry["@type"] === "BreadcrumbList",
    );
    const document = renderRoute(capabilityPath(CAPABILITIES[0]?.id ?? ""));
    const visible = [...document.matchAll(/<li[^>]*class="[^"]*toz-site-breadcrumb-item[^"]*"[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
      (m[1] ?? "").replace(/<[^>]*>/g, "").trim(),
    );
    const declared = (node?.["itemListElement"] as { name: string; position: number }[]).map(
      (item) => item.name,
    );
    assert.deepEqual(declared, visible, "declared breadcrumbs must match the rendered ones");
    const positions = (node?.["itemListElement"] as { position: number }[]).map((item) => item.position);
    assert.deepEqual(positions, [1, 2, 3], "BreadcrumbList positions are 1-based and contiguous");
  });

  it("emits an FAQPage whose answers are the ones the page shows", () => {
    const node = nodesFor(ROUTE_PATHS.about).find((entry) => entry["@type"] === "FAQPage");
    const questions = (node?.["mainEntity"] as { name: string }[]).map((entry) => entry.name);
    assert.deepEqual(questions, ABOUT.faq.map((entry) => entry.question));
  });

  it("claims no rating, price, address or review anywhere", () => {
    const forbidden = [
      "aggregateRating", "review", "ratingValue", "reviewCount", "rating",
      "offers", "price", "priceCurrency",
      "address", "geo", "postalCode", "streetAddress",
      "telephone", "faxNumber", "openingHours", "openingHoursSpecification",
      "award", "numberOfEmployees", "employeeCount", "customerCount",
      "sameAs", "vatID", "duns",
    ];
    for (const route of ROUTES) {
      const serialised = JSON.stringify(nodesFor(route.path));
      for (const key of forbidden) {
        assert.equal(
          serialised.includes(`"${key}"`),
          false,
          `${route.path} structured data must not claim ${key}: the repository has no such fact`,
        );
      }
    }
  });

  it("cannot be broken out of by content in a script block", () => {
    for (const route of ROUTES) {
      const document = renderRoute(route.path);
      const blocks = [...document.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      for (const [, payload] of blocks) {
        assert.equal(payload.includes("</script"), false, "a payload may not close its own block");
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* F. Sitemap and robots                                                        */
/* -------------------------------------------------------------------------- */

describe("sitemap", () => {
  const sitemap = renderSitemap(ROUTES, { lastModified: "2026-01-01" });

  it("is a well-formed urlset", () => {
    assert.ok(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
    assert.ok(sitemap.trimEnd().endsWith("</urlset>"));
  });

  it("lists every indexable route exactly once", () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(new Set(locs).size, locs.length, "a URL must not appear twice");
    const indexable = indexableRoutes(ROUTES);
    assert.equal(locs.length, indexable.length, "the sitemap must cover exactly the indexable routes");
    const expected = indexable.map(
      (route) => `https://example.invalid${route.path === "/" ? "" : route.path}`,
    );
    assert.deepEqual([...locs].sort(), [...expected].sort(), "the sitemap must cover exactly the indexable routes");
  });

  it("excludes every noindex route", () => {
    for (const route of ROUTES.filter((r) => r.meta.noIndex === true)) {
      assert.equal(
        sitemap.includes(`<loc>https://example.invalid${route.path}</loc>`),
        false,
        `${route.path} is noindex and must not be in the sitemap`,
      );
    }
  });

  it("excludes the error page and the empty surfaces specifically", () => {
    for (const route of ["/404", ROUTE_PATHS.projects, ROUTE_PATHS.blog]) {
      assert.equal(sitemap.includes(route), false, `${route} must not appear in the sitemap`);
    }
  });

  it("uses an absolute URL for the site root", () => {
    assert.ok(sitemap.includes("<loc>https://example.invalid</loc>"), "the root URL must not carry a trailing slash");
  });

  it("is stable across builds", () => {
    // A sitemap that changes on every build carries no signal a crawler can use.
    const again = renderSitemap(ROUTES, { lastModified: "2026-01-01" });
    assert.equal(again, sitemap, "rendering the sitemap twice must produce identical output");
  });

  it("orders the homepage first", () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(locs[0], "https://example.invalid", "the homepage must be the first entry");
  });
});

describe("robots", () => {
  const robots = renderRobots();

  it("allows crawling and points at the sitemap", () => {
    assert.ok(robots.includes("User-agent: *"));
    assert.ok(robots.includes("Allow: /"));
    assert.ok(robots.includes("Sitemap: https://example.invalid/sitemap.xml"));
  });

  it("disallows the error document only", () => {
    const disallows = [...robots.matchAll(/^Disallow: (.+)$/gm)].map((m) => (m[1] ?? "").trim());
    assert.deepEqual(disallows, ["/404"], "only the error document is excluded");
  });

  it("does not disallow a route that is meant to be indexed", () => {
    // Matched as a WHOLE LINE: "Disallow: /404" contains the substring
    // "Disallow: /", so a substring test would flag every page on the site.
    const disallowed = new Set(
      [...robots.matchAll(/^Disallow: (.+)$/gm)].map((m) => (m[1] ?? "").trim()),
    );
    for (const route of indexableRoutes(ROUTES)) {
      assert.equal(
        disallowed.has(route.path),
        false,
        `${route.path} is indexable and must not be disallowed`,
      );
    }
  });

  it("does not claim to be access control", () => {
    // Disallow is a crawl instruction. A file that implies otherwise would
    // misrepresent what a crawler directive can do.
    assert.ok(robots.includes("not access control"), "robots.txt must state its actual scope");
  });
});

/* -------------------------------------------------------------------------- */
/* G. No fabricated content                                                    */
/* -------------------------------------------------------------------------- */

describe("no fabricated facts", () => {
  /**
   * The site's visible text, with the contact page's explicit DISCLAIMER removed.
   *
   * The disclaimer is a list of things the project does NOT have — "no phone
   * number, address or opening hours exist to publish". Those sentences contain
   * the very phrases the scan below hunts for, while denying them.
   *
   * So the disclaimer is removed before scanning rather than the scan being
   * weakened. A naive substring check would either fail on an honest denial or,
   * worse, be relaxed until it stopped catching real claims; removing the one
   * known negation keeps the check strict everywhere else.
   */
  function allSiteText(): string {
    let text = ROUTES.map((route) => renderRoute(route.path)).join("\n");
    for (const line of CONTACT.unavailable) {
      text = text.split(line).join("");
    }
    return text.toLowerCase();
  }

  it("publishes no invented contact details", () => {
    const text = allSiteText();
    // A mailto or a phone number is a promise someone could act on.
    assert.equal(/mailto:/i.test(text), false, "no mailto: address is published");
    assert.equal(/tel:?\+?\d/i.test(text), false, "no telephone number is published");
    assert.equal(/\+\d[\d\s().-]{7,}\d/.test(text), false, "no phone-shaped number is published");
  });

  it("publishes no rating, review or customer count", () => {
    const text = allSiteText();
    for (const claim of [
      "rated", "reviews from", "customers trust", "trusted by", "used by",
      "join thousands", "over 100", "99.9%", "100% uptime",
    ]) {
      assert.equal(text.includes(claim), false, `the site must not claim "${claim}"`);
    }
  });

  it("publishes no price or contract term", () => {
    const text = allSiteText();
    for (const claim of ["per month", "/month", "pricing plan", "free trial", "enterprise plan"]) {
      assert.equal(text.includes(claim), false, `the site must not claim "${claim}"`);
    }
  });

  it("publishes no address, hours or certification", () => {
    const text = allSiteText();
    for (const claim of ["open 9", "opening hours", "mon-fri", "certified", "iso 27001", "soc 2"]) {
      assert.equal(text.includes(claim), false, `the site must not claim "${claim}"`);
    }
  });

  it("states on the contact page that no sales channel exists", () => {
    // A contact page that invents an inbox is worse than one that admits the
    // absence, because a visitor would wait for a reply that could not come.
    const contact = renderRoute(ROUTE_PATHS.contact);
    assert.ok(contact.includes("No sales or support inbox is published"));
  });

  it("admits the empty surfaces rather than filling them", () => {
    for (const [key, surface] of Object.entries(EMPTY_SURFACES)) {
      const route = key === "projects" ? ROUTE_PATHS.projects : ROUTE_PATHS.blog;
      const document = renderRoute(route);
      assert.ok(document.includes(surface.heading), `${route} must state its own status`);
      assert.equal(
        [...document.matchAll(/<article|<li class="toz-card/g)].length,
        0,
        `${route} must not contain invented entries`,
      );
    }
  });

  it("keeps every architecture claim pointing at a real module", () => {
    // The homepage already asserts this; the About page restates the layers, so
    // the same check is applied to the page that now repeats them.
    for (const layer of ARCHITECTURE.layers) {
      assert.ok(
        existsSync(path.join(projectRoot, layer.sourcePath)),
        `${layer.sourcePath} must exist: the About page repeats this claim`,
      );
    }
  });

  it("answers its own FAQ with answers the page displays", () => {
    const about = renderRoute(ROUTE_PATHS.about);
    for (const entry of ABOUT.faq) {
      assert.ok(about.includes(entry.question), `the page must show the question: ${entry.question}`);
      assert.ok(about.includes(entry.answer), `the page must show the answer for: ${entry.question}`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* H + I. Accessibility                                                        */
/* -------------------------------------------------------------------------- */

describe("accessibility", () => {
  it("gives every page exactly one main landmark and a skip link", () => {
    for (const route of ROUTES) {
      const document = renderRoute(route.path);
      assert.equal([...document.matchAll(/<main\b/g)].length, 1, `${route.path} needs one main`);
      assert.ok(document.includes('class="toz-skip-link"'), `${route.path} needs a skip link`);
    }
  });

  it("keeps heading levels in order and never skips a level", () => {
    for (const route of ROUTES) {
      const document = renderRoute(route.path);
      const levels = [...document.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
      assert.ok(levels.length > 0, `${route.path} needs headings`);
      assert.equal(levels[0], 1, `${route.path} must start at h1`);
      for (let i = 1; i < levels.length; i += 1) {
        assert.ok(
          (levels[i] ?? 0) - (levels[i - 1] ?? 0) <= 1,
          `${route.path} skips a heading level: h${levels[i - 1]} to h${levels[i]}`,
        );
      }
    }
  });

  it("renders the FAQ as a definition list", () => {
    const about = renderRoute(ROUTE_PATHS.about);
    assert.ok(about.includes("<dl"), "questions and answers belong in a dl");
    const questions = [...about.matchAll(/<dt\b/g)].length;
    const answers = [...about.matchAll(/<dd\b/g)].length;
    assert.equal(questions, answers, "every dt needs a dd");
  });

  it("labels the breadcrumb navigation", () => {
    for (const route of innerPages) {
      assert.ok(
        renderRoute(route.path).includes('aria-label="Breadcrumb"'),
        `${route.path} breadcrumb must be a labelled landmark`,
      );
    }
  });

  it("uses no inline event handler on any page", () => {
    for (const route of ROUTES) {
      assert.equal(
        /<[^>]+\son(click|load|error|input|submit|change)=/i.test(renderRoute(route.path)),
        false,
        `${route.path} must not use inline handlers`,
      );
    }
  });

  it("shows the current page to assistive technology", () => {
    for (const route of innerPages) {
      assert.ok(
        renderRoute(route.path).includes('aria-current="page"'),
        `${route.path} must mark the current page`,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Static output                                                               */
/* -------------------------------------------------------------------------- */

describe("site exports", () => {
  it("exports a webSite node a caller can use directly", () => {
    const node = webSiteNode();
    assert.equal(node["@type"], "WebSite");
    assert.equal(node["@context"], "https://schema.org");
  });

  it("exposes sitemap entries with url, changefreq and priority", () => {
    for (const entry of sitemapEntries(ROUTES)) {
      assert.ok(entry.url.startsWith("https://"), "a sitemap entry needs an absolute url");
      assert.ok(entry.changefreq.length > 0);
      assert.ok(entry.priority.length > 0);
    }
  });
});
