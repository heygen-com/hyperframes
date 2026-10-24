// A rebuild against its original, frame by frame: per-frame SSIM on the original's clock for the whole frame and
// each cell of a 4x4 grid, the worst moments with their worst cell boxed, cuts on both sides, and per-segment
// verdicts. The second side is a video file (a render) or a project folder, whose frames are captured at the
// original's frame times without rendering.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findCuts, signatures } from "./cuts.js";
import { compareEnergy, energyCurve, type EnergyComparison } from "./energy.js";
import { compareLook, look, sameLook, type LookComparison } from "./look.js";
import {
  decode,
  Fix,
  frameAt,
  probeVideo,
  round,
  runFfmpeg,
  videoClip,
  writeImage,
  type Clip,
  type VideoInfo,
} from "./media.js";
import type { Segment } from "./segments.js";

// To be calibrated on the reverse bench; light-reverse's rebuilt moments scored 0.885–0.958 mean SSIM.
export const DEFAULT_MIN_MEAN = 0.92;
export const DEFAULT_MIN_P05 = 0.85;
/**
 * The worst cell of most frames: a missing or misplaced element drags one cell, not the frame. Provisional: four
 * no-API rebuilds scored 0.67–0.98 and synthetic wrong elements 0.71–0.76.
 */
export const DEFAULT_MIN_CELL = 0.75;
// A regenerated shot moves about as much as the original's.
/** The worst-moment pictures a run writes, cleared before the next so a shorter list leaves none behind. */
const OWN_WORST = /^worst-\d{2}-(?:cell|original|yours)\.png$/;
const ENERGY_RATIO: [number, number] = [0.8, 1.25];
const GRID = 4;
const WORST_GAP_S = 0.5;
const SHEET_W = 960;
const CUT_SLACK = 1;
// Missing content: cells are read at this width, from at most this many frames. A cell whose luma spread in the
// original reaches MISSING_DETAIL while yours is flat (under MISSING_FLAT and MISSING_KEEP of the original's) is
// empty; over MISSING_MAX_SHARE of frames with an empty cell fails. A weaker blur or a missing small label is not
// empty: SSIM and its cell gate grade those (provisional, calibrated on the reverse bench).
const MISSING_W = 192;
const MISSING_SAMPLES = 1800;
const MISSING_DETAIL = 8;
const MISSING_KEEP = 0.35;
const MISSING_FLAT = 4;
const MISSING_MAX_SHARE = 0.02;

/** Which of the original's frames are compared. */
export type Pick =
  | { kind: "all" }
  | { kind: "range"; k0: number; k1: number }
  | { kind: "at"; ks: number[] };

export interface Thresholds {
  mean: number;
  p05: number;
  cell: number;
}

export interface DiffOptions {
  reference: string;
  /** A video file, or a project folder holding index.html. */
  yours: string;
  at?: number[];
  range?: [number, number];
  segments?: Segment[];
  thresholds?: Partial<Thresholds>;
  worst?: number;
  sbs?: boolean;
  outDir: string;
  /** Render-ready timeout for a project folder's capture. */
  timeoutMs?: number;
  log?: (message: string) => void;
}

export interface Scores {
  frames: number;
  mean: number;
  p05: number;
  min: number;
  /** The 5th percentile of each frame's worst cell. */
  cell_p05: number;
}

export interface Moment {
  t: number;
  frame: number;
  ssim: number;
  /** The frame's worst cell of a 4x4 grid, in the original's pixels, and both sides of it at full size. */
  cell: { roi: [number, number, number, number]; ssim: number; picture: string };
}

export interface SegmentVerdict {
  id: string;
  window: [number, number];
  pixels: Segment["pixels"];
  pass: boolean | null;
  ssim?: Scores;
  energy?: EnergyComparison;
  look?: LookComparison;
  note?: string;
}

export interface CutReport {
  reference: number[];
  yours: number[];
  /** The original's cuts with no cut within a frame of them in yours. */
  missing: number[];
  extra: number[];
  pass: boolean;
}

export interface MissingContent {
  /** Share of compared frames with a cell the original fills and yours leaves flat. */
  share: number;
  /** The longest such stretches, in seconds. */
  spans: [number, number][];
  pass: boolean;
}

export interface DiffResult {
  pass: boolean;
  reference: string;
  yours: string;
  mode: "video" | "project";
  window: [number, number];
  thresholds: Thresholds;
  ssim: Scores;
  missing_content: MissingContent;
  worst: Moment[];
  cuts?: CutReport;
  duration?: { reference: number; yours: number; pass: boolean };
  sound?: ReturnType<typeof soundOffset>;
  segments?: SegmentVerdict[];
  sheet?: string;
  sbs?: string;
  log: string;
  /** Every compared frame's SSIM and worst cell. */
  frames: string;
  warnings: string[];
}

interface Series {
  /** Whole-frame SSIM per compared frame. */
  frame: number[];
  /** Each frame's 16 cell scores, row by row. */
  cells: number[][];
}

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

function scores(frame: number[], worstCell: number[]): Scores {
  const sorted = [...frame].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    frames: n,
    mean: round(n ? sorted.reduce((s, v) => s + v, 0) / n : 0, 4),
    p05: round(pct(sorted, 0.05), 4),
    min: round(sorted[0] ?? 0, 4),
    cell_p05: round(
      pct(
        [...worstCell].sort((a, b) => a - b),
        0.05,
      ),
      4,
    ),
  };
}

const passes = (s: Scores, t: Thresholds) =>
  s.frames > 0 && s.mean >= t.mean && s.p05 >= t.p05 && s.cell_p05 >= t.cell;

/** The original's frame indexes a pick compares, in order. */
export function pickedFrames(pick: Pick, total: number): number[] {
  if (pick.kind === "at") return pick.ks;
  const [k0, k1] = pick.kind === "range" ? [pick.k0, pick.k1] : [0, total];
  return Array.from({ length: Math.max(0, k1 - k0) }, (_, i) => k0 + i);
}

/** The filters that keep a pick's frames of a stream, renumbered from 0 on the original's clock. */
export function selectFilter(pick: Pick, fpsText: string): string[] {
  const pts = `setpts=N/(${fpsText})/TB`;
  if (pick.kind === "all") return [];
  if (pick.kind === "range") return [`select=between(n\\,${pick.k0}\\,${pick.k1 - 1})`, pts];
  return [`select=${pick.ks.map((k) => `eq(n\\,${k})`).join("+")}`, pts];
}

/** Even cell sizes keep 4:2:0 chroma aligned; the last row and column drop at most a pixel or two. */
const cellSize = (w: number, h: number): [number, number] => [
  Math.floor(w / (2 * GRID)) * 2,
  Math.floor(h / (2 * GRID)) * 2,
];

/**
 * Per-frame SSIM (ffmpeg's All: luma and chroma) of yours against the original, in the pick's order, for the
 * whole frame and each cell: a wrong box over an eighth of the frame still scores 0.94 whole-frame.
 */
function ssimSeries(ref: Clip, yours: Clip, logPath: string): Series {
  const side = (filters: string[]) => [...filters, "setsar=1", "format=yuv420p"].join(",");
  const n = GRID * GRID + 1;
  const tags = (p: string) => Array.from({ length: n }, (_, i) => `[${p}${i}]`).join("");
  const [cw, ch] = cellSize(ref.width, ref.height);
  const graph = [
    `[0:v]${side(ref.filters)},split=${n}${tags("r")}`,
    `[1:v]${side([...yours.filters, `scale=${ref.width}:${ref.height}:flags=bicubic`])},split=${n}${tags("o")}`,
    "[o0][r0]ssim=stats_file=-:shortest=1[s0]",
    ...Array.from({ length: GRID * GRID }, (_, i) => {
      const crop = `crop=${cw}:${ch}:${(i % GRID) * cw}:${Math.floor(i / GRID) * ch}`;
      const k = i + 1;
      return `[r${k}]${crop}[rc${k}];[o${k}]${crop}[oc${k}];[oc${k}][rc${k}]ssim=stats_file=cell${i}.log:shortest=1[s${k}]`;
    }),
  ].join(";");
  // Cell logs are written beside ffmpeg's working folder, so their names need no filtergraph escaping.
  const work = mkdtempSync(join(tmpdir(), "hf-diff-cells-"));
  const all = (text: string) => [...text.matchAll(/All:([\d.]+)/g)].map((m) => Number(m[1]));
  try {
    const maps = Array.from({ length: n }, (_, i) => ["-map", `[s${i}]`]).flat();
    const text = runFfmpeg(
      [...ref.input, ...yours.input, "-filter_complex", graph, ...maps, "-f", "null", "-"],
      undefined,
      work,
    ).toString();
    writeFileSync(logPath, text);
    const frame = all(text);
    const perCell = Array.from({ length: GRID * GRID }, (_, i) =>
      all(readFileSync(join(work, `cell${i}.log`), "utf8")),
    );
    return { frame, cells: frame.map((_, f) => perCell.map((cell) => cell[f] ?? 1)) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Stretches where a cell the original fills is flat in yours. SSIM scores two near-blank patches alike, so a scene
 * left empty on a plain background passes SSIM and its cell gate; this compares each cell's luma spread instead.
 */
function missingContent(ref: Clip, yours: Clip, ks: number[], fps: number): MissingContent {
  const stride = Math.max(1, Math.ceil(ks.length / MISSING_SAMPLES));
  const w = MISSING_W;
  const h = Math.max(GRID * 2, Math.round((w * ref.height) / ref.width / GRID) * GRID);
  const thin =
    stride > 1 ? [`select=not(mod(n\\,${stride}))`, `setpts=N/(${fps / stride})/TB`] : [];
  const spreads = (clip: Clip) =>
    decode(clip.input, [...clip.filters, ...thin, `scale=${w}:${h}`], w, h, true).frames.map((px) =>
      cellSpreads(px, w, h),
    );
  const [a, b] = [spreads(ref), spreads(yours)];
  // The thinning select can pass one frame past the pick; times come from ks, so stop with it.
  const n = Math.min(a.length, b.length, Math.ceil(ks.length / stride));
  const empty = Array.from({ length: n }, (_, j) =>
    a[j]!.some(
      (s, c) => s >= MISSING_DETAIL && b[j]![c]! < Math.min(MISSING_FLAT, MISSING_KEEP * s),
    ),
  );
  const spans: [number, number][] = [];
  empty.forEach((e, j) => {
    if (!e) return;
    const t = round(ks[j * stride]! / fps, 3);
    const last = spans.at(-1);
    if (last && empty[j - 1])
      last[1] = round((ks[Math.min(ks.length - 1, (j + 1) * stride - 1)]! + 1) / fps, 3);
    else spans.push([t, round((ks[Math.min(ks.length - 1, (j + 1) * stride - 1)]! + 1) / fps, 3)]);
  });
  const share = n ? empty.filter(Boolean).length / n : 0;
  return {
    share: round(share, 4),
    spans: spans
      .sort((x, y) => y[1] - y[0] - (x[1] - x[0]))
      .slice(0, 8)
      .sort((x, y) => x[0] - y[0]),
    pass: share <= MISSING_MAX_SHARE,
  };
}

/** Each grid cell's luma standard deviation, row by row. */
function cellSpreads(px: Uint8Array, w: number, h: number): number[] {
  const [cw, ch] = [Math.floor(w / GRID), Math.floor(h / GRID)];
  return Array.from({ length: GRID * GRID }, (_, c) => {
    const [x0, y0] = [(c % GRID) * cw, Math.floor(c / GRID) * ch];
    let [s, ss] = [0, 0];
    for (let y = y0; y < y0 + ch; y++)
      for (let x = x0; x < x0 + cw; x++) {
        const v = px[y * w + x]!;
        s += v;
        ss += v * v;
      }
    const m = s / (cw * ch);
    return Math.sqrt(Math.max(0, ss / (cw * ch) - m * m));
  });
}

/** The `count` frames with the lowest worst cell, at least WORST_GAP_S apart; near-perfect frames are skipped. */
function worstIndexes(worstCell: number[], ks: number[], fps: number, count: number): number[] {
  const order = worstCell
    .map((_, i) => i)
    .filter((i) => worstCell[i]! < 0.98)
    .sort((a, b) => worstCell[a]! - worstCell[b]!);
  const out: number[] = [];
  for (const i of order) {
    if (out.length >= count) break;
    if (out.every((j) => Math.abs(ks[i]! - ks[j]!) / fps >= WORST_GAP_S)) out.push(i);
  }
  return out.sort((a, b) => ks[a]! - ks[b]!);
}

/** One frame of a clip (its i-th after the clip's own filters) at `w`x`h` RGB. */
function frameOf(clip: Clip, i: number, w: number, h: number): Uint8Array {
  const { frames } = decode(
    clip.input,
    [...clip.filters, `select=eq(n\\,${i})`, `scale=${w}:${h}`],
    w,
    h,
    false,
    1,
  );
  if (!frames[0]) throw new Fix(`could not read frame ${i}`, "check both videos play to their end");
  return frames[0];
}

/** A red rectangle drawn into RGB bytes, clipped to the picture (a scaled box can round a pixel past its edge). */
function outline(px: Uint8Array, w: number, [x, y, bw, bh]: number[], t = 3) {
  const h = px.length / 3 / w;
  for (let yy = y!; yy < Math.min(h, y! + bh!); yy++)
    for (let xx = x!; xx < Math.min(w, x! + bw!); xx++) {
      const edge = yy - y! < t || y! + bh! - 1 - yy < t || xx - x! < t || x! + bw! - 1 - xx < t;
      if (edge) px.set([255, 40, 40], (yy * w + xx) * 3);
    }
}

function cutReport(ref: Clip, yours: Clip, k0: number, fps: number): CutReport {
  const a = findCuts(signatures(ref.input, ref.filters).frames).map((c) => c.frame);
  const b = findCuts(signatures(yours.input, yours.filters).frames).map((c) => c.frame);
  const used = new Set<number>();
  const missing: number[] = [];
  for (const f of a) {
    const hit = b.find((g) => !used.has(g) && Math.abs(g - f) <= CUT_SLACK);
    if (hit === undefined) missing.push(f);
    else used.add(hit);
  }
  const t = (f: number) => round((k0 + f) / fps, 3);
  return {
    reference: a.map(t),
    yours: b.map(t),
    missing: missing.map(t),
    extra: b.filter((g) => !used.has(g)).map(t),
    pass: missing.length === 0 && b.length === used.size,
  };
}

/** Captures a project's frames at the original's frame times as a numbered picture sequence. */
async function captureProject(
  projectDir: string,
  times: number[],
  opts: DiffOptions,
  ref: VideoInfo,
): Promise<{ clip: Clip; dir: string }> {
  const { captureSnapshots } = await import("../commands/snapshot.js");
  const shots = mkdtempSync(join(tmpdir(), "hf-diff-shots-"));
  const seq = mkdtempSync(join(tmpdir(), "hf-diff-seq-"));
  try {
    const captured = await captureSnapshots(projectDir, {
      at: times,
      includeEnd: false,
      outputDir: shots,
      timeout: opts.timeoutMs,
      log: opts.log ?? (() => {}),
      recordInHistory: false,
    });
    if (captured.paths.length !== times.length)
      throw new Fix(
        `captured ${captured.paths.length} of ${times.length} frames from ${projectDir}`,
        "run npx hyperframes check on the project, then diff again",
      );
    captured.paths.forEach((p, i) =>
      copyFileSync(resolve(projectDir, p), join(seq, `${String(i).padStart(6, "0")}.png`)),
    );
  } catch (err) {
    rmSync(seq, { recursive: true, force: true });
    throw err;
  } finally {
    rmSync(shots, { recursive: true, force: true });
  }
  return {
    dir: seq,
    clip: {
      input: ["-framerate", ref.fpsText, "-i", join(seq, "%06d.png")],
      filters: [],
      width: ref.width,
      height: ref.height,
      fps: ref.fps,
    },
  };
}

function regeneratedVerdict(s: Segment, reference: string, yours: string, ref: VideoInfo) {
  const seconds = s.end - s.start;
  const [a, b] = [videoClip(reference, s.start, seconds, ref), videoClip(yours, s.start, seconds)];
  const energy = compareEnergy(energyCurve(a), energyCurve(b));
  const looks = compareLook(look(a), look(b));
  const moves = energy.mean_ratio >= ENERGY_RATIO[0] && energy.mean_ratio <= ENERGY_RATIO[1];
  return { pass: moves && sameLook(looks), energy, look: looks };
}

function segmentVerdicts(
  segments: Segment[],
  series: Series,
  worstCell: number[],
  ks: number[],
  ctx: {
    reference: string;
    yours: string;
    ref: VideoInfo;
    mode: DiffResult["mode"];
    t: Thresholds;
  },
): SegmentVerdict[] {
  return segments.map((s) => {
    const head = { id: s.id, window: [s.start, s.end] as [number, number], pixels: s.pixels };
    if (s.pixels === "regenerated")
      return ctx.mode === "video"
        ? { ...head, ...regeneratedVerdict(s, ctx.reference, ctx.yours, ctx.ref) }
        : {
            ...head,
            pass: null,
            note: "regenerated pixels are judged by motion and look: diff a render",
          };
    const [a, b] = [frameAt(s.start, ctx.ref.fps), frameAt(s.end, ctx.ref.fps)];
    const mine = ks.flatMap((k, i) => (k >= a && k < b && i < series.frame.length ? [i] : []));
    if (!mine.length)
      return { ...head, pass: null, note: "no compared frame falls in this segment" };
    const st = scores(
      mine.map((i) => series.frame[i]!),
      mine.map((i) => worstCell[i]!),
    );
    return { ...head, pass: passes(st, ctx.t), ssim: st };
  });
}

/** The compared frames no measured segment speaks for, judged on their pixels: a segment that measured nothing
 * (or a window outside every segment) must not let a failing comparison pass. */
function uncoveredPass(
  segments: SegmentVerdict[],
  series: Series,
  worstCell: number[],
  ks: number[],
  fps: number,
  t: Thresholds,
  warnings: string[],
): boolean {
  const measured = segments.filter((s) => s.pass !== null);
  const inMeasured = (k: number) =>
    measured.some((s) => k >= frameAt(s.window[0], fps) && k < frameAt(s.window[1], fps));
  const rest = series.frame.flatMap((_, i) => (inMeasured(ks[i]!) ? [] : [i]));
  if (!rest.length) return true;
  const unmeasured = segments.filter((s) => s.pass === null).map((s) => s.id);
  warnings.push(
    `${rest.length} compared frame(s) fall in no measured segment${unmeasured.length ? ` (${unmeasured.join(", ")} measured nothing)` : ""}: they are judged on their pixels`,
  );
  return passes(
    scores(
      rest.map((i) => series.frame[i]!),
      rest.map((i) => worstCell[i]!),
    ),
    t,
  );
}

async function worstMoments(
  picks: number[],
  ctx: { refClip: Clip; yours: Clip; series: Series; ks: number[]; ref: VideoInfo; outDir: string },
): Promise<{ worst: Moment[]; sheet?: string }> {
  const { ref, series } = ctx;
  const sw = Math.min(SHEET_W, ref.width);
  const sh = Math.max(2, Math.round((ref.height * sw) / ref.width / 2) * 2);
  const [cw, ch] = cellSize(ref.width, ref.height);
  const worst: Moment[] = [];
  const images: string[] = [];
  const labels: string[] = [];
  for (const [n, i] of picks.entries()) {
    const cells = series.cells[i]!;
    const c = cells.indexOf(Math.min(...cells));
    const roi: Moment["cell"]["roi"] = [(c % GRID) * cw, Math.floor(c / GRID) * ch, cw, ch];
    const scaled = roi.map((v, j) =>
      Math.round((v * (j % 2 ? sh : sw)) / (j % 2 ? ref.height : ref.width)),
    );
    const t = round(ctx.ks[i]! / ref.fps, 3);
    const tag = `worst-${String(n + 1).padStart(2, "0")}`;
    // The failing cell at full size, original | yours, to read text and edges.
    const [fa, fb] = [
      frameOf(ctx.refClip, i, ref.width, ref.height),
      frameOf(ctx.yours, i, ref.width, ref.height),
    ];
    const pair = new Uint8Array((2 * cw + 4) * ch * 3).fill(255);
    for (let y = 0; y < ch; y++)
      [fa, fb].forEach((f, side) =>
        pair.set(
          f.subarray(
            ((roi[1] + y) * ref.width + roi[0]) * 3,
            ((roi[1] + y) * ref.width + roi[0] + cw) * 3,
          ),
          (y * (2 * cw + 4) + side * (cw + 4)) * 3,
        ),
      );
    const cellPicture = writeImage(join(ctx.outDir, `${tag}-cell.png`), pair, 2 * cw + 4, ch);
    const [a, b] = [frameOf(ctx.refClip, i, sw, sh), frameOf(ctx.yours, i, sw, sh)];
    outline(a, sw, scaled);
    outline(b, sw, scaled);
    images.push(writeImage(join(ctx.outDir, `${tag}-original.png`), a, sw, sh));
    images.push(writeImage(join(ctx.outDir, `${tag}-yours.png`), b, sw, sh));
    labels.push(
      `original ${t}s`,
      `yours ${t}s · ssim ${round(series.frame[i]!, 3)} · cell ${round(cells[c]!, 2)}`,
    );
    worst.push({
      t,
      frame: ctx.ks[i]!,
      ssim: round(series.frame[i]!, 4),
      cell: { roi, ssim: round(cells[c]!, 3), picture: cellPicture },
    });
  }
  if (!images.length) return { worst };
  const { createContactSheet } = await import("../capture/contactSheet.js");
  const sheet = await createContactSheet(images, join(ctx.outDir, "worst.jpg"), {
    cols: 2,
    maxImages: images.length,
    cellWidth: 640,
    labelMode: "custom",
    labels,
  });
  return { worst, ...(sheet ? { sheet } : {}) };
}

/** Loudness every 10 ms of the first 20 s, as a rising-edge curve: where sounds start. */
function onsetCurve(path: string): number[] {
  // Padded from time 0, so a track that starts late reads late.
  const raw = runFfmpeg([
    "-i",
    path,
    "-vn",
    "-af",
    "aresample=async=1:first_pts=0",
    "-t",
    "20",
    "-ac",
    "1",
    "-ar",
    "8000",
    "-f",
    "f32le",
    "-",
  ]);
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const rms: number[] = [];
  for (let i = 0; i + 80 <= samples.length; i += 80) {
    let s = 0;
    for (let j = i; j < i + 80; j++) s += samples[j]! ** 2;
    rms.push(Math.sqrt(s / 80));
  }
  return rms.map((v, i) => Math.max(0, v - (rms[i - 1] ?? v)));
}

/** Sound starts in an onset curve: rises over a quarter of its largest, at least 0.1 s apart. */
function starts(curve: number[]): number {
  const floor = 0.25 * Math.max(0, ...curve);
  let [n, last] = [0, -Infinity];
  for (const [i, v] of curve.entries())
    if (v > floor && floor > 0 && i - last >= 10) [n, last] = [n + 1, i];
  return n;
}

/** How far yours' sound sits from the original's (positive: yours is late), from where sounds start. */
// fallow-ignore-next-line complexity
function soundOffset(reference: string, yours: string, ref: VideoInfo, mine: VideoInfo) {
  if (!ref.audio || !mine.audio)
    return { original: ref.audio, yours: mine.audio, pass: ref.audio === mine.audio };
  const [a, b] = [onsetCurve(reference), onsetCurve(yours)];
  let best: [number, number] = [-2, 0];
  for (let lag = -50; lag <= 50; lag++) {
    const n = Math.min(a.length, b.length) - Math.abs(lag);
    if (n < 50) continue;
    let [sab, sa, sb, ma, mb] = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      ma += a[i + Math.max(0, -lag)]!;
      mb += b[i + Math.max(0, lag)]!;
    }
    [ma, mb] = [ma / n, mb / n];
    for (let i = 0; i < n; i++) {
      const [x, y] = [a[i + Math.max(0, -lag)]! - ma, b[i + Math.max(0, lag)]! - mb];
      sab += x * y;
      sa += x * x;
      sb += y * y;
    }
    const r = sa && sb ? sab / Math.sqrt(sa * sb) : -2;
    if (r > best[0]) best = [r, lag];
  }
  const offset = best[1] * 10;
  if (best[0] <= 0.3)
    // Steady sound (a held pad, room tone) has too few starts to align, so it is unmeasured; distinct sounds that
    // match at no lag within ±0.5 s are further off than that, which fails.
    return Math.min(starts(a), starts(b)) < 3
      ? {
          offset_ms: null,
          match: round(best[0], 2),
          pass: null,
          note: "too few distinct sounds to align",
        }
      : {
          offset_ms: null,
          match: round(best[0], 2),
          pass: false,
          note: "the sounds line up at no offset within ±0.5 s",
        };
  return { offset_ms: offset, match: round(best[0], 2), pass: Math.abs(offset) <= 1000 / ref.fps };
}

function sideBySide(reference: string, yours: string, ref: VideoInfo, out: string): string {
  runFfmpeg([
    ...["-y", "-i", reference, "-i", yours, "-filter_complex"],
    `[0:v]setsar=1[a];[1:v]scale=${ref.width}:${ref.height},setsar=1[b];[a][b]hstack=inputs=2,pad=ceil(iw/2)*2:ceil(ih/2)*2[v]`,
    ...["-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p"],
    ...["-c:a", "aac", "-shortest", out],
  ]);
  return out;
}

function choosePick(opts: DiffOptions, ref: VideoInfo): Pick {
  if (opts.at)
    return {
      kind: "at",
      ks: [...new Set(opts.at.map((t) => frameAt(t, ref.fps)))].sort((x, y) => x - y),
    };
  if (opts.range)
    return {
      kind: "range",
      k0: frameAt(opts.range[0], ref.fps),
      k1: Math.min(ref.frames, Math.ceil(opts.range[1] * ref.fps - 1e-6)),
    };
  return { kind: "all" };
}

// fallow-ignore-next-line complexity
export async function diffVideos(options: DiffOptions): Promise<DiffResult> {
  // ffmpeg runs in a scratch folder (see ssimSeries), so every path it reads is absolute.
  const opts = { ...options, reference: resolve(options.reference), yours: resolve(options.yours) };
  const ref = probeVideo(opts.reference);
  const warnings: string[] = [];
  if (ref.vfr)
    warnings.push(
      "the original's frame rate varies, so frame times drift: npx hyperframes measure probe makes a constant-rate copy",
    );
  const mode = existsSync(opts.yours) && statSync(opts.yours).isDirectory() ? "project" : "video";
  if (mode === "project" && !existsSync(join(opts.yours, "index.html")))
    throw new Fix(`${opts.yours} has no index.html`, "pass a project folder or a rendered video");
  if (mode === "project" && !opts.at && !opts.range && opts.segments?.length)
    opts.range = [
      Math.min(...opts.segments.map((s) => s.start)),
      Math.max(...opts.segments.map((s) => s.end)),
    ];
  if (mode === "project" && !opts.at && !opts.range)
    throw new Fix(
      "a project folder is compared at chosen times, not whole",
      "pass --at t1,t2 or --range start,end, or render it and diff the render",
    );
  const pick = choosePick(opts, ref);
  const ks = pickedFrames(pick, ref.frames);
  if (!ks.length || ks.some((k) => k >= ref.frames))
    throw new Fix(
      `the original has ${ref.frames} frames (${round(ref.duration, 2)} s)`,
      "pick times inside it",
    );

  const select = selectFilter(pick, ref.fpsText);
  const refClip: Clip = { ...videoClip(opts.reference, 0, undefined, ref), filters: select };
  let yours: Clip;
  let seqDir: string | undefined;
  let yoursInfo: VideoInfo | undefined;
  if (mode === "project") {
    const captured = await captureProject(
      opts.yours,
      ks.map((k) => k / ref.fps),
      opts,
      ref,
    );
    [yours, seqDir] = [captured.clip, captured.dir];
  } else {
    yoursInfo = probeVideo(opts.yours);
    yours = {
      ...videoClip(opts.yours, 0, undefined, yoursInfo),
      filters: [`fps=${ref.fpsText}`, ...select],
    };
  }

  try {
    mkdirSync(opts.outDir, { recursive: true });
    const inputs = new Set([resolve(opts.reference), resolve(opts.yours)]);
    for (const f of readdirSync(opts.outDir))
      if (OWN_WORST.test(f) && !inputs.has(resolve(opts.outDir, f)))
        rmSync(join(opts.outDir, f), { force: true });
    const logPath = join(opts.outDir, "ssim.log");
    const series = ssimSeries(refClip, yours, logPath);
    if (!series.frame.length)
      throw new Fix("ffmpeg compared no frames", "check both videos play and overlap in time");
    if (series.frame.length < ks.length)
      warnings.push(`yours ends early: ${series.frame.length} of ${ks.length} frames compared`);
    const worstCell = series.cells.map((cells) => Math.min(...cells));
    // Every compared frame, to find the stretches that fail.
    writeFileSync(
      join(opts.outDir, "frames.tsv"),
      [
        "t\tframe\tssim\tworst_cell\tcell",
        ...series.frame.map((v, i) => {
          const c = series.cells[i]!.indexOf(worstCell[i]!);
          return [
            round(ks[i]! / ref.fps, 3),
            ks[i],
            round(v, 4),
            round(worstCell[i]!, 4),
            `r${Math.floor(c / GRID)}c${c % GRID}`,
          ].join("\t");
        }),
      ].join("\n") + "\n",
    );
    const t: Thresholds = {
      mean: opts.thresholds?.mean ?? DEFAULT_MIN_MEAN,
      p05: opts.thresholds?.p05 ?? DEFAULT_MIN_P05,
      cell: opts.thresholds?.cell ?? DEFAULT_MIN_CELL,
    };
    const overall = scores(series.frame, worstCell);
    const missing = missingContent(refClip, yours, ks, ref.fps);
    if (!missing.pass)
      warnings.push(
        `${Math.round(missing.share * 100)}% of frames leave empty what the original fills (${missing.spans.map(([a, b]) => `${a}–${b} s`).join(", ")}): build what is missing there`,
      );
    const picks = worstIndexes(worstCell, ks, ref.fps, opts.worst ?? 4);
    const { worst, sheet } = await worstMoments(picks, {
      refClip,
      yours,
      series,
      ks,
      ref,
      outDir: opts.outDir,
    });
    const cuts = pick.kind === "at" ? undefined : cutReport(refClip, yours, ks[0]!, ref.fps);
    const duration =
      yoursInfo && pick.kind === "all"
        ? {
            reference: round(ref.duration, 3),
            yours: round(yoursInfo.duration, 3),
            pass: Math.abs(ref.duration - yoursInfo.duration) <= 1.5 / ref.fps,
          }
        : undefined;
    const segments = opts.segments
      ? segmentVerdicts(opts.segments, series, worstCell, ks, {
          reference: opts.reference,
          yours: opts.yours,
          ref,
          mode,
          t,
        })
      : undefined;
    const sound =
      yoursInfo && pick.kind === "all"
        ? soundOffset(opts.reference, opts.yours, ref, yoursInfo)
        : undefined;
    const sbs =
      opts.sbs && mode === "video"
        ? sideBySide(opts.reference, opts.yours, ref, join(opts.outDir, "sbs.mp4"))
        : undefined;

    const judged = segments
      ? segments.every((s) => s.pass !== false) &&
        uncoveredPass(segments, series, worstCell, ks, ref.fps, t, warnings)
      : passes(overall, t);
    const complete = series.frame.length === ks.length;
    return {
      pass:
        judged &&
        complete &&
        missing.pass &&
        (cuts?.pass ?? true) &&
        (duration?.pass ?? true) &&
        (sound?.pass ?? true),
      reference: opts.reference,
      yours: opts.yours,
      mode,
      window: [round(ks[0]! / ref.fps, 3), round((ks.at(-1)! + 1) / ref.fps, 3)],
      thresholds: t,
      ssim: overall,
      missing_content: missing,
      worst,
      ...(cuts ? { cuts } : {}),
      ...(duration ? { duration } : {}),
      ...(sound ? { sound } : {}),
      ...(segments ? { segments } : {}),
      ...(sheet ? { sheet } : {}),
      ...(sbs ? { sbs } : {}),
      log: logPath,
      frames: join(opts.outDir, "frames.tsv"),
      warnings,
    };
  } finally {
    if (seqDir) rmSync(seqDir, { recursive: true, force: true });
  }
}
