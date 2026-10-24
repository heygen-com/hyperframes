import { htmlInCanvasForm } from "./htmlInCanvas.js";

// Engine-set: the off switch (its sub-frame blur runs, or the preview could not blur); the render scale (dpr falls back to 1).
export const PAGE_MOTION_BLUR_OFF_GLOBAL = "__HF_PAGE_MOTION_BLUR_OFF__";
export const PAGE_DEVICE_SCALE_GLOBAL = "__HF_DEVICE_SCALE_FACTOR__";

export function supportsCaptureMotionBlur(win: Window = window): boolean {
  return htmlInCanvasForm(win) !== null;
}

const ACCELERATED_CANVASES_GLOBAL = "__hfAcceleratedCanvases";

/**
 * Remember canvases html-in-canvas cannot capture: WebGL, WebGPU, or handed to an OffscreenCanvas.
 * Self-contained: the engine and the preview run its source ahead of every author script.
 */
export function installAcceleratedCanvasTracker(): void {
  const key = "__hfAcceleratedCanvases";
  const known: unknown = Reflect.get(window, key);
  const seen = known instanceof WeakSet ? known : new WeakSet<object>();
  if (seen !== known) Object.defineProperty(window, key, { value: seen });
  const accelerated = ["webgl", "webgl2", "experimental-webgl", "webgpu"];
  const wrap = (
    name: string,
    onCall: (canvas: object, args: unknown[], result: unknown) => void,
  ) => {
    const proto = HTMLCanvasElement.prototype;
    const original: unknown = Reflect.get(proto, name);
    if (typeof original !== "function" || "__hfAccelTracked" in original) return;
    const tracked = function (this: object, ...args: unknown[]): unknown {
      const result: unknown = Reflect.apply(original, this, args);
      onCall(this, args, result);
      return result;
    };
    Object.defineProperty(tracked, "__hfAccelTracked", { value: true });
    Object.defineProperty(proto, name, { value: tracked, writable: true, configurable: true });
  };
  wrap("getContext", (canvas, args, ctx) => {
    if (ctx && accelerated.includes(String(args[0]))) seen.add(canvas);
  });
  wrap("transferControlToOffscreen", (canvas) => {
    seen.add(canvas);
  });
}

export function isAcceleratedCanvas(canvas: HTMLCanvasElement): boolean {
  const seen: unknown = Reflect.get(window, ACCELERATED_CANVASES_GLOBAL);
  return seen instanceof WeakSet && seen.has(canvas);
}

/** The tracker as a script body, for `evaluateOnNewDocument` and inline `<script>` injection. */
export function acceleratedCanvasTrackerSource(): string {
  return `(${installAcceleratedCanvasTracker.toString()})();`;
}
