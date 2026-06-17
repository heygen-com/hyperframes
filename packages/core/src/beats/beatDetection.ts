// bpm-detective touches `window` at module top-level, so it must NOT be a static
// import (that would crash any non-browser import of this module graph, e.g.
// vitest/SSR). It's loaded lazily inside analyzeMusicFromBuffer, which only runs
// in the browser.
type BpmDetect = (buffer: AudioBuffer) => number;
let bpmDetectivePromise: Promise<BpmDetect | null> | null = null;
function loadBpmDetective(): Promise<BpmDetect | null> {
  if (!bpmDetectivePromise) {
    bpmDetectivePromise = import(
      // @ts-ignore -- no type declarations for bpm-detective
      "bpm-detective"
    )
      .then((m) => ((m as { default?: BpmDetect }).default ?? (m as unknown as BpmDetect)) || null)
      .catch(() => null);
  }
  return bpmDetectivePromise;
}

const WINDOW_SIZE = 1024;
const HOP_SIZE = 512;

export interface MusicBeatAnalysis {
  beatTimes: number[];
  /** Per-beat loudness 0–1 (local RMS / peak), aligned by index with beatTimes. */
  beatStrengths: number[];
  bpm: number | null;
  bpmConfidence: "high" | "low" | "uncertain";
  /** Decoded mono samples — retained so strength can be measured at user-added
   *  beats. Audio-file coordinates. May be null if decode data was dropped. */
  channelData: Float32Array | null;
  sampleRate: number;
  /** Reference peak RMS used to normalize beat strengths. */
  peak: number;
}

const STRENGTH_WINDOW_S = 0.05; // ±50ms RMS window

/** Local RMS amplitude at a given audio-file time. */
export function computeRmsAt(channelData: Float32Array, sampleRate: number, time: number): number {
  const halfWindow = Math.floor(sampleRate * STRENGTH_WINDOW_S);
  const center = Math.floor(time * sampleRate);
  const start = Math.max(0, center - halfWindow);
  const end = Math.min(channelData.length, center + halfWindow);
  let sum = 0;
  for (let i = start; i < end; i++) {
    const s = channelData[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / Math.max(end - start, 1));
}

/** Normalized beat strength (0–1) at an audio-file time, using a track peak. */
export function strengthAtTime(
  analysis: Pick<MusicBeatAnalysis, "channelData" | "sampleRate" | "peak">,
  time: number,
): number {
  if (!analysis.channelData || analysis.peak <= 0) return 0.5;
  return Math.min(1, computeRmsAt(analysis.channelData, analysis.sampleRate, time) / analysis.peak);
}

// fallow-ignore-next-line complexity
export async function detectBeats(audioBuffer: AudioBuffer): Promise<number[]> {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  const energies: number[] = [];
  for (let i = 0; i < channelData.length - WINDOW_SIZE; i += HOP_SIZE) {
    let sum = 0;
    for (let j = 0; j < WINDOW_SIZE; j++) {
      const sample = channelData[i + j]!;
      sum += sample * sample;
    }
    energies.push(sum / WINDOW_SIZE);
  }

  const beats: number[] = [];
  const localWindowSize = 20;

  for (let i = localWindowSize; i < energies.length - localWindowSize; i++) {
    let localMean = 0;
    for (let j = i - localWindowSize; j < i + localWindowSize; j++) {
      localMean += energies[j]!;
    }
    localMean /= localWindowSize * 2;

    const threshold = localMean * 1.5;
    const current = energies[i]!;

    if (
      current > threshold &&
      current > (energies[i - 1] ?? 0) &&
      current > (energies[i + 1] ?? 0)
    ) {
      const timeInSeconds = (i * HOP_SIZE) / sampleRate;
      if (beats.length === 0 || timeInSeconds - beats[beats.length - 1]! > 0.1) {
        beats.push(Math.round(timeInSeconds * 1000) / 1000);
      }
    }
  }

  return beats;
}

function computeBpmFromBeats(beatTimes: number[]): number | null {
  if (beatTimes.length < 4) return null;
  const iois: number[] = [];
  for (let i = 1; i < beatTimes.length; i++) {
    iois.push(beatTimes[i]! - beatTimes[i - 1]!);
  }
  const sorted = [...iois].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianIoi = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  if (medianIoi <= 0) return null;
  return Math.round((60 / medianIoi) * 10) / 10;
}

// Fold into 60–120 for octave-safe BPM comparison
function canonicalizeBpm(bpm: number): number {
  let b = bpm;
  while (b > 120) b /= 2;
  while (b < 60) b *= 2;
  return b;
}

// Pick the *2/÷2 octave of `bpm` whose beat interval is closest to the onset
// pulse, so a half-time detective reading (e.g. 174 for an 87bpm song) doesn't
// produce a double-density grid.
function octaveAlignBpm(bpm: number, reference: number): number {
  const candidates = [bpm / 2, bpm, bpm * 2];
  let best = bpm;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (c <= 0) continue;
    const dist = Math.abs(c - reference);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

// fallow-ignore-next-line complexity
function regularizeBeats(rawBeats: number[], bpm: number, duration: number): number[] {
  if (rawBeats.length === 0 || bpm <= 0 || duration <= 0) return rawBeats;
  const beatInterval = 60 / bpm;
  // Guard against a pathological (octave-misread) tempo producing a millisecond
  // interval → tens of thousands of grid beats that freeze the timeline. 480 BPM
  // (0.125s) is well above any real music tempo; bail to the raw onsets instead.
  if (beatInterval < 0.125) return rawBeats;
  const threshold = beatInterval * 0.25;

  // Find phase offset that maximally aligns with raw onsets
  let bestOffset = 0;
  let bestScore = -1;
  for (const anchor of rawBeats.slice(0, 10)) {
    const offset = ((anchor % beatInterval) + beatInterval) % beatInterval;
    let score = 0;
    for (const rb of rawBeats) {
      const phase = ((rb % beatInterval) + beatInterval) % beatInterval;
      const dist = Math.min(Math.abs(phase - offset), beatInterval - Math.abs(phase - offset));
      if (dist < threshold) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  const beats: number[] = [];
  for (let t = bestOffset; t <= duration + 0.001; t += beatInterval) {
    beats.push(Math.round(t * 1000) / 1000);
  }
  return beats;
}

// Drop beats that fall in silent/near-silent regions (e.g. intro/outro) and
// score each surviving beat's loudness (local RMS / peak) for brightness.
function gateBeatsBySilence(
  beats: number[],
  channelData: Float32Array,
  sampleRate: number,
): { times: number[]; strengths: number[]; peak: number } {
  if (beats.length === 0) return { times: beats, strengths: [], peak: 1e-6 };
  const energies = beats.map((t) => computeRmsAt(channelData, sampleRate, t));
  const peak = Math.max(...energies, 1e-6);
  const threshold = peak * 0.12;
  const times: number[] = [];
  const strengths: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    if (energies[i]! >= threshold) {
      times.push(beats[i]!);
      strengths.push(Math.min(1, energies[i]! / peak));
    }
  }
  return { times, strengths, peak };
}

// fallow-ignore-next-line complexity
export async function analyzeMusicFromBuffer(audioBuffer: AudioBuffer): Promise<MusicBeatAnalysis> {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  const rawBeats = await detectBeats(audioBuffer);
  const onsetBpm = computeBpmFromBeats(rawBeats);

  let detectiveBpm: number | null = null;
  try {
    const detect = await loadBpmDetective();
    if (detect) detectiveBpm = detect(audioBuffer);
  } catch {
    // Not enough peaks or browser context unavailable
  }

  let bpm: number | null = onsetBpm;
  let confidence: MusicBeatAnalysis["bpmConfidence"] = "uncertain";
  let regularizeBpm: number | null = null;

  if (onsetBpm !== null && detectiveBpm !== null) {
    const pctDiff =
      Math.abs(canonicalizeBpm(onsetBpm) - canonicalizeBpm(detectiveBpm)) /
      canonicalizeBpm(detectiveBpm);
    if (pctDiff < 0.05) {
      // Detective folds tempo into 90–180; re-pick the octave nearest the onset
      // pulse so a half-time track isn't gridded at double density.
      bpm = octaveAlignBpm(detectiveBpm, onsetBpm);
      confidence = "high";
      regularizeBpm = bpm;
    } else if (pctDiff < 0.1) {
      bpm = Math.round((onsetBpm + detectiveBpm) / 2);
      confidence = "low";
      regularizeBpm = bpm;
    } else {
      bpm = onsetBpm;
      confidence = "uncertain";
    }
  } else if (onsetBpm !== null) {
    bpm = onsetBpm;
    confidence = "low";
    regularizeBpm = onsetBpm;
  } else if (detectiveBpm !== null) {
    bpm = detectiveBpm;
    confidence = "low";
    regularizeBpm = detectiveBpm;
  }

  const gridBeats =
    regularizeBpm !== null ? regularizeBeats(rawBeats, regularizeBpm, duration) : rawBeats;
  const gated = gateBeatsBySilence(gridBeats, channelData, sampleRate);

  return {
    beatTimes: gated.times,
    beatStrengths: gated.strengths,
    bpm,
    bpmConfidence: confidence,
    channelData,
    sampleRate,
    peak: gated.peak,
  };
}

export async function detectBeatsFromUrl(url: string): Promise<number[]> {
  const audioContext = new AudioContext();
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return detectBeats(audioBuffer);
  } finally {
    await audioContext.close();
  }
}

export async function analyzeMusicFromUrl(url: string): Promise<MusicBeatAnalysis> {
  const audioContext = new AudioContext();
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return analyzeMusicFromBuffer(audioBuffer);
  } finally {
    await audioContext.close();
  }
}
