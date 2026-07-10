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
 * Resolve a timeline element's media src to a URL loadable from the studio
 * (parent) document. Composition-relative paths (e.g. "assets/image.png") are
 * only servable through the project preview endpoint; absolute http(s) URLs
 * pass through untouched.
 *
 * Each path segment is percent-encoded so filenames containing spaces,
 * parentheses, or other URL-unsafe characters (e.g.
 * "assets/heygen-symbol-blue-logo (2).svg") yield a valid URL instead of a
 * 404. Slashes are preserved as separators.
 */
export function resolveMediaPreviewUrl(src: string, projectId: string): string {
  if (src.startsWith("http")) return src;
  const encodedSrc = src.split("/").map(encodeURIComponent).join("/");
  return `/api/projects/${projectId}/preview/${encodedSrc}`;
}
