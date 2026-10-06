import { brand } from "../../design-system/primitives/nav.js";
import { link } from "../../design-system/primitives/link.js";
import { attrs, html, raw, type RawHtml } from "../../design-system/utils/html.js";
import { FOOTER, SITE_NAME } from "../content.js";

/**
 * Site footer.
 *
 * Rendered as a real `<footer>` landmark rather than a `<section>`: assistive
 * technology uses the landmark to let a user jump past the navigation, and a
 * footer that is merely a styled section is invisible as one. It reuses the
 * design system's `toz-section` and `toz-container` classes for appearance, so
 * nothing is restyled here.
 */
export function siteFooter(options: { year?: number } = {}): RawHtml {
  // A hard-coded year would go stale; the caller supplies the current one.
  const year = options.year ?? new Date().getUTCFullYear();

  return html`<footer${raw(
    attrs({ class: "toz-section toz-site-footer", "data-tone": "inset", "data-spacing": "md" }),
  )}>
    <div class="toz-container" data-width="default">
      <div class="toz-stack" data-align="stretch" style="--toz-stack-gap: var(--toz-space-10)">
        <div class="toz-grid toz-site-footer__grid" data-columns="auto" style="--toz-grid-gap: var(--toz-space-6)">
          <div class="toz-site-footer__about">
            ${brand({ name: SITE_NAME })}
            <p class="toz-type-body-sm toz-text-muted">${FOOTER.description}</p>
          </div>
          ${FOOTER.groups.map(
            (group) => html`<nav class="toz-site-footer__group" aria-label="${group.heading}">
              <h2 class="toz-type-label toz-text-default">${group.heading}</h2>
              <ul class="toz-site-footer__list">
                ${group.items.map(
                  (item) => html`<li>${link({
                    href: item.href,
                    children: item.label,
                    variant: "subtle",
                  })}</li>`,
                )}
              </ul>
            </nav>`,
          )}
        </div>
        <div class="toz-site-footer__base">
          <p class="toz-type-caption toz-text-subtle">&copy; ${year} ${SITE_NAME}</p>
        </div>
      </div>
    </div>
  </footer>`;
}
