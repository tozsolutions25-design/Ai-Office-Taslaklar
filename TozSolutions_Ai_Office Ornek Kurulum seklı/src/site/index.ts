/**
 * TOZ AI Office — site.
 *
 * The marketing site: routing, page composition and page-level metadata. This
 * layer consumes the PHASE 02 design system and nothing else.
 *
 * It deliberately does NOT import the PHASE 01 core. The homepage describes the
 * product; it does not run it. Coupling the two would put orchestration behind a
 * marketing page and make the core unimportable from a static build.
 */

export {
  ARCHITECTURE,
  CAPABILITIES,
  CANONICAL_ORIGIN,
  CAPABILITY_PATH_PREFIX,
  FOOTER_NAVIGATION,
  capabilityPath,
  FOOTER,
  HERO,
  HOW_IT_WORKS,
  NAVIGATION,
  NEXT_STEP,
  RELIABILITY,
  ROUTE_PATHS,
  SECTION_IDS,
  SITE_NAME,
  VALUE_PROPOSITION,
  type ArchitectureLayer,
  type CapabilityItem,
  type NavItem,
  type NavModel,
  type ProcessStep,
  type ReliabilityPrinciple,
  type SectionId,
  type ValueItem,
} from "./content.js";

export {
  ABOUT_META,
  BLOG_META,
  CAPABILITIES_META,
  CONTACT_META,
  HOME_META,
  NOT_FOUND_META,
  PROJECTS_META,
  canonicalUrl,
  capabilityMeta,
  headFor,
  jsonLdScript,
  renderTitle,
  type PageMeta,
} from "./meta.js";

export {
  REGISTERED_PATHS,
  ROUTES,
  matchRoute,
  normalisePath,
  renderHome,
  renderRoute,
  type RenderOptions,
  type Route,
} from "./routes.js";

export { renderRobots, renderSitemap, sitemapEntries, indexableRoutes } from "./sitemap.js";

export {
  breadcrumbNode,
  capabilityListNode,
  faqPageNode,
  serviceNode,
  toJsonLdScript,
  webPageNode,
  webSiteNode,
  type JsonLd,
} from "./structuredData.js";

export {
  aboutPageBody,
  capabilitiesIndexBody,
  capabilityDetailBody,
  contactPageBody,
  emptySurfaceBody,
} from "./pages/index.js";
export { breadcrumb, pageHeader, pageSection, pageShell, type Crumb } from "./pages/shell.js";
export { ABOUT, CONTACT, EMPTY_SURFACES, type FaqEntry } from "./pages/content.js";

export { homePageBody, type HomeOptions } from "./home/index.js";
export { siteHeader, type SiteHeaderOptions } from "./home/header.js";
export { siteFooter } from "./home/footer.js";
export { architecture } from "./home/architecture.js";
export { hero } from "./home/hero.js";
export { capabilities, howItWorks, nextStep, reliability, valueProposition } from "./home/sections.js";
export { notFoundBody } from "./notFound.js";
export { heroVisual, type HeroVisualOptions } from "./visuals/heroVisual.js";
export { architectureDiagram, type ArchitectureDiagramOptions } from "./visuals/architectureDiagram.js";
