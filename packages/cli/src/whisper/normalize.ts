import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

export interface Word {
  text: string;
  start: number;
  end: number;
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
  const rawWords = (data.words ?? []) as Array<{
    word?: string;
    text?: string;
    start?: number;
    end?: number;
  }>;
  return rawWords
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

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
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

  if (ext === ".srt") return { words: parseSrt(content), format: "srt" };
  if (ext === ".vtt") return { words: parseVtt(content), format: "vtt" };

  // JSON formats — parse once, detect, then extract words
  const parsed = JSON.parse(content);
  const format = detectJsonFormat(parsed);

  const rawWords =
    format === "whisper-cpp"
      ? parseWhisperCpp(parsed)
      : format === "openai"
        ? parseOpenAI(parsed)
        : (parsed as Word[]).map((w) => ({
            text: w.text.trim(),
            start: round3(w.start),
            end: round3(w.end),
          }));

  return { words: rawWords, format };
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
      .map((e) => join(e.parentPath ?? e.path, e.name));
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
