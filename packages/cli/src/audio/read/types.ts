import type { Span } from "@hyperframes/core/audio-analysis";

export const READ_VERSION = 2;

export type Separation = "stems" | "mix";

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
}

export interface Voice {
  source: "transcript" | "activity";
  unit: RateUnit;
  sentences: Sentence[];
  pauses: Span[];
  meanRate: number | null;
  medianPitchHz: number | null;
}

export type EffectKind = "riser" | "boom" | "thump" | "whoosh" | "click" | "tick" | "ding" | "hit";

export type Band = "low" | "mid" | "high";

export interface Effect {
  t: number;
  end: number;
  kind: EffectKind;
  group: string;
  band: Band;
  attackMs: number;
  tail: number;
  /** How far the effect rises out of what was playing just before it. */
  riseDb: number;
  /** The effect's peak against the music at that moment; null without a music stem or while the music is out. */
  overMusicDb: number | null;
  /** More than one when a quick run of the same sound is reported as one train. */
  count: number;
}

export interface EffectGroup {
  id: string;
  kind: EffectKind;
  count: number;
}

export interface Effects {
  events: Effect[];
  groups: EffectGroup[];
  /** Hits that repeat on the music's beat, which are the music's own drums and not listed as effects. */
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
}

export interface Piece {
  id: number;
  /** The stems that carry it, loudest first. */
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

export interface ReadAudio {
  version: typeof READ_VERSION;
  file: string;
  sha256: string;
  duration: number;
  separation: Separation;
  stems: string[];
  transcript: string | null;
  /** Null when the mix alone cannot tell speech from music: no stems and no transcript. */
  voice: Voice | null;
  effects: Effects | null;
  music: Music | null;
  warnings: string[];
}
