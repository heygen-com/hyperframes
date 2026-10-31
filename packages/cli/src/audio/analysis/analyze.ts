import {
  localBeatEvidence,
  medianInterval,
  rhythm,
  runLadder,
  signalDuration,
  signalProvider,
  silence,
  snapper,
  STEADY_BEAT_CONFIDENCE,
  tempoOf,
  type AnalysisQuality,
  type AudioAnalysisProvider,
  type AudioCapability,
  type AudioSignal,
  type Beats,
  type LadderResult,
  type LadderStep,
  type SnapReport,
} from "@hyperframes/core/audio-analysis";
import { apiProvider } from "./providers/api.js";
import { appleMuProvider, appleSoundProvider } from "./providers/apple.js";
import { beatThisProvider } from "./providers/beatThis.js";
import { shiftedTimes } from "./fileTime.js";

/** What `hyperframes audio` asks for when `--only` is not given. */
export const DEFAULT_CAPABILITIES: readonly AudioCapability[] = [
  "kind",
  "moments",
  "onsets",
  "loudness",
  "silence",
  "envelope",
];

/**
 * Every provider the CLI knows, in default ladder order: each capability tries the ones that offer it in this order.
 * beats, downbeats: api, apple-mu, beat-this, signal. sections: api, apple-mu, signal. describe: api, apple-sound.
 */
function audioAnalysisProviders(): AudioAnalysisProvider<AudioSignal>[] {
  return [apiProvider, appleMuProvider, beatThisProvider, appleSoundProvider, signalProvider];
}

export interface AnalyzeOptions {
  capabilities: readonly AudioCapability[];
  /** Defaults to local: audio leaves the machine only when best is asked for. */
  quality?: AnalysisQuality;
  /** Pin a capability to one provider, skipping the ladder. */
  provider?: Partial<Record<AudioCapability, string>>;
  /** Per-capability options handed to the provider. */
  options?: Partial<Record<AudioCapability, Record<string, unknown>>>;
  /** Seconds into the file where the signal begins; every reported time is shifted by it. */
  fileOffset?: number;
  /** Seconds of signal around the analyzed window, there so onsets at its edges are told from the cut. */
  context?: { before: number; after: number };
}

export interface Analysis {
  /** Seconds of signal analyzed. */
  analyzed: number;
  values: Partial<Record<AudioCapability, unknown>>;
  provenance: Partial<Record<AudioCapability, string | null>>;
  ladder: Partial<Record<AudioCapability, LadderStep[]>>;
  warnings: string[];
}

/** Long signals get a coarser envelope, so one item stays near 2,000 values. */
export function envelopeHopMs(seconds: number, asked?: number): number {
  if (asked !== undefined) return asked;
  return Math.max(5, Math.ceil((seconds * 1000) / 2000));
}

const round = (t: number) => Math.round(t * 1000) / 1000;

function within(value: unknown, from: number, to: number): unknown {
  if (!value || typeof value !== "object" || !("events" in value)) return value;
  const onsets = value as { events: { t: number }[] };
  return { ...onsets, events: onsets.events.filter((e) => e.t >= from && e.t < to) };
}

interface Framing {
  /** The signal without its context, which every capability but onsets measures. */
  windowed: AudioSignal;
  /** Seconds of context before the window, and where the window ends, in signal seconds. */
  before: number;
  end: number;
  cut: boolean;
}

function frame(signal: AudioSignal, context: AnalyzeOptions["context"]): Framing {
  const before = context?.before ?? 0;
  const skip = Math.round(before * signal.sampleRate);
  const length = signal.channels[0]?.length ?? 0;
  const end = Math.max(skip, length - Math.round((context?.after ?? 0) * signal.sampleRate));
  const cut = skip > 0 || end < length;
  const windowed = cut
    ? { ...signal, channels: signal.channels.map((c) => c.subarray(skip, end)) }
    : signal;
  return { windowed, before, end: end / signal.sampleRate, cut };
}

function optionsFor(capability: AudioCapability, request: AnalyzeOptions, seconds: number) {
  const options = { ...request.options?.[capability] };
  if (capability === "envelope")
    options.hopMs = envelopeHopMs(seconds, options.hopMs as number | undefined);
  return options;
}

export async function analyzeSignal(
  signal: AudioSignal,
  request: AnalyzeOptions,
  providers: readonly AudioAnalysisProvider<AudioSignal>[] = audioAnalysisProviders(),
): Promise<Analysis> {
  const quality = request.quality ?? "local";
  const { beats, bpm } = request.provider ?? {};
  if (beats && bpm && beats !== bpm) throw new Error("beats and bpm must use the same provider");
  const beatProvider = beats ?? bpm;
  const framing = frame(signal, request.context);
  const analysis: Analysis = {
    analyzed: round(signalDuration(framing.windowed)),
    values: {},
    provenance: {},
    ladder: {},
    warnings: [],
  };
  const ladders = new Map<AudioCapability, Promise<LadderResult>>();
  const ladderFor = (capability: AudioCapability) => {
    let result = ladders.get(capability);
    if (!result) {
      const withContext = capability === "onsets" && framing.cut;
      const input = withContext ? signal : framing.windowed;
      result = runLadder(capability, input, providers, {
        quality,
        provider: capability === "beats" ? beatProvider : request.provider?.[capability],
        options: optionsFor(capability, request, analysis.analyzed),
      }).then((answer) => settled(capability, answer, input));
      ladders.set(capability, result);
    }
    return result;
  };
  for (const capability of request.capabilities) {
    const withContext = capability === "onsets" && framing.cut;
    const result =
      capability === "bpm" ? tempoFromBeats(await ladderFor("beats")) : await ladderFor(capability);
    const value = withContext ? within(result.value, framing.before, framing.end) : result.value;
    const offset = (request.fileOffset ?? 0) - (withContext ? framing.before : 0);
    analysis.values[capability] = shiftedTimes(capability, value, offset);
    analysis.provenance[capability] = result.provenance;
    analysis.ladder[capability] = result.steps;
    const said = new Set(analysis.warnings);
    analysis.warnings.push(...result.warnings.filter((w) => !said.has(w)));
  }
  analysis.warnings.push(...serviceHint(quality, analysis, request.capabilities));
  return analysis;
}

function serviceHint(
  quality: AnalysisQuality,
  analysis: Analysis,
  capabilities: readonly AudioCapability[],
): string[] {
  const leftToService = (capability: AudioCapability) =>
    analysis.values[capability] == null &&
    (analysis.ladder[capability] ?? []).some((s) => s.outcome === "excluded");
  return quality === "local" && capabilities.some(leftToService)
    ? ["a service could have answered what is missing: --quality best uploads the audio to HeyGen"]
    : [];
}

export interface MarkedBeats {
  times: number[];
  /** True where nothing rhythmic sounds at the beat (silence, hiss, a held note): the grid runs on there. */
  unheard: boolean[];
  meter?: number | null;
  snap?: SnapReport;
}

/** Under this a beat sits in digital silence, whatever the rest of the clip does. */
const DIGITAL_SILENCE_DB = -80;
/** A beat whose onset stands this far over its span is heard even where the span keeps no steady beat (narration). */
const HEARD_LIFT = 1.5;

const roundTime = (t: number) => Math.round(t * 1000) / 1000;

/** Beats move onto the signal's own; unheard in digital silence, or with neither a steady beat around nor an onset. */
function settled(
  capability: AudioCapability,
  result: LadderResult,
  signal: AudioSignal,
): LadderResult {
  if (capability !== "beats" && capability !== "downbeats") return result;
  const value = result.value as Omit<MarkedBeats, "unheard"> | null;
  if (!value?.times) return result;
  const beat = beatOf(capability, value, signal);
  const onSignal = result.provenance === "signal" ? value : snappedToSignal(value, signal, beat);
  const quiet = silence(signal, { thresholdDb: DIGITAL_SILENCE_DB });
  const evidence = localBeatEvidence(
    signal,
    onSignal.times,
    capability === "downbeats" ? beat : undefined,
  );
  const unheard = onSignal.times.map(
    (t, i) =>
      quiet.some((span) => t >= span.start && t < span.end) ||
      (evidence[i]!.confidence < STEADY_BEAT_CONFIDENCE && evidence[i]!.lift < HEARD_LIFT),
  );
  return { ...result, value: { ...onSignal, unheard } };
}

/** The beat is the answer's own beat interval, or its bar over its meter; the signal's when neither is known. */
function beatOf(
  capability: "beats" | "downbeats",
  value: Omit<MarkedBeats, "unheard">,
  signal: AudioSignal,
): number {
  const interval = medianInterval(value.times);
  const own =
    capability === "beats" ? interval : interval && value.meter ? interval / value.meter : null;
  return own ?? medianInterval(rhythm(signal).beats.times) ?? 0;
}

function snappedToSignal(value: Omit<MarkedBeats, "unheard">, signal: AudioSignal, beat: number) {
  const onBeat = snapper(rhythm(signal).beats.times, beat / 4, "signal beats");
  return {
    ...value,
    times: value.times.map((t) => roundTime(onBeat.snap(t))),
    snap: onBeat.report(),
  };
}

/** Tempo is read off the beats of whichever provider placed them, so the two never disagree. */
function tempoFromBeats(beats: LadderResult): LadderResult {
  const times = (beats.value as Beats | null)?.times;
  return { ...beats, value: times ? tempoOf(times) : null };
}
