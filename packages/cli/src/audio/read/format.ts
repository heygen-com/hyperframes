import type { Span } from "@hyperframes/core/audio-analysis";
import { semitones } from "./pitch.js";
import type {
  Ambience,
  Effect,
  Effects,
  Entry,
  Music,
  MusicSegment,
  Pause,
  ReadAudio,
  Sentence,
  Voice,
} from "./types.js";

const PITCH_NOTE_SEMITONES = 3;
const KIND_WIDTH = 8;
const QUIET_DB = -45;
const SILENT_DB = -55;
const LEVEL_DB = 0.5;

interface Line {
  start: number;
  end: number | null;
  kind: string;
  text: string;
}

const s = (t: number) => t.toFixed(1);
const signed = (db: number) => `${db >= 0 ? "+" : ""}${db} dB`;
const dbfs = (db: number) => `${db} dBFS`;
const lufs = (db: number) => `${Math.round(db)} LUFS`;

function when(line: Line): string {
  return line.end === null ? s(line.start) : `${s(line.start)}–${s(line.end)}`;
}

function marginOf({ voiceLufs, musicLufs }: { voiceLufs: number; musicLufs: number }): string {
  const margin = voiceLufs - musicLufs;
  const apart = Math.max(1, Math.abs(Math.round(voiceLufs) - Math.round(musicLufs)));
  const verdict =
    Math.abs(margin) < LEVEL_DB
      ? "level with each other"
      : margin > 0
        ? `voice ${apart} dB over music`
        : `music ${apart} dB over voice`;
  return `voice ${lufs(voiceLufs)}, music ${lufs(musicLufs)}: ${verdict}`;
}

function closing(sentence: Sentence): string[] {
  const parts = sentence.ending && sentence.ending !== "level" ? [`${sentence.ending} end`] : [];
  return sentence.againstMusic ? [...parts, marginOf(sentence.againstMusic)] : parts;
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
  parts.push(...closing(sentence));
  return { start: sentence.start, end: sentence.end, kind: "voice", text: parts.join("  ") };
}

function placeOf(t: number, pauses: readonly Span[]): string | null {
  const pause = pauses.find((p) => t >= p.start && t < p.end);
  return pause ? `${(t - pause.start).toFixed(1)} s into the pause` : null;
}

function standing(effect: Effect): string {
  const peak = `peak ${dbfs(effect.peakDb)}`;
  if (effect.overMusicDb !== null) return `${peak}, ${signed(effect.overMusicDb)} over music`;
  if (effect.riseDb === null) return `${peak}, out of silence`;
  return `${peak}, ${signed(effect.riseDb)} over what played before`;
}

function effectLine(effect: Effect, pauses: readonly Span[]): Line {
  const parts = [
    `${effect.kind}${effect.count > 1 ? ` ×${effect.count}` : ""} (${effect.group}): ${effect.band}`,
    `attack ${effect.attackMs} ms`,
    `tail ${effect.tail.toFixed(1)} s`,
    standing(effect),
  ];
  const place = placeOf(effect.t, pauses);
  if (place) parts.push(place);
  return { start: effect.t, end: null, kind: "effect", text: parts.join(", ") };
}

const ENTRY: Record<Entry, string> = {
  start: "",
  new: ", first appearance",
  resumes: ", resumes",
  returns: ", returns",
};

function musicLine(segment: MusicSegment, analysis: ReadAudio): Line {
  const piece = analysis.music!.pieces.find((p) => p.id === segment.piece)!;
  const about = [piece.instruments.join(", "), segment.bpm ? `${segment.bpm} BPM` : null]
    .filter(Boolean)
    .join(" · ");
  const afterBreak =
    (segment.entry === "new" || segment.entry === "resumes") &&
    analysis.music!.breaks.some((gap) => gap.end === segment.start)
      ? " after a break"
      : "";
  const fade = segment.fadeFrom !== null ? `, fades from ${s(segment.fadeFrom)}` : "";
  return {
    start: segment.start,
    end: segment.end,
    kind: "music",
    text: `piece ${piece.id}${about ? ` (${about})` : ""}${ENTRY[segment.entry]}${afterBreak}${fade}`,
  };
}

function effectsIn(events: readonly Effect[]): string | null {
  if (!events.length) return null;
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + e.count);
  const kinds = [...counts].map(([kind, n]) => (n > 1 ? `${kind} ×${n}` : kind)).join(", ");
  const total = events.reduce((n, e) => n + e.count, 0);
  return `${total} ${total === 1 ? "effect" : "effects"} (${kinds})`;
}

function pauseLine(pause: Pause, analysis: ReadAudio): Line {
  const inside = (start: number, end: number) => start < pause.end && end > pause.start;
  const clip = (start: number, end: number) =>
    `${s(Math.max(start, pause.start))}–${s(Math.min(end, pause.end))}`;
  const beds = [
    ...(analysis.music?.segments
      .filter((m) => inside(m.start, m.end))
      .map((m) => `music ${clip(m.start, m.end)}`) ?? []),
    ...(analysis.ambience
      ?.filter((a) => inside(a.start, a.end))
      .map((a) => `ambience ${clip(a.start, a.end)}`) ?? []),
  ];
  if (!beds.length && pause.recordingDb >= SILENT_DB)
    beds.push(`sound continues at ${dbfs(pause.recordingDb)}`);
  const effects = effectsIn(
    analysis.effects?.events.filter((e) => e.t >= pause.start && e.t < pause.end) ?? [],
  );
  const heard = [...(effects ? [effects] : []), ...beds];
  const length = `${(pause.end - pause.start).toFixed(1)} s`;
  const text = heard.length ? `${length}; during it: ${heard.join(", ")}` : `${length}, silent`;
  return { start: pause.start, end: pause.end, kind: "pause", text };
}

function ambienceLine(ambience: Ambience): Line {
  const level = `${ambience.db} dBFS`;
  return {
    start: ambience.start,
    end: ambience.end,
    kind: "ambience",
    text: ambience.db < QUIET_DB ? `quiet, ${level}` : level,
  };
}

function overlaps(line: Line, range?: [number, number]): boolean {
  if (!range) return true;
  return line.start < range[1] && (line.end ?? line.start) >= range[0];
}

function separation(analysis: ReadAudio): string {
  if (analysis.separation !== "stems") return "not separated";
  const heard = analysis.stems.map((stem) => `${stem.name} ${stem.db} dB`).join(", ");
  return `stems: ${heard || "all silent"}`;
}

function voiceSummary(voice: Voice): string {
  const rate = voice.meanRate !== null ? `mean ${voice.meanRate} ${voice.unit}/s` : null;
  const pitch = voice.medianPitchHz !== null ? `median pitch ${voice.medianPitchHz} Hz` : null;
  return `voice: ${voice.sentences.length} lines, ${voice.pauses.length} pauses${[rate, pitch]
    .filter(Boolean)
    .map((p) => `, ${p}`)
    .join("")}`;
}

function effectsSummary(effects: Effects): string {
  const top = effects.groups
    .slice(0, 6)
    .map((g) => `${g.id} ${g.kind} ×${g.count}`)
    .join(", ");
  return `effects: ${effects.events.length} in ${effects.groups.length} sounds${top ? ` (${top})` : ""}${
    effects.drumHits ? `; ${effects.drumHits} drum hits on the beat left out` : ""
  }`;
}

const musicSummary = (music: Music) =>
  music.pieces.length
    ? `music: ${music.pieces.length} pieces, ${music.breaks.length} breaks`
    : "music: none";

function header(analysis: ReadAudio): string[] {
  const { voice, effects, music, ambience } = analysis;
  return [
    `${analysis.file} · ${s(analysis.duration)} s · ${separation(analysis)}`,
    voice && voiceSummary(voice),
    effects && effectsSummary(effects),
    music && musicSummary(music),
    ambience?.length && `ambience: ${ambience.length} stretches`,
  ].filter((line): line is string => typeof line === "string");
}

/** The recording as time-stamped lines, all of it or the events overlapping `range`. */
export function formatRead(analysis: ReadAudio, range?: [number, number]): string {
  const { voice, effects } = analysis;
  const pauses = voice?.pauses ?? [];
  const lines: Line[] = [
    ...(voice?.sentences.map((x) => voiceLine(x, voice)) ?? []),
    ...pauses.map((p) => pauseLine(p, analysis)),
    ...(effects?.events.map((e) => effectLine(e, pauses)) ?? []),
    ...(analysis.music?.segments.map((m) => musicLine(m, analysis)) ?? []),
    ...(analysis.music?.breaks.map((b) => ({
      start: b.start,
      end: b.end,
      kind: "music",
      text: `break ${(b.end - b.start).toFixed(1)} s`,
    })) ?? []),
    ...(analysis.ambience?.map(ambienceLine) ?? []),
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
