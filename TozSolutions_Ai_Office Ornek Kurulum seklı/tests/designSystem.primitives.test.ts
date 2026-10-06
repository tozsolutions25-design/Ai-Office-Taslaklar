import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUTTON_VARIANTS,
  ICON_PATHS,
  button,
  icon,
  iconButton,
  toneIcon,
} from "../src/design-system/primitives/button.js";
import {
  DISABLED_LINK_CLASS,
  LINK_VARIANTS,
  disabledLink,
  link,
} from "../src/design-system/primitives/link.js";
import { CARD_TONES, card, cardBody, cardFooter, cardHeader } from "../src/design-system/primitives/card.js";
import { badge } from "../src/design-system/primitives/status.js";
import { html, toHtmlString } from "../src/design-system/utils/html.js";

const out = (value: ReturnType<typeof button>): string => toHtmlString(value);

describe("button variants", () => {
  it("renders a real button element for an action", () => {
    const rendered = out(button({ children: "Save" }));
    assert.match(rendered, /^<button /);
    assert.ok(rendered.includes(">Save</span>"), "the label must be rendered");
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    assert.ok(out(button({ children: "x" })).includes('type="button"'));
  });

  it("honours an explicit submit type", () => {
    assert.ok(out(button({ children: "x", type: "submit" })).includes('type="submit"'));
  });

  it("renders an anchor when href is supplied", () => {
    const rendered = out(button({ children: "Go", href: "/docs" }));
    assert.match(rendered, /^<a /);
    assert.ok(rendered.includes('href="/docs"'));
    assert.ok(rendered.includes('role="button"'), "a link acting as a button needs the role");
  });

  it("supports every declared variant", () => {
    for (const variant of BUTTON_VARIANTS) {
      const rendered = out(button({ children: "x", variant }));
      assert.ok(rendered.includes(`data-variant="${variant}"`), `missing variant ${variant}`);
    }
  });

  it("defaults to the primary variant", () => {
    assert.ok(out(button({ children: "x" })).includes('data-variant="primary"'));
  });

  it("supports small, medium and large sizes", () => {
    assert.ok(out(button({ children: "x", size: "sm" })).includes('data-size="sm"'));
    assert.ok(out(button({ children: "x", size: "lg" })).includes('data-size="lg"'));
    assert.ok(out(button({ children: "x" })).includes('data-size="md"'));
  });

  it("supports a full-width variant for mobile CTAs", () => {
    assert.ok(out(button({ children: "x", fullWidth: true })).includes('data-full="true"'));
  });
});

describe("button states", () => {
  it("marks a disabled button with the native attribute", () => {
    assert.ok(out(button({ children: "x", disabled: true })).includes("disabled"));
  });

  it("marks a disabled link with aria-disabled and removes the href", () => {
    // A disabled anchor must not be navigable, so the href is dropped and the
    // state is announced instead.
    const rendered = out(button({ children: "x", href: "/x", disabled: true }));
    assert.ok(rendered.includes('aria-disabled="true"'));
    assert.equal(rendered.includes('href="/x"'), false, "a disabled link must not keep its href");
  });

  it("communicates a loading state and blocks activation", () => {
    const rendered = out(button({ children: "Saving", loading: true }));
    assert.ok(rendered.includes('data-loading="true"'));
    assert.ok(rendered.includes('aria-busy="true"'));
    assert.ok(rendered.includes("disabled"), "a loading button must not be activatable");
  });

  it("keeps the visible label during loading", () => {
    const rendered = out(button({ children: "Saving", loading: true }));
    assert.ok(rendered.includes("Saving"), "the label must remain visible");
  });

  it("announces a loading state to assistive technology", () => {
    const rendered = out(button({ children: "Saving", loading: true, loadingLabel: "Saving changes" }));
    assert.ok(rendered.includes("Saving changes"));
    assert.ok(rendered.includes("toz-visually-hidden"));
  });

  it("hides the decorative spinner from assistive technology", () => {
    const rendered = out(button({ children: "x", loading: true }));
    assert.ok(rendered.includes('aria-hidden="true"'), "the spinner is decorative and must be hidden");
  });

  it("treats loading as implying disabled", () => {
    assert.ok(out(button({ children: "x", loading: true })).includes("disabled"));
  });
});

describe("icon buttons", () => {
  it("requires an accessible name and applies it", () => {
    const rendered = toHtmlString(iconButton({ ariaLabel: "Close panel", icon: ICON_PATHS.close }));
    assert.ok(rendered.includes('aria-label="Close panel"'));
  });

  it("hides the icon glyph from assistive technology", () => {
    const rendered = toHtmlString(iconButton({ ariaLabel: "Close", icon: ICON_PATHS.close }));
    assert.ok(rendered.includes('aria-hidden="true"'));
    assert.ok(rendered.includes('focusable="false"'), "inline SVG must not be a focus target");
  });

  it("does not replace a required label with an icon", () => {
    // An icon-only control without a name is unusable, so `ariaLabel` is
    // required by the type; here we assert the name reaches the output.
    const rendered = toHtmlString(iconButton({ ariaLabel: "Refresh status", icon: ICON_PATHS.refresh }));
    assert.ok(rendered.includes("Refresh status"));
  });

  it("uses consistent 1em sizing so icons align with text", () => {
    const rendered = toHtmlString(icon("check"));
    assert.ok(rendered.includes('width="1em"'));
    assert.ok(rendered.includes('height="1em"'));
    assert.ok(rendered.includes('viewBox="0 0 24 24"'));
  });

  it("scales an icon on request", () => {
    assert.ok(toHtmlString(icon("info", "1.75rem")).includes('width="1.75rem"'));
  });

  it("maps each alert tone to a distinct icon", () => {
    const rendered = ["info", "success", "warning", "error"].map((tone) =>
      toHtmlString(toneIcon(tone as "info" | "success" | "warning" | "error")),
    );
    assert.equal(new Set(rendered).size, 4, "each tone needs a visually distinct icon");
  });
});

describe("links", () => {
  it("supports every declared variant", () => {
    for (const variant of LINK_VARIANTS) {
      assert.ok(toHtmlString(link({ href: "/x", children: "x", variant })).includes(`data-variant="${variant}"`));
    }
  });

  it("marks the current page with aria-current=page", () => {
    const rendered = toHtmlString(link({ href: "/x", children: "x", variant: "nav", current: true }));
    assert.ok(rendered.includes('aria-current="page"'), "presence alone would be ambiguous");
  });

  it("omits aria-current on an inactive link", () => {
    assert.equal(toHtmlString(link({ href: "/x", children: "x" })).includes("aria-current"), false);
  });

  it("adds safe rel and target for external links", () => {
    const rendered = toHtmlString(link({ href: "https://example.com", children: "x", external: true }));
    assert.ok(rendered.includes('target="_blank"'));
    assert.ok(rendered.includes('rel="noopener noreferrer"'), "new-tab links must not leak the opener");
  });

  it("distinguishes external links visually, not only by colour", () => {
    assert.ok(toHtmlString(link({ href: "https://x.com", children: "x", external: true })).includes('data-external="true"'));
  });

  it("does not add target or rel to an internal link", () => {
    const rendered = toHtmlString(link({ href: "/x", children: "x" }));
    assert.equal(rendered.includes("_blank"), false);
    assert.equal(rendered.includes("rel="), false);
  });

  it("renders a non-existent link as inert text rather than a dead anchor", () => {
    const rendered = toHtmlString(disabledLink({ children: "Coming soon" }));
    assert.equal(rendered.includes("<a"), false, "a dead anchor must not be rendered");
    assert.ok(rendered.includes('aria-disabled="true"'));
  });

  it("keeps the disabled-link class consistent", () => {
    assert.ok(DISABLED_LINK_CLASS.length > 0);
  });
});

describe("card composition", () => {
  it("renders no header when there is no title, description or status", () => {
    const rendered = toHtmlString(card({ children: "body" }));
    assert.equal(rendered.includes("toz-card__header"), false, "an empty header must not be emitted");
  });

  it("renders a header when a title is present", () => {
    const rendered = toHtmlString(card({ title: "Agent" }));
    assert.ok(rendered.includes("toz-card__header"));
    assert.ok(rendered.includes("Agent"));
  });

  it("uses the requested heading level so the page outline stays correct", () => {
    for (const level of [2, 3, 4] as const) {
      assert.ok(toHtmlString(card({ title: "T", headingLevel: level })).includes(`<h${level} class="toz-card__title"`));
    }
  });

  it("renders title, description, body and footer together", () => {
    const rendered = toHtmlString(
      card({
        title: "Queue",
        description: "Pending tasks",
        children: "content",
        footer: "footer",
      }),
    );
    for (const fragment of ["Queue", "Pending tasks", "content", "footer"]) {
      assert.ok(rendered.includes(fragment), `missing ${fragment}`);
    }
    for (const slot of ["toz-card__header", "toz-card__body", "toz-card__footer"]) {
      assert.ok(rendered.includes(slot), `missing slot ${slot}`);
    }
  });

  it("renders a status slot above the title", () => {
    const rendered = toHtmlString(card({ title: "Queue", status: toHtmlString(badge({ children: "Live" })) }));
    assert.ok(rendered.indexOf("Live") < rendered.indexOf("Queue"), "status must precede the title");
  });

  it("renders media above the header", () => {
    const rendered = toHtmlString(
      card({ title: "T", media: { src: "/a.webp", alt: "A" } }),
    );
    assert.ok(rendered.indexOf("<img") < rendered.indexOf("toz-card__header"));
  });

  it("renders the requested element", () => {
    assert.match(toHtmlString(card({ as: "div" })), /^<div/);
    assert.match(toHtmlString(card({ as: "li" })), /^<li/);
    assert.match(toHtmlString(card({ as: "article" })), /^<article/);
  });

  it("supports each tone", () => {
    for (const tone of CARD_TONES) {
      const rendered = toHtmlString(card({ tone, title: "x" }));
      if (tone === "default") {
        assert.equal(rendered.includes("data-tone"), false, "the default tone should not be serialised");
      } else {
        assert.ok(rendered.includes(`data-tone="${tone}"`));
      }
    }
  });

  it("marks interactive cards only when asked", () => {
    assert.equal(toHtmlString(card({ title: "x" })).includes("data-interactive"), false);
    assert.ok(toHtmlString(card({ title: "x", interactive: true })).includes('data-interactive="true"'));
  });

  it("escapes caller-supplied content", () => {
    const rendered = toHtmlString(card({ title: "<script>alert(1)</script>" }));
    assert.equal(rendered.includes("<script>"), false, "card content must be escaped");
  });

  it("exposes the individual slots for custom composition", () => {
    assert.ok(toHtmlString(cardHeader({ children: "h" })).includes("toz-card__header"));
    assert.ok(toHtmlString(cardBody({ children: "b" })).includes("toz-card__body"));
    assert.ok(toHtmlString(cardFooter({ children: "f" })).includes("toz-card__footer"));
  });

  it("composes fragments passed as children", () => {
    const rendered = toHtmlString(card({ children: html`<p>nested</p>` }));
    assert.ok(rendered.includes("<p>nested</p>"));
  });
});
