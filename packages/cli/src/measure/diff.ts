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
import { basename, dirname, join, resolve } from "node:path";
import { confirmsCut, cutsIn, frameChanges, signatures } from "./cuts.js";
import {
  drawnFrames,
  drawnVerdict,
  readDrawn,
  scoreDrawnFrame,
  type DrawnVerdict,
} from "./drawn.js";
import { compareEnergy, energyCurve, type EnergyComparison } from "./energy.js";
import { compareLook, look, sameLook, type LookComparison } from "./look.js";
import {
  decode,
  Fix,
  frameAt,
  pearson,
  probeVideo,
  round,
  runFfmpeg,
  videoClip,
  writeImage,
  type Clip,
  type Roi,
  type VideoInfo,
} from "./media.js";
import {
  AT_CUT_S,
  clipUses,
  generatedClips,
  personVerdict,
  placeClips,
  type GeneratedClip,
  type PersonVerdict,
} from "./person.js";
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
const ENERGY_RATIO: [number, number] = [0.8, 1.25];
const GRID = 4;
const ALL_CELLS = Array.from({ length: GRID * GRID }, (_, c) => c);
const WORST_GAP_S = 0.5;
const SHEET_W = 960;
const CUT_SLACK = 1;
// A segment's cell is left to its regenerated region when the region covers more than this share of it.
const REGION_CELL_SHARE = 0.1;
// Missing content: cells are read at this width, from at most this many frames. A cell whose luma spread in the
// original reaches MISSING_DETAIL while yours is flat (under MISSING_FLAT and MISSING_KEEP of the original's) is
// empty; over MISSING_MAX_SHARE of frames with an empty cell fails. A weaker blur or a missing small label is not
// empty: SSIM and its cell gate grade those (provisional, calibrated on the reverse bench). An empty cell is missing
// structure when the original's cell still spreads MISSING_DETAIL at an eighth of that width (shapes, cards, a
// map's land), and missing texture otherwise (a credit line, sea-floor grain): texture is reported, not failed.
const MISSING_W = 192;
const MISSING_SAMPLES = 1800;
const MISSING_DETAIL = 8;
const MISSING_KEEP = 0.35;
const MISSING_FLAT = 4;
const MISSING_MAX_SHARE = 0.02;
const STRUCTURE_SCALE = 8;
// Whole-frame reuse: a cut from the original covering this share of its frame plays the whole frame, and a frame
// whose median cell scores REUSE_SSIM shows it. Drawn things come along with it (a copy) for longer than
// REUSE_MAX_FRAMES fails. A Regenerated box over this share of the frame judges nothing by pixels. A cut matched for
// less than REUSE_MIN_S is not reuse: a generated shot starts from a clean still of the original's first frame. A whole-
// frame still of the original shows where yours, read in grey at STILL_W wide, is within STILL_DIFF of it in most
// of the 4x4 cells.
const WHOLE_FRAME_SHARE = 0.9;
const REUSE_SSIM = 0.9;
const REUSE_MAX_FRAMES = 2;
const REUSE_MIN_S = 0.5;
const STILL_W = 96;
const STILL_DIFF = 4;

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
  /** The project's media ledger (`.media/manifest.jsonl`): its cuts from the original show whole-frame reuse. */
  ledger?: string;
  /** The project folder, to find the ledger's generated clips (default: yours, or the folder holding `.media`). */
  project?: string;
  /** Drawn elements to score by themselves, segments or not: boxes in the original's pixels, optional windows. */
  drawn?: { box: [number, number, number, number]; window?: [number, number] }[];
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
  /** A regenerated segment with no person in it (a product shot): judged by motion and look. */
  energy?: EnergyComparison;
  look?: LookComparison;
  /** What `pass` covers, in words: which pixels SSIM scored, and what was judged otherwise. */
  scored?: string;
  /** A rebuilt or reused segment's regenerated region; `ssim` then scores the cells outside it. */
  regenerated?: { roi: [number, number, number, number] };
  /**
   * The re-shot person: three gates decide (framing, text carried in the generated clip, lip sync); motion energy
   * and look are reported, not judged.
   */
  person?: PersonVerdict & { energy?: EnergyComparison; look?: LookComparison };
  /** Each `Drawn:` element over the regenerated person, scored by itself (drawn.ts), in the order written. */
  drawn?: (DrawnVerdict & { id: string })[];
  /** A segment scored by SSIM: the 4x4 cell with the lowest mean over it, and the moment it is lowest. */
  worst_cell?: { roi: Roi; ssim: number; t: number };
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
  /** Share of compared frames with a cell whose shapes the original has and yours leaves flat. */
  share: number;
  /** The longest such stretches, in seconds. */
  spans: [number, number][];
  pass: boolean;
  /** Frames where yours leaves flat only the original's fine texture in a cell: reported, not failed. */
  texture: { share: number; spans: [number, number][] };
}

export interface WholeFrameReuse {
  /** Stretches where yours plays a whole-frame cut of the original, in seconds. */
  spans: [number, number][];
  /** The times (in the original) of the ledger's whole-frame stills that show in yours. */
  stills: number[];
  share: number;
  /** Those inside segments that quote copy: the original's drawn things played along, a copy. */
  drawn: [number, number][];
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
  whole_frame_reuse?: WholeFrameReuse;
  worst: Moment[];
  cuts?: CutReport;
  duration?: { reference: number; yours: number; pass: boolean };
  sound?: ReturnType<typeof soundOffset>;
  segments?: SegmentVerdict[];
  /** What decides the verdict: every drawn element and each rebuilt segment's area outside the person. */
  components?: { passed: number; total: number; mean: number | null };
  /** The re-shot person over the film: the gates that decide, and what is only reported. */
  person?: PersonSummary;
  /** Each `drawn` option's element (D1, D2, …), scored by itself: reported, not judged. */
  drawn?: (DrawnVerdict & { id: string })[];
  sheet?: string;
  sbs?: string;
  log: string;
  /** Every compared frame's SSIM and worst cell. */
  frames: string;
  warnings: string[];
}

export interface PersonSummary {
  /** Each gate over every segment: false when one fails, null when none could be measured. */
  gates: { framing: boolean | null; text: boolean | null; sync: boolean | null };
  /** Segments failing each gate. */
  failed: { framing: string[]; text: string[]; sync: string[] };
  /** Median of the segments' motion energy ratios (yours over the original's): reported, not judged. */
  energy: number | null;
  /**
   * Generated clips that start at one of the original's cuts, of those placed on the film, and the original's cuts
   * inside the person's segments where no clip starts (a jump cut played as one take): reported.
   */
  shots_at_cuts: {
    at_cuts: number;
    total: number;
    off: { clip: string; start: number }[];
    cuts_without_shot: number[];
  };
  clips: GeneratedClip[];
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
 * `judged(k)` lists the cells of the original's frame k this applies to: a regenerated person's gesture is theirs.
 */
function missingContent(
  ref: Clip,
  yours: Clip,
  ks: number[],
  fps: number,
  judged: (k: number) => number[] = () => ALL_CELLS,
): MissingContent {
  const stride = Math.max(1, Math.ceil(ks.length / MISSING_SAMPLES));
  const w = MISSING_W;
  const h = Math.max(GRID * 2, Math.round((w * ref.height) / ref.width / GRID) * GRID);
  const [cw, ch] = [
    w / STRUCTURE_SCALE,
    Math.max(GRID, Math.round(h / STRUCTURE_SCALE / GRID) * GRID),
  ];
  const thin =
    stride > 1 ? [`select=not(mod(n\\,${stride}))`, `setpts=N/(${fps / stride})/TB`] : [];
  const spreads = (clip: Clip, sw: number, sh: number) =>
    decode(clip.input, [...clip.filters, ...thin, `scale=${sw}:${sh}`], sw, sh, true).frames.map(
      (px) => cellSpreads(px, sw, sh),
    );
  const [a, b, coarse] = [spreads(ref, w, h), spreads(yours, w, h), spreads(ref, cw, ch)];
  // The thinning select can pass one frame past the pick; times come from ks, so stop with it.
  const n = Math.min(a.length, b.length, coarse.length, Math.ceil(ks.length / stride));
  const kinds = Array.from({ length: n }, (_, j) => {
    const empty = judged(ks[j * stride]!).filter((c) => {
      const s = a[j]![c]!;
      return s >= MISSING_DETAIL && b[j]![c]! < Math.min(MISSING_FLAT, MISSING_KEEP * s);
    });
    return {
      structure: empty.some((c) => coarse[j]![c]! >= MISSING_DETAIL),
      texture: empty.length > 0,
    };
  });
  const spansOf = (on: boolean[]) => {
    const spans: [number, number][] = [];
    on.forEach((e, j) => {
      if (!e) return;
      const t = round(ks[j * stride]! / fps, 3);
      const end = round((ks[Math.min(ks.length - 1, (j + 1) * stride - 1)]! + 1) / fps, 3);
      const last = spans.at(-1);
      if (last && on[j - 1]) last[1] = end;
      else spans.push([t, end]);
    });
    return spans
      .sort((x, y) => y[1] - y[0] - (x[1] - x[0]))
      .slice(0, 8)
      .sort((x, y) => x[0] - y[0]);
  };
  const structure = kinds.map((k) => k.structure);
  const texture = kinds.map((k) => k.texture && !k.structure);
  const share = n ? structure.filter(Boolean).length / n : 0;
  return {
    share: round(share, 4),
    spans: spansOf(structure),
    pass: share <= MISSING_MAX_SHARE,
    texture: {
      share: round(n ? texture.filter(Boolean).length / n : 0, 4),
      spans: spansOf(texture),
    },
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
  const [da, db] = [ref, yours].map((c) => frameChanges(signatures(c.input, c.filters).frames));
  const [a, b] = [cutsIn(da!), cutsIn(db!)];
  const used = new Set<number>();
  const missing: number[] = [];
  for (const cut of a) {
    const hit = b.find((g) => !used.has(g.frame) && Math.abs(g.frame - cut.frame) <= CUT_SLACK);
    // A soft cut is near the line: a clear change on the other side matches it.
    if (hit) used.add(hit.frame);
    else if (!(cut.soft && confirmsCut(db!, cut))) missing.push(cut.frame);
  }
  const extra = b.filter((g) => !used.has(g.frame) && !(g.soft && confirmsCut(da!, g)));
  const t = (f: number) => round((k0 + f) / fps, 3);
  return {
    reference: a.map((c) => t(c.frame)),
    yours: b.map((c) => t(c.frame)),
    missing: missing.map(t),
    extra: extra.map((c) => t(c.frame)),
    pass: missing.length === 0 && extra.length === 0,
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
      record: false,
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

function regeneratedVerdict(
  s: Segment,
  reference: string,
  yours: string,
  ref: VideoInfo,
  roi?: Roi,
) {
  const seconds = s.end - s.start;
  const [a, b] = [videoClip(reference, s.start, seconds, ref), videoClip(yours, s.start, seconds)];
  // Yours may be another size: the region is the same share of its frame.
  const mine = roi && scaleRoi(roi, b.width / ref.width, b.height / ref.height);
  const energy = compareEnergy(energyCurve(a, roi), energyCurve(b, mine));
  const looks = compareLook(look(a, 2, roi), look(b, 2, mine));
  const moves = energy.mean_ratio >= ENERGY_RATIO[0] && energy.mean_ratio <= ENERGY_RATIO[1];
  return { pass: moves && sameLook(looks), energy, look: looks };
}

const scaleRoi = ([x, y, w, h]: Roi, sx: number, sy: number): Roi => {
  const [x0, y0] = [Math.round((x * sx) / 2) * 2, Math.round((y * sy) / 2) * 2];
  return [
    x0,
    y0,
    Math.max(2, Math.round((w * sx) / 2) * 2),
    Math.max(2, Math.round((h * sy) / 2) * 2),
  ];
};

/** A segment's regenerated region in the original's pixels, clipped to the frame; shares when every value is ≤ 1. */
export function regionRoi(
  box: [number, number, number, number],
  width: number,
  height: number,
): Roi {
  const [sx, sy] = box.every((v) => v <= 1) ? [width, height] : [1, 1];
  const roi = scaleRoi(box, sx, sy);
  const [x, y] = [Math.min(roi[0], width - 2), Math.min(roi[1], height - 2)];
  return [x, y, Math.min(roi[2], width - x), Math.min(roi[3], height - y)];
}

/** The grid cells (row by row) a region covers no more than REGION_CELL_SHARE of. */
export function cellsOutside(roi: Roi, width: number, height: number): number[] {
  const [cw, ch] = cellSize(width, height);
  return ALL_CELLS.filter((c) => {
    const [x, y] = [(c % GRID) * cw, Math.floor(c / GRID) * ch];
    const ox = Math.max(0, Math.min(x + cw, roi[0] + roi[2]) - Math.max(x, roi[0]));
    const oy = Math.max(0, Math.min(y + ch, roi[1] + roi[3]) - Math.max(y, roi[1]));
    return ox * oy <= REGION_CELL_SHARE * cw * ch;
  });
}

interface VerdictContext {
  reference: string;
  yours: string;
  ref: VideoInfo;
  mode: DiffResult["mode"];
  t: Thresholds;
  /** A segment's drawn elements, scored by themselves. */
  drawn: Map<Segment, (DrawnVerdict & { id: string })[]>;
  /** A segment's re-shot person, by the three gates. */
  person: Map<Segment, PersonVerdict>;
}

function segmentVerdicts(
  segments: Segment[],
  series: Series,
  worstCell: number[],
  ks: number[],
  ctx: VerdictContext,
): SegmentVerdict[] {
  return segments.map((s) => {
    const head = { id: s.id, window: [s.start, s.end] as [number, number], pixels: s.pixels };
    if (s.pixels === "regenerated" && !s.drawn) {
      if (ctx.mode !== "video")
        return {
          ...head,
          pass: null,
          note: "regenerated pixels are judged on a render: diff a render",
        };
      const moved = regeneratedVerdict(s, ctx.reference, ctx.yours, ctx.ref);
      const person = ctx.person.get(s);
      // No face to judge (a product shot): motion and look decide.
      if (!person || person.pass === null) return { ...head, ...moved };
      return {
        ...head,
        pass: person.pass,
        scored: "the person: framing, text carried in the generated clip, lip sync",
        person: { ...person, energy: moved.energy, look: moved.look },
      };
    }
    const [a, b] = [frameAt(s.start, ctx.ref.fps), frameAt(s.end, ctx.ref.fps)];
    const mine = ks.flatMap((k, i) => (k >= a && k < b && i < series.frame.length ? [i] : []));
    if (!mine.length)
      return { ...head, pass: null, note: "no compared frame falls in this segment" };
    if (s.regenerated || s.pixels === "regenerated")
      return mixedVerdict(s, head, mine, series, ctx);
    const st = scores(
      mine.map((i) => series.frame[i]!),
      mine.map((i) => worstCell[i]!),
    );
    return {
      ...head,
      pass: passes(st, ctx.t),
      ssim: st,
      worst_cell: lowestCell(mine, series, ks, ctx.ref),
    };
  });
}

/** Of these frames, the cell with the lowest mean SSIM, and the time it is lowest. */
function lowestCell(
  mine: number[],
  series: Series,
  ks: number[],
  ref: { width: number; height: number; fps: number },
): { roi: Roi; ssim: number; t: number } {
  const means = series.cells[mine[0]!]!.map(
    (_, c) => mine.reduce((sum, i) => sum + series.cells[i]![c]!, 0) / mine.length,
  );
  const c = means.indexOf(Math.min(...means));
  const at = mine.reduce((lo, i) => (series.cells[i]![c]! < series.cells[lo]![c]! ? i : lo));
  const [cw, ch] = cellSize(ref.width, ref.height);
  return {
    roi: [(c % GRID) * cw, Math.floor(c / GRID) * ch, cw, ch],
    ssim: round(means[c]!, 4),
    t: round(ks[at]! / ref.fps, 3),
  };
}

/**
 * A segment with a regenerated person (its box, or the whole frame): the person by motion and look, the cells
 * outside the box by SSIM, and each drawn element over the person by itself.
 */
// fallow-ignore-next-line complexity
function mixedVerdict(
  s: Segment,
  head: { id: string; window: [number, number]; pixels: Segment["pixels"] },
  mine: number[],
  series: Series,
  ctx: VerdictContext,
): SegmentVerdict {
  const whole = s.pixels === "regenerated";
  const roi: Roi = whole
    ? [0, 0, ctx.ref.width, ctx.ref.height]
    : regionRoi(s.regenerated!, ctx.ref.width, ctx.ref.height);
  const rest = whole ? [] : cellsOutside(roi, ctx.ref.width, ctx.ref.height);
  const moved =
    ctx.mode === "video"
      ? regeneratedVerdict(s, ctx.reference, ctx.yours, ctx.ref, whole ? undefined : roi)
      : undefined;
  const gates = ctx.person.get(s);
  const person =
    gates || moved
      ? {
          ...(gates ?? { gates: { framing: null, text: null, sync: null }, pass: null }),
          energy: moved?.energy,
          look: moved?.look,
        }
      : undefined;
  const st = rest.length
    ? scores(
        mine.map((i) => rest.reduce((sum, c) => sum + series.cells[i]![c]!, 0) / rest.length),
        mine.map((i) => Math.min(...rest.map((c) => series.cells[i]![c]!))),
      )
    : undefined;
  const drawn = ctx.drawn.get(s) ?? [];
  const verdicts = [
    st ? passes(st, ctx.t) : null,
    person?.pass ?? null,
    ...drawn.map((d) => d.pass),
  ];
  const pass = verdicts.includes(false) ? false : verdicts.every((p) => p === null) ? null : true;
  const scored = [
    st
      ? `SSIM: the ${rest.length} cells outside the regenerated box`
      : drawn.length
        ? "drawn elements only (no cell is outside the regenerated box)"
        : "no pixels (the regenerated box covers every cell)",
    "the person: framing, text carried in the generated clip, lip sync (motion and look reported)",
    ...(drawn.length ? [`${drawn.length} drawn elements, each scored by itself`] : []),
  ].join("; ");
  const note =
    ctx.mode === "project"
      ? { note: `the regenerated ${whole ? "picture" : "region"} is judged on a render` }
      : {};
  const parts = {
    pass,
    scored,
    ...(st ? { ssim: st } : {}),
    ...(drawn.length ? { drawn } : {}),
    ...(person ? { person } : {}),
  };
  return { ...head, ...parts, ...(whole ? {} : { regenerated: { roi } }), ...note };
}

/**
 * The drawn elements over a regenerated person, each scored by itself on its window inside its segment (drawn.ts),
 * from one decode of each side.
 */
function scoreDrawn(
  segments: Segment[],
  refClip: Clip,
  yours: Clip,
  ks: number[],
  ref: VideoInfo,
  available: number,
): Map<Segment, (DrawnVerdict & { id: string })[]> {
  const jobs = segments.flatMap((s) => drawnOf(s, ref).map((d) => ({ s, ...d })));
  const verdicts = scoreElements(jobs, refClip, yours, ks, ref, available);
  const out = new Map<Segment, (DrawnVerdict & { id: string })[]>();
  jobs.forEach((j, n) => out.set(j.s, [...(out.get(j.s) ?? []), verdicts[n]!]));
  return out;
}

/** Drawn elements scored by themselves on their windows, in order, from one decode of each side. */
function scoreElements(
  elements: { id: string; box: Roi; window: [number, number] }[],
  refClip: Clip,
  yours: Clip,
  ks: number[],
  ref: VideoInfo,
  available: number,
): (DrawnVerdict & { id: string })[] {
  const jobs = elements.map((d) => ({
    ...d,
    frames: drawnFrames(ks, ref.fps, ...d.window, available),
  }));
  const live = jobs.filter((j) => j.frames.length);
  const [a, b] = [refClip, yours].map((clip) => readDrawn(clip, live, ref.width, ref.height));
  return jobs.map((j) => {
    const n = live.indexOf(j);
    const pairs =
      n < 0 ? [] : a![n]!.map((fa, i) => [fa, b![n]![i]] as const).filter(([, fb]) => fb);
    const frames = pairs.map(([fa, fb]) => scoreDrawnFrame(fa, fb!, j.box[2], j.box[3]));
    return { id: j.id, ...drawnVerdict(j.box, j.window, frames) };
  });
}

/** A segment's drawn elements over a regenerated person: id, box in the original's pixels, window. */
function drawnOf(s: Segment, ref: VideoInfo): { id: string; box: Roi; window: [number, number] }[] {
  if (!(s.regenerated || s.pixels === "regenerated")) return [];
  return (s.drawn ?? []).map((d, n) => ({
    id: `${s.id}.D${n + 1}`,
    box: regionRoi(d.box, ref.width, ref.height),
    window: [Math.max(s.start, d.window?.[0] ?? s.start), Math.min(s.end, d.window?.[1] ?? s.end)],
  }));
}

/** The film's headline: the components that decide it, and the person's gates and what is reported. */
function headline(
  segments: SegmentVerdict[],
  clips: GeneratedClip[],
  t: Thresholds,
  cuts: number[] = [],
): { components: NonNullable<DiffResult["components"]>; person: PersonSummary } {
  const parts = segments.flatMap((v) => [
    ...(v.ssim ? [{ pass: passes(v.ssim, t), score: v.ssim.mean }] : []),
    ...(v.drawn ?? []).flatMap((d) =>
      d.pass === null ? [] : [{ pass: d.pass, score: d.score ?? 0 }],
    ),
  ]);
  const people = segments.flatMap((v) =>
    v.person ? [{ id: v.id, window: v.window, ...v.person }] : [],
  );
  const gate = (key: "framing" | "text" | "sync") => {
    const g = people.map((p) => p.gates[key]);
    return g.includes(false) ? false : g.some((x) => x === true) ? true : null;
  };
  const ratios = people.flatMap((p) => (p.energy ? [p.energy.mean_ratio] : []));
  const placed = clips.filter((c) => c.at_cut !== undefined);
  return {
    components: {
      passed: parts.filter((p) => p.pass).length,
      total: parts.length,
      mean: parts.length
        ? round(parts.reduce((sum, p) => sum + p.score, 0) / parts.length, 4)
        : null,
    },
    person: {
      gates: { framing: gate("framing"), text: gate("text"), sync: gate("sync") },
      failed: {
        framing: people.filter((p) => p.gates.framing === false).map((p) => p.id),
        text: people.filter((p) => p.gates.text === false).map((p) => p.id),
        sync: people.filter((p) => p.gates.sync === false).map((p) => p.id),
      },
      energy: ratios.length
        ? round([...ratios].sort((a, b) => a - b)[ratios.length >> 1]!, 3)
        : null,
      shots_at_cuts: {
        at_cuts: placed.filter((c) => c.at_cut).length,
        total: placed.length,
        off: placed.flatMap((c) => (c.at_cut ? [] : [{ clip: c.path, start: c.offset! }])),
        cuts_without_shot: placed.length
          ? cuts.filter(
              (k) =>
                people.some((p) => k > p.window[0] && k < p.window[1]) &&
                !placed.some((c) => Math.abs(c.offset! - k) <= AT_CUT_S),
            )
          : [],
      },
      clips,
    },
  };
}

/** A media ledger's cuts from the original that show its whole frame: video windows and the times of stills. */
export function wholeFrameCuts(
  ledger: string,
  width: number,
  height: number,
): { windows: [number, number][]; stills: number[] } {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;
  const numbers = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  type Cut = { window: [number, number] } | { at: number };
  // fallow-ignore-next-line complexity
  const cuts = ledger.split("\n").flatMap((line): Cut[] => {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return [];
    }
    if (!isRecord(entry) || !isRecord(entry.provenance) || entry.provenance.provider !== "original")
      return [];
    const p = entry.provenance;
    const [window, roi] = [numbers(p.window), numbers(p.roi)];
    // A cut with no region is the whole frame.
    const area = roi.length === 4 ? roi[2]! * roi[3]! : width * height;
    if (area < WHOLE_FRAME_SHARE * width * height) return [];
    if (entry.type === "video" && window.length === 2)
      return [{ window: [window[0]!, window[1]!] }];
    return entry.type === "image" && typeof p.at === "number" ? [{ at: p.at }] : [];
  });
  return {
    windows: cuts.flatMap((c) => ("window" in c ? [c.window] : [])),
    stills: [...new Set(cuts.flatMap((c) => ("at" in c ? [c.at] : [])))].sort((a, b) => a - b),
  };
}

/** For each still (a time in the original), which compared frames of yours show it. */
function stillsShown(ref: Clip, yours: Clip, stills: number[], fps: number): boolean[][] {
  if (!stills.length) return [];
  const h = Math.max(GRID, Math.round((STILL_W * ref.height) / ref.width / GRID) * GRID);
  const read = (clip: Clip, extra: string[] = [], limit?: number) =>
    decode(
      clip.input,
      [...clip.filters, ...extra, `scale=${STILL_W}:${h}`],
      STILL_W,
      h,
      true,
      limit,
    ).frames;
  const mine = read(yours);
  return stills.map((at) => {
    const still = read(ref, [`select=eq(n\\,${frameAt(at, fps)})`], 1)[0];
    if (!still) return mine.map(() => false);
    return mine.map((px) => {
      const cells = cellDiffs(px, still, STILL_W, h).sort((a, b) => a - b);
      return pct(cells, 0.5) <= STILL_DIFF;
    });
  });
}

/** The mean absolute difference of two grey pictures in each 4x4 cell. */
function cellDiffs(a: Uint8Array, b: Uint8Array, w: number, h: number): number[] {
  const [cw, ch] = [Math.floor(w / GRID), Math.floor(h / GRID)];
  return ALL_CELLS.map((c) => {
    const [x0, y0] = [(c % GRID) * cw, Math.floor(c / GRID) * ch];
    let sum = 0;
    for (let y = y0; y < y0 + ch; y++)
      for (let x = x0; x < x0 + cw; x++) sum += Math.abs(a[y * w + x]! - b[y * w + x]!);
    return sum / (cw * ch);
  });
}

/** The ledger beside a project or its segments file (a copy may be named media-manifest.jsonl). */
export function findLedger(yours: string, segmentsFile?: string): string | undefined {
  const dirs = [
    ...(existsSync(yours) && statSync(yours).isDirectory() ? [yours] : []),
    ...(segmentsFile ? [dirname(segmentsFile)] : []),
  ];
  return dirs
    .flatMap((d) => [join(d, ".media", "manifest.jsonl"), join(d, "media-manifest.jsonl")])
    .find((f) => existsSync(f));
}

/** Runs of compared frames that are on, as [start, end) seconds. */
function frameSpans(on: boolean[], ks: number[], fps: number): [number, number][] {
  const spans: [number, number][] = [];
  on.forEach((v, i) => {
    if (!v) return;
    const last = spans.at(-1);
    if (last && on[i - 1] && ks[i] === ks[i - 1]! + 1) last[1] = round((ks[i]! + 1) / fps, 3);
    else spans.push([round(ks[i]! / fps, 3), round((ks[i]! + 1) / fps, 3)]);
  });
  return spans;
}

/**
 * Where yours plays one of the original's whole-frame cuts (inside its window, most cells near the original's own
 * pixels, for REUSE_MIN_S or longer) or shows one of its whole-frame stills, and where that frame's segment draws
 * copy: the original's drawn things came along with the footage.
 */
function wholeFrameReuse(
  cuts: { windows: [number, number][]; stills: number[] },
  stills: boolean[][],
  series: Series,
  ks: number[],
  fps: number,
  segments?: Segment[],
): WholeFrameReuse {
  const inside = (k: number, a: number, b: number) => k >= frameAt(a, fps) && k < frameAt(b, fps);
  const played = series.frame.map(
    (_, i) =>
      cuts.windows.some(([a, b]) => inside(ks[i]!, a, b)) &&
      pct(
        [...series.cells[i]!].sort((x, y) => x - y),
        0.5,
      ) >= REUSE_SSIM,
  );
  const long = longRuns(played, ks, Math.ceil(REUSE_MIN_S * fps));
  const shown = long.map((v, i) => v || stills.some((on) => on[i]));
  const drawn = shown.map(
    (v, i) => v && !!segments?.some((s) => s.copy && inside(ks[i]!, s.start, s.end)),
  );
  return {
    spans: frameSpans(shown, ks, fps),
    stills: cuts.stills.filter((_, j) => stills[j]?.some(Boolean)),
    share: round(shown.filter(Boolean).length / Math.max(1, shown.length), 4),
    drawn: frameSpans(drawn, ks, fps),
    pass: drawn.filter(Boolean).length <= REUSE_MAX_FRAMES,
  };
}

/** `on` with its runs of consecutive frames shorter than `min` turned off. */
export function longRuns(on: boolean[], ks: number[], min: number): boolean[] {
  const out = [...on];
  for (let i = 0; i < on.length; ) {
    if (!on[i]) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < on.length && on[j] && ks[j] === ks[j - 1]! + 1) j++;
    if (j - i < min) out.fill(false, i, j);
    i = j;
  }
  return out;
}

/** Regenerated boxes that hide what should be judged by pixels. */
function regionWarnings(segments: Segment[], ref: VideoInfo): string[] {
  return segments.flatMap((s) => {
    const box = s.regenerated && regionRoi(s.regenerated, ref.width, ref.height);
    if (s.drawn || !(box || s.pixels === "regenerated")) return [];
    if (box && box[2] * box[3] >= WHOLE_FRAME_SHARE * ref.width * ref.height)
      return [
        `${s.id}: its Regenerated box covers the whole frame, so nothing in it is judged by pixels: box the person, and give each drawn element over them a Drawn: x, y, w, h line`,
      ];
    return s.copy
      ? [
          `${s.id} draws copy over a regenerated person: a drawn element inside the person's box is judged by pixels only with its own Drawn: x, y, w, h line`,
        ]
      : [];
  });
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
  // On the sound's own timestamps (first_pts=0 pads up to its first decoded sample), not the probe's start_time:
  // ffmpeg 5.1 drops an HE-AAC edit list's skip twice, keeps the rest timestamped right, and still probes 0.
  const raw = runFfmpeg([
    ...["-i", path, "-vn", "-af", "aresample=async=1:first_pts=0"],
    ...["-t", "20", "-ac", "1", "-ar", "8000", "-f", "f32le", "-"],
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

/** How far yours' sound sits from the original's (positive: yours is late), from where sounds start. */
export function soundOffset(reference: string, yours: string, ref: VideoInfo, mine: VideoInfo) {
  if (!ref.audio || !mine.audio)
    return { original: ref.audio, yours: mine.audio, pass: ref.audio === mine.audio };
  const [a, b] = [onsetCurve(reference), onsetCurve(yours)];
  let best: [number, number] = [-2, 0];
  for (let lag = -50; lag <= 50; lag++) {
    const n = Math.min(a.length, b.length) - Math.abs(lag);
    if (n < 50) continue;
    const [i, j] = [Math.max(0, -lag), Math.max(0, lag)];
    const r = pearson(a.slice(i, i + n), b.slice(j, j + n)) ?? -2;
    if (r > best[0]) best = [r, lag];
  }
  const offset = best[1] * 10;
  // Steady sound (a held pad, room tone) has too few starts to align: say so rather than fail it.
  if (best[0] <= 0.3)
    return {
      offset_ms: null,
      match: round(best[0], 2),
      pass: true,
      note: "too few distinct sounds to align",
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
    for (const f of readdirSync(opts.outDir))
      if (/^worst-/.test(f)) rmSync(join(opts.outDir, f), { force: true });
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
    const missing = missingContent(refClip, yours, ks, ref.fps, (k) => {
      const s = opts.segments?.find(
        (seg) => k >= frameAt(seg.start, ref.fps) && k < frameAt(seg.end, ref.fps),
      );
      if (s?.pixels === "regenerated") return [];
      return s?.regenerated
        ? cellsOutside(regionRoi(s.regenerated, ref.width, ref.height), ref.width, ref.height)
        : ALL_CELLS;
    });
    if (!missing.pass)
      warnings.push(
        `${Math.round(missing.share * 100)}% of frames leave empty what the original fills (${missing.spans.map(([a, b]) => `${a}–${b} s`).join(", ")}): build what is missing there`,
      );
    if (missing.texture.share > MISSING_MAX_SHARE)
      warnings.push(
        `${Math.round(missing.texture.share * 100)}% of frames lack fine texture or small detail the original has (${missing.texture.spans.map(([a, b]) => `${a}–${b} s`).join(", ")}): reported, not failed`,
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
            reference: round(ref.pictureDuration, 3),
            yours: round(yoursInfo.pictureDuration, 3),
            pass: Math.abs(ref.pictureDuration - yoursInfo.pictureDuration) <= 1.5 / ref.fps,
          }
        : undefined;
    const ledgerText =
      opts.ledger && existsSync(opts.ledger) ? readFileSync(opts.ledger, "utf8") : undefined;
    const people = new Map<Segment, PersonVerdict>();
    let clips: ReturnType<typeof placeClips> = [];
    if (opts.segments && yoursInfo) {
      const project =
        opts.project ??
        (opts.ledger && basename(dirname(opts.ledger)) === ".media"
          ? dirname(dirname(opts.ledger))
          : undefined);
      const refCuts = cuts?.reference ?? [];
      const uses = project
        ? await clipUses(project).catch(() => new Map<string, never[]>())
        : new Map<string, never[]>();
      clips = ledgerText ? placeClips(generatedClips(ledgerText), project, ref, refCuts, uses) : [];
      if (clips.length && clips.every((c) => !c.info))
        warnings.push(
          "the ledger's generated clips are not found, so text carried in them is not checked: pass --project <folder>",
        );
      for (const s of opts.segments)
        if (s.regenerated || s.pixels === "regenerated")
          people.set(
            s,
            await personVerdict({
              ref,
              yours: yoursInfo,
              window: [s.start, s.end],
              cuts: refCuts,
              clips,
              drawn: drawnOf(s, ref),
            }),
          );
    }
    const segments = opts.segments
      ? segmentVerdicts(opts.segments, series, worstCell, ks, {
          reference: opts.reference,
          yours: opts.yours,
          ref,
          mode,
          t,
          drawn: scoreDrawn(opts.segments, refClip, yours, ks, ref, series.frame.length),
          person: people,
        })
      : undefined;
    if (opts.segments) warnings.push(...regionWarnings(opts.segments, ref));
    const elements = opts.drawn?.length
      ? scoreElements(
          opts.drawn.map((d, n) => ({
            id: `D${n + 1}`,
            box: regionRoi(d.box, ref.width, ref.height),
            window: d.window ?? [0, round(ref.pictureDuration, 3)],
          })),
          refClip,
          yours,
          ks,
          ref,
          series.frame.length,
        )
      : undefined;
    const ledger = ledgerText ? wholeFrameCuts(ledgerText, ref.width, ref.height) : undefined;
    const reuse =
      ledger && (ledger.windows.length || ledger.stills.length)
        ? wholeFrameReuse(
            ledger,
            stillsShown({ ...refClip, filters: [] }, yours, ledger.stills, ref.fps),
            series,
            ks,
            ref.fps,
            opts.segments,
          )
        : undefined;
    if (reuse && !reuse.pass) {
      const seconds = reuse.drawn.reduce((sum, [a, b]) => sum + b - a, 0);
      warnings.push(
        `${round(seconds, 2)} s play the original's whole frame with its drawn things in it (${reuse.drawn.map(([a, b]) => `${a}–${b} s`).join(", ")}): a copy, not a reverse. Cut only the camera image, each piece on its own box, and rebuild what is drawn`,
      );
      for (const v of segments ?? [])
        if (reuse.drawn.some(([a, b]) => a < v.window[1] && b > v.window[0])) {
          v.pass = false;
          v.note = "plays the original's whole frame with its drawn things: a copy";
        }
    } else if (reuse?.spans.length && !opts.segments)
      warnings.push(
        `${Math.round(reuse.share * 100)}% of frames play the original's whole frame: pass --segments <file> to tell footage from copied drawings`,
      );
    const sound =
      yoursInfo && pick.kind === "all"
        ? soundOffset(opts.reference, opts.yours, ref, yoursInfo)
        : undefined;
    const sbs =
      opts.sbs && mode === "video"
        ? sideBySide(opts.reference, opts.yours, ref, join(opts.outDir, "sbs.mp4"))
        : undefined;

    const judged = segments ? segments.every((s) => s.pass !== false) : passes(overall, t);
    const top = segments
      ? headline(
          segments,
          clips.map(({ info: _info, file: _file, still: _still, ...c }) => c),
          t,
          cuts?.reference,
        )
      : undefined;
    const complete = series.frame.length === ks.length;
    return {
      pass:
        judged &&
        complete &&
        missing.pass &&
        (reuse?.pass ?? true) &&
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
      ...(reuse ? { whole_frame_reuse: reuse } : {}),
      worst,
      ...(cuts ? { cuts } : {}),
      ...(duration ? { duration } : {}),
      ...(sound ? { sound } : {}),
      ...(top ? top : {}),
      ...(segments ? { segments } : {}),
      ...(elements ? { drawn: elements } : {}),
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
