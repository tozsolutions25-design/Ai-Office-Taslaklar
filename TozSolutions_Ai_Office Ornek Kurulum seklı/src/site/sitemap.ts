/**
 * Sitemap and robots.
 *
 * Generated from the ROUTE TABLE rather than maintained by hand, so a route
 * cannot exist without appearing here and a page cannot be forgotten.
 *
 * One rule decides membership, and it is the same one the page metadata uses:
 * a route marked `noindex` is EXCLUDED. A sitemap that listed a `noindex` page
 * would be sending a crawler contradictory instructions, and search engines
 * resolve that contradiction in the direction that produces a worse result.
 *
 * The not-found page is excluded for the same reason it is marked `noindex`: it
 * is not content, and `https://…/404` appearing in a sitemap is a classic
 * mistake.
 */

import { CANONICAL_ORIGIN } from "./content.js";
import type { Route } from "./routes.js";

export interface SitemapEntry {
  readonly path: string;
  readonly url: string;
  readonly changefreq: "daily" | "weekly" | "monthly" | "yearly";
  readonly priority: "0.0" | "0.1" | "0.2" | "0.3" | "0.4" | "0.5" | "0.6" | "0.7" | "0.8" | "0.9" | "1.0";
}

export interface SitemapOptions {
  readonly origin?: string;
  /**
   * Last-modified date, as `YYYY-MM-DD`.
   *
   * Supplied by the caller rather than read from the clock, because a sitemap
   * that changes on every build is not a signal a crawler can use, and a
   * generated file whose only purpose is diffing badly should be stable.
   */
  readonly lastModified?: string;
}

/**
 * The routes a crawler should be told about.
 *
 * `noindex` decides membership. There is no second filter, so "is this page in
 * the sitemap" and "may this page be indexed" cannot disagree.
 */
export function indexableRoutes(routes: readonly Route[]): readonly Route[] {
  return routes.filter((route) => route.meta.noIndex !== true);
}

function priorityFor(path: string): SitemapEntry["priority"] {
  switch (path) {
    case "/":
      return "1.0";
    case "/capabilities":
    case "/about":
      return "0.8";
    case "/contact":
      return "0.6";
    default:
      // Capability detail pages: real content, but one of several.
      return path.startsWith("/capabilities/") ? "0.7" : "0.5";
  }
}

function changefreqFor(path: string): SitemapEntry["changefreq"] {
  return path === "/" ? "weekly" : "monthly";
}

export function sitemapEntries(
  routes: readonly Route[],
  options: SitemapOptions = {},
): readonly SitemapEntry[] {
  const base = (options.origin ?? CANONICAL_ORIGIN).replace(/\/$/, "");
  return indexableRoutes(routes).map((route) => ({
    path: route.path,
    url: `${base}${route.path === "/" ? "" : route.path}`,
    changefreq: changefreqFor(route.path),
    priority: priorityFor(route.path),
  }));
}

/** Escapes a value for XML text content. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderSitemap(
  routes: readonly Route[],
  options: SitemapOptions = {},
): string {
  const entries = sitemapEntries(routes, options);
  const lastModified =
    options.lastModified === undefined ? "" : `\n    <lastmod>${options.lastModified}</lastmod>`;
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${xmlEscape(entry.url)}</loc>${lastModified}
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export interface RobotsOptions {
  readonly origin?: string;
  /**
   * Paths a crawler must not fetch.
   *
   * Disallow is a crawl-budget instruction, not a security control, and nothing
   * sensitive is published on this site - so this covers the two genuinely
   * non-content paths and does not pretend to protect anything.
   */
  readonly disallow?: readonly string[];
}

/**
 * robots.txt.
 *
 * A public marketing site with no admin area and no private routes, so the file
 * is mostly a pointer to the sitemap. It says so plainly rather than listing
 * speculative paths that do not exist: a `Disallow` for a path nobody serves is
 * noise that makes the real entries harder to see.
 */
export function renderRobots(options: RobotsOptions = {}): string {
  const base = (options.origin ?? CANONICAL_ORIGIN).replace(/\/$/, "");
  const disallow = options.disallow ?? ["/404"];
  const lines = [
    "# TOZ AI Office",
    "#",
    "# A public documentation and architecture site. There is no admin area and no",
    "# private route, so this file is mostly a pointer to the sitemap.",
    "#",
    "# Disallow is a crawl-budget instruction, not access control. Nothing sensitive",
    "# is published here, so there is nothing here to protect.",
    "",
    "User-agent: *",
    "Allow: /",
    ...disallow.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ];
  return lines.join("\n");
}
