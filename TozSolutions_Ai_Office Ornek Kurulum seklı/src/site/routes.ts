/**
 * Routing.
 *
 * A deliberately small route table. There is no framework, no router library and
 * no HTTP server in this project: pages are functions from a path to HTML, and
 * the caller decides how to deliver the result. That keeps PHASE 03 free of a
 * server dependency while still giving the site a real, testable route concept
 * â€” a URL is either a registered route or it is the not-found page, and there is
 * no third case.
 *
 * Inner pages are implemented (PROJECT_STATE.md §13). A route is registered here
 * only when the page behind it actually renders, which is why the table is built
 * from real data rather than from a list of intended URLs: `CAPABILITY_ROUTES` is
 * generated from `CAPABILITIES`, so a capability cannot exist without a page.
 */

import { htmlDocument } from "../design-system/theme/theme.js";
import { html, toHtmlString, type RawHtml } from "../design-system/utils/html.js";
import {
  CANONICAL_ORIGIN,
  CAPABILITIES,
  ROUTE_PATHS,
  SITE_NAME,
  capabilityPath,
  type SectionId,
} from "./content.js";
import { homePageBody } from "./home/index.js";
import {
  ABOUT_META,
  BLOG_META,
  CAPABILITIES_META,
  CONTACT_META,
  HOME_META,
  NOT_FOUND_META,
  PROJECTS_META,
  capabilityMeta,
  headFor,
  jsonLdScript,
  type PageMeta,
} from "./meta.js";
import { notFoundBody } from "./notFound.js";
import {
  aboutPageBody,
  capabilitiesIndexBody,
  capabilityDetailBody,
  contactPageBody,
  emptySurfaceBody,
} from "./pages/index.js";
import {
  breadcrumbNode,
  capabilityListNode,
  faqPageNode,
  serviceNode,
  webPageNode,
  webSiteNode,
  type JsonLd,
} from "./structuredData.js";

export interface Route {
  readonly path: string;
  readonly meta: PageMeta;
  /** Anchors this route defines, used to validate links. */
  readonly sectionIds: readonly SectionId[];
  /**
   * Structured data for this route, or null for a page that has none.
   *
   * A property rather than something `render` decides, so the sitemap, the
   * tests and the emitted `<head>` all read the same source.
   */
  readonly structuredData?: (origin: string) => readonly JsonLd[];
  render(): RawHtml;
}

const STATIC_ROUTES: readonly Route[] = [
  {
    path: ROUTE_PATHS.home,
    meta: HOME_META,
    sectionIds: [
      "hero",
      "capabilities",
      "how-it-works",
      "architecture",
      "reliability",
      "next",
    ],
    structuredData: (origin) => [webSiteNode({ origin }), webPageNode({ path: "/", title: SITE_NAME, description: HOME_META.description, origin })],
    render: () => homePageBody(),
  },
  {
    path: ROUTE_PATHS.about,
    meta: ABOUT_META,
    sectionIds: [],
    structuredData: (origin) => [
      webSiteNode({ origin }),
      webPageNode({ path: ROUTE_PATHS.about, title: "About", description: ABOUT_META.description, origin }),
      breadcrumbNode(
        [
          { label: "Home", path: "/" },
          { label: "About", path: ROUTE_PATHS.about },
        ],
        origin,
      ),
      faqPageNode({ origin }),
    ],
    render: () => aboutPageBody(),
  },
  {
    path: ROUTE_PATHS.capabilities,
    meta: CAPABILITIES_META,
    sectionIds: [],
    structuredData: (origin) => [
      webSiteNode({ origin }),
      webPageNode({
        path: ROUTE_PATHS.capabilities,
        title: "Capabilities",
        description: CAPABILITIES_META.description,
        origin,
      }),
      breadcrumbNode(
        [
          { label: "Home", path: "/" },
          { label: "Capabilities", path: ROUTE_PATHS.capabilities },
        ],
        origin,
      ),
      capabilityListNode({ origin }),
    ],
    render: () => capabilitiesIndexBody(),
  },
  {
    path: ROUTE_PATHS.contact,
    meta: CONTACT_META,
    sectionIds: [],
    structuredData: (origin) => [
      webSiteNode({ origin }),
      webPageNode({ path: ROUTE_PATHS.contact, title: "Contact", description: CONTACT_META.description, origin }),
      breadcrumbNode(
        [
          { label: "Home", path: "/" },
          { label: "Contact", path: ROUTE_PATHS.contact },
        ],
        origin,
      ),
    ],
    render: () => contactPageBody(),
  },
  {
    path: ROUTE_PATHS.projects,
    meta: PROJECTS_META,
    sectionIds: [],
    render: () => emptySurfaceBody("projects"),
  },
  {
    path: ROUTE_PATHS.blog,
    meta: BLOG_META,
    sectionIds: [],
    render: () => emptySurfaceBody("blog"),
  },
  {
    path: ROUTE_PATHS.notFound,
    meta: NOT_FOUND_META,
    sectionIds: [],
    render: () => notFoundBody(),
  },
];

/**
 * Capability detail routes, one per capability.
 *
 * Built from the capability data rather than hand-registered, so a capability
 * cannot exist without a page and a page cannot exist for a capability that was
 * removed. Each gets a generated `PageMeta`, which is why a new capability needs
 * no metadata edit.
 */
const CAPABILITY_ROUTES: readonly Route[] = CAPABILITIES.map((capability) => ({
  path: capabilityPath(capability.id),
  meta: capabilityMeta(capability),
  sectionIds: [],
  structuredData: (origin: string) => [
    webSiteNode({ origin }),
    webPageNode({
      path: capabilityPath(capability.id),
      title: capability.title,
      description: capability.body,
      origin,
    }),
    breadcrumbNode(
      [
        { label: "Home", path: "/" },
        { label: "Capabilities", path: ROUTE_PATHS.capabilities },
        { label: capability.title, path: capabilityPath(capability.id) },
      ],
      origin,
    ),
    serviceNode(capability, { origin }),
  ],
  render: () => capabilityDetailBody(capability),
}));

/**
 * Every route the site serves: static pages first, then generated detail pages.
 *
 * This is the table the sitemap, the link checker and the tests all read, so
 * "a route exists" has exactly one meaning in this codebase.
 */
export const ROUTES: readonly Route[] = [...STATIC_ROUTES, ...CAPABILITY_ROUTES];

/** Registered paths, for validation. */
export const REGISTERED_PATHS: ReadonlySet<string> = new Set(ROUTES.map((route) => route.path));

/**
 * Resolves a path to a route.
 *
 * Trailing slashes are normalised so `/` and `//` do not produce two entries, and
 * an unknown path resolves to the not-found route rather than throwing. A site
 * that throws on an unknown path returns a stack trace to a visitor.
 */
export function matchRoute(path: string): Route {
  const normalised = normalisePath(path);
  const found = ROUTES.find((route) => route.path === normalised);
  return found ?? notFoundRoute();
}

function notFoundRoute(): Route {
  const route = ROUTES.find((entry) => entry.path === ROUTE_PATHS.notFound);
  if (!route) {
    throw new Error("The not-found route is missing from the route table");
  }
  return route;
}

/**
 * Normalises a path so one page has exactly one URL.
 *
 * Repeated slashes are collapsed and a trailing slash is removed. The empty
 * string and a bare slash both normalise to `/`, because a request for the site
 * root must resolve regardless of how the URL was written.
 */
export function normalisePath(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (collapsed === "/") {
    return "/";
  }
  return collapsed.replace(/\/+$/, "");
}

export interface RenderOptions {
  /** Base path the design-system stylesheets are served from. */
  readonly stylesheetBasePath?: string;
  readonly origin?: string;
}

/** Renders a route to a complete HTML document. */
export function renderRoute(path: string, options: RenderOptions = {}): string {
  const route = matchRoute(path);
  const document_ = htmlDocument({
    title: route.meta.title,
    theme: "dark",
    stylesheetBasePath: options.stylesheetBasePath ?? "/design-system/styles",
    head: [
      ...headFor(route.meta, options.origin),
      ...(route.structuredData === undefined
        ? []
        : [jsonLdScript(route.structuredData(options.origin ?? CANONICAL_ORIGIN))]),
      siteStylesheet(),
    ],
    bodyClass: "toz-site",
  });
  return toHtmlString(document_).replace("</body>", `${toHtmlString(route.render())}\n</body>`);
}

/** Renders the homepage to a complete HTML document. */
export function renderHome(options: RenderOptions = {}): string {
  return renderRoute(ROUTE_PATHS.home, options);
}

function siteStylesheet(): RawHtml {
  return html`<link rel="stylesheet" href="/site/styles/site.css" />`;
}
