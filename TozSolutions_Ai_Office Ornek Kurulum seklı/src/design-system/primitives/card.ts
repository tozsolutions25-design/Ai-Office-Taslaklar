/**
 * Card.
 *
 * Composed from small parts so a caller can use the whole component or assemble
 * a custom arrangement from the same pieces. There is no hardcoded business
 * content: a card describes a generic container, and the title, description and
 * status are supplied by the caller.
 *
 * `interactive` is opt-in and adds only a hover treatment. It is never paired
 * with a nested interactive element, because a clickable container wrapping
 * links or buttons produces ambiguous focus order.
 */

import { cn } from "../utils/cn.js";
import { attrs, html, raw, type HtmlChild, type RawHtml } from "../utils/html.js";
import { responsiveImage, type ResponsiveImageOptions } from "./media.js";

export const CARD_TONES = ["default", "accent", "muted"] as const;
export type CardTone = (typeof CARD_TONES)[number];

export interface CardOptions {
  readonly title?: HtmlChild;
  readonly description?: HtmlChild;
  readonly children?: HtmlChild;
  readonly footer?: HtmlChild;
  readonly media?: ResponsiveImageOptions;
  /** Small status element rendered above the title, e.g. a badge. */
  readonly status?: HtmlChild;
  readonly interactive?: boolean;
  readonly tone?: CardTone;
  /** Sets `disabled`-like presentation without using the disabled attribute. */
  readonly state?: "default" | "disabled";
  readonly as?: "div" | "article" | "li";
  readonly headingLevel?: 2 | 3 | 4;
  readonly class?: string;
  readonly id?: string;
  readonly ariaLabel?: string;
  readonly ariaLabelledby?: string;
}

export function card(options: CardOptions = {}): RawHtml {
  const {
    title,
    description,
    children,
    footer,
    media,
    status,
    class: className,
    ...rest
  } = options;

  const tag = options.as ?? "article";
  // The heading level is caller-controlled so a page keeps a correct outline;
  // the design system does not decide document structure for you.
  const headingTag = `h${options.headingLevel ?? 3}`;

  return html`<${raw(tag)}${raw(
    attrs({
      class: cn("toz-card", className),
      "data-interactive": rest.interactive === true ? "true" : undefined,
      "data-tone": rest.tone === undefined || rest.tone === "default" ? undefined : rest.tone,
      "data-state": rest.state === "disabled" ? "disabled" : undefined,
      id: rest.id,
      "aria-label": rest.ariaLabel,
      "aria-labelledby": rest.ariaLabelledby,
    }),
  )}>
    ${media ? responsiveImage(media) : ""}
    ${title === undefined && description === undefined && status === undefined ? "" : html`<div class="toz-card__header">
      ${status === undefined ? "" : status}
      ${title === undefined ? "" : html`<${raw(headingTag)} class="toz-card__title">${title}</${raw(headingTag)}>`}
      ${description === undefined ? "" : html`<div class="toz-card__description">${description}</div>`}
    </div>`}
    ${children === undefined ? "" : html`<div class="toz-card__body">${children}</div>`}
    ${footer === undefined ? "" : html`<div class="toz-card__footer">${footer}</div>`}
  </${raw(tag)}>`;
}

/** Header-only card slot, for custom compositions. */
export function cardHeader(options: { children: HtmlChild; class?: string }): RawHtml {
  return html`<div${raw(attrs({ class: cn("toz-card__header", options.class) }))}>${options.children}</div>`;
}

/** Body-only card slot, for custom compositions. */
export function cardBody(options: { children: HtmlChild; class?: string }): RawHtml {
  return html`<div${raw(attrs({ class: cn("toz-card__body", options.class) }))}>${options.children}</div>`;
}

/** Footer-only card slot, for custom compositions. */
export function cardFooter(options: { children: HtmlChild; class?: string }): RawHtml {
  return html`<div${raw(attrs({ class: cn("toz-card__footer", options.class) }))}>${options.children}</div>`;
}
