/**
 * The per-frame draw: a background, then each mover's own pixels redrawn along its path.
 *
 * Each mover is cropped from a capture of the movers alone, on a transparent background, and
 * drawn at every tap pose into a float buffer, additive at weight 1/n: the shutter integral. Its
 * coverage fades at the path ends, so the trail goes over a background without the movers (a
 * second capture, movers hidden).
 *
 * Image-space approximation: a mover's box and the glow around it move together.
 */

import { type Affine, invert, sweep, tapWeights, thinTaps } from "./pose";

export interface MoverFrame {
  w: number;
  h: number;
  /** The pose the capture shows (frame time). */
  now: Affine;
  /** Poses across the shutter. */
  taps: Affine[];
}

interface CompositeStats {
  blurred: number;
  taps: number;
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface Layer {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

// Float16 keeps n additive 1/n-weighted taps exact; 8-bit loses up to ~n/2 levels per channel.
function makeLayer(w: number, h: number): Layer {
  const canvas = new OffscreenCanvas(w, h);
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d", { colorType: "float16" } as CanvasRenderingContext2DSettings);
  } catch {
    ctx = null;
  }
  ctx = ctx ?? canvas.getContext("2d");
  if (!ctx) throw new Error("capture motion blur: no 2D context for the accumulation buffer");
  return { canvas, ctx };
}

/** Whether a mover travels far enough within this shutter to draw a trail at all. */
function moves(mover: MoverFrame, frameW: number, frameH: number): boolean {
  const { travel, rect } = sweep(mover.taps, mover.w, mover.h, frameW, frameH);
  return rect !== null && travel >= 1;
}

/** `width`/`height` are CSS px; the buffers hold `dpr` device pixels per CSS px. */
export function createCompositor(width: number, height: number, dpr = 1) {
  const accumW = Math.max(1, Math.round(width * dpr));
  const accumH = Math.max(1, Math.round(height * dpr));
  const accum = makeLayer(accumW, accumH);
  const crops: Layer[] = [];
  // A mover box this many times the frame is too big to copy every frame; it is left sharp.
  const maxCropArea = width * height * 4;

  const cropLayer = (i: number, w: number, h: number): Layer => {
    const dw = Math.ceil(w * dpr);
    const dh = Math.ceil(h * dpr);
    let layer = crops[i];
    if (!layer || layer.canvas.width < dw || layer.canvas.height < dh) {
      layer = makeLayer(
        Math.max(dw, layer?.canvas.width ?? 1),
        Math.max(dh, layer?.canvas.height ?? 1),
      );
      crops[i] = layer;
    }
    return layer;
  };

  function plan(movers: MoverFrame[]): boolean[] {
    return movers.map(
      (mover) =>
        invert(mover.now) !== null &&
        mover.w * mover.h <= maxCropArea &&
        moves(mover, width, height),
    );
  }

  /** Copy each kept mover's frame-time pixels out of `src`. */
  function crop(src: CanvasImageSource, movers: MoverFrame[], kept: boolean[]): void {
    movers.forEach((mover, i) => {
      const back = invert(mover.now);
      if (!kept[i] || !back) return;
      const { w, h } = mover;
      const c = cropLayer(i, w, h).ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = 1;
      c.clearRect(0, 0, Math.ceil(w * dpr), Math.ceil(h * dpr));
      c.setTransform(
        dpr * back.a,
        dpr * back.b,
        dpr * back.c,
        dpr * back.d,
        dpr * back.e,
        dpr * back.f,
      );
      c.drawImage(src, 0, 0, width, height);
    });
  }

  function trail(out: Context2D, mover: MoverFrame, layer: Layer): number {
    const { w, h } = mover;
    const { travel, rect } = sweep(mover.taps, w, h, width, height);
    if (!rect) return 0;
    const taps = thinTaps(mover.taps, travel);
    const rx = Math.max(0, Math.floor(rect.x * dpr));
    const ry = Math.max(0, Math.floor(rect.y * dpr));
    const rw = Math.min(accumW, Math.ceil((rect.x + rect.w) * dpr)) - rx;
    const rh = Math.min(accumH, Math.ceil((rect.y + rect.h) * dpr)) - ry;
    if (rw <= 0 || rh <= 0) return 0;
    const a = accum.ctx;
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = "source-over";
    a.globalAlpha = 1;
    a.clearRect(rx, ry, rw, rh);
    a.globalCompositeOperation = "lighter";
    const weights = tapWeights(taps.length);
    taps.forEach((m, k) => {
      a.globalAlpha = weights[k] ?? 0;
      a.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.e, dpr * m.f);
      a.drawImage(layer.canvas, 0, 0, w * dpr, h * dpr, 0, 0, w, h);
    });
    out.drawImage(accum.canvas, rx, ry, rw, rh, rx, ry, rw, rh);
    return taps.length;
  }

  /** `background` into `out`, then the trail of every mover `crop` kept. */
  function draw(
    background: CanvasImageSource,
    out: Context2D,
    movers: MoverFrame[],
    kept: boolean[],
  ): CompositeStats {
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalAlpha = 1;
    out.globalCompositeOperation = "copy";
    out.drawImage(background, 0, 0);
    out.globalCompositeOperation = "source-over";
    const stats: CompositeStats = { blurred: 0, taps: 0 };
    movers.forEach((mover, i) => {
      const layer = crops[i];
      if (!kept[i] || !layer) return;
      const n = trail(out, mover, layer);
      if (n > 0) {
        stats.blurred++;
        stats.taps += n;
      }
    });
    return stats;
  }

  return { plan, crop, draw };
}
