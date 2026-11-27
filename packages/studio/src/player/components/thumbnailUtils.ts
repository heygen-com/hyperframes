import { decodedUrlPath } from "@hyperframes/parsers";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { MAX_VISIBLE_THUMBNAIL_FRAMES } from "../lib/timelineViewportBudgets";

export interface ThumbnailStripLayout {
  /** Width of a single tile, in CSS px. */
  frameW: number;
  /** Number of tiles needed to fill the container. */
  frameCount: number;
}

/** Quantize request identities so a pixel-by-pixel resize does not thrash the cache. */
export function quantizeThumbnailFrameCount(frameCount: number): number {
  const safeCount = Math.max(1, Number.isFinite(frameCount) ? Math.ceil(frameCount) : 1);
  const cap = 2 ** Math.floor(Math.log2(MAX_VISIBLE_THUMBNAIL_FRAMES));
  return Math.min(cap, 2 ** Math.ceil(Math.log2(safeCount)));
}

/**
 * The decoded frame tile `index` of `tileCount` shows, of a strip's `frameCount`: the last tile
 * shows the clip's last frame; the others the slice (videoThumbnailTimestamps) holding their centre.
 */
export function thumbnailFrameForTile(
  index: number,
  tileCount: number,
  frameCount: number,
): number {
  if (frameCount < 2) return 0;
  if (tileCount > 1 && index >= tileCount - 1) return frameCount - 1;
  const slices = frameCount - 1;
  return Math.min(slices - 1, Math.floor(((index + 0.5) * slices) / tileCount));
}

/**
 * Measure an image without mounting it in React's DOM. The scheduler owns the
 * abort signal, so an unmounted clip cannot leave Blink retaining a pending
 * image request and its former React tree.
 */
export function probeImageSize(
  imageSrc: string,
  signal: AbortSignal,
  tolerateSvgError = false,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    image.onload = () => {
      cleanup();
      resolve(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : { width: 1920, height: 1080 },
      );
    };
    image.onerror = () => {
      cleanup();
      if (tolerateSvgError && /\.svg($|\?)/i.test(imageSrc)) resolve({ width: 1920, height: 1080 });
      else reject(new Error("Image thumbnail failed to load"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    image.src = imageSrc;
  });
}

/**
 * Compute the film-strip tile layout for a clip thumbnail: tiles as tall as
 * the measured strip, sized by the media's aspect ratio, repeated to fill the
 * clip width. Degenerate aspects (0, negative, NaN, Infinity) fall back to 16:9.
 */
export function computeThumbnailStrip(
  containerWidth: number,
  aspect: number,
  clipHeight: number,
  minFrameWidth = 1,
): ThumbnailStripLayout {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const frameW = Math.max(minFrameWidth, Math.round(clipHeight * safeAspect));
  const measured = containerWidth > 0 && clipHeight > 0;
  const frameCount = measured ? Math.max(1, Math.ceil(containerWidth / frameW)) : 1;
  return { frameW, frameCount };
}

export function authoredSrcPath(src: string): string {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src) ? src : decodedUrlPath(src);
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

/** True when a project-relative `path` has a `..` segment, which the browser resolves above the project. */
export function climbsOut(path: string): boolean {
  return path.split("/").includes("..");
}

/**
 * A timeline element's media src as a file on this project's preview route (query dropped: the host adds
 * options), or an external http(s), `data:` or `blob:` URL; "" (load nothing) for any other API route or a climb.
 */
export function resolveMediaPreviewUrl(
  src: string,
  projectId: string,
  studioOrigin?: string,
): string {
  if (!src || /^(?:data:|blob:)/i.test(src)) return src;
  let relativePath: string | null = src;
  let hash = "";
  if (/^https?:/i.test(src)) {
    if (!URL.canParse(src)) return "";
    const url = new URL(src);
    if (url.origin !== studioOrigin) return src;
    relativePath = sameOriginProjectPath(url, projectId);
    hash = url.hash;
  }
  const path = relativePath?.replace(/^\/+/, "");
  if (path === undefined || climbsOut(path)) return "";
  return buildProjectApiPath(projectId, `/preview/${encodePreviewPath(path)}${hash}`);
}

/** The project file a same-origin `url` names (a rooted path is one), or null for any other API route. */
function sameOriginProjectPath(url: URL, projectId: string): string | null {
  const previewPath = new URL(buildProjectApiPath(projectId, `/preview/`), url.origin).pathname;
  const inPreview = url.pathname.startsWith(previewPath);
  if (!inPreview && url.pathname.startsWith("/api/")) return null;
  try {
    return decodeURIComponent(url.pathname.slice(inPreview ? previewPath.length : 0));
  } catch {
    return null;
  }
}
