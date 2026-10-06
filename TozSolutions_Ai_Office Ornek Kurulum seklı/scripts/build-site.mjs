/**
 * Renders the site to static HTML in `dist/site/`.
 *
 * A static build, not a server. The project has no HTTP framework and PHASE 03
 * adds none: the deliverable is HTML that any static host — or a browser opening
 * the file directly — can serve.
 *
 * Writes:
 *   dist/site/index.html            the homepage
 *   dist/site/<route>/index.html    one directory per inner page, so a static
 *                                   host resolves the pretty path directly
 *   dist/site/404.html              the not-found page
 *   dist/site/sitemap.xml           generated from the route table
 *   dist/site/robots.txt            points at the sitemap
 *   dist/site/styles/               the design system and site stylesheets
 *
 * Pages are enumerated from `ROUTES` rather than listed here, so a route cannot
 * be added without being built, and a route cannot be removed without its stale
 * output being cleared. `dist/site` is deleted first, precisely so the second
 * case cannot leave an orphan directory behind.
 *
 * Stylesheets are emitted as siblings rather than linked with absolute paths, so
 * the output resolves correctly both from a file:// URL and from a web root.
 *
 * `lastmod` is pinned to a constant rather than the build date, so rebuilding an
 * unchanged site produces a byte-identical sitemap. A sitemap that changes on
 * every build carries no signal a crawler can use.
 *
 * Usage: `npm run site:build`.
 */

import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const dist = path.join(projectRoot, "dist");
const outDir = path.join(dist, "site");
const stylesOut = path.join(outDir, "styles");

const site = await import(pathToFileURL(path.join(dist, "src", "site", "index.js")).href);

const designSystemStyles = path.join(dist, "src", "design-system", "styles");
const siteStyles = path.join(dist, "src", "site", "styles");

// A relative base keeps the output portable between a web root and a local file.
const STYLESHEET_BASE = "styles";
const SITE_STYLESHEET = "styles/site.css";

/**
 * Maps a route path to its output file.
 *
 * `/` becomes `index.html`; `/about` becomes `about/index.html`, which is what a
 * static host expects for a pretty URL. `/404` is the one exception: it is
 * written flat as `404.html` because that is the filename a static host
 * conventionally serves as its error document.
 */
function outputFileFor(routePath) {
  if (routePath === site.ROUTE_PATHS.home) return "index.html";
  if (routePath === site.ROUTE_PATHS.notFound) return "404.html";
  return path.join(routePath.replace(/^\//, ""), "index.html");
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(stylesOut, { recursive: true });

let written = 0;
for (const route of site.ROUTES) {
  const file = outputFileFor(route.path);
  const target = path.join(outDir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  const html = site
    .renderRoute(route.path, { stylesheetBasePath: STYLESHEET_BASE })
    // The site stylesheet is linked with a site-relative path by `renderRoute`;
    // rewrite it to sit alongside the design system styles in the same folder.
    .replace(`href="/site/${SITE_STYLESHEET}"`, `href="${SITE_STYLESHEET}"`);
  writeFileSync(target, html, "utf8");
  written += 1;
  console.log(`site:build wrote ${path.relative(projectRoot, target)} (${html.length} bytes)`);
}

const sitemap = site.renderSitemap(site.ROUTES, { lastModified: "2026-01-01" });
writeFileSync(path.join(outDir, "sitemap.xml"), sitemap, "utf8");
// Report the INDEXABLE count, not the page count. The two differ, and printing
// the wrong one would make a reader think noindex pages had been indexed.
const indexed = site.sitemapEntries(site.ROUTES).length;
console.log(
  `site:build wrote ${path.relative(projectRoot, path.join(outDir, "sitemap.xml"))} ` +
    `(${indexed} of ${written} page(s) indexable)`,
);

const robots = site.renderRobots();
writeFileSync(path.join(outDir, "robots.txt"), robots, "utf8");
console.log(`site:build wrote ${path.relative(projectRoot, path.join(outDir, "robots.txt"))}`);

for (const directory of [designSystemStyles, siteStyles]) {
  for (const file of readdirSync(directory)) {
    if (!file.endsWith(".css")) continue;
    cpSync(path.join(directory, file), path.join(stylesOut, file));
  }
}
console.log(`site:build copied stylesheets into ${path.relative(projectRoot, stylesOut)}`);
