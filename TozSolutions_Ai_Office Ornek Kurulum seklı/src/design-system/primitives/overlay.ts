/**
 * Overlay primitives.
 *
 * Built on PLATFORM behaviour rather than a library:
 *
 *  - `dialog()` renders a native `<dialog>`. Focus trapping, inert background
 *    content, Escape-to-close, the top layer and the correct stacking context
 *    are all provided by the browser, so no focus-management dependency is
 *    needed and no behaviour has to be reimplemented.
 *  - `popover()` uses the native `popover` attribute, which also needs no
 *    JavaScript to open and close and is keyboard accessible.
 *  - `tooltip()` is CSS-only, driven by `:hover` and `:focus-within`.
 *
 * `openDialogEnhancer()` is the ONE place JavaScript is required, and it is
 * exported rather than inlined so a strict Content-Security-Policy page can
 * decide whether to serve it, externalise it, or open dialogs another way.
 */

import { cn } from "../utils/cn.js";
import { attrs, html, raw, type HtmlChild, type RawHtml } from "../utils/html.js";
import { icon } from "./button.js";

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export interface DialogOptions {
  /**
   * DOM id of the dialog. A trigger references it with `data-dialog-open`, so
   * the id is the wiring between the two and is required.
   */
  readonly id: string;
  readonly title: HtmlChild;
  readonly children: HtmlChild;
  /** Actions, usually buttons. Right-aligned and wrapping on narrow screens. */
  readonly footer?: HtmlChild;
  /** Renders the close affordance. Defaults to true. */
  readonly closable?: boolean;
  /** Native dialog display. `modal` traps focus; `auto` does not. */
  readonly mode?: "modal" | "auto";
  readonly class?: string;
}

export function dialog(options: DialogOptions): RawHtml {
  const { children, class: className, ...rest } = options;
  const headingId = `${rest.id}-title`;
  const closable = rest.closable !== false;

  return html`<dialog${raw(
    attrs({
      class: cn("toz-dialog", className),
      id: rest.id,
      "aria-labelledby": headingId,
      // A modal dialog must not be dismissible by clicking the backdrop, which
      // is the platform default for `showModal()` and therefore needs no
      // configuration here.
    }),
  )}>
    <div class="toz-dialog__header">
      <h2 class="toz-dialog__title" id="${headingId}">${rest.title}</h2>
      ${
        closable
          ? html`<button type="button" class="toz-dialog__close" data-dialog-close="${rest.id}" aria-label="Close dialog">${icon(
              "close",
              "1.125rem",
            )}</button>`
          : ""
      }
    </div>
    <div class="toz-dialog__body">${children}</div>
    ${rest.footer === undefined ? "" : html`<div class="toz-dialog__footer">${rest.footer}</div>`}
  </dialog>`;
}

export interface ConfirmDialogOptions {
  readonly id: string;
  readonly title: HtmlChild;
  readonly children: HtmlChild;
  /** Label for the confirming action, e.g. "Delete agent". */
  readonly confirmLabel: string;
  /** Label for the cancelling action. Defaults to "Cancel". */
  readonly cancelLabel?: string;
  /**
   * Renders the confirm action as destructive. Use for anything irreversible.
   * Note this is presentation only: the caller is responsible for requiring
   * confirmation of the actual operation.
   */
  readonly destructive?: boolean;
  readonly class?: string;
}

/**
 * A confirmation dialog.
 *
 * The confirm button is NOT autofocused: the safe action should receive initial
 * focus, so a stray Enter press cannot delete something.
 */
export function confirmDialog(options: ConfirmDialogOptions): RawHtml {
  const { children, class: className, ...rest } = options;
  return dialog({
    id: rest.id,
    title: rest.title,
    children,
    footer: html`<button
        type="button"
        class="toz-button"
        data-variant="ghost"
        data-dialog-close="${rest.id}"
      >${rest.cancelLabel ?? "Cancel"}</button><button
        type="button"
        class="toz-button"
        data-variant="${rest.destructive === true ? "destructive" : "primary"}"
        data-dialog-confirm="${rest.id}"
      >${rest.confirmLabel}</button>`,
    class: className,
  });
}

/**
 * A small script that wires dialog triggers.
 *
 * Kept deliberately tiny and dependency-free. It:
 *  - opens the dialog named by a `data-dialog-open` attribute,
 *  - closes on `data-dialog-close`,
 *  - closes on backdrop click for `method="dialog"`-free dialogs,
 *  - restores focus to the trigger on close, which the platform does not do
 *    automatically once the element is removed from the top layer.
 *
 * Emitted as a string so the consuming page decides how to deliver it.
 */
export function openDialogEnhancer(): string {
  return `(() => {
  const show = (id) => {
    const el = document.getElementById(id);
    if (el && typeof el.showModal === "function") el.showModal();
    else if (el) el.setAttribute("open", "");
  };
  const hide = (id) => {
    const el = document.getElementById(id);
    if (el && typeof el.close === "function") el.close();
    else if (el) el.removeAttribute("open");
  };
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const opener = target.closest("[data-dialog-open]");
    if (opener) {
      const id = opener.getAttribute("data-dialog-open");
      if (id) {
        opener.setAttribute("data-dialog-return-focus", "true");
        show(id);
      }
      return;
    }
    const closer = target.closest("[data-dialog-close]");
    if (closer) {
      const id = closer.getAttribute("data-dialog-close");
      if (id) hide(id);
      return;
    }
    const dialog = target.closest("dialog[open]");
    if (dialog && event.target === dialog) hide(dialog.id);
  });
  document.addEventListener("close", (event) => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLElement)) return;
    const id = dialog.getAttribute("data-dialog-return-focus");
    if (id === "true") {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.focus();
    }
  }, true);
})();`;
}

/* ------------------------------------------------------------------ */
/* Popover                                                             */
/* ------------------------------------------------------------------ */

export interface PopoverOptions {
  readonly id: string;
  readonly title?: HtmlChild;
  readonly children: HtmlChild;
  /** `auto` positions like a tooltip; `manual` lets the author place it. */
  readonly placement?: "bottom" | "right" | "manual";
  readonly class?: string;
}

/**
 * A native popover.
 *
 * The trigger uses `popovertarget`, so opening and closing work with a single
 * attribute and no script, and the platform handles light-dismiss and Escape.
 */
export function popover(options: PopoverOptions): RawHtml {
  const { children, class: className, ...rest } = options;
  return html`<div${raw(
    attrs({
      class: cn("toz-popover", className),
      id: rest.id,
      popover: rest.placement === "manual" ? "manual" : "auto",
      role: "dialog",
      "aria-label": rest.title === undefined ? undefined : String(rest.title),
    }),
  )}>${rest.title === undefined ? "" : html`<div class="toz-alert__title">${rest.title}</div>`}${children}</div>`;
}

/** The trigger that opens a `popover()`. */
export function popoverTrigger(options: { targetId: string; children: HtmlChild; class?: string }): RawHtml {
  return html`<button${raw(
    attrs({
      type: "button",
      class: cn("toz-button", options.class),
      "data-variant": "ghost",
      popovertarget: options.targetId,
    }),
  )}>${options.children}</button>`;
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

export interface TooltipOptions {
  /** The trigger content. */
  readonly children: HtmlChild;
  /** The explanation. This is the tooltip's only accessible text. */
  readonly content: string;
  /** `top` for icon-only controls, where there is nowhere else for the text. */
  readonly placement?: "top";
  readonly class?: string;
}

/**
 * A CSS-only tooltip.
 *
 * The text is `aria-hidden` and the trigger must carry its own accessible name:
 * a tooltip is a visual affordance, and screen-reader users get the label
 * instead. That is why `content` is required but not announced.
 */
export function tooltip(options: TooltipOptions): RawHtml {
  return html`<span${raw(attrs({ class: cn("toz-tooltip-anchor", options.class) }))}>
    ${options.children}
    <span class="toz-tooltip" role="tooltip" aria-hidden="true">${options.content}</span>
  </span>`;
}
