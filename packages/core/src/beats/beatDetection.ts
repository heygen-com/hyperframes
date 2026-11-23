import { energyMixSteps, type AudioSignal } from "../audioAnalysis";
import { rhythmSteps, tempoOf } from "../audioRhythm";
import { finish, type Steps } from "../audioSteps";

export interface MusicBeatAnalysis {
  beatTimes: number[];
  /** Per-beat loudness 0–1 (local RMS / peak), aligned by index with beatTimes. */
  beatStrengths: number[];
  bpm: number | null;
  bpmConfidence: "high" | "low" | "uncertain";
  /** Per-sample level across channels — retained so strength can be measured at
   *  user-added beats. Audio-file coordinates. May be null if decode data was dropped. */
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

/** At or above this the tempo is reported as "high" confidence. */
const HIGH_CONFIDENCE = 0.35;

/** Each beat's local RMS against the loudest beat's, and that loudest RMS. */
function beatStrengths(beats: number[], levels: Float32Array, sampleRate: number) {
  const energies = beats.map((t) => computeRmsAt(levels, sampleRate, t));
  const peak = Math.max(...energies, 1e-6);
  return { strengths: energies.map((e) => Math.min(1, e / peak)), peak };
}

export interface MusicAnalysisOptions {
  pause?: () => Promise<void>;
}

/** Longest stretch the analysis runs before awaiting `pause`. */
const SLICE_MS = 8;

async function sliced<T>(steps: Steps<T>, pause: (() => Promise<void>) | undefined): Promise<T> {
  if (!pause) return finish(steps);
  let start = performance.now();
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    if (performance.now() - start >= SLICE_MS) {
      await pause();
      start = performance.now();
    }
  }
}

/** Beats, tempo and per-beat strength of decoded audio; no beats and a null bpm when it has no steady beat. */
export async function analyzeMusicFromSignal(
  signal: AudioSignal,
  { pause }: MusicAnalysisOptions = {},
): Promise<MusicBeatAnalysis> {
  await pause?.();
  const { beats } = await sliced(rhythmSteps(signal), pause);
  const channelData = await sliced(energyMixSteps(signal), pause);
  const confidence = beats.confidence ?? 0;
  const times = beats.times;
  const { strengths, peak } = beatStrengths(times, channelData, signal.sampleRate);
  const bpm = tempoOf(times).value;
  return {
    beatTimes: times,
    beatStrengths: strengths,
    bpm,
    bpmConfidence: bpm === null ? "uncertain" : confidence >= HIGH_CONFIDENCE ? "high" : "low",
    channelData,
    sampleRate: signal.sampleRate,
    peak,
  };
}

export function analyzeMusicFromBuffer(
  audioBuffer: AudioBuffer,
  options: MusicAnalysisOptions = {},
): Promise<MusicBeatAnalysis> {
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, c) =>
    audioBuffer.getChannelData(c),
  );
  return analyzeMusicFromSignal({ sampleRate: audioBuffer.sampleRate, channels }, options);
}

export async function analyzeMusicFromUrl(
  url: string,
  options: MusicAnalysisOptions = {},
): Promise<MusicBeatAnalysis> {
  await options.pause?.();
  const audioContext = new AudioContext();
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return analyzeMusicFromBuffer(audioBuffer, options);
  } finally {
    await audioContext.close();
  }
}
