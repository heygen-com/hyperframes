import { isWebKit } from "./mediaClock";
import { PREVIEW_VIDEO_CANVAS_ATTR } from "../studioPreviewMark";

/** The one owner of how a decoded frame on a canvas is made to look like the browser's own video layer, which on
 * macOS Chromium shows 8-bit SDR video with Apple's video gamma (about 1.961) where a canvas shows it as sRGB.
 * Display-only (a CSS filter), so `drawImage` and WebGL readers of the canvas keep the pixels a playing video gives them. */
export const NATIVE_VIDEO_LOOK_FILTER_ID = "__hf_native_video_look";
const VIDEO_LAYER_GAMMA = 1.961;

const srgbEncode = (linear: number): number =>
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;

/** The 8-bit value the video layer shows for a canvas value, 0 to 255. */
export function nativeVideoLookValue(canvasValue: number): number {
  return Math.round(255 * srgbEncode(Math.pow(canvasValue / 255, VIDEO_LAYER_GAMMA)));
}

/** Chromium on macOS: the only browser measured to draw a canvas differently from its video layer. */
export function nativeVideoLookNeeded(): boolean {
  const { userAgent } = navigator;
  return /Macintosh/.test(userAgent) && !isWebKit() && /Chrom(e|ium)\//.test(userAgent);
}

type SourceFacts = Record<string, { bitDepth?: number } | undefined>;

/** Whether the studio's scan (keyed by the end of the file's path) says this video has more than 8 bits per channel. */
export function isHighBitDepthSource(video: HTMLVideoElement): boolean {
  const facts = (window as unknown as { __HF_MEDIA_SOURCE_FACTS__?: SourceFacts })
    .__HF_MEDIA_SOURCE_FACTS__;
  const src = video.currentSrc || video.getAttribute("src");
  if (!facts || !src) return false;
  let path: string;
  try {
    path = decodeURIComponent(new URL(src, video.ownerDocument.baseURI).pathname);
  } catch {
    return false;
  }
  const match = Object.keys(facts)
    .filter((suffix) => path.endsWith(suffix))
    .sort((a, b) => b.length - a.length)[0];
  return (match === undefined ? 8 : (facts[match]?.bitDepth ?? 8)) > 8;
}

function ensureFilter(doc: Document): void {
  if (doc.getElementById(NATIVE_VIDEO_LOOK_FILTER_ID)) return;
  const values = Array.from({ length: 256 }, (_, level) =>
    (nativeVideoLookValue(level) / 255).toFixed(4),
  ).join(" ");
  const channel = (name: string) => `<feFunc${name} type="table" tableValues="${values}"/>`;
  const holder = doc.createElement("div");
  holder.innerHTML =
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true" data-hyperframes-ignore data-hf-ignore ` +
    `data-layout-ignore data-hyperframes-picker-ignore ${PREVIEW_VIDEO_CANVAS_ATTR}><filter id="${NATIVE_VIDEO_LOOK_FILTER_ID}" ` +
    `color-interpolation-filters="sRGB"><feComponentTransfer>${channel("R")}${channel("G")}${channel("B")}` +
    `</feComponentTransfer></filter></svg>`;
  (doc.body ?? doc.documentElement).append(holder.firstElementChild as Element);
}

/** Gives the visible stand-in canvas the look its video layer has, ahead of any authored filter. */
export function applyNativeVideoLook(canvas: HTMLCanvasElement, authoredFilter: string): void {
  if (!nativeVideoLookNeeded()) return;
  ensureFilter(canvas.ownerDocument);
  const look = `url(#${NATIVE_VIDEO_LOOK_FILTER_ID})`;
  canvas.style.setProperty(
    "filter",
    authoredFilter === "none" ? look : `${look} ${authoredFilter}`,
  );
}
