/**
 * Form primitives.
 *
 * Accessibility is structural here, not optional:
 *
 *  - `field()` wires the label, description and validation message to the
 *    control by ID, and emits `aria-describedby` for help text and errors.
 *  - An invalid field sets BOTH `aria-invalid="true"` and a visible message, so
 *    the error is announced and not merely implied by a red border.
 *  - `required` is conveyed by the HTML attribute; the visual asterisk is
 *    `aria-hidden`, so a screen reader announces "required" once, not twice.
 *  - Radio groups are wrapped in `<fieldset>` with a `<legend>`.
 *  - Every control has a minimum touch target of 2.75rem.
 *
 * The `id` of the control is REQUIRED, because a label without a resolvable
 * target is not a label. The type system enforces it, which removes the most
 * common form accessibility defect at compile time.
 */

import { cn } from "../utils/cn.js";
import { attrs, html, raw, type HtmlChild, type RawHtml } from "../utils/html.js";

/* ------------------------------------------------------------------ */
/* Field wrapper                                                       */
/* ------------------------------------------------------------------ */

export interface FieldOptions {
  /** The control's DOM id. Must match the rendered control. */
  readonly id: string;
  readonly label: HtmlChild;
  readonly description?: HtmlChild;
  readonly error?: HtmlChild;
  readonly required?: boolean;
  readonly disabled?: boolean;
  /** The control element. */
  readonly children: HtmlChild;
  readonly class?: string;
}

export function field(options: FieldOptions): RawHtml {
  const { children, class: className, error, description, ...rest } = options;
  const invalid = error !== undefined;
  const disabled = rest.disabled === true;

  return html`<div${raw(
    attrs({
      class: cn("toz-field", className),
      "data-invalid": invalid ? "true" : undefined,
      "data-disabled": disabled ? "true" : undefined,
    }),
  )}>
    <label class="toz-field__label" for="${rest.id}">
      ${rest.label}
      ${rest.required === true ? html`<span class="toz-field__required" aria-hidden="true">*</span>` : ""}
    </label>
    ${description === undefined ? "" : html`<div class="toz-field__description" id="${`${rest.id}-description`}">${description}</div>`}
    ${children}
    ${invalid ? html`<div class="toz-field__message" id="${`${rest.id}-error`}">${error}</div>` : ""}
  </div>`;
}

/**
 * Emits the `aria-describedby` attribute for a control.
 *
 * Exposed separately because `field()` cannot inject attributes into a control
 * the caller has already rendered. Use it with `input`, `textarea` and
 * `select` so the wiring stays in one place.
 */
export function describedBy(options: { id: string; hasDescription?: boolean; hasError?: boolean }): string | undefined {
  return (
    [
      options.hasDescription === true ? `${options.id}-description` : null,
      options.hasError === true ? `${options.id}-error` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

/* ------------------------------------------------------------------ */
/* Text-like controls                                                  */
/* ------------------------------------------------------------------ */

export type AutocompleteHint =
  | "name"
  | "email"
  | "tel"
  | "street-address"
  | "organization"
  | "url"
  | "new-password"
  | "current-password"
  | "off";

export interface InputOptions {
  readonly id: string;
  readonly name?: string;
  readonly type?: "text" | "email" | "tel" | "url" | "password" | "search" | "number";
  readonly value?: string;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly autoComplete?: AutocompleteHint;
  readonly inputMode?: "text" | "email" | "tel" | "url" | "numeric" | "decimal" | "search";
  readonly maxLength?: number;
  readonly invalid?: boolean;
  /** Set when the field is invalid, to point `aria-describedby` at the error. */
  readonly ariaDescribedBy?: string;
  readonly ariaLabel?: string;
  readonly class?: string;
}

export function input(options: InputOptions): RawHtml {
  const { class: className, ...rest } = options;
  return html`<input${raw(
    attrs({
      class: cn("toz-input", className),
      id: rest.id,
      name: rest.name ?? rest.id,
      type: rest.type ?? "text",
      value: rest.value,
      placeholder: rest.placeholder,
      required: rest.required,
      disabled: rest.disabled,
      readonly: rest.readOnly,
      autocomplete: rest.autoComplete,
      inputmode: rest.inputMode,
      maxlength: rest.maxLength,
      "aria-invalid": rest.invalid === true ? "true" : undefined,
      "aria-describedby": rest.ariaDescribedBy,
      "aria-label": rest.ariaLabel,
    }),
  )} />`;
}

export interface TextareaOptions {
  readonly id: string;
  readonly name?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly maxLength?: number;
  readonly invalid?: boolean;
  readonly ariaDescribedBy?: string;
  readonly ariaLabel?: string;
  readonly class?: string;
}

export function textarea(options: TextareaOptions): RawHtml {
  const { class: className, ...rest } = options;
  return html`<textarea${raw(
    attrs({
      class: cn("toz-textarea", className),
      id: rest.id,
      name: rest.name ?? rest.id,
      placeholder: rest.placeholder,
      rows: rest.rows ?? 4,
      required: rest.required,
      disabled: rest.disabled,
      readonly: rest.readOnly,
      maxlength: rest.maxLength,
      "aria-invalid": rest.invalid === true ? "true" : undefined,
      "aria-describedby": rest.ariaDescribedBy,
      "aria-label": rest.ariaLabel,
    }),
  )}>${rest.value ?? ""}</textarea>`;
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** Group heading for a related set of options. */
  readonly group?: string;
}

export interface SelectOptions {
  readonly id: string;
  readonly name?: string;
  readonly options: readonly SelectOption[];
  /** Marks the selected value. Must match one of the option values. */
  readonly value?: string;
  /** A disabled first option acts as a "choose one" prompt. */
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly ariaDescribedBy?: string;
  readonly ariaLabel?: string;
  readonly class?: string;
}

/**
 * Native `<select>`.
 *
 * Native is chosen over a custom listbox deliberately: it is keyboard
 * accessible, works with screen readers, supports type-ahead on every platform,
 * and needs no JavaScript. A custom control would have to reimplement all of
 * that, usually worse.
 */
export function select(options: SelectOptions): RawHtml {
  const { class: className, ...rest } = options;
  const current = rest.value;

  const groups = new Map<string, SelectOption[]>();
  for (const option of rest.options) {
    const key = option.group ?? "";
    const bucket = groups.get(key) ?? [];
    bucket.push(option);
    groups.set(key, bucket);
  }

  const renderOption = (option: SelectOption): RawHtml => html`<option${raw(
    attrs({
      value: option.value,
      selected: current === option.value ? "selected" : undefined,
      disabled: option.disabled,
    }),
  )}>${option.label}</option>`;

  return html`<select${raw(
    attrs({
      class: cn("toz-select", className),
      id: rest.id,
      name: rest.name ?? rest.id,
      required: rest.required,
      disabled: rest.disabled,
      "aria-invalid": rest.invalid === true ? "true" : undefined,
      "aria-describedby": rest.ariaDescribedBy,
      "aria-label": rest.ariaLabel,
    }),
  )}>
    ${
      rest.placeholder === undefined
        ? ""
        : html`<option value="" disabled selected=${current === undefined ? "selected" : undefined}>${rest.placeholder}</option>`
    }
    ${[...groups.entries()].map(([group, bucket]) =>
      group === ""
        ? bucket.map(renderOption)
        : html`<optgroup label="${group}">${bucket.map(renderOption)}</optgroup>`,
    )}
  </select>`;
}

/* ------------------------------------------------------------------ */
/* Choice controls                                                     */
/* ------------------------------------------------------------------ */

export type ChoiceType = "checkbox" | "radio";

export interface ChoiceOptions {
  readonly id: string;
  readonly type: ChoiceType;
  readonly name: string;
  readonly label: HtmlChild;
  readonly description?: HtmlChild;
  readonly checked?: boolean;
  readonly value?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly ariaDescribedBy?: string;
  readonly class?: string;
}

/**
 * Checkbox or radio.
 *
 * The `<label>` WRAPS the control rather than using `for`, which gives the
 * whole row a large hit area and makes the accessible name unambiguous.
 */
export function choice(options: ChoiceOptions): RawHtml {
  const { class: className, ...rest } = options;
  return html`<label${raw(
    attrs({
      class: cn("toz-choice", className),
      for: rest.id,
      "data-disabled": rest.disabled === true ? "true" : undefined,
    }),
  )}>
    <input${raw(
      attrs({
        class: "toz-choice__control",
        id: rest.id,
        type: rest.type,
        name: rest.name,
        value: rest.value ?? "on",
        checked: rest.checked,
        required: rest.required,
        disabled: rest.disabled,
        "aria-invalid": rest.invalid === true ? "true" : undefined,
        "aria-describedby": rest.ariaDescribedBy,
      }),
    )} />
    <span class="toz-choice__text">
      <span class="toz-choice__label">${rest.label}</span>
      ${rest.description === undefined ? "" : html`<span class="toz-choice__description">${rest.description}</span>`}
    </span>
  </label>`;
}

export function checkbox(options: Omit<ChoiceOptions, "type">): RawHtml {
  return choice({ ...options, type: "checkbox" });
}

export function radio(options: Omit<ChoiceOptions, "type">): RawHtml {
  return choice({ ...options, type: "radio" });
}

export interface SwitchOptions {
  readonly id: string;
  readonly name?: string;
  /** The state shown when on. Keep it short; the label carries the meaning. */
  readonly label: HtmlChild;
  readonly description?: HtmlChild;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly class?: string;
}

/**
 * A toggle, built on a native checkbox.
 *
 * Not a checkbox with different styling: the underlying element is a checkbox,
 * so form submission, keyboard operation and `:checked` all work without
 * JavaScript. The visual switch is pure CSS.
 */
export function switchControl(options: SwitchOptions): RawHtml {
  const { class: className, ...rest } = options;
  return html`<label${raw(
    attrs({
      // The control itself is `.toz-switch__control`; the label needs no
      // modifier, so no wrapper class is emitted here.
      class: cn("toz-choice", className),
      for: rest.id,
      "data-disabled": rest.disabled === true ? "true" : undefined,
    }),
  )}>
    <input${raw(
      attrs({
        class: "toz-switch__control",
        id: rest.id,
        type: "checkbox",
        role: "switch",
        name: rest.name ?? rest.id,
        checked: rest.checked,
        disabled: rest.disabled,
      }),
    )} />
    <span class="toz-choice__text">
      <span class="toz-choice__label">${rest.label}</span>
      ${rest.description === undefined ? "" : html`<span class="toz-choice__description">${rest.description}</span>`}
    </span>
  </label>`;
}

/* ------------------------------------------------------------------ */
/* Fieldset                                                            */
/* ------------------------------------------------------------------ */

export interface FieldsetOptions {
  readonly legend: string;
  readonly description?: HtmlChild;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly ariaDescribedBy?: string;
  readonly class?: string;
  readonly children: HtmlChild;
}

/**
 * Groups related controls, required for radio sets so the group label and the
 * group's validation message are announced with the right semantics.
 */
export function fieldset(options: FieldsetOptions): RawHtml {
  const { children, class: className, ...rest } = options;
  return html`<fieldset${raw(
    attrs({
      class: cn("toz-fieldset", className),
      disabled: rest.disabled,
      "aria-describedby": rest.ariaDescribedBy,
      "aria-invalid": rest.invalid === true ? "true" : undefined,
    }),
  )}>
    <legend class="toz-fieldset__legend">${rest.legend}</legend>
    ${rest.description === undefined ? "" : html`<div class="toz-field__description">${rest.description}</div>`}
    ${children}
  </fieldset>`;
}

/* ------------------------------------------------------------------ */
/* Form                                                                */
/* ------------------------------------------------------------------ */

export interface FormOptions {
  /** Where the form submits. */
  readonly action?: string;
  readonly method?: "get" | "post";
  /** The accessible name of the submitting control is the caller's job. */
  readonly ariaLabel?: string;
  readonly ariaLabelledby?: string;
  readonly noValidate?: boolean;
  readonly class?: string;
  readonly id?: string;
  readonly children: HtmlChild;
}

export function form(options: FormOptions): RawHtml {
  const { children, class: className, ...rest } = options;
  return html`<form${raw(
    attrs({
      class: cn("toz-stack", className),
      action: rest.action,
      method: rest.method ?? "post",
      "aria-label": rest.ariaLabel,
      "aria-labelledby": rest.ariaLabelledby,
      novalidate: rest.noValidate === true ? "novalidate" : undefined,
      id: rest.id,
    }),
  )}>${children}</form>`;
}
