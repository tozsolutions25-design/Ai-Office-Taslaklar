import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RawHtml} from "../src/design-system/utils/html.js";
import { attrs, escapeHtml, html, raw, toHtmlString } from "../src/design-system/utils/html.js";
import { cn } from "../src/design-system/utils/cn.js";

/** Renders a fragment to a string for assertions. */
const out = (value: RawHtml | string): string => toHtmlString(value);

describe("HTML escaping", () => {
  it("escapes the characters that can break out of markup", () => {
    assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
    assert.equal(escapeHtml('a"b'), "a&quot;b");
    assert.equal(escapeHtml("a'b"), "a&#39;b");
    assert.equal(escapeHtml("a&b"), "a&amp;b");
  });

  it("escapes the ampersand first so entities are not double-mangled", () => {
    // Order matters: if `<` were escaped before `&`, the produced `&lt;`
    // would itself be re-escaped into `&amp;lt;`.
    assert.equal(escapeHtml("<&>"), "&lt;&amp;&gt;");
  });

  it("escapes interpolated values", () => {
    const rendered = out(html`<p>${"<img onerror=alert(1)>"}</p>`);
    assert.equal(rendered, "<p>&lt;img onerror=alert(1)&gt;</p>");
    assert.equal(rendered.includes("<img"), false);
  });

  it("does not double-escape a nested fragment", () => {
    const inner = html`<b>${"bold"}</b>`;
    assert.equal(out(html`<p>${inner}</p>`), "<p><b>bold</b></p>");
  });

  it("renders nothing for null, undefined and false", () => {
    assert.equal(out(html`<p>${null}${undefined}${false}</p>`), "<p></p>");
  });

  it("renders zero and empty string faithfully", () => {
    assert.equal(out(html`<p>${0}${""}</p>`), "<p>0</p>");
  });

  it("flattens arrays of children", () => {
    const items = ["a", "b", "c"];
    assert.equal(out(html`<ul>${items.map((item) => html`<li>${item}</li>`)}</ul>`), "<ul><li>a</li><li>b</li><li>c</li></ul>");
  });

  it("passes raw() through unescaped", () => {
    assert.equal(out(html`<div>${raw("<hr />")}</div>`), "<div><hr /></div>");
  });

  it("preserves static markup in the template", () => {
    assert.equal(out(html`<a href="/x">go</a>`), '<a href="/x">go</a>');
  });
});

describe("attribute serialisation", () => {
  it("omits null, undefined and false", () => {
    assert.equal(attrs({ a: null, b: undefined, c: false, d: "x" }), ' d="x"');
  });

  it("renders a valueless attribute for true", () => {
    assert.equal(attrs({ disabled: true }), " disabled");
  });

  it("escapes keys and values", () => {
    assert.equal(attrs({ 'data-x"': 'a"b' }), ' data-x&quot;="a&quot;b"');
  });

  it("joins array values", () => {
    assert.equal(attrs({ class: ["a", "", "b"] }), ' class="a b"');
  });

  it("omits an attribute whose value stringifies to empty", () => {
    assert.equal(attrs({ class: [] }), "");
    assert.equal(attrs({ value: "" }), "");
  });

  it("serialises numbers", () => {
    assert.equal(attrs({ tabindex: 1 }), ' tabindex="1"');
  });

  it("returns an empty string for an empty map", () => {
    assert.equal(attrs({}), "");
  });
});

describe("class composition", () => {
  it("joins strings", () => {
    assert.equal(cn("a", "b"), "a b");
  });

  it("drops falsy values", () => {
    assert.equal(cn("a", false, null, undefined, "", "b"), "a b");
  });

  it("applies conditional maps", () => {
    assert.equal(cn({ a: true, b: false, c: true }), "a c");
  });

  it("flattens nested arrays", () => {
    assert.equal(cn(["a", ["b", { c: true }]]), "a b c");
  });

  it("removes duplicates so a passed class cannot be doubled", () => {
    assert.equal(cn("a", "a", { a: true }), "a");
  });

  it("preserves order of first appearance", () => {
    assert.equal(cn("z", "a", "z"), "z a");
  });

  it("returns an empty string when given nothing", () => {
    assert.equal(cn(), "");
  });

  it("includes numeric class names", () => {
    assert.equal(cn(1, "a"), "1 a");
  });
});
