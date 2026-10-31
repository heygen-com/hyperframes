import { inkOf } from "./drawn.js";
import type { Roi } from "./media.js";

export interface Ink {
  /** x, y, width, height of all the ink, in the video's pixels. */
  bounds: Roi;
  /** Ink pixels over the region's pixels. */
  share: number;
  /** One band of ink rows per line of text. */
  lines: { y: number; height: number }[];
}

/** The ink of an RGB crop at `roi` (its place in the frame), or null when it holds none. */
export function measureInk(px: Uint8Array, roi: Roi): Ink | null {
  const [x0, y0, w, h] = roi;
  const ink = inkOf(px, w, h);
  const cols = new Set<number>();
  const rows: number[] = [];
  let count = 0;
  for (let y = 0; y < h; y++) {
    let any = false;
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      cols.add(x);
      count++;
      any = true;
    }
    if (any) rows.push(y);
  }
  if (!count) return null;
  const [minX, maxX] = [Math.min(...cols), Math.max(...cols)];
  const [minY, maxY] = [rows[0]!, rows.at(-1)!];
  return {
    bounds: [x0 + minX, y0 + minY, maxX - minX + 1, maxY - minY + 1],
    share: Math.round((count / (w * h)) * 1e4) / 1e4,
    lines: bands(rows).map(([a, b]) => ({ y: y0 + a, height: b - a + 1 })),
  };
}

/** Runs of consecutive numbers as [first, last]. */
function bands(sorted: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const n of sorted) {
    const last = out.at(-1);
    if (last && last[1] === n - 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}
