import html2canvas from "html2canvas";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT } from "./webgl.js";

let patched = false;
const VOID_ELEMENT_TAGS = new Set([
  "AREA",
  "BASE",
  "BR",
  "COL",
  "EMBED",
  "HR",
  "IMG",
  "INPUT",
  "LINK",
  "META",
  "PARAM",
  "SOURCE",
  "TRACK",
  "WBR",
]);

function patchCreatePattern(): void {
  if (patched) return;
  patched = true;
  const orig = CanvasRenderingContext2D.prototype.createPattern;
  CanvasRenderingContext2D.prototype.createPattern = function (
    image: CanvasImageSource,
    repetition: string | null,
  ): CanvasPattern | null {
    if (
      image &&
      "width" in image &&
      "height" in image &&
      ((image as HTMLCanvasElement).width === 0 || (image as HTMLCanvasElement).height === 0)
    ) {
      return null;
    }
    return orig.call(this, image, repetition);
  };
}

export function initCapture(): void {
  patchCreatePattern();
}

export interface CaptureSceneOptions {
  forceVisible?: boolean;
  preferBrowserPaint?: boolean;
  scale?: number;
}

function forceSceneVisibleInClone(source: HTMLElement, cloneDoc: Document): void {
  if (!source.id) return;
  const clone = cloneDoc.getElementById(source.id);
  if (!(clone instanceof HTMLElement)) return;

  clone.style.opacity = "1";
  clone.style.visibility = "visible";
  clone.querySelectorAll<HTMLElement>("[data-start]").forEach((el) => {
    el.style.visibility = "visible";
  });
}

function stabilizeTransformedBoxShadows(root: HTMLElement): void {
  const view = root.ownerDocument.defaultView;
  if (!view) return;

  [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].forEach((el) => {
    if (VOID_ELEMENT_TAGS.has(el.tagName)) return;
    const styles = view.getComputedStyle(el);
    if (styles.boxShadow === "none" || styles.transform === "none") return;

    const shadow = root.ownerDocument.createElement("div");
    shadow.setAttribute("data-hyper-shader-shadow-shim", "");
    shadow.style.cssText = [
      "position:absolute",
      "inset:0",
      "border-radius:inherit",
      `box-shadow:${styles.boxShadow}`,
      "background:transparent",
      "pointer-events:none",
      "z-index:0",
    ].join(";");

    if (styles.position === "static") {
      el.style.position = "relative";
    }
    el.style.boxShadow = "none";
    el.insertBefore(shadow, el.firstChild);
  });
}

export function captureScene(
  sceneEl: HTMLElement,
  bgColor: string,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT,
  options: CaptureSceneOptions = {},
): Promise<HTMLCanvasElement> {
  const captureWithRenderer = (foreignObjectRendering: boolean): Promise<HTMLCanvasElement> => {
    return html2canvas(sceneEl, {
      width,
      height,
      scale: options.scale ?? 1,
      backgroundColor: bgColor,
      logging: false,
      foreignObjectRendering,
      // Safari applies stricter canvas-taint rules than Chrome. SVG data URLs
      // with <filter> elements (e.g. feTurbulence grain backgrounds), certain
      // cross-origin images, and mask/clip-path url() refs can taint the
      // output canvas on WebKit. Without these flags, html2canvas throws
      // `SecurityError: The operation is insecure` during its own read-back
      // path and every shader transition falls through to the catch handler
      // — observed in Safari + Claude Design's cross-origin iframe sandbox.
      //
      // useCORS:    send CORS headers on image fetches so cross-origin images
      //             with proper `Access-Control-Allow-Origin` don't taint the
      //             canvas in the first place. Strict improvement.
      // allowTaint: let html2canvas complete and return a canvas even when it
      //             becomes tainted (instead of throwing). Important caveat:
      //             a tainted canvas CANNOT be uploaded to WebGL via
      //             `gl.texImage2D` — WebGL spec requires SecurityError on
      //             non-origin-clean sources, with no opt-out. So this flag
      //             only moves the failure point from html2canvas to the
      //             texImage2D call in webgl.ts. The caller catches the
      //             rejected promise and keeps the DOM fallback visible. Net
      //             effect: the end-user UX avoids blank frames either way,
      //             but we get a cleaner, more predictable error site and the
      //             flag is defensively correct for the non-taint branches
      //             where it genuinely helps (e.g.,
      //             `crossOrigin="anonymous"` image fetches that already had
      //             CORS headers).
      useCORS: true,
      allowTaint: true,
      onclone: (cloneDoc) => {
        if (!sceneEl.id) return;
        const clone = cloneDoc.getElementById(sceneEl.id);
        if (clone instanceof HTMLElement) {
          stabilizeTransformedBoxShadows(clone);
        }
        if (options.forceVisible) {
          forceSceneVisibleInClone(sceneEl, cloneDoc);
        }
      },
      ignoreElements: (el: Element) =>
        el.tagName === "CANVAS" || el.hasAttribute("data-no-capture"),
    });
  };

  if (options.preferBrowserPaint === true) {
    return captureWithRenderer(true).catch(() => captureWithRenderer(false));
  }

  return captureWithRenderer(false);
}
