import type { Span } from "@hyperframes/core/audio-analysis";
import { median, round, levels, quantile } from "./signal.js";
import { semitones, within, type PitchPoint } from "./pitch.js";
import type { Ending, RateUnit, Sentence, Voice } from "./types.js";

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

const SENTENCE_END = /[。！？!?…；;.]["'”’」』)]*$/;
const SENTENCE_GAP = 0.6;
const LONGEST_SENTENCE = 60;
const PAUSE_SECONDS = 0.4;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LETTERS = /\p{L}/u;
const ENDING_SEMITONES = 2;
const MIN_PITCH_FRAMES = 5;

function rateUnit(words: readonly TimedWord[]): RateUnit {
  const text = words.map((w) => w.text).join("");
  return (text.match(CJK)?.length ?? 0) * 2 >= text.replace(/\s/g, "").length ? "chars" : "words";
}

function spoken(words: readonly TimedWord[], unit: RateUnit): number {
  if (unit === "chars") return words.reduce((n, w) => n + (w.text.match(CJK)?.length ?? 0), 0);
  return words.filter((w) => LETTERS.test(w.text)).length;
}

function joined(words: readonly TimedWord[], unit: RateUnit): string {
  return unit === "chars"
    ? words.map((w) => w.text.trim()).join("")
    : words
        .map((w) => w.text.trim())
        .join(" ")
        .replace(/\s+([,.!?;:])/g, "$1");
}

function sentenceGroups(words: readonly TimedWord[]): TimedWord[][] {
  const groups: TimedWord[][] = [];
  let current: TimedWord[] = [];
  let chars = 0;
  words.forEach((word, i) => {
    current.push(word);
    chars += word.text.length;
    const next = words[i + 1];
    if (
      !next ||
      SENTENCE_END.test(word.text.trim()) ||
      next.start - word.end >= SENTENCE_GAP ||
      chars >= LONGEST_SENTENCE
    ) {
      groups.push(current);
      current = [];
      chars = 0;
    }
  });
  return groups;
}

function ending(track: readonly PitchPoint[], start: number, end: number): Ending | null {
  const split = start + (end - start) * 0.7;
  const body = within(track, start, split);
  const tail = within(track, split, end);
  if (body.length < MIN_PITCH_FRAMES || tail.length < 2) return null;
  const shift = semitones(median(tail), median(body));
  if (shift >= ENDING_SEMITONES) return "rising";
  if (shift <= -ENDING_SEMITONES) return "falling";
  return "level";
}

function pitchOf(track: readonly PitchPoint[], start: number, end: number): number | null {
  const hz = within(track, start, end);
  return hz.length >= MIN_PITCH_FRAMES ? Math.round(median(hz)) : null;
}

function summary(sentences: Sentence[], pauses: Span[], track: readonly PitchPoint[]) {
  const timed = sentences.filter((s) => s.rate !== null);
  const seconds = timed.reduce((n, s) => n + (s.end - s.start), 0);
  const meanRate = seconds
    ? round(timed.reduce((n, s) => n + s.rate! * (s.end - s.start), 0) / seconds, 1)
    : null;
  return {
    sentences,
    pauses,
    meanRate,
    medianPitchHz: track.length ? Math.round(median(track.map((p) => p.hz))) : null,
  };
}

export function voiceFromWords(words: readonly TimedWord[], track: readonly PitchPoint[]): Voice {
  const ordered = words.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
  const unit = rateUnit(ordered);
  const sentences = sentenceGroups(ordered).map((group): Sentence => {
    const start = group[0]!.start;
    const end = group[group.length - 1]!.end;
    const count = spoken(group, unit);
    return {
      start: round(start),
      end: round(end),
      text: joined(group, unit),
      rate: count && end > start ? round(count / (end - start), 1) : null,
      pitchHz: pitchOf(track, start, end),
      ending: ending(track, start, end),
    };
  });
  const pauses: Span[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i]!.start - ordered[i - 1]!.end;
    if (gap >= PAUSE_SECONDS)
      pauses.push({ start: round(ordered[i - 1]!.end), end: round(ordered[i]!.start) });
  }
  return { source: "transcript", unit, ...summary(sentences, pauses, track) };
}

const ACTIVITY_HOP = 0.05;
const SHORTEST_SPEECH = 0.3;

/** Where the voice is active, for a recording without a transcript: spans between pauses, without words. */
export function voiceFromActivity(
  vocals: Float32Array,
  sampleRate: number,
  track: readonly PitchPoint[],
): Voice {
  const db = levels(vocals, sampleRate, ACTIVITY_HOP);
  const threshold = Math.max(-45, quantile(db, 0.9) - 30);
  const spans: Span[] = [];
  let start: number | null = null;
  let quietSince: number | null = null;
  db.forEach((level, f) => {
    const t = f * ACTIVITY_HOP;
    if (level >= threshold) {
      if (start === null) start = t;
      quietSince = null;
    } else if (start !== null) {
      quietSince ??= t;
      if (t - quietSince >= PAUSE_SECONDS) {
        if (quietSince - start >= SHORTEST_SPEECH) spans.push({ start, end: quietSince });
        start = null;
        quietSince = null;
      }
    }
  });
  const end = db.length * ACTIVITY_HOP;
  if (start !== null && (quietSince ?? end) - start >= SHORTEST_SPEECH)
    spans.push({ start, end: quietSince ?? end });
  const sentences = spans.map(
    (s): Sentence => ({
      start: round(s.start),
      end: round(s.end),
      text: null,
      rate: null,
      pitchHz: pitchOf(track, s.start, s.end),
      ending: ending(track, s.start, s.end),
    }),
  );
  const pauses = spans
    .slice(1)
    .map((s, i) => ({ start: round(spans[i]!.end), end: round(s.start) }));
  return { source: "activity", unit: "chars", ...summary(sentences, pauses, track) };
}
