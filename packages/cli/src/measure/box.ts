// Where one graphic sits, found by its colour rather than by what moves, so a presenter who never stops does not
// pull the box (ported from the Studio's box.mjs): at one time its box, ink, dominant colours, text line bands and
// cap height; over a range when it is on screen; with track, each move of its centre, size and ink, fitted to the
// closest GSAP ease.
import { join } from "node:path";
import { fitMoves, printable, type Row } from "./curve.js";
import {
  Fix,
  frameAt,
  readFrameAt,
  readFrames,
  round,
  runFfmpeg,
  type Roi,
  type VideoInfo,
} from "./media.js";

// A range is read at this width (a 1080 px frame at 3 px a step); one time is read at full size.
const RANGE_W = 360;
const BLOB = 0.02;
const MIN_BLOB = 4;
// Over a range a frame shows the graphic when it holds this share of the range's most ink; less is noise.
const PRESENT = 0.05;
const BORDER = 2;
const HOLD_S = 0.3;

export interface Frame {
  px: Uint8Array;
  w: number;
  h: number;
}
export type Match = (r: number, g: number, b: number) => boolean;
export interface Blob {
  n: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Cluster {
  rgb: number[];
  n: number;
}

const hexOf = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const dist2 = (a: number[], b: number[]) =>
  (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;

/** Colour clusters of the pixels in `rect` (x0,y0,x1,y1 inclusive) that `keep` passes: 16-level bins, each merged
 * into the first larger cluster within `radius`, largest first. */
// fallow-ignore-next-line complexity
function clusters(
  { px, w }: Frame,
  [x0, y0, x1, y1]: number[],
  keep: (x: number, y: number, o: number) => boolean,
  radius: number,
): Cluster[] {
  const bins = new Map<number, number[]>();
  for (let y = y0!; y <= y1!; y++)
    for (let x = x0!; x <= x1!; x++) {
      const o = (y * w + x) * 3;
      if (!keep(x, y, o)) continue;
      const key = ((px[o]! >> 4) << 8) | ((px[o + 1]! >> 4) << 4) | (px[o + 2]! >> 4);
      let bin = bins.get(key);
      if (!bin) bins.set(key, (bin = [0, 0, 0, 0]));
      bin[0]!++;
      for (let c = 0; c < 3; c++) bin[c + 1]! += px[o + c]!;
    }
  const out: { seed: number[]; n: number; sum: number[] }[] = [];
  for (const [n, ...sum] of [...bins.values()].sort((a, b) => b[0]! - a[0]!)) {
    const rgb = sum.map((s) => s / n!);
    const home = out.find((c) => dist2(c.seed, rgb) <= radius * radius);
    if (!home) out.push({ seed: rgb, n: n!, sum });
    else {
      home.n += n!;
      sum.forEach((s, c) => (home.sum[c]! += s));
    }
  }
  return out.map((c) => ({ rgb: c.sum.map((s) => s / c.n), n: c.n })).sort((a, b) => b.n - a.n);
}

/** --color auto: the commonest cluster among pixels that match no colour holding 2% of the ROI's border ring. */
function autoColor(f: Frame, tol: number): Cluster | null {
  const { w, h } = f;
  const ring = (x: number, y: number) =>
    x < BORDER || y < BORDER || x >= w - BORDER || y >= h - BORDER;
  const border = clusters(f, [0, 0, w - 1, h - 1], ring, tol);
  const total = border.reduce((s, c) => s + c.n, 0);
  const ground = border.filter((c) => c.n >= 0.02 * total).map((c) => c.rgb);
  const unlike = (x: number, y: number, o: number) =>
    !ring(x, y) &&
    ground.every((c) => dist2(c, [f.px[o]!, f.px[o + 1]!, f.px[o + 2]!]) > tol * tol);
  return clusters(f, [0, 0, w - 1, h - 1], unlike, tol)[0] ?? null;
}

/** The pixel test for --color. */
function matcher(spec: string, tol: number): Match {
  if (spec === "white") return (r, g, b) => Math.min(r, g, b) >= 255 - tol;
  if (spec === "dark") return (r, g, b) => Math.max(r, g, b) <= tol;
  // what a solo render on #00ff00 leaves once the green is keyed out
  if (spec === "alpha") return (r, g, b) => r + (255 - g) + b >= 90;
  const m = /^#?([0-9a-f]{6})$/i.exec(spec);
  if (!m)
    throw new Fix(
      `--color must be #rrggbb, white, dark, auto or alpha, got "${spec}"`,
      "--color #fce7bc",
    );
  const c = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16));
  return (r, g, b) => dist2(c, [r, g, b]) <= tol * tol;
}

/** The 8-connected blobs of the pixels `match` passes: each one's size and box, and every pixel's blob (0: none). */
// fallow-ignore-next-line complexity
export function blobs({ px, w, h }: Frame, match: Match): { id: Int32Array; list: Blob[] } {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++)
    mask[i] = match(px[3 * i]!, px[3 * i + 1]!, px[3 * i + 2]!) ? 1 : 0;
  const id = new Int32Array(w * h);
  const list: Blob[] = [{ n: 0, x0: w, y0: h, x1: -1, y1: -1 }];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || id[s]) continue;
    const blob = { n: 0, x0: w, y0: h, x1: -1, y1: -1 };
    const c = list.push(blob) - 1;
    const stack = [s];
    id[s] = c;
    for (let p = stack.pop(); p !== undefined; p = stack.pop()) {
      const x = p % w;
      const y = (p - x) / w;
      blob.n++;
      [blob.x0, blob.y0] = [Math.min(blob.x0, x), Math.min(blob.y0, y)];
      [blob.x1, blob.y1] = [Math.max(blob.x1, x), Math.max(blob.y1, y)];
      for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++)
        for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
          const q = ny * w + nx;
          if (!mask[q] || id[q]) continue;
          id[q] = c;
          stack.push(q);
        }
    }
  }
  return { id, list };
}

/** Blobs under BLOB of the graphic's largest are speckle (a highlight on a jacket, a slice of other text). */
const floorOf = (...lists: Blob[][]) =>
  Math.max(MIN_BLOB, BLOB * lists.flat().reduce((m, b) => Math.max(m, b.n), 0));

/** The box and pixel count of the blobs holding `floor` pixels or more, or null. */
function graphic(list: Blob[], floor: number) {
  const kept = list.filter((b) => b.n >= floor);
  if (!kept.length) return null;
  const edge = (k: "x0" | "y0" | "x1" | "y1", f: (...v: number[]) => number) =>
    f(...kept.map((b) => b[k]));
  return {
    x0: edge("x0", Math.min),
    y0: edge("y0", Math.min),
    x1: edge("x1", Math.max),
    y1: edge("y1", Math.max),
    ink: kept.reduce((s, b) => s + b.n, 0),
  };
}
type Graphic = NonNullable<ReturnType<typeof graphic>>;

/** One frame's graphic, with its text line bands: runs of rows holding it, a one-row gap bridged, under 3 rows
 * dropped. */
function measure(f: Frame, match: Match) {
  const { id, list } = blobs(f, match);
  const floor = floorOf(list);
  const g = graphic(list, floor);
  if (!g) return null;
  const lines: number[][] = [];
  for (let y = g.y0; y <= g.y1; y++) {
    let on = false;
    for (let x = g.x0; x <= g.x1 && !on; x++)
      on = id[y * f.w + x]! > 0 && list[id[y * f.w + x]!]!.n >= floor;
    if (!on) continue;
    const last = lines.at(-1);
    if (last && y - last[1]! <= 2) last[1] = y;
    else lines.push([y, y]);
  }
  return { ...g, lines: lines.filter(([a, b]) => b! - a! + 1 >= 3) };
}

/** Frames of `roi` from `start` for `seconds`, every one, at `width` (0: full size). */
function read(video: string, start: number, seconds: number, roi: Roi, width: number): Frame[] {
  const { frames, w, h } = readFrames(video, { start, seconds, roi, width });
  return frames.map((px) => ({ px, w, h }));
}

/** One frame with the box drawn (and the union in yellow), cropped round it. */
function picture(
  video: string,
  t: number,
  b: number[],
  [W, H]: number[],
  out: string,
  union: number[] | null = null,
) {
  const outer = union ?? b;
  const pad = Math.max(16, Math.round(0.25 * Math.max(outer[2]!, outer[3]!)));
  const cx = Math.max(0, outer[0]! - pad);
  const cy = Math.max(0, outer[1]! - pad);
  const cw = Math.min(W!, outer[0]! + outer[2]! + pad) - cx;
  const ch = Math.min(H!, outer[1]! + outer[3]! + pad) - cy;
  const draw = ([x, y, w, h]: number[], color: string, thick: number) =>
    `drawbox=x=${x! - cx}:y=${y! - cy}:w=${w}:h=${h}:color=${color}:t=${thick}`;
  const vf = [
    `crop=${cw}:${ch}:${cx}:${cy}`,
    ...(union ? [draw(union, "yellow", 1)] : []),
    draw(b, "red", 2),
  ];
  runFfmpeg(["-y", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", vf.join(","), out]);
  return out;
}

/** The --color spec as a test, choosing auto's colour on the sample of `fs` where it covers most. */
function choose(spec: string, tol: number, fs: Frame[]) {
  if (spec !== "auto") return { match: matcher(spec, tol), color: spec };
  const picks = [0, 0.25, 0.5, 0.75, 1].map((p) =>
    autoColor(fs[Math.round(p * (fs.length - 1))]!, tol),
  );
  const best = picks.reduce<Cluster | null>((a, b) => ((b?.n ?? 0) > (a?.n ?? 0) ? b : a), null);
  if (!best)
    throw new Fix(
      "--color auto found nothing unlike the ROI's border",
      "pass --color #rrggbb or white",
    );
  return { match: matcher(hexOf(best.rgb), tol), color: hexOf(best.rgb) };
}

/** The no-pixels error, naming what the ROI does hold. */
function nothing(f: Frame, color: string, tol: number) {
  const top = clusters(f, [0, 0, f.w - 1, f.h - 1], () => true, tol).slice(0, 3);
  const names = top
    .map((c) => `${hexOf(c.rgb)} ${Math.round((100 * c.n) / (f.w * f.h))}%`)
    .join(", ");
  const pick = autoColor(f, tol);
  return new Fix(
    `no pixels of ${color} (within --tol ${tol}) in the ROI; it holds ${names}`,
    pick
      ? `pass --color ${hexOf(pick.rgb)} (what --color auto picks here) or one of those colours`
      : "draw --roi round the graphic with some of its ground, then --color auto",
  );
}

/** In video pixels. */
const toVideo = (m: Graphic, [rx, ry]: Roi, kx: number, ky: number) => ({
  x: Math.round(rx + m.x0 * kx),
  y: Math.round(ry + m.y0 * ky),
  w: Math.round((m.x1 - m.x0 + 1) * kx),
  h: Math.round((m.y1 - m.y0 + 1) * ky),
});

export interface BoxOptions {
  video: string;
  info: VideoInfo;
  roi: Roi;
  color: string;
  tol: number;
  dir: string;
}

const frameAtStart = (t: number, fps: number) => Math.ceil(t * fps - 1e-6);

/** The graphic at one time. */
export function boxAt(o: BoxOptions, t: number) {
  const one = readFrameAt(o.info, t, { roi: o.roi });
  const f: Frame | undefined = one.frames[0] && { px: one.frames[0], w: one.w, h: one.h };
  if (!f)
    throw new Fix(
      `no frame at ${t}s`,
      `pick a time before ${round(o.info.duration - 1 / o.info.fps, 2)}s`,
    );
  const { match, color } = choose(o.color, o.tol, [f]);
  const m = measure(f, match);
  if (!m) throw nothing(f, color, o.tol);
  const box = toVideo(m, o.roi, 1, 1);
  const inBox = clusters(f, [m.x0, m.y0, m.x1, m.y1], () => true, o.tol);
  const area = box.w * box.h;
  const lines = m.lines.map(([a, b]) => ({ y: o.roi[1] + a!, h: b! - a! + 1 }));
  const heights = lines.map((l) => l.h).sort((a, b) => a - b);
  return {
    t,
    frame: frameAt(t, o.info.fps),
    color,
    box,
    ink_px: m.ink,
    colors: inBox.slice(0, 3).map((c) => ({ hex: hexOf(c.rgb), share: round(c.n / area, 2) })),
    lines,
    cap_height_px: heights[(heights.length - 1) >> 1] ?? null,
    image: picture(
      o.video,
      t,
      [box.x, box.y, box.w, box.h],
      [o.info.width, o.info.height],
      join(o.dir, `box-${t}s.png`),
    ),
  };
}

interface RangeRow extends Row {
  frame: number;
  box: { x: number; y: number; w: number; h: number } | null;
}

/** Runs where the box is on screen and none of x, y, w, h moves past `quant`, 0.3 s or longer. */
function holds(rows: RangeRow[], quant: number, fps: number) {
  const still = rows.map((r, i) => {
    const prev = rows[i - 1];
    if (!prev || r.x == null || prev.x == null || r.y == null || prev.y == null) return false;
    return (
      Math.abs(r.x - prev.x) <= quant &&
      Math.abs(r.y - prev.y) <= quant &&
      Math.abs(r.w - prev.w) <= quant &&
      Math.abs(r.h - prev.h) <= quant
    );
  });
  const out: { start_s: number; seconds: number }[] = [];
  for (let i = 0, run = 0; i <= still.length; i++) {
    if (still[i]) run++;
    else {
      if (run + 1 >= HOLD_S * fps)
        out.push({ start_s: rows[i - run - 1]!.t, seconds: round((run + 1) / fps, 2) });
      run = 0;
    }
  }
  return out;
}

/** Over a range: when it is seen, its union and median box; with `track`, each move fitted and the still holds. */
export function boxRange(opts: BoxOptions, start: number, end: number, track: boolean) {
  const { info, roi } = opts;
  const width = Math.min(RANGE_W, roi[2]);
  const fs = read(opts.video, start, end - start, roi, width);
  if (!fs.length)
    throw new Fix(
      `no frames between ${start}s and ${end}s`,
      `keep --end at most ${round(info.duration, 2)}`,
    );
  const kx = roi[2] / width;
  const ky = roi[3] / fs[0]!.h;
  const { match, color } = choose(opts.color, opts.tol, fs);
  // speckle is judged against the graphic's largest blob in the whole range, so a sliver entering is not swamped
  const found = fs.map((f) => blobs(f, match).list);
  const floor = floorOf(...found);
  const frame0 = frameAtStart(start, info.fps);
  const empty = (t: number, frame: number): RangeRow => ({
    t,
    frame,
    x: null,
    y: null,
    w: 0,
    h: 0,
    ink: 0,
    box: null,
  });
  const rows = found.map((list, i): RangeRow => {
    const frame = frame0 + i;
    const t = round(frame / info.fps, 3);
    const m = graphic(list, floor);
    if (!m) return empty(t, frame);
    const b = toVideo(m, roi, kx, ky);
    return {
      t,
      frame,
      x: round(b.x + b.w / 2, 1),
      y: round(b.y + b.h / 2, 1),
      w: b.w,
      h: b.h,
      ink: Math.round(m.ink * kx * ky),
      box: b,
    };
  });
  const most = Math.max(...rows.map((r) => r.ink));
  const present = rows.map((r) => (r.box && r.ink < PRESENT * most ? empty(r.t, r.frame) : r));
  const seen = present.filter((r) => r.box);
  if (!seen.length) throw nothing(fs[fs.length >> 1]!, color, opts.tol);
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[(v.length - 1) >> 1]!;
  const boxes = seen.flatMap((r) => (r.box ? [r.box] : []));
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const union = [
    x0,
    y0,
    Math.max(...boxes.map((b) => b.x + b.w)) - x0,
    Math.max(...boxes.map((b) => b.y + b.h)) - y0,
  ];
  const last = seen.at(-1)!;
  const lastBox = boxes.at(-1)!;
  const out = {
    start,
    end,
    fps: round(info.fps, 3),
    color,
    frames: present.length,
    seen_frames: seen.length,
    first_seen_s: seen[0]!.t,
    first_seen_frame: seen[0]!.frame,
    last_seen_s: last.t,
    last_seen_frame: last.frame,
    box_union: union,
    box_median: (["x", "y", "w", "h"] as const).map((k) => med(boxes.map((b) => b[k]))),
    ink_px_median: med(seen.map((r) => r.ink)),
    image: picture(
      opts.video,
      last.t,
      [lastBox.x, lastBox.y, lastBox.w, lastBox.h],
      [info.width, info.height],
      join(opts.dir, `box-${start}-${end}s.png`),
      union,
    ),
  };
  if (!track) return out;
  // Each move of x, y (the box's centre), w, h and ink, and the still holds.
  const quant = Math.max(kx, ky);
  const minPx = Math.max(2 * quant, 0.02 * Math.max(roi[2], roi[3]));
  const maxInk = Math.max(...present.map((r) => r.ink));
  const moves = (["x", "y", "w", "h", "ink"] as const)
    .flatMap((k) =>
      k === "ink"
        ? fitMoves(present, k, info.fps, 0.1 * maxInk, 0.02 * maxInk)
        : fitMoves(present, k, info.fps, minPx, quant),
    )
    .sort((a, b) => a.start_s - b.start_s);
  return {
    ...out,
    moves: printable(moves).map((m) => ({ ...m, next: undefined })),
    holds: holds(present, quant, info.fps),
  };
}
