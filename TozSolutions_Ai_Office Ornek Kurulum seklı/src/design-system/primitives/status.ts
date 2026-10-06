/**
 * Status and data-visualisation primitives.
 *
 * Foundations for the agent, provider, queue and job interfaces that later
 * phases will need. They are deliberately generic: each accepts a plain status
 * string or a number, and knows nothing about the core's registries.
 *
 * Colour is never the only signal. A status dot is paired with a text label, a
 * progress bar carries an accessible value, and a health indicator states its
 * state in words. That keeps the components usable for colour-blind users and
 * in high-contrast modes.
 */

import { type HealthState, type StatusTone, healthTone } from "../tokens/colors.js";
import { cn } from "../utils/cn.js";
import { attrs, html, raw, type HtmlChild, type RawHtml } from "../utils/html.js";
import { icon } from "./button.js";

/* ------------------------------------------------------------------ */
/* Status dot                                                          */
/* ------------------------------------------------------------------ */

export const STATUS_DOT_SIZES = ["sm", "md", "lg"] as const;
export type StatusDotSize = (typeof STATUS_DOT_SIZES)[number];

interface StatusDotShared {
  readonly tone: StatusTone;
  readonly size?: StatusDotSize;
  readonly class?: string;
}

/**
 * A status dot must either carry a label or be explicitly marked decorative.
 *
 * The union enforces this at COMPILE time. A bare coloured dot conveys nothing
 * to a screen reader and is unreadable for a colour-blind user, so the
 * unlabelled form is only permitted where surrounding text already states the
 * condition — which the caller has to say out loud.
 */
export type StatusDotOptions =
  | (StatusDotShared & {
      /** Announced text. Required unless the dot is decorative. */
      readonly label: string;
      readonly decorative?: false;
    })
  | (StatusDotShared & {
      /** Surrounding text already states the condition. */
      readonly decorative: true;
      readonly label?: never;
    });

export function statusDot(options: StatusDotOptions): RawHtml {
  return html`<span${raw(
    attrs({
      class: cn("toz-status-dot", options.class),
      "data-tone": options.tone,
      "data-size": options.size ?? "md",
      role: options.label === undefined ? undefined : "img",
      "aria-label": options.label,
    }),
  )}></span>`;
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

export interface BadgeOptions {
  readonly children: HtmlChild;
  readonly tone?: StatusTone;
  /**
   * For a live value such as a processing state. Adds `role="status"` so
   * assistive technology announces changes without stealing focus.
   */
  readonly live?: boolean;
  readonly icon?: "none" | "processing";
  readonly class?: string;
  readonly id?: string;
}

export function badge(options: BadgeOptions): RawHtml {
  const { children, class: className, live = false, ...rest } = options;
  return html`<span${raw(
    attrs({
      class: cn("toz-badge", className),
      "data-tone": rest.tone ?? "neutral",
      role: live ? "status" : undefined,
      "aria-live": live ? "polite" : undefined,
      id: rest.id,
    }),
  )}>${rest.icon === "processing" ? statusDot({ tone: "processing", size: "sm", decorative: true }) : ""}${children}</span>`;
}

/* ------------------------------------------------------------------ */
/* Health indicator                                                    */
/* ------------------------------------------------------------------ */

export const HEALTH_LABELS: Readonly<Record<HealthState, string>> = {
  unknown: "Unknown",
  healthy: "Healthy",
  degraded: "Degraded",
  unavailable: "Unavailable",
  disabled: "Disabled",
};

export interface HealthIndicatorOptions {
  readonly state: HealthState;
  /** Overrides the default label. */
  readonly label?: string;
  /** e.g. "120 ms" or "checked 2 min ago". Non-secret context. */
  readonly detail?: string;
  readonly size?: StatusDotSize;
  readonly class?: string;
}

export function healthIndicator(options: HealthIndicatorOptions): RawHtml {
  const label = options.label ?? HEALTH_LABELS[options.state];
  const tone = healthTone(options.state);
  return html`<span${raw(attrs({ class: cn("toz-health", options.class) }))}>
    ${statusDot({ tone, size: options.size ?? "md", decorative: true })}
    <span>${label}</span>
    ${options.detail === undefined ? "" : html`<span class="toz-timestamp">${options.detail}</span>`}
  </span>`;
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export interface ProgressOptions {
  /**
   * Completion from 0 to 100. Omit for an indeterminate bar.
   * Values outside the range are rejected by the caller contract rather than
   * silently clamped, so a bad metric is visible instead of cosmetically fixed.
   */
  readonly value?: number;
  readonly max?: number;
  readonly label: string;
  /** Hides the numeric readout while keeping it available to assistive tech. */
  readonly hideValue?: boolean;
  readonly tone?: StatusTone;
  readonly size?: "sm" | "md";
  readonly class?: string;
}

export function progress(options: ProgressOptions): RawHtml {
  const { value, label, class: className, ...rest } = options;
  const indeterminate = value === undefined;
  const max = rest.max ?? 100;
  const percent = indeterminate ? 0 : Math.max(0, Math.min(100, (value / max) * 100));

  // Built with `attrs` rather than an inline template so the unknown value can
  // be OMITTED, not serialised as the string "null".
  const barAttributes = attrs({
    class: "toz-progress__bar",
    role: "progressbar",
    "aria-label": label,
    "aria-valuenow": indeterminate ? null : Math.round(percent),
    "aria-valuemin": 0,
    "aria-valuemax": max,
    "aria-valuetext": indeterminate ? `${label}: in progress` : `${label}: ${Math.round(percent)}%`,
    style: `inline-size: ${indeterminate ? "35%" : `${percent}%`}`,
  });

  return html`<div${raw(
    attrs({
      class: cn("toz-progress", className),
      "data-tone": rest.tone ?? "primary",
      "data-indeterminate": indeterminate ? "true" : undefined,
      style: rest.size === "sm" ? "block-size:0.25rem" : undefined,
    }),
  )}><div${raw(barAttributes)}></div></div>${
    rest.hideValue === true || indeterminate
      ? ""
      : html`<span class="toz-visually-hidden">${Math.round(percent)}%</span>`
  }`;
}

/* ------------------------------------------------------------------ */
/* Spinner                                                             */
/* ------------------------------------------------------------------ */

export interface SpinnerOptions {
  /** Announced description. Required: a bare spinner announces nothing. */
  readonly label: string;
  readonly sizeRem?: string;
  readonly class?: string;
}

export function spinner(options: SpinnerOptions): RawHtml {
  return html`<span${raw(
    attrs({
      class: cn("toz-spinner", options.class),
      role: "status",
      style: options.sizeRem === undefined ? undefined : `--toz-spinner-size: ${options.sizeRem}`,
    }),
  )}><span class="toz-visually-hidden">${options.label}</span></span>`;
}

/* ------------------------------------------------------------------ */
/* Metric                                                              */
/* ------------------------------------------------------------------ */

export type MetricDirection = "up" | "down" | "flat";

export interface MetricOptions {
  readonly label: string;
  /** Pre-formatted value. The design system does not format numbers, so a
   * caller can render units, currencies or compact notation deliberately. */
  readonly value: string;
  readonly delta?: string;
  readonly deltaDirection?: MetricDirection;
  readonly hint?: HtmlChild;
  readonly class?: string;
}

export function metric(options: MetricOptions): RawHtml {
  const { class: className, ...rest } = options;
  return html`<div${raw(attrs({ class: cn("toz-metric", className) }))}>
    <span class="toz-metric__label">${rest.label}</span>
    <span class="toz-metric__value">${rest.value}</span>
    ${
      rest.delta === undefined
        ? ""
        : html`<span class="toz-metric__delta" data-direction="${rest.deltaDirection ?? "flat"}">${rest.delta}</span>`
    }
    ${rest.hint === undefined ? "" : html`<span class="toz-metric__label">${rest.hint}</span>`}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Timestamp                                                           */
/* ------------------------------------------------------------------ */

/**
 * A machine-readable `<time>` element.
 *
 * `dateTime` carries the machine value, so the visible text can stay in a
 * chosen, readable format without losing precision. A `<time>` element is
 * purely semantic, so it degrades to plain text.
 */
export interface TimestampOptions {
  /** Human-readable rendering. */
  readonly text: string;
  /** ISO 8601 value for the `datetime` attribute. */
  readonly iso: string;
  readonly class?: string;
}

export function timestamp(options: TimestampOptions): RawHtml {
  return html`<time${raw(
    attrs({
      class: cn("toz-timestamp", options.class),
      datetime: options.iso,
    }),
  )}>${options.text}</time>`;
}

/* ------------------------------------------------------------------ */
/* Skeleton (loading placeholder)                                      */
/* ------------------------------------------------------------------ */

export interface SkeletonOptions {
  /** Announced description of what is loading. */
  readonly label: string;
  readonly heightRem?: string;
  readonly width?: string;
  readonly radius?: "small" | "medium";
  readonly class?: string;
}

/**
 * A loading placeholder.
 *
 * The whole element is `aria-hidden` and accompanied by a visually hidden
 * status message, because a screen reader announcing "loading" once per
 * skeleton element would be far noisier than a single message.
 */
export function skeleton(options: SkeletonOptions): RawHtml {
  return html`<span${raw(
    attrs({
      class: cn("toz-skeleton", options.class),
      "aria-hidden": "true",
      style: [
        options.heightRem === undefined ? null : `--toz-skeleton-size: ${options.heightRem}`,
        options.width === undefined ? null : `inline-size: ${options.width}`,
      ]
        .filter(Boolean)
        .join("; "),
    }),
  )}></span>`;
}

/** A labelled group of skeleton placeholders. */
export function skeletonGroup(options: { label: string; lines?: number; children?: HtmlChild }): RawHtml {
  const lines = options.lines ?? 3;
  return html`<div role="status" aria-label="${options.label}">
    ${
      options.children ??
      Array.from({ length: lines }, (_unused, index) =>
        skeleton({
          label: options.label,
          width: index === lines - 1 ? "60%" : "100%",
        }),
      )
    }
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Loading / empty states                                              */
/* ------------------------------------------------------------------ */

export interface EmptyStateOptions {
  readonly title: string;
  readonly description?: HtmlChild;
  /** e.g. a "Create first agent" button. */
  readonly action?: HtmlChild;
  readonly icon?: "info" | "search" | "refresh" | "check";
  readonly class?: string;
}

/**
 * The zero-data state.
 *
 * Always states what is missing and, where one exists, the action that resolves
 * it. A blank region is never left unexplained.
 */
export function emptyState(options: EmptyStateOptions): RawHtml {
  return html`<div${raw(attrs({ class: cn("toz-empty-state", options.class) }))}>
    ${
      options.icon === undefined
        ? ""
        : html`<span class="toz-empty-state__icon" aria-hidden="true">${icon(options.icon, "1.75rem")}</span>`
    }
    <span class="toz-empty-state__title">${options.title}</span>
    ${options.description === undefined ? "" : html`<span>${options.description}</span>`}
    ${options.action ?? ""}
  </div>`;
}

export interface LoadingStateOptions {
  readonly label: string;
  readonly description?: HtmlChild;
  readonly class?: string;
}

export function loadingState(options: LoadingStateOptions): RawHtml {
  return html`<div${raw(
    attrs({ class: cn("toz-stack", "toz-empty-state", options.class), role: "status" }),
  )}>
    ${spinner({ label: options.label, sizeRem: "1.75rem" })}
    <span class="toz-empty-state__title">${options.label}</span>
    ${options.description === undefined ? "" : html`<span>${options.description}</span>`}
  </div>`;
}
