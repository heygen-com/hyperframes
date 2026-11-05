import { bandFramesOf, type Span } from "@hyperframes/core/audio-analysis";
import { ABSENT_DB, asSignal, levels, quantile, round, spanDb } from "./signal.js";
import type { Band, Effect, EffectGroup, Effects } from "./types.js";

const HOP = 0.01;
const FLOOR_FRAMES = 150;
const FLOOR_EVERY = 10;
const RISE_DB = 20;
const STEP_DB = 6;
const AUDIBLE_DB = -60;
const MASKED_DB = 20;
const TAIL_DB = 30;
const LONGEST = 4;
const SAME_SOUND = 0.95;
const TRAIN_GAP = 0.2;
const BEAT_SLACK = 0.05;
const ON_BEAT_SHARE = 0.7;
const DRUM_GROUP_MIN = 8;
const LOW_HZ = 150;
const BAND_FPS = 100;
const SETTLE_FRAMES = 5;
const PEAK_SLACK = 0.05;
const BEFORE = 0.5;
const MUSIC_BEFORE = 1;
const GAP = 0.03;
const SHORTEST_REFERENCE = 0.2;
const SAME_ONSET = 0.03;
const SPEECH_SLACK = 0.1;
const LIKE_SOUND = 0.9;
const RECURS = 3;
const STANDOUT_WINDOW = 4;
const STANDOUT_DB = 6;
const ENTRANCE_SLACK = 0.1;

interface Found {
  t: number;
  peak: number;
  end: number;
  peakDb: number;
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

/** How far a sound found at frame `f` reaches: back to where it left the floor or the trough after the sound before, on to its peak and through its tail, up to the next sound's onset. */
function onsetOf(db: Float32Array, f: number, base: number, from: number): number {
  let onset = f;
  while (
    onset > Math.max(from, f - 50) &&
    db[onset - 1]! > base + STEP_DB &&
    db[onset - 1]! < db[onset]!
  )
    onset--;
  return onset;
}

function extent(db: Float32Array, f: number, floor: Float32Array, from: number) {
  const base = floor[f]!;
  const onset = onsetOf(db, f, base, from);
  let peak = f;
  let end = f;
  const last = Math.min(db.length - 1, f + LONGEST / HOP);
  for (let g = f; g <= last; g++) {
    if (g >= f + SETTLE_FRAMES && startsAgain(db, g, f + 1, floor[g]!)) break;
    if (db[g]! > db[peak]!) peak = g;
    end = g;
    if (g > peak && (db[g]! < db[peak]! - TAIL_DB || db[g]! < base + 3)) break;
  }
  return { onset, peak, end };
}

function startsAgain(db: Float32Array, g: number, from: number, floor: number): boolean {
  let before = Infinity;
  for (let k = Math.max(from, g - SETTLE_FRAMES); k < g; k++) before = Math.min(before, db[k]!);
  return db[g]! - floor >= RISE_DB / 2 && db[g]! - before >= STEP_DB;
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
  let from = 0;
  for (let f = 5; f < db.length; f++) {
    if (!startsHere(db, f, floor[f]!)) continue;
    const { onset, peak, end } = extent(db, f, floor, from);
    const t = refined(samples, sampleRate, onset, Math.max(floor[f]!, db[onset - 1] ?? -120));
    if (!skip(t)) found.push({ t, peak: peak * HOP, end: end * HOP, peakDb: db[peak]! });
    from = end + 1;
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

function bandOf(low: number, centroid: number): Band {
  if (low >= 0.5) return "low";
  return centroid >= 2500 ? "high" : "mid";
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

interface Measured extends Shaped {
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

export interface EffectSource {
  samples: Float32Array;
  /** Where this track plays music or ambience: a sound that starts or peaks inside one belongs to it, not an effect. */
  heldBy?: readonly Span[];
  playsIn?: readonly Span[];
  stem?: string;
  parts?: Record<string, Float32Array>;
}

export interface EffectInput {
  /** The tracks effects are found in, each on its own: the drums and the bed, or the whole mix without stems. */
  sources: readonly EffectSource[];
  sampleRate: number;
  /** The whole recording: every level an effect is given is read from it, so the stems' leakage does not count. */
  mix: Float32Array;
  /** Everything but the voice, to say how far an effect stands over the music. */
  music: Float32Array | null;
  musicSegments?: readonly Span[];
  beats: readonly number[];
  /** Spans where an onset is speech, not an effect (the mix only). */
  speech: readonly Span[];
}

interface Levels {
  peakDb: number;
  riseDb: number | null;
  overMusicDb: number | null;
}

interface Shaped extends Found {
  band: Band;
  print: Float64Array;
  stem: string | null;
  inMusic: boolean;
}

function loudestPart(parts: Record<string, Float32Array>, sampleRate: number, f: Found): string {
  const end = Math.max(f.t + 0.05, Math.min(f.end, f.t + 0.4));
  return Object.entries(parts)
    .map(([name, samples]) => [name, spanDb(samples, sampleRate, f.t, end)] as const)
    .sort((a, b) => b[1] - a[1])[0]![0];
}

function foundIn(
  { samples: source, heldBy = [], playsIn = [], stem, parts }: EffectSource,
  input: EffectInput,
  mixDb: Float32Array,
): Shaped[] {
  const db = source === input.mix ? mixDb : levels(source, input.sampleRate, HOP);
  const inSpeech = (t: number) =>
    input.speech.some((s) => t >= s.start - SPEECH_SLACK && t < s.end);
  const masked = (f: Found) => f.peakDb < (mixDb[Math.round(f.peak / HOP)] ?? -120) - MASKED_DB;
  const held = (f: Found) => heldBy.some((span) => f.t < span.end && f.peak >= span.start);
  const found = detect(db, source, input.sampleRate, inSpeech).filter(
    (f) => !masked(f) && !held(f),
  );
  const bands = found.length ? bandFramesOf(asSignal(source, input.sampleRate)).bands : [];
  return found.map((f) => {
    const power = shape(bands, f.t, Math.min(f.end, f.t + 0.4));
    return {
      ...f,
      band: bandOf(lowShare(power), centroidHz(power)),
      print: printOf(power),
      stem: parts ? loudestPart(parts, input.sampleRate, f) : (stem ?? null),
      inMusic: playsIn.some((span) => f.t >= span.start - ENTRANCE_SLACK && f.t < span.end),
    };
  });
}

function measured(input: EffectInput, mixDb: Float32Array): Measured[] {
  const all = input.sources
    .flatMap((source) => foundIn(source, input, mixDb))
    .sort((a, b) => a.t - b.t);
  const out: Measured[] = [];
  for (const sound of all) {
    const previous = out[out.length - 1];
    if (previous && sound.t - previous.t < SAME_ONSET) {
      if (sound.peakDb > previous.peakDb) out[out.length - 1] = { ...sound, group: -1 };
    } else out.push({ ...sound, group: -1 });
  }
  grouped(out);
  return out;
}

function peakInMix(mixDb: Float32Array, m: Measured): number {
  const a = Math.max(0, Math.round((m.peak - PEAK_SLACK) / HOP));
  const b = Math.min(mixDb.length - 1, Math.round((m.peak + PEAK_SLACK) / HOP));
  let peak = -120;
  for (let f = a; f <= b; f++) peak = Math.max(peak, mixDb[f]!);
  return peak;
}

function musicNear(input: EffectInput, m: Measured, segment: Span): number {
  const { music, sampleRate } = input;
  const before = Math.max(segment.start, m.t - MUSIC_BEFORE);
  if (m.t - GAP - before >= SHORTEST_REFERENCE)
    return spanDb(music!, sampleRate, before, m.t - GAP);
  return spanDb(music!, sampleRate, m.end + GAP, Math.min(segment.end, m.end + MUSIC_BEFORE));
}

function levelsOf(input: EffectInput, mixDb: Float32Array, m: Measured): Levels {
  const peakDb = peakInMix(mixDb, m);
  const a = Math.max(0, Math.round((m.t - BEFORE) / HOP));
  const b = Math.max(a, Math.round((m.t - GAP) / HOP));
  const beforeDb = b > a ? quantile(mixDb.subarray(a, b), 0.5) : -120;
  const segment = input.music
    ? input.musicSegments?.find((span) => m.t >= span.start && m.t < span.end)
    : undefined;
  const musicDb = segment ? musicNear(input, m, segment) : null;
  return {
    peakDb: Math.round(peakDb),
    riseDb: beforeDb < ABSENT_DB ? null : Math.round(peakDb - beforeDb),
    overMusicDb: musicDb !== null && musicDb >= ABSENT_DB ? Math.round(peakDb - musicDb) : null,
  };
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

function alikeSounds(a: Measured, b: Measured): boolean {
  const ratio = (a.end - a.t) / Math.max(1e-3, b.end - b.t);
  return ratio >= 0.5 && ratio <= 2 && cosine(a.print, b.print) >= LIKE_SOUND;
}

function musicHits(sounds: readonly Measured[]): Set<Measured> {
  const playing = sounds.filter((m) => m.inMusic);
  const own = new Set<Measured>();
  for (const m of playing) {
    const same = playing.filter((o) => o.stem === m.stem);
    const recurs = same.filter((o) => alikeSounds(m, o)).length >= RECURS;
    const around = same
      .filter((o) => o !== m && Math.abs(o.t - m.t) <= STANDOUT_WINDOW)
      .map((o) => o.peakDb);
    const standsOut = around.length > 0 && m.peakDb >= quantile(around, 0.9) + STANDOUT_DB;
    if (recurs && !standsOut) own.add(m);
  }
  return own;
}

function effectOf(m: Measured, group: string, levels: Levels): Effect {
  return {
    t: round(m.t),
    end: round(m.end),
    kind: "effect",
    group,
    band: m.band,
    attackMs: Math.round((m.peak - m.t) * 1000),
    tail: round(m.end - m.peak),
    ...levels,
    count: 1,
    stem: m.stem,
  };
}

export function findEffects(input: EffectInput): Effects {
  const mixDb = levels(input.mix, input.sampleRate, HOP);
  const all = measured(input, mixDb);
  const own = musicHits(all);
  const sounds = all.filter((m) => !own.has(m));
  const members = new Map<number, Measured[]>();
  for (const m of sounds) members.set(m.group, [...(members.get(m.group) ?? []), m]);
  const drums = drumGroups(members, input.beats);
  const kept = [...members]
    .filter(([id]) => !drums.has(id))
    .sort((a, b) => b[1].length - a[1].length);
  const names = new Map(kept.map(([id], i) => [id, `S${i + 1}`]));
  const groups: EffectGroup[] = kept.map(([id, list]) => ({
    id: names.get(id)!,
    count: list.length,
  }));
  const events: Effect[] = [];
  for (const m of sounds) {
    if (drums.has(m.group)) continue;
    const group = names.get(m.group)!;
    const previous = events[events.length - 1];
    if (previous?.group === group && m.t - previous.end <= TRAIN_GAP) {
      previous.end = round(m.end);
      previous.count++;
    } else events.push(effectOf(m, group, levelsOf(input, mixDb, m)));
  }
  const drumHits = [...drums].reduce((n, id) => n + members.get(id)!.length, own.size);
  return { events, groups, drumHits };
}
