/**
 * Theme architecture.
 *
 * Dark-first. The dark palette is the CSS default, so a page that never sets a
 * theme is already dark. Light mode is a single attribute override.
 *
 * Theming is PURE CSS driven by `data-theme`, so switching needs no JavaScript
 * and no re-render. This phase intentionally ships no visible theme switcher:
 * the brief asks for the foundation, not the feature, and adding a control
 * before the product requires one would be premature.
 */

import { attrs, html, raw, type AttributeValue, type HtmlChild, type RawHtml } from "../utils/html.js";

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

/** The attribute that selects the theme. */
export const THEME_ATTRIBUTE = "data-theme";

export interface DocumentAttributesOptions {
  readonly theme?: Theme;
  readonly lang?: string;
  readonly colorScheme?: "dark" | "light";
  /** Rendered on `<html>`, e.g. a noindex directive. */
  readonly extra?: Readonly<Record<string, AttributeValue>>;
}

export const DEFAULT_LANG = "en";

/**
 * Attributes for the root `<html>` element.
 *
 * Emitting the theme server-side avoids a flash of the wrong theme, which is
 * the only reason this helper exists rather than a plain `data-theme` in
 * markup.
 */
export function documentAttributes(options: DocumentAttributesOptions = {}): Record<string, AttributeValue> {
  const theme = options.theme ?? "dark";
  return {
    lang: options.lang ?? DEFAULT_LANG,
    [THEME_ATTRIBUTE]: theme,
    ...options.extra,
  };
}

export interface HtmlDocumentOptions extends DocumentAttributesOptions {
  readonly title: string;
  readonly head?: readonly HtmlChild[];
  readonly bodyClass?: string;
  /**
   * Directory the design-system stylesheets are served from.
   *
   * Defaults to a root-relative path, which is correct for a site served over
   * HTTP. A static build written to disk needs a relative base instead, so the
   * page still resolves its stylesheets when opened directly from the
   * filesystem.
   */
  readonly stylesheetBasePath?: string;
}

/**
 * Builds a complete HTML document.
 *
 * The design system owns the document SHELL — `<head>`, the stylesheet links
 * and the skip link — but never page content. That separation is what lets the
 * same shell serve a marketing page, a dashboard or documentation.
 */
export function htmlDocument(options: HtmlDocumentOptions): RawHtml {
  const { title, head = [], bodyClass, stylesheetBasePath, ...documentOptions } = options;
  return html`<!doctype html>
<html${raw(attrs(documentAttributes(documentOptions)))}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    ${stylesheetLinks(stylesheetBasePath ?? "/design-system/styles")}
    ${head}
  </head>
  <body${raw(attrs({ class: bodyClass }))}></body>
</html>
`;
}

/** The stylesheets a page must load, in cascade order. */
export const STYLESHEET_ORDER = [
  "tokens.css",
  "base.css",
  "layout.css",
  "components.css",
] as const;

/** `link` elements for the stylesheets, for pages assembling their own head. */
export function stylesheetLinks(basePath = "/design-system/styles"): readonly RawHtml[] {
  return STYLESHEET_ORDER.map((file) =>
    html`<link rel="stylesheet" href="${`${basePath}/${file}`}" />`,
  );
}
