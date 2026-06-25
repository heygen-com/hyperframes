import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

export interface Word {
  /** Stable identifier for referencing this word in overrides and compositions.
   *  Assigned during normalization as `w{index}`. Optional for backwards compat
   *  with existing transcript.json files that predate this field. */
  id?: string;
  text: string;
  start: number;
  end: number;
}

export interface Cue {
  text: string;
  start: number;
  end: number;
}

export interface WordsToCuesOptions {
  maxChars?: number;
  maxGap?: number;
  /** Treat each entry as a finished cue (skip word-level grouping). Defaults to
   *  auto-detection: true when any entry contains internal whitespace. */
  preGrouped?: boolean;
}

// ---------------------------------------------------------------------------
// Format detection + parsing
// ---------------------------------------------------------------------------

export type TranscriptFormat = "whisper-cpp" | "openai" | "srt" | "vtt" | "words-json";

/**
 * Detect the format of a transcript file from its extension and content.
 */
export function detectFormat(filePath: string): TranscriptFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".srt") return "srt";
  if (ext === ".vtt") return "vtt";
  if (ext === ".json") return detectJsonFormat(JSON.parse(readFileSync(filePath, "utf-8")));
  throw new Error(`Unsupported transcript file extension: ${ext}. Use .json, .srt, or .vtt`);
}

function detectJsonFormat(raw: unknown): TranscriptFormat {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (obj.transcription && Array.isArray(obj.transcription)) return "whisper-cpp";
    if (obj.words && Array.isArray(obj.words)) return "openai";
  }
  if (Array.isArray(raw) && raw[0]?.text !== undefined && raw[0]?.start !== undefined) {
    return "words-json";
  }
  throw new Error(
    "Unrecognized JSON transcript format. Expected whisper.cpp (transcription[].tokens), " +
      "OpenAI API (words[]), or normalized ([{text, start, end}]).",
  );
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Rejoin word fragments that whisper splits across tokens:
 * - Single capital + lowercase continuation: C + aught -> Caught, G + onna -> Gonna
 * - Word ending in consonant + in': shin + in' -> shinin', hid + in' -> hidin'
 */
function mergeFragments(words: Word[]): void {
  for (let i = 0; i < words.length - 1; i++) {
    const curr = words[i];
    const next = words[i + 1];
    if (!curr || !next) continue;
    const isSingleLetterFragment =
      curr.text.length === 1 &&
      /^[A-Z]$/.test(curr.text) &&
      !/^[IAO]$/.test(curr.text) &&
      /^[a-z]/.test(next.text);
    const shouldMerge =
      isSingleLetterFragment || (/[a-z]$/.test(curr.text) && /^in'$/i.test(next.text));
    if (shouldMerge) {
      curr.text += next.text;
      curr.end = next.end;
      words.splice(i + 1, 1);
      i--;
    }
  }
}

/**
 * Distribute timestamps evenly across zero-duration word clusters.
 * Whisper sometimes assigns identical start/end to sequences of words,
 * making karaoke highlights flash through them instantly.
 *
 * Also handles malformed timestamps where start > end — these are treated
 * the same as zero-duration and get interpolated from surrounding words.
 */
function interpolateZeroDuration(words: Word[]): void {
  for (let i = 0; i < words.length; i++) {
    const wi = words[i];
    if (!wi || wi.start < wi.end) continue;
    let j = i;
    while (j < words.length) {
      const wj = words[j];
      if (!wj || wj.start < wj.end) break;
      j++;
    }
    const clusterLen = j - i;
    const prev = i > 0 ? words[i - 1] : undefined;
    const prevEnd = prev ? prev.end : wi.start;
    const nextWord = j < words.length ? words[j] : undefined;
    const nextStart = nextWord ? nextWord.start : prevEnd + clusterLen * 0.3;
    const span = nextStart - prevEnd;
    const perWord = span / clusterLen;
    for (let k = i; k < j; k++) {
      const wk = words[k];
      if (!wk) continue;
      wk.start = round3(prevEnd + (k - i) * perWord);
      wk.end = round3(prevEnd + (k - i + 1) * perWord);
    }
    i = j - 1;
  }
}

function parseWhisperCpp(data: Record<string, unknown>): Word[] {
  const words: Word[] = [];
  const transcription = data.transcription as Array<{
    tokens?: Array<{
      text?: string;
      offsets?: { from?: number; to?: number };
    }>;
  }>;

  for (const seg of transcription ?? []) {
    for (const token of seg.tokens ?? []) {
      const rawText = token.text ?? "";
      const text = rawText.trim();
      if (!text || text.startsWith("[_") || text.startsWith("[BLANK")) continue;

      const lastWord = words[words.length - 1];

      // Merge into previous word when the token is a sub-word continuation,
      // trailing punctuation, or a contraction suffix.
      // Whisper uses leading spaces to mark word boundaries in all languages.
      const shouldMerge =
        lastWord &&
        (!rawText.startsWith(" ") ||
          /^[.,!?;:'")\]}>…–—¡¿-]+$/.test(text) ||
          /^'(t|m|s|ve|re|ll|d)$/i.test(text));
      if (shouldMerge) {
        lastWord.text += text;
        lastWord.end = round3((token.offsets?.to ?? 0) / 1000);
        continue;
      }

      words.push({
        text,
        start: round3((token.offsets?.from ?? 0) / 1000),
        end: round3((token.offsets?.to ?? 0) / 1000),
      });
    }
  }

  mergeFragments(words);
  interpolateZeroDuration(words);

  return words;
}

function parseOpenAI(data: Record<string, unknown>): Word[] {
  const words = (data.words ?? []) as Array<{
    word?: string;
    text?: string;
    start?: number;
    end?: number;
  }>;
  return words
    .map((w) => ({
      text: (w.word ?? w.text ?? "").trim(),
      start: round3(w.start ?? 0),
      end: round3(w.end ?? 0),
    }))
    .filter((w) => w.text.length > 0);
}

function parseSrt(content: string): Word[] {
  // SRT doesn't have word-level timestamps — parse as phrase-level entries.
  // Each cue becomes one "word" entry (the full phrase).
  const blocks = content.trim().split(/\n\n+/);
  const words: Word[] = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    // SRT format: index, timestamp line, text lines
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;

    const [startStr, endStr] = timeLine.split("-->").map((s) => s.trim());
    if (!startStr || !endStr) continue;

    const text = lines
      .slice(lines.indexOf(timeLine) + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "") // strip HTML tags
      .trim();
    if (!text) continue;

    words.push({
      text,
      start: parseSrtTimestamp(startStr),
      end: parseSrtTimestamp(endStr),
    });
  }
  return words;
}

function parseVtt(content: string): Word[] {
  // Strip the WEBVTT header and any metadata blocks
  const body = content.replace(/^WEBVTT[^\n]*\n/, "").replace(/^[A-Z-]+:.*\n/gm, "");
  // VTT is structurally similar to SRT (without numeric indices)
  const blocks = body.trim().split(/\n\n+/);
  const words: Word[] = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;

    const [startStr, endStr] = timeLine.split("-->").map((s) => s.trim());
    if (!startStr || !endStr) continue;

    const text = lines
      .slice(lines.indexOf(timeLine) + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "") // strip HTML tags
      .trim();
    if (!text) continue;

    words.push({
      text,
      start: parseVttTimestamp(startStr),
      end: parseVttTimestamp(endStr),
    });
  }
  return words;
}

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/** Parse SRT timestamp: 00:01:23,456 → seconds */
function parseSrtTimestamp(ts: string): number {
  const m = ts.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return (
    parseInt(m[1]!, 10) * 3600 +
    parseInt(m[2]!, 10) * 60 +
    parseInt(m[3]!, 10) +
    parseInt(m[4]!.padEnd(3, "0"), 10) / 1000
  );
}

/** Parse VTT timestamp: 00:01:23.456 or 01:23.456 → seconds */
function parseVttTimestamp(ts: string): number {
  const parts = ts.split(":");
  if (parts.length === 3) return parseSrtTimestamp(ts);
  // MM:SS.mmm
  if (parts.length === 2) {
    const [min, secMs] = parts;
    const [sec, ms] = (secMs ?? "0.0").split(".");
    return (
      parseInt(min!, 10) * 60 + parseInt(sec!, 10) + parseInt((ms ?? "0").padEnd(3, "0"), 10) / 1000
    );
  }
  return 0;
}

/** Format SRT timestamp: seconds → 00:01:23,456 */
function formatSrtTimestamp(seconds: number): string {
  const { hours, minutes, wholeSeconds, milliseconds } = timestampParts(seconds);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(wholeSeconds)},${pad3(milliseconds)}`;
}

/** Format VTT timestamp: seconds → 00:01:23.456 */
function formatVttTimestamp(seconds: number): string {
  const { hours, minutes, wholeSeconds, milliseconds } = timestampParts(seconds);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(wholeSeconds)}.${pad3(milliseconds)}`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function timestampParts(seconds: number): {
  hours: number;
  minutes: number;
  wholeSeconds: number;
  milliseconds: number;
} {
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
  const totalMs = Math.max(0, Math.round(safeSeconds * 1000));
  const milliseconds = totalMs % 1000;
  const totalSeconds = (totalMs - milliseconds) / 1000;
  const wholeSeconds = totalSeconds % 60;
  const totalMinutes = (totalSeconds - wholeSeconds) / 60;
  const minutes = totalMinutes % 60;
  const hours = (totalMinutes - minutes) / 60;
  return { hours, minutes, wholeSeconds, milliseconds };
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

function endsSentence(text: string): boolean {
  return /[.!?][)"'\]}]*$/.test(text);
}

function pushCue(cues: Cue[], cue: Cue | undefined): void {
  if (!cue) return;
  const text = cue.text.trim();
  if (!text) return;
  cues.push({ text, start: round3(cue.start), end: round3(cue.end) });
}

/** Whether `word` should start a new cue rather than extend `current`. */
function breaksCue(
  current: Cue,
  word: Word,
  text: string,
  maxChars: number,
  maxGap: number,
): boolean {
  const nextLength = current.text.length + 1 + text.length;
  const gap = word.start - current.end;
  return nextLength > maxChars || gap > maxGap;
}

/** Map each entry to its own cue (used when entries are already phrase-level). */
function entriesToCues(words: Word[]): Cue[] {
  const cues: Cue[] = [];
  for (const word of words) {
    pushCue(cues, { text: word.text, start: word.start, end: word.end });
  }
  return cues;
}

// Han + Hiragana + Katakana + CJK symbols/fullwidth. These scripts are written
// without spaces between tokens, so whisper's per-token output must be joined
// without a separator. Hangul (Korean) is intentionally excluded — it does use
// inter-word spaces.
const CJK_CHAR = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

/** Join two adjacent tokens, omitting the space across a CJK boundary. */
function joinTokens(left: string, right: string): string {
  const a = left.at(-1) ?? "";
  const b = right[0] ?? "";
  const sep = CJK_CHAR.test(a) || CJK_CHAR.test(b) ? "" : " ";
  return `${left}${sep}${right}`;
}

export function wordsToCues(words: Word[], opts: WordsToCuesOptions = {}): Cue[] {
  // Phrase-level transcripts (imported .srt/.vtt cues) must keep their existing
  // cue boundaries — re-grouping would merge distinct captions and lose timing.
  // The caller can force this via `preGrouped`; otherwise infer it from the data
  // (any entry containing internal whitespace is a multi-word phrase, so the
  // whole transcript is phrase-level rather than word-level whisper output).
  const preGrouped = opts.preGrouped ?? words.some((w) => /\s/.test(w.text.trim()));
  if (preGrouped) return entriesToCues(words);

  const maxChars = opts.maxChars ?? 42;
  const maxGap = opts.maxGap ?? 0.8;
  const cues: Cue[] = [];
  let current: Cue | undefined;

  const flush = (): void => {
    pushCue(cues, current);
    current = undefined;
  };

  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;

    if (current && !breaksCue(current, word, text, maxChars, maxGap)) {
      current.text = joinTokens(current.text, text);
      current.end = word.end;
    } else {
      flush();
      current = { text, start: word.start, end: word.end };
    }

    if (endsSentence(text)) flush();
  }

  flush();
  return cues;
}

export function formatSrt(words: Word[], opts?: WordsToCuesOptions): string {
  const cues = wordsToCues(words, opts);
  if (cues.length === 0) return "";

  return (
    cues
      .map(
        (cue, i) =>
          `${i + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}`,
      )
      .join("\n\n") + "\n"
  );
}

export function formatVtt(words: Word[], opts?: WordsToCuesOptions): string {
  const cues = wordsToCues(words, opts);
  if (cues.length === 0) return "WEBVTT\n\n";

  return (
    "WEBVTT\n\n" +
    cues
      .map(
        (cue) => `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${cue.text}`,
      )
      .join("\n\n") +
    "\n"
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and normalize a transcript file to a standard word array.
 *
 * Supports:
 * - whisper.cpp JSON (--output-json-full with --dtw)
 * - OpenAI Whisper API response (verbose_json with word timestamps)
 * - SRT subtitle files (phrase-level, not word-level)
 * - VTT subtitle files (phrase-level, not word-level)
 * - Pre-normalized JSON array ([{text, start, end}])
 */
export function loadTranscript(filePath: string): { words: Word[]; format: TranscriptFormat } {
  const ext = extname(filePath).toLowerCase();
  const content = readFileSync(filePath, "utf-8");

  if (ext === ".srt") {
    const words = parseSrt(content).map((w, i) => ({ ...w, id: w.id ?? `w${i}` }));
    return { words, format: "srt" };
  }
  if (ext === ".vtt") {
    const words = parseVtt(content).map((w, i) => ({ ...w, id: w.id ?? `w${i}` }));
    return { words, format: "vtt" };
  }

  // JSON formats — parse once, detect, then extract words
  const parsed = JSON.parse(content);
  const format = detectJsonFormat(parsed);

  const words =
    format === "whisper-cpp"
      ? parseWhisperCpp(parsed)
      : format === "openai"
        ? parseOpenAI(parsed)
        : (parsed as Word[]).map((w) => ({
            id: w.id ?? "",
            text: w.text.trim(),
            start: round3(w.start),
            end: round3(w.end),
          }));

  return { words, format };
}

/**
 * Remove words that fall before the detected speech onset.
 * Whisper can hallucinate words over non-speech sections at the start of audio.
 */
export function stripBeforeOnset(words: Word[], onsetSeconds: number): Word[] {
  // 0.5s tolerance: keep words whose timestamps straddle the onset boundary,
  // since whisper may assign a slightly early start to the first spoken word.
  return words.filter((w) => w.start >= onsetSeconds - 0.5);
}

export function patchCaptionHtml(dir: string, words: Word[]): void {
  if (words.length === 0) return;

  // Indent to 10 spaces to match typical composition script indentation
  const wordsJson = JSON.stringify(words, null, 2).replace(/\n/g, "\n          ");

  let htmlFiles: string[];
  try {
    htmlFiles = readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && e.name.endsWith(".html"))
      .map((e) => join(e.parentPath, e.name));
  } catch {
    return;
  }

  for (const file of htmlFiles) {
    let content = readFileSync(file, "utf-8");
    const scriptBlocks = content.match(/<script>[\s\S]*?<\/script>/g) ?? [];
    let scriptMatch: RegExpMatchArray | null = null;
    let transcriptMatch: RegExpMatchArray | null = null;
    for (const block of scriptBlocks) {
      scriptMatch = scriptMatch ?? block.match(/const script = \[[\s\S]*?\];/);
      transcriptMatch = transcriptMatch ?? block.match(/const TRANSCRIPT = \[[\s\S]*?\];/);
    }
    const match = scriptMatch ?? transcriptMatch;
    if (match) {
      const varName = scriptMatch ? "script" : "TRANSCRIPT";
      content = content.replace(match[0], `const ${varName} = ${wordsJson};`);
      writeFileSync(file, content, "utf-8");
    }
  }
}
