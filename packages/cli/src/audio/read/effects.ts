import { bandFramesOf, type Span } from "@hyperframes/core/audio-analysis";
import { asSignal, levels, quantile, round } from "./signal.js";
import type { Band, Effect, EffectGroup, EffectKind, Effects } from "./types.js";

const HOP = 0.01;
const FLOOR_FRAMES = 150;
const FLOOR_EVERY = 10;
const RISE_DB = 20;
const STEP_DB = 6;
const AUDIBLE_DB = -60;
const MASKED_DB = 20;
const MUSIC_OUT_DB = -60;
const TAIL_DB = 30;
const LONGEST = 4;
const SAME_SOUND = 0.95;
const TRAIN_GAP = 0.2;
const BEAT_SLACK = 0.05;
const ON_BEAT_SHARE = 0.7;
const DRUM_GROUP_MIN = 8;
const LOW_HZ = 150;
const BAND_FPS = 100;

interface Found {
  t: number;
  peak: number;
  end: number;
  peakDb: number;
  riseDb: number;
}

/** A rolling low percentile of the level: what was playing before each frame. */
function floors(db: Float32Array): Float32Array {
  const out = new Float32Array(db.length);
  let current = db[0] ?? -120;
  for (let f = 0; f < db.length; f++) {
    if (f % FLOOR_EVERY === 0 && f > 0)
      current = quantile(db.subarray(Math.max(0, f - FLOOR_FRAMES), f), 0.2);
    out[f] = current;
  }
  return out;
}

const BLOCK = 0.001;

/** The first millisecond that rises halfway out of the floor: frame levels alone place an onset up to a hop early. */
function refined(
  samples: Float32Array,
  sampleRate: number,
  frame: number,
  floorDb: number,
): number {
  const block = Math.max(1, Math.round(BLOCK * sampleRate));
  const from = Math.max(0, Math.round((frame - 2) * HOP * sampleRate));
  const to = Math.min(samples.length, Math.round((frame + 2) * HOP * sampleRate));
  for (let a = from; a + block <= to; a += block) {
    let power = 0;
    for (let i = a; i < a + block; i++) power += samples[i]! ** 2;
    if (10 * Math.log10(power / block + 1e-12) >= floorDb + RISE_DB / 2) return a / sampleRate;
  }
  return frame * HOP;
}

/** How far a sound found at frame `f` reaches: back to where it left the floor, on to its peak and through its tail. */
function extent(db: Float32Array, f: number, floor: number) {
  let onset = f;
  while (onset > Math.max(0, f - 50) && db[onset - 1]! > floor + STEP_DB) onset--;
  let peak = f;
  let end = f;
  const last = Math.min(db.length - 1, f + LONGEST / HOP);
  for (let g = f; g <= last; g++) {
    if (db[g]! > db[peak]!) peak = g;
    end = g;
    if (g > peak && (db[g]! < db[peak]! - TAIL_DB || db[g]! < floor + 3)) break;
  }
  return { onset, peak, end };
}

function startsHere(db: Float32Array, f: number, floor: number): boolean {
  const level = db[f]!;
  if (level < AUDIBLE_DB || level - floor < RISE_DB) return false;
  return level - Math.min(db[f - 1]!, db[f - 2]!, db[f - 3]!, db[f - 4]!, db[f - 5]!) >= STEP_DB;
}

function detect(
  db: Float32Array,
  samples: Float32Array,
  sampleRate: number,
  skip: (t: number) => boolean,
): Found[] {
  const floor = floors(db);
  const found: Found[] = [];
  for (let f = 5; f < db.length; f++) {
    if (!startsHere(db, f, floor[f]!)) continue;
    const { onset, peak, end } = extent(db, f, floor[f]!);
    const t = refined(samples, sampleRate, onset, floor[f]!);
    if (!skip(t))
      found.push({
        t,
        peak: peak * HOP,
        end: end * HOP,
        peakDb: db[peak]!,
        riseDb: db[peak]! - floor[f]!,
      });
    f = Math.max(end, onset + 8);
  }
  return found;
}

const BIN_HZ = 22050 / 1024;
const EDGES = (() => {
  const edges: number[] = [];
  for (let hz = 30; hz < 9000; hz *= 2 ** (1 / 5)) edges.push(Math.max(1, Math.round(hz / BIN_HZ)));
  return edges;
})();
const bandHz = (k: number) => 30 * 2 ** ((k + 0.5) / 5);
/** Bins in each band: core's band frames hold the mean power per bin, so a band's energy is that times its width. */
const WIDTH = EDGES.slice(0, -1).map((edge, k) => Math.max(edge + 1, EDGES[k + 1]!) - edge);
const energies = (power: Float64Array) => Array.from(power, (v, k) => Math.expm1(v) * WIDTH[k]!);
const BANDS_PER_PRINT = 5;

function shape(bands: Float64Array[], from: number, to: number): Float64Array {
  const a = Math.max(0, Math.floor(from * BAND_FPS));
  const b = Math.max(a + 1, Math.min(bands.length, Math.ceil(to * BAND_FPS)));
  const size = bands[0]?.length ?? 0;
  const mean = new Float64Array(size);
  for (let f = a; f < b; f++) for (let k = 0; k < size; k++) mean[k]! += bands[f]![k]! / (b - a);
  return mean;
}

function lowShare(power: Float64Array): number {
  const e = energies(power);
  const total = e.reduce((a, b) => a + b, 0);
  const low = e.reduce((sum, p, k) => sum + (bandHz(k) < LOW_HZ ? p : 0), 0);
  return total > 0 ? low / total : 0;
}

function centroidHz(power: Float64Array): number {
  const e = energies(power);
  const weight = e.reduce((a, b) => a + b, 0);
  const sum = e.reduce((acc, p, k) => acc + p * Math.log2(bandHz(k)), 0);
  return weight > 0 ? 2 ** (sum / weight) : 0;
}

const tonal = (power: Float64Array) => {
  const sorted = Float64Array.from(power).sort();
  return sorted[sorted.length - 1]! - sorted[Math.floor(sorted.length * 0.75)]! >= 2.5;
};

interface Shape {
  length: number;
  attack: number;
  tail: number;
  band: Band;
  centroid: number;
  tonal: boolean;
}

/** Tried in order; a sound none of them fits is a hit. */
const KINDS: [(s: Shape) => boolean, (s: Shape) => EffectKind][] = [
  [(s) => s.length >= 0.8 && s.attack >= 0.45 * s.length, () => "riser"],
  [(s) => s.band === "low", (s) => (s.tail >= 0.6 ? "boom" : "thump")],
  [(s) => s.length <= 0.15, (s) => (s.centroid >= 3000 ? "tick" : "click")],
  [(s) => s.tonal && s.tail >= 0.4, () => "ding"],
  [(s) => s.attack >= 0.06 && s.length <= 1.5, () => "whoosh"],
];

function bandOf(low: number, centroid: number): Band {
  if (low >= 0.5) return "low";
  return centroid >= 2500 ? "high" : "mid";
}

function kindOf(found: Found, power: Float64Array): { kind: EffectKind; band: Band } {
  const centroid = centroidHz(power);
  const shape: Shape = {
    length: found.end - found.t,
    attack: found.peak - found.t,
    tail: found.end - found.peak,
    band: bandOf(lowShare(power), centroid),
    centroid,
    tonal: tonal(power),
  };
  const kind = KINDS.find(([fits]) => fits(shape))?.[1](shape) ?? "hit";
  return { kind, band: shape.band };
}

/** The sound's spectral shape: the square root of each octave's share of its energy, so loudness does not count. */
function printOf(power: Float64Array): Float64Array {
  const e = energies(power);
  const octaves = new Float64Array(Math.ceil(e.length / BANDS_PER_PRINT));
  e.forEach((p, k) => (octaves[Math.floor(k / BANDS_PER_PRINT)]! += p));
  const total = octaves.reduce((a, b) => a + b, 0);
  return octaves.map((p) => (total > 0 ? Math.sqrt(p / total) : 0));
}

function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < a.length; k++) {
    dot += a[k]! * b[k]!;
    na += a[k]! ** 2;
    nb += b[k]! ** 2;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

interface Measured extends Found {
  kind: EffectKind;
  band: Band;
  print: Float64Array;
  group: number;
}

function grouped(events: Measured[]): Float64Array[] {
  const prints: { sum: Float64Array; n: number; length: number }[] = [];
  for (const event of events) {
    const length = event.end - event.t;
    let best = -1;
    let bestScore = SAME_SOUND;
    prints.forEach((p, i) => {
      const ratio = length / p.length;
      if (ratio < 0.5 || ratio > 2) return;
      const score = cosine(
        event.print,
        p.sum.map((v) => v / p.n),
      );
      if (score >= bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best < 0) {
      prints.push({ sum: Float64Array.from(event.print), n: 1, length });
      best = prints.length - 1;
    } else {
      const p = prints[best]!;
      event.print.forEach((v, k) => (p.sum[k]! += v));
      p.length = (p.length * p.n + length) / (p.n + 1);
      p.n++;
    }
    event.group = best;
  }
  return prints.map((p) => p.sum);
}

function onBeat(t: number, beats: readonly number[]): boolean {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  const near = [beats[lo - 1], beats[lo]].filter((b): b is number => b !== undefined);
  return near.some((b) => Math.abs(b - t) <= BEAT_SLACK);
}

function majority(kinds: EffectKind[]): EffectKind {
  const counts = new Map<EffectKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
}

export interface EffectInput {
  /** The track effects are found in: the drum stem, or the whole mix without stems. */
  source: Float32Array;
  sampleRate: number;
  /** The music without drums, to say how far an effect stands over it. */
  music: Float32Array | null;
  /** The whole recording, when the source is a stem: an effect far under it is separation residue nobody hears. */
  heard: Float32Array | null;
  beats: readonly number[];
  /** Spans where an onset is speech, not an effect (the mix only). */
  speech: readonly Span[];
}

function measured(input: EffectInput): Measured[] {
  const db = levels(input.source, input.sampleRate, HOP);
  const inSpeech = (t: number) => input.speech.some((s) => t >= s.start && t < s.end);
  const heardDb = input.heard ? levels(input.heard, input.sampleRate, HOP, 0.5) : null;
  const masked = (f: Found) => {
    const level = heardDb?.[Math.round(f.peak / HOP)];
    return level !== undefined && f.peakDb < level - MASKED_DB;
  };
  const found = detect(db, input.source, input.sampleRate, inSpeech).filter((f) => !masked(f));
  const bands = found.length ? bandFramesOf(asSignal(input.source, input.sampleRate)).bands : [];
  const out: Measured[] = found.map((f) => {
    const power = shape(bands, f.t, Math.min(f.end, f.t + 0.4));
    return { ...f, ...kindOf(f, power), print: printOf(power), group: -1 };
  });
  grouped(out);
  return out;
}

/** Groups that keep landing on the music's beat are its own drums, not effects. */
function drumGroups(members: Map<number, Measured[]>, beats: readonly number[]): Set<number> {
  const drums = new Set<number>();
  if (!beats.length) return drums;
  for (const [id, list] of members) {
    const onBeats = list.filter((m) => onBeat(m.t, beats)).length;
    if (list.length >= DRUM_GROUP_MIN && onBeats >= ON_BEAT_SHARE * list.length) drums.add(id);
  }
  return drums;
}

function effectOf(
  m: Measured,
  group: string,
  kind: EffectKind,
  musicDb: Float32Array | null,
): Effect {
  const musicLevel = musicDb?.[Math.round(m.peak / HOP)];
  const musicPlays = musicLevel !== undefined && musicLevel > MUSIC_OUT_DB;
  return {
    t: round(m.t),
    end: round(m.end),
    kind,
    group,
    band: m.band,
    attackMs: Math.round((m.peak - m.t) * 1000),
    tail: round(m.end - m.peak),
    riseDb: Math.round(m.riseDb),
    overMusicDb: musicPlays ? Math.round(m.peakDb - musicLevel) : null,
    count: 1,
  };
}

export function findEffects(input: EffectInput): Effects {
  const sounds = measured(input);
  const members = new Map<number, Measured[]>();
  for (const m of sounds) members.set(m.group, [...(members.get(m.group) ?? []), m]);
  const drums = drumGroups(members, input.beats);
  const kept = [...members]
    .filter(([id]) => !drums.has(id))
    .sort((a, b) => b[1].length - a[1].length);
  const names = new Map(kept.map(([id], i) => [id, `S${i + 1}`]));
  const groups: EffectGroup[] = kept.map(([id, list]) => ({
    id: names.get(id)!,
    kind: majority(list.map((m) => m.kind)),
    count: list.length,
  }));
  const kindOfGroup = new Map(groups.map((g) => [g.id, g.kind]));
  const musicDb = input.music ? levels(input.music, input.sampleRate, HOP, 0.5) : null;
  const events: Effect[] = [];
  for (const m of sounds) {
    if (drums.has(m.group)) continue;
    const group = names.get(m.group)!;
    const previous = events[events.length - 1];
    if (previous?.group === group && m.t - previous.end <= TRAIN_GAP) {
      previous.end = round(m.end);
      previous.count++;
    } else events.push(effectOf(m, group, kindOfGroup.get(group) ?? m.kind, musicDb));
  }
  const drumHits = [...drums].reduce((n, id) => n + members.get(id)!.length, 0);
  return { events, groups, drumHits };
}
