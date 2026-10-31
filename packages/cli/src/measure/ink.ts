// The ink of text (or any drawn mark) in one region of one frame: the pixels whose colour stands out from their
// surroundings, as bounds and line bands in the video's own pixels, so a rebuild can be sized from them.
import { inkOf } from "./drawn.js";
import type { Roi } from "./media.js";

export interface Ink {
  /** x, y, width, height of all the ink, in the video's pixels. */
  bounds: Roi;
  /** Ink pixels over the region's pixels. */
  share: number;
  /** Bands of rows with ink, split by an empty row: one per line of text. */
  lines: { y: number; height: number }[];
}

/** The ink of an RGB crop at `roi` (the crop's place in the frame), or null when it holds none. */
export function measureInk(px: Uint8Array, roi: Roi): Ink | null {
  const [x0, y0, w, h] = roi;
  const ink = inkOf(px, w, h);
  let [minX, maxX, minY, maxY, count] = [w, -1, h, -1, 0];
  const rows: boolean[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      count++;
      rows[y] = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!count) return null;
  const lines: Ink["lines"] = [];
  for (let y = minY; y <= maxY; y++) {
    if (!rows[y]) continue;
    const last = lines.at(-1);
    if (last && last.y + last.height === y + y0) last.height++;
    else lines.push({ y: y + y0, height: 1 });
  }
  return {
    bounds: [x0 + minX, y0 + minY, maxX - minX + 1, maxY - minY + 1],
    share: Math.round((count / (w * h)) * 1e4) / 1e4,
    lines,
  };
}
