// When things change on screen, ported from the Studio's viral-clone events.mjs: from the frame-to-frame grey
// difference inside an ROI or each cell of a grid, cuts (most of the frame changes at once), flashes (one or two
// frames that return to the picture before), appears and disappears (a region steps from one steady look to
// another), holds (still for 0.3 s or more) and other motion, each with its frame number. The map adds the sound's
// onsets and beats and groups everything into the windows worth looking at frame by frame.
import { findCuts } from "./cuts.js";
import { grey, readClip, round, videoClip, writeImage, type Roi, type VideoInfo } from "./media.js";

// The width motion-rhythm reads motion at, so its still threshold carries over.
const EVENT_W = 160;
const CUT_SHARE = 0.7;
const CUT_GRID = 4;
const HOLD_S = 0.3;
const STEP_MAX_S = 0.5;
const FLASH_FRAMES = 2;
const STRIP_MAX = 24;
const STRIP_W = 1200;
// Events closer than this share one window to look at, up to WINDOW_MAX_S: a talking head changes somewhere all
// the time, and one 20 s window shows nothing frame by frame.
const WINDOW_GAP_S = 0.25;
const WINDOW_MAX_S = 1.5;

/** A grid cell; rect is x0,y0,x1,y1 in working pixels, end exclusive. */
interface Cell {
  name: string;
  rect: [number, number, number, number];
}

export type EventType = "cut" | "flash" | "appear" | "disappear" | "change" | "hold";

export interface ScreenEvent {
  type: EventType;
  t: number;
  frame: number;
  frames?: number;
  seconds?: number;
  cells?: string[];
  roi?: number[];
  magnitude?: number;
}

/** An event with the frames and box its strip pair shows (working pixels). */
interface Shown extends ScreenEvent {
  before: number;
  after: number;
  rect: number[] | null;
}

function cells(cols: number, rows: number, w: number, h: number): Cell[] {
  return Array.from({ length: rows * cols }, (_, i) => {
    const [r, c] = [Math.floor(i / cols), i % cols];
    return {
      name: `r${r}c${c}`,
      rect: [
        Math.floor((c * w) / cols),
        Math.floor((r * h) / rows),
        Math.floor(((c + 1) * w) / cols),
        Math.floor(((r + 1) * h) / rows),
      ],
    };
  });
}

/** Mean absolute difference of two frames inside `rect`. */
function diff(a: Uint8Array, b: Uint8Array, w: number, [x0, y0, x1, y1]: number[]): number {
  let s = 0;
  for (let y = y0!; y < y1!; y++)
    for (let x = x0!; x < x1!; x++) s += Math.abs(a[y * w + x]! - b[y * w + x]!);
  return s / Math.max(1, (x1! - x0!) * (y1! - y0!));
}

/** Mean and standard deviation of grey inside `rect`. */
function level(f: Uint8Array, w: number, [x0, y0, x1, y1]: number[]) {
  let [s, s2] = [0, 0];
  for (let y = y0!; y < y1!; y++)
    for (let x = x0!; x < x1!; x++) {
      s += f[y * w + x]!;
      s2 += f[y * w + x]! ** 2;
    }
  const n = Math.max(1, (x1! - x0!) * (y1! - y0!));
  return { mean: s / n, std: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) };
}

/** Each frame's change from the one before inside `rect` (frame 0: 0). */
const changes = (g: Uint8Array[], w: number, rect: number[]) =>
  g.map((f, i) => (i ? diff(f, g[i - 1]!, w, rect) : 0));

/** Runs of frames changing by over twice the series' 25th percentile and over 2 grey levels, one quiet frame bridged. */
function bursts(d: number[]): [number, number][] {
  const q = d.slice(1).sort((a, b) => a - b);
  const act = Math.max(2, 2 * (q[Math.floor(q.length / 4)] ?? 0));
  const out: [number, number][] = [];
  for (let i = 1; i < d.length; i++) {
    if (d[i]! <= act) continue;
    const last = out.at(-1);
    if (last && i - last[1] <= 2) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

/** Still runs of HOLD_S or more by motion-rhythm's still threshold: [first frame of the held picture, its frames]. */
function stills(d: number[], fps: number): [number, number][] {
  const q = d.slice(1).sort((a, b) => a - b);
  const floor = Math.min(1.5, Math.max(0.5, 2 * (q[Math.floor(q.length / 10)] ?? 0)));
  const out: [number, number][] = [];
  for (let i = 1, run = 0; i <= d.length; i++) {
    if (i < d.length && d[i]! <= floor) run++;
    else {
      if (run + 1 >= HOLD_S * fps) out.push([i - run - 1, run + 1]);
      run = 0;
    }
  }
  return out;
}

/** Joins items whose `near(a, b)` holds, transitively. */
function groups<T>(items: T[], near: (a: T, b: T) => boolean): T[][] {
  const root = items.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (near(items[i]!, items[j]!)) root[find(i)] = find(j);
  const out = new Map<number, T[]>();
  items.forEach((it, i) => out.set(find(i), [...(out.get(find(i)) ?? []), it]));
  return [...out.values()];
}

/**
 * Frames where CUT_SHARE of the cells change by `thr` or more at once. Two such frames a frame or two apart whose
 * second returns to the picture before the first are a flash, not two cuts.
 */
function cutFrames(g: Uint8Array[], w: number, cutCells: Cell[], thr: number) {
  const d = cutCells.map((c) => changes(g, w, c.rect));
  const hits = g
    .map((_, i) => i)
    .filter((i) => i > 0 && d.filter((x) => x[i]! >= thr).length >= CUT_SHARE * cutCells.length);
  const cuts: [number, number][] = [];
  const flashes: [number, number][] = [];
  for (let k = 0; k < hits.length; k++) {
    const [i, j] = [hits[k]!, hits[k + 1]];
    const last = cuts.at(-1);
    if (
      j !== undefined &&
      j - i <= FLASH_FRAMES &&
      diff(g[j]!, g[i - 1]!, w, [0, 0, w, g[0]!.length / w]) < thr
    ) {
      flashes.push([i, j - 1]);
      k++;
    } else if (last && i === last[1] + 1)
      last[1] = i; // a whip or a short dissolve: one cut over several frames
    else cuts.push([i, i]);
  }
  return { cuts, flashes, d };
}

interface Burst {
  ci: number;
  c: Cell;
  a: number;
  b: number;
  net: number;
  peak: number;
}

/** Each region's bursts outside the cuts and flashes, split into steps, local flashes and other motion. */
// fallow-ignore-next-line complexity
function bursting(
  g: Uint8Array[],
  w: number,
  regions: Cell[],
  skip: (a: number, b: number) => boolean,
  thr: number,
  fps: number,
) {
  const settle = Math.round(HOLD_S * fps);
  const steps: Burst[] = [];
  const flashes: Burst[] = [];
  const moves: Burst[] = [];
  for (const [ci, c] of regions.entries()) {
    const d = changes(g, w, c.rect);
    for (const [a, b] of bursts(d)) {
      if (skip(a, b)) continue;
      const net = diff(g[b]!, g[a - 1]!, w, c.rect);
      const peak = Math.max(...d.slice(a, b + 1));
      const burst = { ci, c, a, b, net, peak };
      // a flash lights up for a frame or two and the region returns to how it was
      if (
        b - a + 1 <= FLASH_FRAMES &&
        peak >= 2 * thr &&
        b + 1 < g.length &&
        diff(g[b + 1]!, g[a - 1]!, w, c.rect) < thr
      ) {
        flashes.push(burst);
        continue;
      }
      // a step joins two looks that each last: the region moves under a third as much in the 0.3 s either side
      const was = diff(g[a - 1]!, g[Math.max(0, a - 1 - settle)]!, w, c.rect);
      const now = diff(g[b]!, g[Math.min(g.length - 1, b + settle)]!, w, c.rect);
      const step = net >= thr && b - a + 1 <= STEP_MAX_S * fps && Math.max(was, now) <= net / 3;
      (step ? steps : moves).push(burst);
    }
  }
  return { steps, flashes, moves };
}

export interface DetectOptions {
  info: VideoInfo;
  start: number;
  end: number;
  /** One region, or (when `grid` is given) the whole frame split into cells. */
  roi: Roi;
  grid?: { cols: number; rows: number };
  thr?: number;
}

export interface Detected {
  fps: number;
  frames: number;
  events: ScreenEvent[];
  /** Working-size RGB frames and the events a strip should show, for drawing. */
  rgb: Uint8Array[];
  w: number;
  h: number;
  shown: Shown[];
}

/** Every cut, flash, step, change and hold of a window of a video. */
export function detectEvents(opts: DetectOptions): Detected {
  const { info, start, end, roi, grid } = opts;
  const thr = opts.thr ?? 5;
  const fps = info.fps;
  const whole: Roi = [0, 0, info.width, info.height];
  const sameAsWhole = roi.every((v, i) => v === whole[i]);
  const clip = videoClip(info.path, start, end - start, info);
  const { frames: rgb, w, h } = readClip(clip, { roi, width: EVENT_W });
  const g = rgb.map(grey);
  const wholeG = sameAsWhole ? g : readClip(clip, { width: EVENT_W, gray: true }).frames;
  const wholeH = wholeG[0] ? wholeG[0].length / EVENT_W : h;
  const f0 = Math.ceil(start * fps - 1e-6);
  const at = (i: number) => ({ frame: f0 + i, t: round((f0 + i) / fps, 3) });
  if (g.length < 3) return { fps, frames: g.length, events: [], rgb, w, h, shown: [] };

  // Cuts are read on the whole frame: the grid's own cells, or with an ROI a 4x4 grid of the whole frame.
  const cutCells = cells(grid?.cols ?? CUT_GRID, grid?.rows ?? CUT_GRID, EVENT_W, wholeH);
  const cut = cutFrames(wholeG, EVENT_W, cutCells, thr);
  // A fast handheld move or whip changes most cells on frame after frame: motion, not a run of cuts. A cut is one
  // the brightness test diff uses also finds (cuts.ts), or a change that stands alone in time.
  const real = new Set(
    findCuts(wholeG).flatMap((c) => Array.from({ length: c.frames }, (_, i) => c.frame + i)),
  );
  const alone = ([i, j]: [number, number]) =>
    j === i && cut.cuts.every(([a, b]) => (a === i && b === j) || b < i - 3 || a > j + 3);
  cut.cuts = cut.cuts.filter((c) => real.has(c[0]) || alone(c));
  const single: Cell = { name: "roi", rect: [0, 0, w, h] };
  const regions = grid ? cells(grid.cols, grid.rows, w, h) : [single];
  const covered = (a: number, b: number) =>
    [...cut.cuts, ...cut.flashes].some(([x, y]) => x <= b && a <= y);
  const { steps, flashes, moves } = bursting(g, w, regions, covered, thr, fps);
  const cols = grid?.cols ?? 1;
  const touching = (s: Burst, o: Burst) =>
    Math.abs(Math.floor(s.ci / cols) - Math.floor(o.ci / cols)) <= 1 &&
    Math.abs((s.ci % cols) - (o.ci % cols)) <= 1;
  const overlap = (s: Burst, o: Burst) => s.a <= o.b + 2 && o.a <= s.b + 2;
  const [kx, ky] = [roi[2] / w, roi[3] / h];
  const event = (grp: Burst[], type: EventType, size: number): Shown => {
    const [a, b] = [Math.min(...grp.map((s) => s.a)), Math.max(...grp.map((s) => s.b))];
    const rect = [0, 1, 2, 3].map((k) =>
      (k < 2 ? Math.min : Math.max)(...grp.map((s) => s.c.rect[k]!)),
    );
    const where = grid
      ? {
          cells: [...new Set(grp.map((s) => s.c.name))].sort(),
          roi: [
            rect[0]! * kx + roi[0],
            rect[1]! * ky + roi[1],
            (rect[2]! - rect[0]!) * kx,
            (rect[3]! - rect[1]!) * ky,
          ].map(Math.round),
        }
      : {};
    return {
      type,
      ...at(a),
      frames: b - a + 1,
      ...where,
      magnitude: round(size, 1),
      before: a - 1,
      after: b,
      rect: grid ? rect : null,
    };
  };
  const stepEvents = groups(steps, (s, o) => overlap(s, o) && touching(s, o)).map((grp) => {
    const e = event(grp, "change", grp.reduce((m, s) => m + s.net, 0) / grp.length);
    const box = e.rect ?? [0, 0, w, h];
    const [was, now] = [level(g[e.before]!, w, box), level(g[e.after]!, w, box)];
    const up = Math.abs(now.std - was.std) >= 2 ? now.std > was.std : now.mean > was.mean;
    return { ...e, type: up ? ("appear" as const) : ("disappear" as const) };
  });
  const flashEvents = [
    ...groups(flashes, (s, o) => overlap(s, o) && touching(s, o)).map((grp) =>
      event(grp, "flash", Math.max(...grp.map((s) => s.peak))),
    ),
    ...cut.flashes.map(([i, j]) => ({
      type: "flash" as const,
      ...at(i),
      frames: j - i + 1,
      magnitude: round(cut.d.reduce((m, d) => m + d[i]!, 0) / cut.d.length, 1),
      before: i - 1,
      after: i,
      rect: null,
    })),
  ];
  const moveEvents = groups(moves, overlap).map((grp) =>
    event(grp, "change", Math.max(...grp.map((s) => s.peak))),
  );
  const cutEvents: Shown[] = cut.cuts.map(([i, j]) => ({
    type: "cut",
    ...at(i),
    ...(j > i ? { frames: j - i + 1 } : {}),
    magnitude: round(cut.d.reduce((m, d) => m + d[i]!, 0) / cut.d.length, 1),
    before: i - 1,
    after: j,
    rect: null,
  }));
  const still = changes(grid ? wholeG : g, EVENT_W, [0, 0, EVENT_W, grid ? wholeH : h]);
  const held: ScreenEvent[] = stills(still, fps).map(([i, n]) => ({
    type: "hold",
    ...at(i),
    seconds: round(n / fps, 2),
  }));

  // The strip keeps the biggest: cuts and flashes, then steps by cells × magnitude, then changes by magnitude.
  const weight = (e: Shown) => (e.cells?.length ?? 1) * (e.magnitude ?? 0);
  const order = (x: ScreenEvent, y: ScreenEvent) => x.frame - y.frame;
  const shown = [
    ...cutEvents,
    ...flashEvents,
    ...[...stepEvents].sort((x, y) => weight(y) - weight(x)),
    ...[...moveEvents].sort((x, y) => (y.magnitude ?? 0) - (x.magnitude ?? 0)),
  ]
    .slice(0, STRIP_MAX)
    .sort(order);
  const plain = ({ before: _b, after: _a, rect: _r, ...e }: Shown): ScreenEvent => e;
  const events = [...cutEvents, ...flashEvents, ...stepEvents, ...moveEvents].map(plain);
  return { fps, frames: g.length, events: [...events, ...held].sort(order), rgb, w, h, shown };
}

/** One picture of each shown event's before|after pair, its region boxed in red. */
export function drawStrip(d: Detected, out: string): string {
  const { rgb, w, h, shown } = d;
  const per = Math.max(1, Math.floor(STRIP_W / (2 * w + 12)));
  const cw = per * (2 * w + 12);
  const ch = Math.ceil(shown.length / per) * (h + 8);
  const px = new Uint8Array(cw * ch * 3).fill(255);
  shown.forEach((e, k) => {
    const [ox, oy] = [(k % per) * (2 * w + 12), Math.floor(k / per) * (h + 8)];
    [e.before, e.after].forEach((f, side) => {
      const x0 = ox + side * (w + 2);
      for (let y = 0; y < h; y++)
        px.set(rgb[f]!.subarray(y * w * 3, (y + 1) * w * 3), ((oy + y) * cw + x0) * 3);
      if (!e.rect) return;
      const [rx0, ry0, rx1, ry1] = e.rect;
      for (let y = ry0!; y < ry1!; y++)
        for (let x = rx0!; x < rx1!; x++)
          if (y === ry0 || y === ry1! - 1 || x === rx0 || x === rx1! - 1)
            px.set([255, 0, 0], ((oy + y) * cw + x0 + x) * 3);
    });
  });
  return writeImage(out, px, cw, ch);
}

export interface LookWindow {
  start: number;
  end: number;
  /** What happens, e.g. "cut", "appear r1c2,r1c3", "flash 1f". */
  what: string[];
  /** Sound onsets inside the window, seconds. */
  onsets?: number[];
  /** The frames its events start on: a strip of the window must show these. */
  onset_frames: number[];
}

/** Every event but holds, merged into the windows worth looking at frame by frame, two frames padded either side. */
export function lookWindows(
  events: ScreenEvent[],
  fps: number,
  onsets: number[] = [],
): LookWindow[] {
  const pad = 2 / fps;
  const spans = events
    .filter((e) => e.type !== "hold")
    .map((e) => {
      const where = e.cells ? ` ${e.cells.join(",")}` : "";
      const len = e.type === "flash" ? ` ${e.frames}f` : "";
      return {
        a: e.t - pad,
        b: e.t + ((e.frames ?? 1) - 1) / fps + pad,
        what: `${e.type}${where}${len}`,
        frame: e.frame,
      };
    })
    .sort((x, y) => x.a - y.a);
  const out: Omit<LookWindow, "onsets">[] = [];
  for (const s of spans) {
    const last = out.at(-1);
    if (last && s.a - last.end <= WINDOW_GAP_S && s.b - last.start <= WINDOW_MAX_S) {
      last.end = Math.max(last.end, s.b);
      last.what.push(s.what);
      last.onset_frames.push(s.frame);
    } else out.push({ start: s.a, end: s.b, what: [s.what], onset_frames: [s.frame] });
  }
  return out.map((wnd) => {
    const hits = onsets.filter((t) => t >= wnd.start && t <= wnd.end);
    return {
      start: round(Math.max(0, wnd.start), 3),
      end: round(wnd.end, 3),
      what: wnd.what,
      ...(hits.length ? { onsets: hits.map((t) => round(t, 3)) } : {}),
      onset_frames: [...new Set(wnd.onset_frames)].sort((x, y) => x - y),
    };
  });
}

/** How many of each type, for a summary line. */
export function countEvents(events: ScreenEvent[]): Record<EventType, number> {
  const count = (type: EventType) => events.filter((e) => e.type === type).length;
  return {
    cut: count("cut"),
    flash: count("flash"),
    appear: count("appear"),
    disappear: count("disappear"),
    change: count("change"),
    hold: count("hold"),
  };
}
