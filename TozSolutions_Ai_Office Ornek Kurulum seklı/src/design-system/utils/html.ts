/**
 * HTML composition helpers.
 *
 * The design system renders to HTML **strings** rather than to a framework
 * tree. This is a deliberate architectural choice, not a shortcut:
 *
 *  - It adds zero runtime dependencies (see PROJECT_STATE.md AD-19).
 *  - Output is server-renderable, so future marketing, product and
 *    documentation pages do not need to ship a component runtime to the
 *    browser.
 *  - It is testable without a DOM, because the unit under test is the markup
 *    itself. No jsdom, no happy-dom, no browser.
 *
 * Safety: every interpolated value is HTML-escaped unless it is explicitly
 * wrapped in `raw()`. `raw()` is the ONLY escape hatch, and it is used solely
 * for markup produced by this design system, so the boundary is auditable.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/** Markup that is already safe and must not be escaped again. */
export class RawHtml {
  public readonly value: string;

  public constructor(value: string) {
    this.value = value;
  }

  public toString(): string {
    return this.value;
  }
}

/**
 * Marks a string as trusted markup.
 *
 * Only ever call this with markup this design system produced. Passing
 * user-supplied input defeats HTML escaping and is a cross-site-scripting
 * risk.
 */
export function raw(markup: string): RawHtml {
  return new RawHtml(markup);
}

/** Anything accepted as a child in composition. */
export type HtmlChild = RawHtml | string | number | boolean | null | undefined | readonly HtmlChild[];

/** A rendered fragment. */
export type Html = RawHtml;

/** Unwraps a value to a plain HTML string. */
export function toHtmlString(value: Html | string): string {
  return value instanceof RawHtml ? value.value : value;
}

function renderChild(child: HtmlChild): string {
  if (child === null || child === undefined || child === false || child === true) {
    // `false` is the idiomatic "render nothing" in template composition; `true`
    // is treated the same way so a stray boolean cannot leak the word "true".
    return "";
  }
  if (child instanceof RawHtml) {
    return child.value;
  }
  if (Array.isArray(child)) {
    return (child as readonly HtmlChild[]).map(renderChild).join("");
  }
  return escapeHtml(String(child));
}

/**
 * Tagged template that escapes every interpolation.
 *
 * Nested `html` results and `RawHtml` values pass through unescaped, which is
 * what makes components safely composable.
 */
export function html(strings: TemplateStringsArray, ...values: readonly HtmlChild[]): RawHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i += 1) {
    out += renderChild(values[i]);
    out += strings[i + 1] ?? "";
  }
  return new RawHtml(out);
}

export type AttributeValue = string | number | boolean | null | undefined | readonly string[];

/**
 * Serialises an attribute map.
 *
 * `false`, `null` and `undefined` omit the attribute entirely, so boolean
 * attributes are declared simply by their presence. `class` accepts an array
 * for convenience. Keys are escaped; values are escaped.
 */
export function attrs(map: Readonly<Record<string, AttributeValue>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (value === true) {
      parts.push(` ${escapeHtml(key)}`);
      continue;
    }
    const rendered = Array.isArray(value) ? value.filter(Boolean).join(" ") : String(value);
    if (rendered === "") {
      continue;
    }
    parts.push(` ${escapeHtml(key)}="${escapeHtml(rendered)}"`);
  }
  return parts.join("");
}
