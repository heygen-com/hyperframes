import {
  bandFramesOf,
  medianInterval,
  rhythm,
  type AudioSignal,
} from "@hyperframes/core/audio-analysis";
import { ABSENT_DB, asSignal, levels, median, mixed, round } from "./signal.js";
import type { Ambience, Entry, Music, MusicSegment, Piece } from "./types.js";

const HOP = 0.1;
const CUT_DB = 25;
const RUNNING_FRAMES = 200;
const LEVEL_WINDOW = 0.4;
const CONTEXT = 2;
const SHORTEST_BREAK = 0.5;
const LONGEST_REST = 1;
const SHORTEST_SEGMENT = 1;
const SAME_PIECE = 0.92;
const SAME_TEMPO = 0.06;
const SAME_MIX = 0.25;
const RESUMING_GAP = 5;
const RESUMING_PIECE = 0.85;
const RESUMING_MIX = 0.35;
const FADE_DB = 10;
const FADE_WINDOW = 3;
const ENERGY_WINDOW = 30;
const LEADING_SHARE = 0.2;
const TONAL_SHARE = 0.4;
const DENSE_WINDOW = 2;
const DENSE_SHARE = 0.5;
const STEADY = 0.5;

export interface MusicInput {
  /** Every pitched stem, by name: bass, guitar, piano, other. */
  stems: Record<string, Float32Array>;
  drums: Float32Array | null;
  sampleRate: number;
}

interface Run {
  start: number;
  end: number;
}

type Span = { quiet: boolean; start: number; end: number };

function joined(spans: Span[], tooShort: (span: Span) => boolean): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && (tooShort(span) || last.quiet === span.quiet)) last.end = span.end;
    else out.push({ ...span });
  }
  return out;
}

function powerDb(db: Float32Array, start: number, end: number): number {
  const a = Math.max(0, Math.round(start / HOP));
  const b = Math.min(db.length, Math.round(end / HOP));
  let sum = 0;
  for (let f = a; f < b; f++) sum += 10 ** (db[f]! / 10);
  return b > a ? 10 * Math.log10(sum / (b - a) || 1e-12) : Number.NEGATIVE_INFINITY;
}

/** A break holds the music far under what plays around it, or out altogether, across its whole length. */
function holdsUp(db: Float32Array, span: Span): boolean {
  const inside = powerDb(db, span.start, span.end);
  const around = Math.max(
    powerDb(db, span.start - CONTEXT, span.start),
    powerDb(db, span.end, span.end + CONTEXT),
  );
  return inside < ABSENT_DB || inside < around - CUT_DB;
}

const tooShort = (span: Span) =>
  span.end - span.start < (span.quiet ? SHORTEST_BREAK : SHORTEST_SEGMENT);

function candidates(
  quiet: Uint8Array,
  from: number,
  to: number,
  absorbed: (span: Span) => boolean = tooShort,
): Span[] {
  const spans: Span[] = [];
  for (let f = from; f < to; f++) {
    const isQuiet = quiet[f] === 1;
    const last = spans[spans.length - 1];
    if (last && last.quiet === isQuiet) last.end = (f + 1) * HOP;
    else spans.push({ quiet: isQuiet, start: f * HOP, end: (f + 1) * HOP });
  }
  return joined(spans, absorbed);
}

/** Inside a dip that does not hold up as a whole, the music is out wherever it is absent for longer than a rest between notes. */
function silencesIn(db: Float32Array, span: Span): Span[] {
  const from = Math.round(span.start / HOP);
  const to = Math.min(db.length, Math.round(span.end / HOP));
  const absent = new Uint8Array(db.length);
  for (let f = from; f < to; f++) absent[f] = db[f]! < ABSENT_DB ? 1 : 0;
  const shortSilence = (s: Span) => s.quiet && s.end - s.start < LONGEST_REST;
  return candidates(absent, from, to, shortSilence).map((s) =>
    s.quiet && !holdsUp(db, s) ? { ...s, quiet: false } : s,
  );
}

/** Breaks are where the music drops far under its running level, or out altogether, for half a second or more. */
function runs(db: Float32Array): { segments: Run[]; breaks: Run[] } {
  const quiet = new Uint8Array(db.length);
  const heard: number[] = [];
  for (let f = 0; f < db.length; f++) {
    const level = db[f]!;
    const reference = heard.length
      ? median(heard.slice(-RUNNING_FRAMES))
      : Number.NEGATIVE_INFINITY;
    quiet[f] = level < ABSENT_DB || level < reference - CUT_DB ? 1 : 0;
    if (!quiet[f]) heard.push(level);
  }
  const merged = candidates(quiet, 0, db.length).flatMap((span) =>
    span.quiet && !holdsUp(db, span) ? silencesIn(db, span) : [span],
  );
  const settled = joined(merged, (s) => !s.quiet && s.end - s.start < SHORTEST_SEGMENT);
  return {
    segments: settled.filter((s) => !s.quiet),
    breaks: settled.filter((s) => s.quiet && s.start > 0 && s.end < db.length * HOP),
  };
}

function soundShare(fine: Float32Array, run: Run): Float32Array {
  const a = Math.round(run.start / HOP);
  const b = Math.min(fine.length, Math.round(run.end / HOP));
  const heard = new Float64Array(b - a + 1);
  for (let f = a; f < b; f++) heard[f - a + 1] = heard[f - a]! + (fine[f]! >= ABSENT_DB ? 1 : 0);
  const half = Math.round(DENSE_WINDOW / 2 / HOP);
  const out = new Float32Array(b - a);
  for (let f = a; f < b; f++) {
    const lo = Math.max(a, f - half);
    const hi = Math.min(b, f + half + 1);
    out[f - a] = (heard[hi - a]! - heard[lo - a]!) / (hi - lo);
  }
  return out;
}

function steadyEdges(fine: Float32Array, part: Span): Span {
  const steady = Math.round(STEADY / HOP);
  const a = Math.round(part.start / HOP);
  const b = Math.min(fine.length, Math.round(part.end / HOP));
  const holds = (f: number) => {
    for (let k = f; k < f + steady; k++) if (k >= b || fine[k]! < ABSENT_DB) return false;
    return true;
  };
  let start = a;
  while (start < b && !holds(start)) start++;
  let end = b;
  while (end > start && !holds(end - steady)) end--;
  return start < end ? { ...part, start: start * HOP, end: end * HOP } : part;
}

function sustainedParts(fine: Float32Array, run: Run): Run[] {
  if (run.end - run.start <= DENSE_WINDOW) {
    const a = Math.round(run.start / HOP);
    const b = Math.max(a + 1, Math.min(fine.length, Math.round(run.end / HOP)));
    let heard = 0;
    for (let f = a; f < b; f++) if (fine[f]! >= ABSENT_DB) heard++;
    return heard / (b - a) >= DENSE_SHARE ? [run] : [];
  }
  const dense = soundShare(fine, run);
  const a = Math.round(run.start / HOP);
  const sparse = new Uint8Array(fine.length);
  dense.forEach((share, i) => (sparse[a + i] = share < DENSE_SHARE ? 1 : 0));
  return candidates(sparse, a, a + dense.length)
    .filter((part) => !part.quiet)
    .map((part) => steadyEdges(fine, part))
    .map(({ start, end }) => ({ start, end: Math.min(end, run.end) }));
}

function chromaOf(chroma: Float64Array[], fps: number, run: Run): Float64Array {
  const a = Math.floor(run.start * fps);
  const b = Math.max(a + 1, Math.min(chroma.length, Math.ceil(run.end * fps)));
  const sum = new Float64Array(12);
  for (let f = a; f < b; f++) chroma[f]?.forEach((v, k) => (sum[k]! += v));
  const norm = Math.hypot(...sum);
  return norm ? sum.map((v) => v / norm) : sum;
}

function medianTopThreePitchShare(chroma: Float64Array[], fps: number, run: Run): number {
  const a = Math.floor(run.start * fps);
  const b = Math.min(chroma.length, Math.ceil(run.end * fps));
  const held: number[] = [];
  for (let f = a; f < b; f++) {
    const sorted = [...chroma[f]!].sort((x, y) => y - x);
    const total = sorted.reduce((n, v) => n + v, 0);
    if (total > 0) held.push((sorted[0]! + sorted[1]! + sorted[2]!) / total);
  }
  return median(held);
}

const dot = (a: Float64Array, b: Float64Array) => a.reduce((n, v, k) => n + v * b[k]!, 0);

function energyOf(samples: Float32Array, sampleRate: number, run: Run): number {
  const a = Math.floor(run.start * sampleRate);
  const b = Math.min(samples.length, Math.floor(run.end * sampleRate));
  let sum = 0;
  for (let i = a; i < b; i++) sum += samples[i]! ** 2;
  return b > a ? sum / (b - a) : 0;
}

function shares(input: MusicInput, run: Run): Record<string, number> {
  const energies = Object.entries(input.stems).map(
    ([name, samples]) => [name, energyOf(samples, input.sampleRate, run)] as const,
  );
  const total = energies.reduce((n, [, e]) => n + e, 0);
  return Object.fromEntries(energies.map(([name, e]) => [name, total ? e / total : 0]));
}

function mixDistance(a: Record<string, number>, b: Record<string, number>): number {
  return Object.keys(a).reduce((n, k) => n + Math.abs(a[k]! - (b[k] ?? 0)), 0) / 2;
}

function bpmOf(beats: readonly number[], run: Run): number | null {
  const inside = beats.filter((t) => t >= run.start && t < run.end);
  const interval = inside.length >= 4 ? medianInterval(inside) : null;
  return interval ? Math.round(60 / interval) : null;
}

function beatsInRun(signal: AudioSignal, run: Run): number[] {
  const samples = signal.channels[0]!;
  if (run.start === 0 && run.end === samples.length / signal.sampleRate)
    return rhythm(signal).beats.times;
  const excerpt = samples.subarray(
    Math.floor(run.start * signal.sampleRate),
    Math.ceil(run.end * signal.sampleRate),
  );
  return rhythm(asSignal(excerpt, signal.sampleRate)).beats.times;
}

const sameTempo = (a: number | null, b: number | null) =>
  a === null || b === null || Math.abs(a - b) / Math.max(a, b) <= SAME_TEMPO;

function fadeFrom(db: Float32Array, run: Run): number | null {
  const a = Math.floor(run.start / HOP);
  const b = Math.min(db.length, Math.floor(run.end / HOP));
  const body = median(db.subarray(a, b));
  const last = db[b - 1] ?? body;
  if (body - last < FADE_DB) return null;
  for (let f = Math.max(a, b - FADE_WINDOW / HOP); f < b; f++)
    if (db[f]! < body - 3) return round(f * HOP, 1);
  return null;
}

type Known = Piece & { print: Float64Array; mix: Record<string, number> };

interface Heard {
  run: Run;
  print: Float64Array;
  mix: Record<string, number>;
  bpm: number | null;
  tonality: number;
}

const leading = (mix: Record<string, number>) =>
  Object.entries(mix)
    .filter(([, share]) => share >= LEADING_SHARE)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

const isMusic = (heard: Heard) =>
  heard.bpm !== null || heard.tonality >= TONAL_SHARE || leading(heard.mix).length > 1;

const alike = (p: Known, heard: Heard, piece: number, mix: number) =>
  dot(p.print, heard.print) >= piece &&
  mixDistance(p.mix, heard.mix) <= mix &&
  sameTempo(p.bpm, heard.bpm);

/** The piece a part belongs to: the one before a short break, held loosely, else any heard before, held strictly. */
function pieceOf(
  pieces: Known[],
  previous: MusicSegment | undefined,
  heard: Heard,
): Known | undefined {
  const last = previous && pieces.find((p) => p.id === previous.piece);
  if (
    last &&
    heard.run.start - previous.end <= RESUMING_GAP &&
    alike(last, heard, RESUMING_PIECE, RESUMING_MIX)
  )
    return last;
  return pieces.find((p) => alike(p, heard, SAME_PIECE, SAME_MIX));
}

function newPiece(id: number, heard: Heard): Known {
  return {
    id,
    instruments: leading(heard.mix),
    bpm: heard.bpm,
    firstAt: round(heard.run.start),
    print: heard.print,
    mix: heard.mix,
  };
}

function liesBetweenMusic(found: Run[], gap: Run, musical: Set<Run>): boolean {
  const after = found.findIndex((run) => run.start >= gap.end);
  return after > 0 && musical.has(found[after - 1]!) && musical.has(found[after]!);
}

function energyCurve(
  melodic: Float32Array,
  sampleRate: number,
  duration: number,
  musical: Set<Run>,
) {
  const energy = [];
  for (let start = 0; start < duration; start += ENERGY_WINDOW) {
    const end = Math.min(duration, start + ENERGY_WINDOW);
    const overlaps = [...musical]
      .map((run) => ({ start: Math.max(start, run.start), end: Math.min(end, run.end) }))
      .filter((run) => run.end > run.start);
    if (!overlaps.length) continue;
    const power =
      overlaps.reduce(
        (sum, run) => sum + energyOf(melodic, sampleRate, run) * (run.end - run.start),
        0,
      ) /
      (end - start);
    energy.push({
      start,
      end: Math.min(round(end), round(duration, 3)),
      db: power > 0 ? Math.round(10 * Math.log10(power)) : -120,
    });
  }
  return energy;
}

export function readMusic(input: MusicInput): {
  music: Music;
  ambience: Ambience[];
  beats: number[];
} {
  const melodic = mixed(Object.values(input.stems));
  const db = levels(melodic, input.sampleRate, HOP, LEVEL_WINDOW);
  const duration = melodic.length / input.sampleRate;
  const fine = levels(melodic, input.sampleRate, HOP, HOP);
  const { segments: whole, breaks } = runs(db);
  for (const run of whole) run.end = Math.min(run.end, duration);
  const found = whole.flatMap((run) => sustainedParts(fine, run));
  const frames = bandFramesOf(asSignal(melodic, input.sampleRate));
  const rhythmic = asSignal(
    input.drums ? mixed([melodic, input.drums]) : melodic,
    input.sampleRate,
  );
  const beats = rhythm(rhythmic).beats.times;
  const pieces: Known[] = [];
  const segments: MusicSegment[] = [];
  const ambience: Ambience[] = [];
  const musical = new Set<Run>();
  for (const run of found) {
    const heard: Heard = {
      run,
      print: chromaOf(frames.chroma, frames.chromaFps, run),
      mix: shares(input, run),
      bpm: bpmOf(beatsInRun(rhythmic, run), { start: 0, end: run.end - run.start }),
      tonality: medianTopThreePitchShare(frames.chroma, frames.chromaFps, run),
    };
    if (!isMusic(heard)) {
      ambience.push({
        start: round(run.start),
        end: Math.min(round(run.end), round(duration, 3)),
        db: Math.round(10 * Math.log10(Math.max(1e-12, energyOf(melodic, input.sampleRate, run)))),
      });
      continue;
    }
    musical.add(run);
    const previous = segments[segments.length - 1];
    let piece = pieceOf(pieces, previous, heard);
    let entry: Entry;
    if (piece) entry = previous?.piece === piece.id ? "resumes" : "returns";
    else {
      piece = newPiece(pieces.length + 1, heard);
      pieces.push(piece);
      entry = previous ? "new" : "start";
    }
    segments.push({
      start: round(run.start),
      end: Math.min(round(run.end), round(duration, 3)),
      piece: piece.id,
      entry,
      bpm: heard.bpm,
      fadeFrom: fadeFrom(db, run),
    });
  }
  return {
    music: {
      segments,
      pieces: pieces.map(({ print: _print, mix: _mix, ...piece }) => piece),
      breaks: breaks
        .filter((b) => liesBetweenMusic(found, b, musical))
        .map((b) => ({ start: round(b.start), end: round(b.end) })),
      energy: energyCurve(melodic, input.sampleRate, duration, musical),
    },
    ambience,
    beats,
  };
}
