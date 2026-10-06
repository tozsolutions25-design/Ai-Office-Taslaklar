/**
 * Renders a design-system component gallery to `dist/preview/index.html`.
 *
 * This is a DEVELOPMENT artefact, not a page. It exists so the design system can
 * be opened in a browser and reviewed during development without a bundler, a
 * dev server or a component framework.
 *
 * It deliberately contains NO product or marketing content: no headline, no
 * business copy, no statistics, no testimonials, no customer logos. Every
 * string is a neutral component label, so the gallery cannot be mistaken for,
 * or grow into, homepage content.
 *
 * Usage: `npm run ui:preview` (builds first).
 */

import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const dist = path.join(projectRoot, "dist");
const outDir = path.join(dist, "preview");
const stylesOut = path.join(outDir, "styles");

// A Windows absolute path is not a valid ESM specifier; it needs a file URL.
const ds = await import(pathToFileURL(path.join(dist, "src", "design-system", "index.js")).href);

const {
  alert,
  badge,
  brand,
  button,
  card,
  checkbox,
  cluster,
  container,
  dialog,
  emptyState,
  field,
  fieldset,
  figure,
  form,
  grid,
  header,
  headerContent,
  healthIndicator,
  htmlDocument,
  input,
  link,
  main,
  metric,
  mobileNav,
  nav,
  navItem,
  progress,
  radio,
  responsiveImage,
  section,
  select,
  skipLink,
  stack,
  statusDot,
  switchControl,
  textarea,
  timestamp,
  tooltip,
} = ds;

const { toHtmlString } = ds;

const heading = (text) => `<h2 class="toz-type-h3 toz-type-body" style="margin-bottom:1rem">${text}</h2>`;
const row = (children) => toHtmlString(cluster({ children, gap: "3" }));
const label = (text) => `<span class="toz-type-caption toz-text-muted">${text}</span>`;

function gallerySection(title, body) {
  return toHtmlString(
    section({ spacing: "md", children: container({ children: stack({ children: [heading(title), body] }) }) }),
  );
}

const buttonGallery = `
  <div class="toz-stack" style="--toz-stack-gap:0.75rem">
    ${row(
      ["primary", "secondary", "outline", "ghost", "destructive", "link"]
        .map((variant) => button({ children: variant, variant, size: "sm" }))
        .join(""),
    )}
    ${row([
      button({ children: "Small", size: "sm" }),
      button({ children: "Medium" }),
      button({ children: "Large", size: "lg" }),
      button({ children: "Disabled", disabled: true }),
      button({ children: "Loading", loading: true, loadingLabel: "Loading sample" }),
      button({ children: "Full width", fullWidth: true }),
    ].join(""))}
  </div>`;

const linkGallery = `
  <div class="toz-stack" style="--toz-stack-gap:0.75rem">
    ${row(
      ["standard", "nav", "subtle", "emphasis"]
        .map((variant) => link({ href: "#", children: variant, variant, current: variant === "nav" }))
        .join(""),
    )}
    ${row(link({ href: "https://example.com", children: "External", external: true }))}
  </div>`;

const statusGallery = `
  <div class="toz-stack" style="--toz-stack-gap:1rem">
    ${row(
      ["neutral", "info", "success", "warning", "error", "processing"]
        .map((tone) => badge({ tone, children: tone }))
        .join(""),
    )}
    ${row(
      ["neutral", "info", "success", "warning", "error", "processing"]
        .map((tone) => statusDot({ tone, label: tone }))
        .join(""),
    )}
    ${row(["healthy", "degraded", "unavailable", "disabled", "unknown"].map((state) => toHtmlString(healthIndicator({ state }))).join(""))}
    ${toHtmlString(progress({ value: 62, label: "Sample determinate progress" }))}
    ${toHtmlString(progress({ label: "Sample indeterminate progress" }))}
    ${toHtmlString(metric({ label: "Sample metric", value: "1,024", delta: "+4.2%", deltaDirection: "up" }))}
    ${toHtmlString(timestamp({ text: "sample relative time", iso: "2026-01-01T00:00:00.000Z" }))}
  </div>`;

const cardGallery = grid({
  columns: 3,
  children: [
    card({ title: "Card title", description: "Supporting description.", children: "<p>Body content.</p>", footer: button({ children: "Action", size: "sm" }) }),
    card({ title: "With status", status: toHtmlString(badge({ tone: "success", children: "ok" })), children: "<p>Body content.</p>" }),
    card({ title: "Interactive", interactive: true, children: "<p>Body content.</p>" }),
  ].join(""),
});

const formGallery = form({
  ariaLabel: "Design system form sample",
  children: [
    field({
      id: "sample-text",
      label: "Text field",
      description: "Help text.",
      required: true,
      children: input({ id: "sample-text", ariaDescribedBy: "sample-text-description" }),
    }),
    field({
      id: "sample-invalid",
      label: "Invalid field",
      error: "Sample validation message.",
      children: input({ id: "sample-invalid", invalid: true, ariaDescribedBy: "sample-invalid-error" }),
    }),
    field({ id: "sample-textarea", label: "Textarea", children: textarea({ id: "sample-textarea", rows: 3 }) }),
    field({
      id: "sample-select",
      label: "Select",
      children: select({
        id: "sample-select",
        placeholder: "Choose one",
        options: [
          { value: "a", label: "Option A" },
          { value: "b", label: "Option B", group: "Grouped" },
        ],
      }),
    }),
    fieldset({
      legend: "Checkbox group",
      children: [
        checkbox({ id: "sample-c1", name: "sample-c", label: "Checkbox one", checked: true }),
        checkbox({ id: "sample-c2", name: "sample-c", label: "Checkbox two" }),
      ].join(""),
    }),
    fieldset({
      legend: "Radio group",
      children: [
        radio({ id: "sample-r1", name: "sample-r", label: "Radio one", checked: true }),
        radio({ id: "sample-r2", name: "sample-r", label: "Radio two" }),
      ].join(""),
    }),
    switchControl({ id: "sample-switch", label: "Switch", description: "Sample description.", checked: true }),
  ].join(""),
});

const feedbackGallery = `
  <div class="toz-stack" style="--toz-stack-gap:0.75rem">
    ${["info", "success", "warning", "error"]
      .map((tone) => toHtmlString(alert({ tone, title: `${tone} alert`, children: "Sample message body." })))
      .join("")}
    ${toHtmlString(emptyState({ title: "Empty state", description: "Sample description.", action: toHtmlString(button({ children: "Action", size: "sm" })) }))}
  </div>`;

const overlayGallery = `
  <div class="toz-cluster" data-justify="start" data-gap="3">
    <button type="button" class="toz-button" data-variant="outline" data-dialog-open="sample-dialog">Open dialog</button>
    ${toHtmlString(tooltip({ children: "<button type=\'button\' class=\'toz-button\' data-variant=\'ghost\'>Tooltip trigger</button>", content: "Sample tooltip" }))}
  </div>
  ${toHtmlString(dialog({ id: "sample-dialog", title: "Dialog title", children: "<p>Dialog body content.</p>", footer: button({ children: "Close", variant: "outline", size: "sm" }) }))}`;

const layoutGallery = `
  <div class="toz-stack" style="--toz-stack-gap:1rem">
    ${toHtmlString(grid({ columns: "auto", children: [1, 2, 3, 4, 5, 6].map((n) => `<div class="toz-card" style="padding:1rem"><span class="toz-type-body-sm">Item ${n}</span></div>`).join("") }))}
  </div>`;

const mediaGallery = toHtmlString(
  figure({
    image: { src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3Crect width='16' height='9' fill='%230d1320'/%3E%3C/svg%3E", alt: "Sample placeholder", aspectRatio: "16 / 9" },
    caption: "Sample figure caption.",
  }),
) + toHtmlString(responsiveImage({ src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3Crect width='16' height='9' fill='%23141d2e'/%3E%3C/svg%3E", aspectRatio: "16 / 9" }));

const body = [
  toHtmlString(header({
    children: toHtmlString(headerContent({
      brand: toHtmlString(brand({ name: "TOZ AI Office" })),
      nav: toHtmlString(nav({
        id: "preview-nav",
        ariaLabel: "Preview",
        responsive: true,
        children: [navItem({ href: "#tokens", children: "Tokens" }), navItem({ href: "#components", children: "Components" })].join(""),
      })),
      actions: toHtmlString(mobileNav({
        id: "preview-mobile-nav",
        label: "Menu",
        children: [navItem({ href: "#tokens", children: "Tokens" }), navItem({ href: "#components", children: "Components" })].join(""),
      })),
    })),
  })),
  toHtmlString(main({
    children: section({
      id: "components",
      children: container({
        children: stack({
          gap: "10",
          children: [
            gallerySection("Buttons", buttonGallery),
            gallerySection("Links", linkGallery),
            gallerySection("Cards", cardGallery),
            gallerySection("Status and data", statusGallery),
            gallerySection("Forms", formGallery),
            gallerySection("Feedback", feedbackGallery),
            gallerySection("Overlays", overlayGallery),
            gallerySection("Layout and responsive grid", layoutGallery),
            gallerySection("Media", mediaGallery),
          ].join(""),
        }),
      }),
    }),
  })),
].join("\n");

const document_ = toHtmlString(
  htmlDocument({
    title: "TOZ AI Office - design system gallery",
    bodyClass: "toz-ignore",
    head: [
      ds.html`<script>${ds.raw(ds.openDialogEnhancer())}</script>`,
      ds.html`<style>body { padding-block-end: 4rem; }</style>`,
    ],
  }),
);

// The shell renders an empty <body>; splice the gallery in, plus the skip link.
const page = document_.replace("</body>", `${toHtmlString(skipLink())}\n${body}\n</body>`);

mkdirSync(stylesOut, { recursive: true });
for (const file of ["tokens.css", "base.css", "layout.css", "components.css"]) {
  cpSync(
    path.join(dist, "src", "design-system", "styles", file),
    path.join(stylesOut, file),
  );
}
writeFileSync(path.join(outDir, "index.html"), page, "utf8");

console.log(`ui:preview wrote ${path.relative(projectRoot, path.join(outDir, "index.html"))} (${page.length} bytes)`);
