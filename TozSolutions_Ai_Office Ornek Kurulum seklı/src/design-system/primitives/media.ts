/**
 * Media.
 *
 * Responsive image handling with a reserved aspect ratio, so a page does not
 * shift as images load. `loading="lazy"` and `decoding="async"` are applied by
 * default: an image below the fold should not compete with content for
 * bandwidth or block decoding.
 *
 * No image assets ship with the design system. Sample imagery would imply
 * content that does not exist.
 */

import { cn } from "../utils/cn.js";
import { attrs, html, raw, type HtmlChild, type RawHtml } from "../utils/html.js";

export const OBJECT_FIT_VALUES = ["cover", "contain", "fill", "none", "scale-down"] as const;
export type ObjectFit = (typeof OBJECT_FIT_VALUES)[number];

export interface ResponsiveImageOptions {
  readonly src: string;
  /**
   * Accessible description. Omit only when the image is purely decorative, in
   * which case `alt=""` is emitted and the image is hidden from assistive
   * technology, which is the correct treatment for decoration.
   */
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  /** e.g. "16 / 9". Reserves layout space to prevent reflow. */
  readonly aspectRatio?: string;
  readonly fit?: ObjectFit;
  /** `srcset` and `sizes` for art direction or density switching. */
  readonly srcSet?: string;
  readonly sizes?: string;
  /** Set false for a likely above-the-fold image. */
  readonly lazy?: boolean;
  readonly class?: string;
  readonly id?: string;
}

export function responsiveImage(options: ResponsiveImageOptions): RawHtml {
  const { alt, class: className, ...rest } = options;
  const decorative = alt === undefined;
  return html`<img${raw(
    attrs({
      class: cn("toz-image", className),
      src: rest.src,
      // Empty alt marks the image decorative. A missing alt attribute would
      // make a screen reader announce the filename.
      alt: decorative ? "" : alt,
      width: rest.width,
      height: rest.height,
      srcset: rest.srcSet,
      sizes: rest.sizes,
      loading: rest.lazy === false ? "eager" : "lazy",
      decoding: "async",
      // Reserves space; without it the layout jumps on load.
      style: rest.aspectRatio === undefined ? undefined : `--toz-image-ratio: ${rest.aspectRatio}`,
      "data-fit": rest.fit ?? "cover",
      id: rest.id,
    }),
  )} />`;
}

export interface FigureOptions {
  readonly image: ResponsiveImageOptions;
  readonly caption?: HtmlChild;
  readonly class?: string;
}

/** Image with a caption, for documentation and product pages. */
export function figure(options: FigureOptions): RawHtml {
  return html`<figure${raw(attrs({ class: cn("toz-figure", options.class) }))}>
    ${responsiveImage(options.image)}
    ${options.caption === undefined ? "" : html`<figcaption class="toz-figure__caption">${options.caption}</figcaption>`}
  </figure>`;
}
