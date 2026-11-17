import { isWebKit } from "./mediaClock";
import { PREVIEW_VIDEO_CANVAS_ATTR } from "../studioPreviewMark";
import { sourceFactsOf } from "./mediaSourceLookup";

/** The one owner of making a canvas frame look like the browser's own video layer, which on macOS Chromium
 * shows 8-bit SDR video with Apple's gamma (about 1.961) where a canvas shows sRGB. Display-only, so canvas
 * readers keep the pixels a playing video gives them. */
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

/** Only a source the studio's scan positively reports as 8-bit is measured; unknown or higher depth is left alone. */
function isKnownSdrSource(video: HTMLVideoElement): boolean {
  const bitDepth = sourceFactsOf(video)?.bitDepth;
  return typeof bitDepth === "number" && bitDepth > 0 && bitDepth <= 8;
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
export function applyNativeVideoLook(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  authoredFilter: string,
): void {
  if (!nativeVideoLookNeeded() || !isKnownSdrSource(video)) return;
  ensureFilter(canvas.ownerDocument);
  const look = `url(#${NATIVE_VIDEO_LOOK_FILTER_ID})`;
  canvas.style.setProperty(
    "filter",
    authoredFilter === "none" ? look : `${look} ${authoredFilter}`,
  );
}
