import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  ARCHITECTURE,
  CAPABILITIES,
  FOOTER,
  FOOTER_NAVIGATION,
  HERO,
  HOW_IT_WORKS,
  NAVIGATION,
  NEXT_STEP,
  RELIABILITY,
  ROUTE_PATHS,
  SECTION_IDS,
  VALUE_PROPOSITION,
} from "../src/site/content.js";
import { REGISTERED_PATHS } from "../src/site/routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");

/** Every visible string rendered on the homepage, lowercased for scanning. */
function visibleCopy(): string {
  const records = [
    HERO,
    VALUE_PROPOSITION,
    HOW_IT_WORKS,
    ARCHITECTURE,
    RELIABILITY,
    NEXT_STEP,
    FOOTER,
    ...CAPABILITIES,
    ...HOW_IT_WORKS.steps,
    ...RELIABILITY.principles,
    ...VALUE_PROPOSITION.items,
    ...ARCHITECTURE.layers,
    ...NAVIGATION.items,
  ];
  const text = JSON.stringify(records).toLowerCase();
  return text;
}

describe("content integrity: no fabricated claims", () => {
  const copy = visibleCopy();

  it("contains no percentage or ratio claims", () => {
    const percentages = copy.match(/\d+(\.\d+)?\s*%/g) ?? [];
    assert.deepEqual(percentages, [], `numerical performance claims found: ${percentages.join(", ")}`);
  });

  it("contains no multipliers or scale claims", () => {
    const multiples = copy.match(/\b\d+(\.\d+)?\s*(x|×)\b/g) ?? [];
    assert.deepEqual(multiples, [], `multiplier claims found: ${multiples.join(", ")}`);
  });

  it("makes no statement about customer counts, revenue or scale", () => {
    // Matched as whole words: a substring test flags "arr" inside "array" and
    // "users" inside "users of a capability", which are not claims.
    for (const phrase of [
      "customers",
      "clients",
      "users",
      "companies",
      "teams trust",
      "revenue",
      "arr",
      "million",
      "billion",
      "thousands",
    ]) {
      assert.equal(
        new RegExp(`\\b${phrase}\\b`).test(copy),
        false,
        `unsupported scale claim: "${phrase}"`,
      );
    }
  });

  it("makes no statement about performance, uptime or speed", () => {
    for (const phrase of [
      "uptime",
      "faster",
      "speed up",
      "10x",
      "latency reduction",
      "guaranteed",
      "always available",
      "zero downtime",
    ]) {
      assert.equal(copy.includes(phrase), false, `unsupported performance claim: "${phrase}"`);
    }
  });

  it("contains no testimonials, ratings or review platforms", () => {
    // "review" is deliberately NOT in this list: the process copy legitimately
    // uses "Results are checked" and "reviewed". What must not appear is a
    // claim ABOUT reviews, which would be a testimonial or a rating.
    for (const phrase of ["testimonial", "rated", "stars", "capterra", "g2 crowd", "five star"]) {
      assert.equal(
        new RegExp(`\\b${phrase}\\b`).test(copy),
        false,
        `unsupported social proof: "${phrase}"`,
      );
    }
  });

  it("makes no claim about the reviews or ratings it received", () => {
    for (const phrase of ["customer review", "user review", "reviews from", "rated by", "review score"]) {
      assert.equal(copy.includes(phrase), false, `unsupported review claim: "${phrase}"`);
    }
  });

  it("contains no awards, certifications or compliance claims", () => {
    for (const phrase of [
      "award",
      "certified",
      "certification",
      "iso 27001",
      "soc 2",
      "gdpr",
      "compliant",
      "hipaa",
    ]) {
      assert.equal(copy.includes(phrase), false, `unsupported certification claim: "${phrase}"`);
    }
  });

  it("contains no partnership or media claims", () => {
    // Whole words: "press" is a substring of "pressure", which the copy uses to
    // describe resource contention.
    for (const phrase of ["partner", "partnership", "featured in", "press", "as seen"]) {
      assert.equal(
        new RegExp(`\\b${phrase}\\b`).test(copy),
        false,
        `unsupported partnership claim: "${phrase}"`,
      );
    }
  });

  it("contains no years-of-experience claim", () => {
    const years = copy.match(/\b(since|for)\s+(19|20)\d{2}\b/g) ?? [];
    assert.deepEqual(years, [], `tenure claims found: ${years.join(", ")}`);
  });

  it("contains no fabricated contact details", () => {
    for (const pattern of [/\+?\d[\d\s().-]{7,}\d/, /[\w.+-]+@[\w-]+\.[\w.]+/, /\bhttps?:\/\/(?!example)/]) {
      const matches = JSON.stringify([HERO, FOOTER, NAVIGATION, NEXT_STEP]).match(pattern) ?? [];
      assert.deepEqual(matches, [], `contact or endpoint detail found: ${matches.join(", ")}`);
    }
  });

  it("omits the contact group from the footer rather than inventing one", () => {
    assert.equal(FOOTER.showContact, false);
    const headings = FOOTER.groups.map((group) => group.heading.toLowerCase());
    assert.equal(headings.includes("contact"), false, "no contact group may be invented");
  });

  it("avoids generic AI marketing clichés", () => {
    for (const phrase of [
      "the future is here",
      "revolutioniz",
      "revolutionis",
      "never before",
      "unlock infinite",
      "unleash the power",
      "supercharge",
      "game-chang",
      "cutting-edge",
      "seamless",
      "empower",
    ]) {
      assert.equal(copy.includes(phrase), false, `generic marketing phrase: "${phrase}"`);
    }
  });

  it("states a concrete, technical proposition in the headline", () => {
    assert.ok(HERO.headline.length > 40, "the headline should carry a real proposition");
    assert.equal(/\?$/.test(HERO.headline), false, "a question headline is a cliché");
    assert.ok(HERO.eyebrow.length > 0);
  });
});

describe("capability claims match the implementation", () => {
  it("labels every capability with its status rather than implying availability", () => {
    for (const capability of CAPABILITIES) {
      assert.ok(capability.statusLabel.length > 0, `${capability.id} has no status label`);
      assert.ok(
        ["available", "building"].includes(capability.status),
        `${capability.id} has an unknown status`,
      );
    }
  });

  it("marks unbuilt capabilities as boundaries, not as shipped", () => {
    for (const capability of CAPABILITIES.filter((item) => item.status === "building")) {
      assert.match(
        capability.statusLabel.toLowerCase(),
        /boundary|planned|not yet|designed/,
        `${capability.id} is not implemented, so its label must say so`,
      );
    }
  });

  it("names no specific provider, model or vendor", () => {
    const copy = visibleCopy();
    for (const name of [
      "openai",
      "gpt",
      "claude",
      "anthropic",
      "gemini",
      "llama",
      "openrouter",
      "nvidia",
      "ollama",
      "mistral",
      "azure",
      "bedrock",
    ]) {
      assert.equal(copy.includes(name), false, `a specific provider must not be named: ${name}`);
    }
  });

  it("names no external integration as connected", () => {
    const copy = visibleCopy();
    for (const name of ["anythingllm", "n8n", "telegram", "slack", "zapier", "webhook"]) {
      assert.equal(copy.includes(name), false, `an unbuilt integration must not be named: ${name}`);
    }
  });
});

describe("architecture claims correspond to real modules", () => {
  it("points every layer at a directory that exists in the repository", () => {
    // This is what stops the architecture section from becoming an illustration
    // that has drifted away from the system it describes.
    for (const layer of ARCHITECTURE.layers) {
      assert.ok(
        existsSync(path.join(projectRoot, layer.sourcePath)),
        `layer "${layer.name}" claims ${layer.sourcePath}, which does not exist`,
      );
    }
  });

  it("covers the layers the real architecture establishes", () => {
    const names = ARCHITECTURE.layers.map((layer) => layer.name);
    for (const expected of ["Orchestration", "Intelligence", "Execution", "Knowledge", "Observability"]) {
      assert.ok(names.includes(expected), `the architecture section must describe ${expected}`);
    }
  });

  it("marks the knowledge layer optional, because the core runs without it", () => {
    const knowledge = ARCHITECTURE.layers.find((layer) => layer.id === "knowledge");
    assert.ok(knowledge, "the knowledge layer must be described");
    assert.equal(knowledge.optional, true, "knowledge must be optional: the core does not depend on it");
  });

  it("has unique layer identifiers", () => {
    const ids = ARCHITECTURE.layers.map((layer) => layer.id);
    assert.equal(new Set(ids).size, ids.length, "layer ids must be unique");
  });
});

describe("reliability claims are architectural, not promotional", () => {
  it("describes principles that are enforced in code", () => {
    const titles = RELIABILITY.principles.map((principle) => principle.title.toLowerCase());
    for (const expected of [
      "controlled execution",
      "bounded retries",
      "provider fallback",
      "capability-aware routing",
      "health-aware selection",
      "auditability",
      "human approval",
    ]) {
      assert.ok(titles.includes(expected), `the principle "${expected}" must be described`);
    }
  });

  it("claims no numerical reliability figure", () => {
    const copy = JSON.stringify(RELIABILITY).toLowerCase();
    assert.equal(/\d+\s*%/.test(copy), false, "no reliability percentage may be claimed");
  });
});

describe("navigation targets exist", () => {
  it("points every navigation item at a real section or a real route", () => {
    // UPDATED for the inner pages. The invariant is UNCHANGED — every navigation
    // entry must resolve — but "resolves" now has two valid forms, because
    // entries may target a homepage section or a built page. Previously only
    // sections were legal, since only the homepage existed.
    //
    // The `sectionId`/`href` correspondence is still checked, because a section
    // item whose href drifted from its id is exactly the broken link this suite
    // exists to prevent.
    const knownSections = new Set<string>(Object.values(SECTION_IDS));
    for (const item of NAVIGATION.items) {
      if (item.sectionId === null) {
        assert.ok(
          REGISTERED_PATHS.has(item.href),
          `navigation item "${item.label}" targets unregistered route ${item.href}`,
        );
        continue;
      }
      assert.ok(
        knownSections.has(item.sectionId),
        `navigation item "${item.label}" targets unknown section ${item.sectionId}`,
      );
      assert.ok(
        item.href === `#${item.sectionId}` || item.href === `/#${item.sectionId}`,
        `the href must match the section id, either in-page or home-prefixed: ${item.href}`,
      );
    }
  });

  it("points the primary call to action at something that resolves", () => {
    const href = NAVIGATION.primaryCta.href;
    const target = href.replace(/^.*#/, "");
    if (href.startsWith("#") || href.includes("#")) {
      assert.ok(
        (Object.values(SECTION_IDS) as readonly string[]).includes(target),
        `the primary CTA targets unknown section ${target}`,
      );
    } else {
      assert.ok(REGISTERED_PATHS.has(href), `the primary CTA targets unregistered route ${href}`);
    }
  });

  it("keeps the navigation concise", () => {
    assert.ok(NAVIGATION.items.length <= 6, "primary navigation should stay short");
  });

  it("keeps navigation labels short enough for a horizontal bar", () => {
    for (const item of NAVIGATION.items) {
      assert.ok(item.label.length <= 20, `navigation label "${item.label}" is too long for the bar`);
    }
  });

  it("links only to routes that exist", () => {
    // REPLACES "does not link to any route other than the homepage".
    //
    // The original rule was "no navigation entry may point at an unbuilt route",
    // which was true when only `/` existed. The RULE is unchanged; only the
    // permitted set grew, so the assertion became a resolution check rather than
    // a prohibition. A link to a route that is not registered is still a failure,
    // and now that there are many routes this is the check that matters.
    const anchors = [
      ...NAVIGATION.items.map((item) => ({ label: item.label, href: item.href })),
      { label: "primary CTA", href: NAVIGATION.primaryCta.href },
      ...FOOTER_NAVIGATION.map((item) => ({ label: `footer: ${item.label}`, href: item.href })),
    ];
    const knownSections = new Set<string>(Object.values(SECTION_IDS));
    for (const { label, href } of anchors) {
      if (href.startsWith("#")) {
        assert.ok(knownSections.has(href.slice(1)), `${label} targets unknown section ${href}`);
        continue;
      }
      if (href.startsWith("/#")) {
        assert.ok(knownSections.has(href.slice(2)), `${label} targets unknown section ${href}`);
        continue;
      }
      assert.ok(REGISTERED_PATHS.has(href), `${label} links to an unregistered route: ${href}`);
    }
  });

  it("keeps the hero and next-step actions as in-page anchors", () => {
    // The homepage is a single scrolling document, so its calls to action stay
    // in-page. A homepage CTA that navigated away would be a poor experience
    // even now that other pages exist.
    for (const action of [HERO.primaryCta, HERO.secondaryCta, ...NEXT_STEP.actions]) {
      assert.ok(action.href.startsWith("#"), `call to action must not target an unbuilt route: ${action.href}`);
    }
  });
});

describe("route surface", () => {
  it("registers a homepage and a not-found page", () => {
    assert.equal(ROUTE_PATHS.home, "/");
    assert.ok(ROUTE_PATHS.notFound.startsWith("/"));
    assert.ok(REGISTERED_PATHS.has("/"), "the homepage is registered");
    assert.ok(REGISTERED_PATHS.has("/404"), "the not-found page is registered");
  });

  it("registers every inner page it links to", () => {
    // UPDATED: the inner pages now exist (PROJECT_STATE.md \u00a713). This asserts
    // each is reachable, so a page cannot be removed from the table while the
    // footer still advertises it.
    for (const path of ["/about", "/capabilities", "/contact", "/projects", "/blog"]) {
      assert.ok(REGISTERED_PATHS.has(path), `${path} must be a registered route`);
    }
  });
});
