import type { Span } from "@hyperframes/core/audio-analysis";
import { semitones } from "./pitch.js";
import type { Effect, Entry, MusicSegment, ReadAudio, Sentence, Voice } from "./types.js";

const PITCH_NOTE_SEMITONES = 3;
const KIND_WIDTH = 7;

interface Line {
  start: number;
  end: number | null;
  kind: string;
  text: string;
}

const s = (t: number) => t.toFixed(1);
const signed = (db: number) => `${db >= 0 ? "+" : ""}${db} dB`;

function when(line: Line): string {
  return line.end === null ? s(line.start) : `${s(line.start)}–${s(line.end)}`;
}

function voiceLine(sentence: Sentence, voice: Voice): Line {
  const { unit, meanRate, medianPitchHz } = voice;
  const parts = [sentence.text === null ? "(no transcript)" : `"${sentence.text}"`];
  if (sentence.rate !== null)
    parts.push(`${sentence.rate} ${unit}/s${meanRate !== null ? ` (mean ${meanRate})` : ""}`);
  if (
    sentence.pitchHz !== null &&
    medianPitchHz !== null &&
    Math.abs(semitones(sentence.pitchHz, medianPitchHz)) >= PITCH_NOTE_SEMITONES
  )
    parts.push(`pitch ${sentence.pitchHz} Hz (median ${medianPitchHz})`);
  if (sentence.ending && sentence.ending !== "level") parts.push(`${sentence.ending} end`);
  return { start: sentence.start, end: sentence.end, kind: "voice", text: parts.join("  ") };
}

function placeOf(t: number, pauses: readonly Span[]): string | null {
  const pause = pauses.find((p) => t >= p.start && t < p.end);
  return pause ? `${(t - pause.start).toFixed(1)} s into the pause` : null;
}

function standing(effect: Effect, musicRead: boolean): string {
  if (effect.overMusicDb !== null) return `${signed(effect.overMusicDb)} over music`;
  return musicRead ? "while the music is out" : `${signed(effect.riseDb)} over what played before`;
}

function effectLine(effect: Effect, pauses: readonly Span[], musicRead: boolean): Line {
  const parts = [
    `${effect.kind}${effect.count > 1 ? ` ×${effect.count}` : ""} (${effect.group}): ${effect.band}`,
    `attack ${effect.attackMs} ms`,
    `tail ${effect.tail.toFixed(1)} s`,
    standing(effect, musicRead),
  ];
  const place = placeOf(effect.t, pauses);
  if (place) parts.push(place);
  return { start: effect.t, end: null, kind: "effect", text: parts.join(", ") };
}

const ENTRY: Record<Entry, string> = {
  start: "",
  new: ", first appearance after a break",
  resumes: ", resumes after a break",
  returns: ", returns",
};

function musicLine(segment: MusicSegment, analysis: ReadAudio): Line {
  const piece = analysis.music!.pieces.find((p) => p.id === segment.piece)!;
  const about = [piece.instruments.join(", "), segment.bpm ? `${segment.bpm} BPM` : null]
    .filter(Boolean)
    .join(" · ");
  const fade = segment.fadeFrom !== null ? `, fades from ${s(segment.fadeFrom)}` : "";
  return {
    start: segment.start,
    end: segment.end,
    kind: "music",
    text: `piece ${piece.id}${about ? ` (${about})` : ""}${ENTRY[segment.entry]}${fade}`,
  };
}

function overlaps(line: Line, range?: [number, number]): boolean {
  if (!range) return true;
  return line.start < range[1] && (line.end ?? line.start) >= range[0];
}

function header(analysis: ReadAudio): string[] {
  const { voice, effects, music } = analysis;
  const separated =
    analysis.separation === "stems" ? `stems: ${analysis.stems.join(", ")}` : "not separated";
  const lines = [`${analysis.file} · ${s(analysis.duration)} s · ${separated}`];
  if (voice) {
    const rate = voice.meanRate !== null ? `mean ${voice.meanRate} ${voice.unit}/s` : null;
    const pitch = voice.medianPitchHz !== null ? `median pitch ${voice.medianPitchHz} Hz` : null;
    lines.push(
      `voice: ${voice.sentences.length} lines, ${voice.pauses.length} pauses${[rate, pitch]
        .filter(Boolean)
        .map((p) => `, ${p}`)
        .join("")}`,
    );
  }
  if (effects) {
    const top = effects.groups
      .slice(0, 6)
      .map((g) => `${g.id} ${g.kind} ×${g.count}`)
      .join(", ");
    lines.push(
      `effects: ${effects.events.length} in ${effects.groups.length} sounds${top ? ` (${top})` : ""}${
        effects.drumHits ? `; ${effects.drumHits} drum hits on the beat left out` : ""
      }`,
    );
  }
  if (music) lines.push(`music: ${music.pieces.length} pieces, ${music.breaks.length} breaks`);
  return lines;
}

/** The recording as time-stamped lines, all of it or the events overlapping `range`. */
export function formatRead(analysis: ReadAudio, range?: [number, number]): string {
  const { voice, effects } = analysis;
  const pauses = voice?.pauses ?? [];
  const lines: Line[] = [
    ...(voice?.sentences.map((x) => voiceLine(x, voice)) ?? []),
    ...pauses.map((p) => ({
      start: p.start,
      end: p.end,
      kind: "pause",
      text: `${(p.end - p.start).toFixed(1)} s`,
    })),
    ...(effects?.events.map((e) => effectLine(e, pauses, analysis.music !== null)) ?? []),
    ...(analysis.music?.segments.map((m) => musicLine(m, analysis)) ?? []),
    ...(analysis.music?.breaks.map((b) => ({
      start: b.start,
      end: b.end,
      kind: "music",
      text: `break ${(b.end - b.start).toFixed(1)} s`,
    })) ?? []),
  ]
    .filter((line) => overlaps(line, range))
    .sort((a, b) => a.start - b.start || (a.end ?? a.start) - (b.end ?? b.start));
  const width = Math.max(0, ...lines.map((l) => when(l).length));
  const body = lines.map((l) => `${when(l).padEnd(width)}  ${l.kind.padEnd(KIND_WIDTH)} ${l.text}`);
  const warnings = analysis.warnings.map((w) => `! ${w}`);
  return [...header(analysis), "", ...body, ...(warnings.length ? ["", ...warnings] : [])].join(
    "\n",
  );
}
