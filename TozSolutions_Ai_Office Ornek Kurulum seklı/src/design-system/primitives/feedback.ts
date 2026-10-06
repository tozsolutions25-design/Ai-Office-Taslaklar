/**
 * Feedback primitives.
 *
 * `alert()` covers notices, success, warning and error messages. The `role` is
 * chosen per tone, because the announcement behaviour is not the same:
 *
 *  - `error`   -> `role="alert"`, announced immediately and assertively.
 *  - others    -> `role="status"`, announced politely without interrupting.
 *
 * A page that renders several `error` alerts at once will be verbose for a
 * screen-reader user, so callers should use at most one per view where possible
 * and link to the rest.
 */

import { type StatusTone } from "../tokens/colors.js";
import { cn } from "../utils/cn.js";
import { attrs, html, raw, type HtmlChild, type RawHtml } from "../utils/html.js";
import { icon, type IconName } from "./button.js";

export const ALERT_TONES = ["info", "success", "warning", "error"] as const;
export type AlertTone = (typeof ALERT_TONES)[number];

const ALERT_ICONS: Readonly<Record<AlertTone, IconName>> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
};

export interface AlertOptions {
  readonly tone: AlertTone;
  /** Bold first line. Keep it short. */
  readonly title?: HtmlChild;
  readonly children?: HtmlChild;
  /** Action, e.g. a retry button or a link. */
  readonly action?: HtmlChild;
  /** Hides the leading icon when the message is already unambiguous. */
  readonly hideIcon?: boolean;
  readonly live?: boolean;
  readonly class?: string;
  readonly id?: string;
}

export function alert(options: AlertOptions): RawHtml {
  const { children, class: className, live = false, ...rest } = options;
  const tone = rest.tone;
  // `alert` overrides `status`; live is opt-in so a static message is not
  // announced when the page loads.
  const role = live ? (tone === "error" ? "alert" : "status") : undefined;

  return html`<div${raw(
    attrs({
      class: cn("toz-alert", className),
      "data-tone": tone,
      role,
      "aria-live": live ? (tone === "error" ? "assertive" : "polite") : undefined,
      id: rest.id,
    }),
  )}>
    ${
      rest.hideIcon === true
        ? ""
        : html`<span class="toz-alert__icon" aria-hidden="true">${icon(ALERT_ICONS[tone], "1.125rem")}</span>`
    }
    <div class="toz-alert__body">
      ${rest.title === undefined ? "" : html`<div class="toz-alert__title">${rest.title}</div>`}
      ${children === undefined ? "" : html`<div class="toz-alert__description">${children}</div>`}
    </div>
    ${rest.action ?? ""}
  </div>`;
}

export interface NoticeOptions {
  readonly children: HtmlChild;
  /** Small leading label, e.g. "New". */
  readonly label?: string;
  readonly tone?: StatusTone;
  readonly class?: string;
}

/** A compact inline note, for supplementary detail rather than a full alert. */
export function notice(options: NoticeOptions): RawHtml {
  return html`<p${raw(
    attrs({
      class: cn("toz-type-body-sm", "toz-text-muted", options.class),
      "data-tone": options.tone ?? "neutral",
    }),
  )}>${options.label === undefined ? "" : html`<strong class="toz-text-default">${options.label}</strong> `}${options.children}</p>`;
}

export const successMessage = (children: HtmlChild, className?: string): RawHtml =>
  alert({ tone: "success", title: "Success", children, class: className, live: true });

export const errorMessage = (children: HtmlChild, className?: string): RawHtml =>
  alert({ tone: "error", title: "Something went wrong", children, class: className, live: true });

export const warningMessage = (children: HtmlChild, className?: string): RawHtml =>
  alert({ tone: "warning", title: "Warning", children, class: className, live: true });

export const infoMessage = (children: HtmlChild, className?: string): RawHtml =>
  alert({ tone: "info", children, class: className, live: true });
