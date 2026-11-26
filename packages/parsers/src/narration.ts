/**
 * The narration manifest, `narration.json` at the project root: the script. One entry per voiced
 * line, holding what the line says, in which voice, and the audio clip and caption words that show
 * it. `voiced` records what the line was last voiced from, so a later edit to the text, the voice
 * or the WAV shows up as drift.
 *
 * What a voice turned out to be (its length and word timings) is not copied here. media-use already
 * records that in `audio_meta.json`, keyed by the same line id; `narrationTimingsOf` reads it. So
 * narration.json says what each line should be, and audio_meta.json what was generated.
 *
 * Keys this module does not know are kept: parse, edit the returned object, serialize.
 */

export const NARRATION_FILE = "narration.json";
/** media-use's record of generated voices: `voices[].{id, path, duration_s, words}`. */
export const AUDIO_META_FILE = "audio_meta.json";
export const NARRATION_VERSION = 1;
export const NARRATION_LINE_ATTR = "data-narration-line";

export interface NarrationWord {
  text: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export interface NarrationVoiced {
  textHash: string;
  voiceKey: string;
  audioHash: string;
  at?: string;
  [key: string]: unknown;
}

export interface NarrationVoiceSettings {
  provider?: string;
  voice?: string;
  speed?: number;
  lang?: string;
}

export interface NarrationLine extends NarrationVoiceSettings {
  id: string;
  text: string;
  /** Project-relative audio file that speaks the line. */
  audio: string;
  voiced?: NarrationVoiced;
  [key: string]: unknown;
}

/** One line's generated voice, from audio_meta.json: its file, length, and words from its start. */
export interface NarrationTiming {
  path?: string;
  durationSeconds: number;
  words: NarrationWord[];
}

export interface NarrationCaptions {
  /** Project-relative HTML file holding the caption array. */
  file?: string;
  /** The array's name: `script` or `TRANSCRIPT`. */
  array?: string;
  [key: string]: unknown;
}

export interface NarrationManifest {
  version: number;
  defaults?: NarrationVoiceSettings & Record<string, unknown>;
  captions?: NarrationCaptions;
  lines: NarrationLine[];
  [key: string]: unknown;
}

export type NarrationParseResult =
  | { ok: true; manifest: NarrationManifest }
  | { ok: false; problems: string[] };

const LINE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function voicedProblems(voiced: unknown, where: string): string[] {
  if (voiced === undefined) return [];
  if (!isRecord(voiced)) return [`${where}.voiced must be an object`];
  return ["textHash", "voiceKey", "audioHash"]
    .filter((key) => typeof voiced[key] !== "string")
    .map((key) => `${where}.voiced.${key} must be a string`);
}

function idProblems(id: unknown, where: string, seen: Set<string>): string[] {
  if (typeof id !== "string" || !LINE_ID.test(id)) {
    return [`${where}.id must be a plain name such as "l2"`];
  }
  if (seen.has(id)) return [`${where}.id "${id}" is used twice`];
  seen.add(id);
  return [];
}

/** Each field check: the problem when the line's value fails it. */
const LINE_FIELDS: Array<[string, (value: unknown) => boolean, string]> = [
  ["text", (value) => typeof value === "string", "must be a string"],
  [
    "audio",
    (value) => typeof value === "string" && value !== "",
    "must name the line's audio file",
  ],
  ["speed", (value) => value === undefined || isFiniteNumber(value), "must be a number"],
];

function lineProblems(line: unknown, index: number, seen: Set<string>): string[] {
  const where = `lines[${index}]`;
  if (!isRecord(line)) return [`${where} must be an object`];
  return [
    ...idProblems(line.id, where, seen),
    ...LINE_FIELDS.filter(([key, ok]) => !ok(line[key])).map(
      ([key, , problem]) => `${where}.${key} ${problem}`,
    ),
    ...voicedProblems(line.voiced, where),
  ];
}

/** Every problem that keeps `value` from being a narration manifest; empty when it is one. */
export function narrationManifestProblems(value: unknown): string[] {
  if (!isRecord(value)) return ["the manifest must be a JSON object"];
  const problems: string[] = [];
  if (value.version !== NARRATION_VERSION) {
    problems.push(`version must be ${NARRATION_VERSION}`);
  }
  if (value.defaults !== undefined && !isRecord(value.defaults)) {
    problems.push("defaults must be an object");
  }
  if (value.captions !== undefined && !isRecord(value.captions)) {
    problems.push("captions must be an object");
  }
  if (!Array.isArray(value.lines)) return [...problems, "lines must be an array"];
  const seen = new Set<string>();
  return [...problems, ...value.lines.flatMap((line, index) => lineProblems(line, index, seen))];
}

export function parseNarrationManifest(text: string): NarrationParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`not valid JSON: ${(error as Error).message}`] };
  }
  const problems = narrationManifestProblems(value);
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, manifest: value as NarrationManifest };
}

const isWord = (value: unknown): value is NarrationWord =>
  isRecord(value) &&
  typeof value.text === "string" &&
  isFiniteNumber(value.start) &&
  isFiniteNumber(value.end) &&
  value.end >= value.start;

/**
 * Each line's generated voice from audio_meta.json's text, by line id. A voice entry without an id
 * or a length is left out, and so is a malformed word. Returns null when the text isn't JSON or has
 * no `voices` list, so a caller can tell "no timings" from "no voice for this line".
 */
export function narrationTimingsOf(text: string): Map<string, NarrationTiming> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.voices)) return null;
  const timings = new Map<string, NarrationTiming>();
  for (const voice of value.voices) {
    if (!isRecord(voice) || voice.id === undefined || voice.id === null) continue;
    if (!isFiniteNumber(voice.duration_s) || voice.duration_s < 0) continue;
    const words = Array.isArray(voice.words) ? voice.words.filter(isWord) : [];
    timings.set(String(voice.id), {
      ...(typeof voice.path === "string" ? { path: voice.path } : {}),
      durationSeconds: voice.duration_s,
      words: words.map(({ text: said, start, end }) => ({ text: said, start, end })),
    });
  }
  return timings;
}

/** Two-space JSON with a final newline; keys keep the order they were parsed or set in. */
export function serializeNarrationManifest(manifest: NarrationManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function findNarrationLine(
  manifest: NarrationManifest,
  id: string,
): NarrationLine | undefined {
  return manifest.lines.find((line) => line.id === id);
}

/** A line's own voice settings over the manifest defaults. */
export function narrationVoiceOf(
  line: NarrationVoiceSettings,
  defaults: NarrationVoiceSettings = {},
): Required<NarrationVoiceSettings> {
  return {
    provider: line.provider ?? defaults.provider ?? "kokoro",
    voice: line.voice ?? defaults.voice ?? "",
    speed: line.speed ?? defaults.speed ?? 1,
    lang: line.lang ?? defaults.lang ?? "",
  };
}

/** The voice a line is spoken in, as one comparable string: `provider:voice:speed:lang`. */
export function narrationVoiceKey(
  line: NarrationVoiceSettings,
  defaults: NarrationVoiceSettings = {},
): string {
  const voice = narrationVoiceOf(line, defaults);
  return [voice.provider, voice.voice, voice.speed, voice.lang].join(":");
}

/** The text as it is hashed: whitespace collapsed, so a reflowed line is not a changed line. */
export function normalizeNarrationText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Words for comparing what a caption shows with what a line says: lower case, no punctuation. */
export function narrationComparableWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);
}
