// Separate elements at one instant, ported from light-reverse's measure.objects: count, sizes, and whether they
// form a ring, grid, row, column or stack. Elements are 8-connected blobs of pixels far from the background (the
// ROI border's median); positions and sizes are shares of the full frame.
import { blobs, type Frame } from "./box.js";
import { Fix, readFrameAt, round, type Roi, type VideoInfo } from "./media.js";

const MAX_W = 960;
const MIN_SHARE = 0.0003;

interface Found {
  cx: number;
  cy: number;
  w: number;
  h: number;
  x0: number;
  y0: number;
  area: number;
}

/** Where working pixels sit in the frame: offset of the ROI and video pixels per working pixel. */
interface Geometry {
  W: number;
  H: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
}

const toShare = (g: Geometry, x: number, y: number) => ({
  x: round((g.x + x * g.sx) / g.W, 3),
  y: round((g.y + y * g.sy) / g.H, 3),
});

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / (v.length || 1);
const std = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** How many runs `values` form when gaps over `gap` split them. */
const runs = (values: number[], gap: number) => {
  const v = [...values].sort((a, b) => a - b);
  return 1 + v.slice(1).filter((x, i) => x - v[i]! > gap).length;
};

/** The arrangement of the largest group of like-sized elements; a stray glyph or crumb joins nothing. */
// fallow-ignore-next-line unused-export complexity
export function arrangement(all: Found[], g: Geometry) {
  let found = all;
  if (found.length >= 3) {
    const med = median(found.map((o) => o.area));
    const like = found.filter((o) => o.area >= 0.6 * med && o.area <= 1.6 * med);
    if (like.length >= 3) found = like;
  }
  if (found.length < 3) return { kind: "fewer than 3 elements", count: found.length };
  const areas = found.map((o) => o.area);
  const similar = std(areas) / mean(areas) < 0.35;
  const c = found.map((o) => [o.cx * g.sx, o.cy * g.sy] as const); // video px
  const size = median(found.map((o) => Math.max(o.w * g.sx, o.h * g.sy)));
  const boxes = found.map((o) => [o.x0, o.y0, o.x0 + o.w, o.y0 + o.h] as const);
  const overlaps = boxes
    .flatMap((a, i) =>
      boxes.slice(i + 1).map((b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]),
    )
    .filter(Boolean).length;
  if (similar) {
    const centre = [mean(c.map((p) => p[0])), mean(c.map((p) => p[1]))] as const;
    const r = c.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1]));
    if (mean(r) > size * 0.6 && std(r) / mean(r) < 0.12) {
      const ang = c
        .map(
          (p) =>
            ((((Math.atan2(p[1] - centre[1], p[0] - centre[0]) * 180) / Math.PI) % 360) + 360) %
            360,
        )
        .sort((a, b) => a - b);
      const gaps = [...ang.slice(1), ang[0]! + 360].map((a, i) => a - ang[i]!);
      const radius = mean(r);
      return {
        kind: "ring",
        count: found.length,
        centre: toShare(g, centre[0] / g.sx, centre[1] / g.sy),
        ring_diameter_share_of_width: round((2 * radius) / g.W, 4),
        element_to_ring_diameter: round(size / (2 * radius), 2),
        evenly_spaced: std(gaps) < 12,
        touching: 2 * radius * Math.sin(Math.PI / found.length) <= size * 1.1,
      };
    }
    const rows = runs(
      c.map((p) => p[1]),
      size * 0.5,
    );
    const cols = runs(
      c.map((p) => p[0]),
      size * 0.5,
    );
    if (rows * cols >= found.length && found.length >= 0.7 * rows * cols && (rows > 1 || cols > 1))
      return {
        kind: rows > 1 && cols > 1 ? "grid" : rows === 1 ? "row" : "column",
        rows,
        cols,
        element_share_of_width: round(size / g.W, 3),
      };
  }
  if (overlaps >= found.length - 1) {
    const order = c.map((_, i) => i).sort((i, j) => c[i]![0] + c[i]![1] - (c[j]![0] + c[j]![1]));
    const steps = order
      .slice(1)
      .map((i, k) => [c[i]![0] - c[order[k]!]![0], c[i]![1] - c[order[k]!]![1]]);
    return {
      kind: "stack",
      count: found.length,
      overlapping_pairs: overlaps,
      mean_offset_share: {
        x: round(mean(steps.map((s) => s[0]!)) / g.W, 3),
        y: round(mean(steps.map((s) => s[1]!)) / g.H, 3),
      },
    };
  }
  return {
    kind: "scattered",
    count: found.length,
    overlapping_pairs: overlaps,
    similar_sizes: similar,
  };
}

const hex = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** The elements standing out from the background at `t` inside `roi`. */
// fallow-ignore-next-line complexity
export function objects(video: string, info: VideoInfo, t: number, roi: Roi, tol = 40) {
  const width = roi[2] > MAX_W ? MAX_W : 0;
  const { frames, w, h } = readFrameAt(info, t, { roi, width });
  const px = frames[0];
  if (!px)
    throw new Fix(
      `no frame at ${t}s`,
      `pick a time before ${round(info.duration - 1 / info.fps, 2)}s`,
    );
  const f: Frame = { px, w, h };
  const g: Geometry = {
    W: info.width,
    H: info.height,
    x: roi[0],
    y: roi[1],
    sx: roi[2] / w,
    sy: roi[3] / h,
  };
  // the background is the median of the ROI's outermost rows and columns
  const border: number[][] = [[], [], []];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1)
        for (let ch = 0; ch < 3; ch++) border[ch]!.push(px[(y * w + x) * 3 + ch]!);
  const bg = border.map(median);
  const { id, list } = blobs(
    f,
    (r, gr, b) => Math.max(Math.abs(r - bg[0]!), Math.abs(gr - bg[1]!), Math.abs(b - bg[2]!)) > tol,
  );
  const sums = list.map(() => [0, 0]);
  for (let i = 0; i < id.length; i++)
    if (id[i]) {
      sums[id[i]!]![0]! += i % w;
      sums[id[i]!]![1]! += Math.floor(i / w);
    }
  const found = list
    .flatMap((b, i): Found[] =>
      i === 0 || b.n < MIN_SHARE * w * h
        ? []
        : [
            {
              cx: sums[i]![0]! / b.n,
              cy: sums[i]![1]! / b.n,
              w: b.x1 - b.x0 + 1,
              h: b.y1 - b.y0 + 1,
              x0: b.x0,
              y0: b.y0,
              area: b.n,
            },
          ],
    )
    .sort((a, b) => b.area - a.area);
  return {
    t,
    background: hex(bg),
    count: found.length,
    elements: found.slice(0, 24).map((o) => ({
      ...toShare(g, o.cx, o.cy),
      w: round((o.w * g.sx) / g.W, 3),
      h: round((o.h * g.sy) / g.H, 3),
    })),
    arrangement: arrangement(found, g),
  };
}
