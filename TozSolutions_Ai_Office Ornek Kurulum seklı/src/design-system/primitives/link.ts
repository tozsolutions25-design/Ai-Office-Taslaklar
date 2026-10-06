/**
 * Links.
 *
 * A single consistent element with a variant, rather than several link
 * components. `external` adds the `rel` and `target` that are required for
 * links that leave the site, plus a visible arrow so the destination is
 * communicated without relying on colour.
 */

import { cn } from "../utils/cn.js";
import { attrs, html, raw, type HtmlChild, type RawHtml } from "../utils/html.js";

export const LINK_VARIANTS = ["standard", "nav", "subtle", "emphasis"] as const;
export type LinkVariant = (typeof LINK_VARIANTS)[number];

export interface LinkOptions {
  readonly href: string;
  readonly children: HtmlChild;
  readonly variant?: LinkVariant;
  /** Marks the current page for navigation links. */
  readonly current?: boolean;
  /** Opens in a new context. Implies safe `rel` values. */
  readonly external?: boolean;
  readonly ariaLabel?: string;
  readonly title?: string;
  readonly class?: string;
  readonly id?: string;
  readonly download?: string;
}

export function link(options: LinkOptions): RawHtml {
  const { href, children, class: className, ...rest } = options;
  return html`<a${raw(
    attrs({
      class: cn("toz-link", className),
      href,
      "data-variant": rest.variant ?? "standard",
      "data-external": rest.external === true ? "true" : undefined,
      // `aria-current="page"` is the correct signal for the current page;
      // presence alone would be ambiguous.
      "aria-current": rest.current === true ? "page" : undefined,
      target: rest.external === true ? "_blank" : undefined,
      rel: rest.external === true ? "noopener noreferrer" : undefined,
      "aria-label": rest.ariaLabel,
      title: rest.title,
      download: rest.download,
      id: rest.id,
    }),
  )}>${children}</a>`;
}

/**
 * Class applied to a link that cannot be activated.
 *
 * Exported so the class and the component cannot drift apart, and so a test can
 * assert the styling hook exists rather than hard-coding the string.
 */
export const DISABLED_LINK_CLASS = "toz-link--disabled";

/** A link that does not exist yet. Rendered as inert text, not a dead anchor. */
export function disabledLink(options: { children: HtmlChild; class?: string }): RawHtml {
  return html`<span${raw(
    attrs({
      class: cn("toz-link", DISABLED_LINK_CLASS, options.class),
      "data-variant": "subtle",
      "aria-disabled": "true",
    }),
  )}>${options.children}</span>`;
}
