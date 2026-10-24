import { bandFramesOf, medianInterval, rhythm } from "@hyperframes/core/audio-analysis";
import { asSignal, levels, median, mixed, round } from "./signal.js";
import type { Entry, Music, MusicSegment, Piece } from "./types.js";

const HOP = 0.1;
const ABSENT_DB = -55;
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

function chromaOf(chroma: Float64Array[], fps: number, run: Run): Float64Array {
  const a = Math.floor(run.start * fps);
  const b = Math.max(a + 1, Math.min(chroma.length, Math.ceil(run.end * fps)));
  const sum = new Float64Array(12);
  for (let f = a; f < b; f++) chroma[f]?.forEach((v, k) => (sum[k]! += v));
  const norm = Math.hypot(...sum);
  return norm ? sum.map((v) => v / norm) : sum;
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
}

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
    instruments: Object.entries(heard.mix)
      .filter(([, share]) => share >= LEADING_SHARE)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name),
    bpm: heard.bpm,
    firstAt: round(heard.run.start),
    print: heard.print,
    mix: heard.mix,
  };
}

function energyCurve(melodic: Float32Array, sampleRate: number, duration: number) {
  const energy = [];
  for (let start = 0; start < duration; start += ENERGY_WINDOW) {
    const end = Math.min(duration, start + ENERGY_WINDOW);
    const power = energyOf(melodic, sampleRate, { start, end });
    energy.push({
      start,
      end: round(end),
      db: power > 0 ? Math.round(10 * Math.log10(power)) : -120,
    });
  }
  return energy;
}

export function readMusic(input: MusicInput): { music: Music; beats: number[] } {
  const melodic = mixed(Object.values(input.stems));
  const db = levels(melodic, input.sampleRate, HOP, LEVEL_WINDOW);
  const { segments: found, breaks } = runs(db);
  const frames = bandFramesOf(asSignal(melodic, input.sampleRate));
  const beats = rhythm(
    asSignal(input.drums ? mixed([melodic, input.drums]) : melodic, input.sampleRate),
  ).beats.times;
  const pieces: Known[] = [];
  const segments: MusicSegment[] = [];
  for (const run of found) {
    const heard: Heard = {
      run,
      print: chromaOf(frames.chroma, frames.chromaFps, run),
      mix: shares(input, run),
      bpm: bpmOf(beats, run),
    };
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
      end: round(run.end),
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
      breaks: breaks.map((b) => ({ start: round(b.start), end: round(b.end) })),
      energy: energyCurve(melodic, input.sampleRate, db.length * HOP),
    },
    beats,
  };
}
