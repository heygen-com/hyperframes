/** Rendered height of a timeline-clip thumbnail strip, in CSS px. */
export const THUMBNAIL_CLIP_HEIGHT = 66;

export interface ThumbnailStripLayout {
  /** Width of a single tile, in CSS px. */
  frameW: number;
  /** Number of tiles needed to fill the container. */
  frameCount: number;
}

/**
 * Compute the film-strip tile layout for a clip thumbnail: fixed-height tiles
 * sized by the media's aspect ratio, repeated to fill the clip width.
 * Degenerate aspects (0, negative, NaN, Infinity) fall back to 16:9.
 */
export function computeThumbnailStrip(
  containerWidth: number,
  aspect: number,
  clipHeight: number = THUMBNAIL_CLIP_HEIGHT,
): ThumbnailStripLayout {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const frameW = Math.max(1, Math.round(clipHeight * safeAspect));
  const frameCount = containerWidth > 0 ? Math.max(1, Math.ceil(containerWidth / frameW)) : 1;
  return { frameW, frameCount };
}

/**
 * Percent-encode each segment of a composition-relative media path so filenames
 * containing spaces, parentheses, a U+202F narrow no-break space (the macOS
 * screenshot artifact), or any other non-ASCII / URL-unsafe character yield a
 * valid URL instead of a 404. Slashes are preserved as separators.
 *
 * Shared by every timeline media-URL builder (filmstrip thumbnails, audio
 * waveform, sub-composition preview) so they encode identically to the assets
 * panel — a raw segment 404s on the exact filenames the assets panel loads fine.
 */
export function encodePreviewPath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

/**
 * Resolve a timeline element's media src to a URL loadable from the studio
 * (parent) document. Composition-relative paths (e.g. "assets/image.png") are
 * routed through the project preview endpoint with each segment encoded.
 *
 * Already-loadable URLs pass through untouched: absolute http(s) URLs, plus
 * `data:` and `blob:` URLs. Routing a `data:`/`blob:` URL through the preview
 * endpoint would percent-encode the whole thing into a multi-KB path segment
 * that the server rejects with HTTP 431 (Request Header Fields Too Large).
 */
export function resolveMediaPreviewUrl(src: string, projectId: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(src)) return src;
  return `/api/projects/${projectId}/preview/${encodePreviewPath(src)}`;
}
