import type { Span } from "@hyperframes/core/audio-analysis";

export const READ_VERSION = 7;

export type Separation = "stems" | "mix";

export const LAYERS = ["music", "sfx", "voice"] as const;
export type Layer = (typeof LAYERS)[number];

export type RateUnit = "chars" | "words";

export type Ending = "rising" | "falling" | "level";

export interface Sentence {
  start: number;
  end: number;
  /** Null when there is no transcript and the span comes from where the voice is active. */
  text: string | null;
  rate: number | null;
  pitchHz: number | null;
  ending: Ending | null;
  againstMusic: { voiceLufs: number; musicLufs: number } | null;
}

export interface Pause extends Span {
  recordingDb: number;
}

export interface Voice {
  source: "transcript" | "activity";
  unit: RateUnit;
  sentences: Sentence[];
  pauses: Pause[];
  meanRate: number | null;
  medianPitchHz: number | null;
}

export type Band = "low" | "mid" | "high";

export interface Effect {
  t: number;
  end: number;
  kind: "effect";
  group: string;
  band: Band;
  attackMs: number;
  tail: number;
  /** The loudest 20 ms of the whole recording at the effect's peak, in dBFS. */
  peakDb: number;
  /** The peak over the recording's level in the half second before the effect; null when that was silent. */
  riseDb: number | null;
  overMusicDb: number | null;
  /** More than one when a quick run of the same sound is reported as one train. */
  count: number;
  stem: string | null;
}

export interface EffectGroup {
  id: string;
  count: number;
}

export interface Effects {
  events: Effect[];
  groups: EffectGroup[];
  /** The music's own drums, not listed as effects: hits that recur in the drums while music plays, or that repeat on its beat. */
  drumHits: number;
}

export type Entry = "start" | "resumes" | "returns" | "new";

export interface MusicSegment {
  start: number;
  end: number;
  piece: number;
  entry: Entry;
  bpm: number | null;
  /** Where a fade out begins, when the segment ends on one. */
  fadeFrom: number | null;
  stems: StemSpan[];
}

export interface StemSpan extends Span {
  name: string;
}

export interface Piece {
  id: number;
  /** The stems that carry most of its first segment, loudest first. */
  instruments: string[];
  bpm: number | null;
  firstAt: number;
}

export interface Music {
  segments: MusicSegment[];
  pieces: Piece[];
  breaks: Span[];
  /** Level of the music every 30 s, in dBFS. */
  energy: { start: number; end: number; db: number }[];
}

export interface Ambience {
  start: number;
  end: number;
  db: number;
}

export interface AudibleStem {
  name: string;
  db: number;
  spans: Span[];
  description: string | null;
}

export interface Description {
  overall: string;
  bgmPrompt: string | null;
}

export interface ReadAudio {
  version: typeof READ_VERSION;
  file: string;
  sha256: string;
  duration: number;
  separation: Separation;
  layer?: Layer;
  stems: AudibleStem[];
  stemsDir: string | null;
  voiceFreeMix: string | null;
  bpm: number | null;
  description: Description | null;
  transcript: string | null;
  /** Null when the mix alone cannot tell speech from music: no stems and no transcript. */
  voice: Voice | null;
  effects: Effects | null;
  music: Music | null;
  ambience: Ambience[] | null;
  warnings: string[];
}
