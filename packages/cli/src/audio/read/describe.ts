import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Span } from "@hyperframes/core/audio-analysis";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { runFile } from "../analysis/providers/shared.js";
import type { AudibleStem, Description } from "./types.js";

const MODEL = "gemini-4-argon";
const MODEL_ENV = "HYPERFRAMES_READ_AUDIO_MODEL";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 180_000;
const ATTEMPTS = 2;

export const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

const seconds = (t: number) => String(Math.round(t * 100) / 100);
const spansText = (spans: readonly Span[]) =>
  spans.map((s) => `${seconds(s.start)}–${seconds(s.end)}`).join(", ") || "never";

function stemPrompt(name: string, duration: number): string {
  return [
    `This audio is one stem, "${name}", that an audio separator split out of a ${seconds(duration)} s soundtrack.`,
    "It holds only what the separator put in this stem.",
    "Describe what it holds: instruments or sounds, rhythm or pattern, feel, and how it changes over time, with the second of each change (enters, changes, stops, returns) where you can hear it.",
    "If it holds sound effects, name each kind and roughly when.",
    "Do not list individual beats or notes.",
    "If it is near empty or only bleed from other stems, say so in one sentence.",
    "Plain text, at most five sentences.",
  ].join(" ");
}

export interface Measured {
  duration: number;
  bpm: number | null;
  stems: readonly AudibleStem[];
  breaks: readonly Span[];
}

function overallPrompt({ duration, bpm, stems, breaks }: Measured): string {
  const facts = [
    bpm ? `tempo about ${bpm} BPM` : null,
    ...stems.map((s) => `${s.name} heard ${spansText(s.spans)}`),
    breaks.length ? `music breaks ${spansText(breaks)}` : null,
  ].filter(Boolean);
  return [
    `An audio separator split a ${seconds(duration)} s soundtrack into stems, and a listener described each stem alone.`,
    `Measured facts, in seconds; trust these over the descriptions' times: ${facts.join("; ")}.`,
    "The descriptions:",
    ...stems.map((s) => `${s.name}: ${s.description}`),
    "",
    "From these, answer in two parts, plain text, each starting with its label on a new line.",
    "OVERALL: at most four sentences: what the soundtrack holds (voice, music, other sound), the music's style, instruments and feel, and how it is arranged over time, using the measured times.",
    'BGM PROMPT: one paragraph describing only the music, as a prompt for a music generator: style, tempo, instruments, feel, and how it develops from start to end in order ("opens with…, then…, then…, ends with…"). No voice, no sound effects, no seconds or timestamps. Music means instruments or a beat carrying a tune or a groove; sound effects are not music, even when they come in a rhythm. If the soundtrack has no music, write BGM PROMPT: none.',
  ].join("\n");
}

function parseOverall(text: string): Description | null {
  const overall = /OVERALL:\s*([\s\S]*?)(?:\n\s*\**BGM PROMPT:|$)/i.exec(text)?.[1];
  const bgmPrompt = /BGM PROMPT:\s*([\s\S]*)$/i.exec(text)?.[1];
  const clean = (s: string | undefined) =>
    s?.replace(/\*\*/g, "").replace(/\s+/g, " ").trim() ?? "";
  const prompt = clean(bgmPrompt);
  if (!clean(overall) || !prompt) return null;
  return { overall: clean(overall), bgmPrompt: /^none\.?$/i.test(prompt) ? null : prompt };
}

const isMp3 = (bytes: Buffer) =>
  (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
  (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);

async function mp3Of(path: string, scratch: string): Promise<Buffer> {
  const bytes = readFileSync(path);
  if (isMp3(bytes)) return bytes;
  const ffmpeg = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpeg) throw new Error("ffmpeg is required to describe audio; run: npx hyperframes doctor");
  const out = join(scratch, `${createHash("sha256").update(path).digest("hex").slice(0, 12)}.mp3`);
  await runFile(
    ffmpeg,
    ["-v", "error", "-y", "-i", path, "-vn", "-ac", "2", "-ar", "44100", "-b:a", "160k", out],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  return readFileSync(out);
}

interface Answer {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

const retryable = (status: number) => status === 429 || status >= 500;

/** The answer's text, or why there is none. */
async function textOf(response: Response): Promise<{ text: string } | { failure: string }> {
  const answer = (await response.json().catch(() => ({}))) as Answer;
  if (!response.ok)
    return {
      failure: `HTTP ${response.status}${answer.error?.message ? `: ${answer.error.message}` : ""}`,
    };
  const parts = answer.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  return text ? { text } : { failure: "an empty answer" };
}

async function generate(model: string, key: string, audio: Buffer | null, prompt: string) {
  const sound = audio
    ? [{ inlineData: { mimeType: "audio/mpeg", data: audio.toString("base64") } }]
    : [];
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [...sound, { text: prompt }] }],
  });
  let failure = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const result = await textOf(response);
    if ("text" in result) return result.text;
    failure = result.failure;
    if (!response.ok && !retryable(response.status)) break;
  }
  throw new Error(failure);
}

interface Ask {
  label: string;
  /** The audio the model listens to; null for a question about text alone. */
  path: string | null;
  prompt: string;
}

/** One model call per ask, all at once, each answer kept by the audio's content and the prompt. */
async function answers(asks: Ask[], cacheDir: string, warnings: string[]) {
  const key = geminiKey()!;
  const model = process.env[MODEL_ENV] || MODEL;
  const dir = join(cacheDir, "describe");
  mkdirSync(dir, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), "hf-describe-"));
  try {
    const texts = await Promise.all(
      asks.map(async ({ label, path, prompt }) => {
        try {
          const audio = path ? await mp3Of(path, scratch) : null;
          const hash = createHash("sha256").update(model).update(prompt);
          const id = (audio ? hash.update(audio) : hash).digest("hex");
          const file = join(dir, `${id.slice(0, 24)}.txt`);
          if (existsSync(file)) return readFileSync(file, "utf8");
          const text = await generate(model, key, audio, prompt);
          writeFileSync(`${file}.tmp`, text);
          renameSync(`${file}.tmp`, file);
          return text;
        } catch (error) {
          warnings.push(
            `${label} not described: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }
      }),
    );
    return texts;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export interface Described {
  stems: AudibleStem[];
  description: Description | null;
}

/** Each stem described alone by a model listening to it, then the whole and a BGM prompt written from those descriptions. */
export async function describeStems(
  stemPaths: Record<string, string>,
  measured: Measured,
  cacheDir: string,
  warnings: string[],
): Promise<Described> {
  const heard = measured.stems.filter((stem) => stem.spans.length > 0);
  const perStem = await answers(
    heard.map((stem) => ({
      label: `stem ${stem.name}`,
      path: stemPaths[stem.name]!,
      prompt: stemPrompt(stem.name, measured.duration),
    })),
    cacheDir,
    warnings,
  );
  const stems = measured.stems.map((stem) => ({
    ...stem,
    description: perStem[heard.indexOf(stem)]?.replace(/\s+/g, " ").trim() || null,
  }));
  const described = stems.filter((stem) => stem.description);
  if (!described.length) return { stems, description: null };
  const [overall] = await answers(
    [
      {
        label: "the soundtrack",
        path: null,
        prompt: overallPrompt({ ...measured, stems: described }),
      },
    ],
    cacheDir,
    warnings,
  );
  const description = overall ? parseOverall(overall) : null;
  if (overall && !description)
    warnings.push("the soundtrack not described: the answer had no OVERALL and BGM PROMPT parts");
  return { stems, description };
}
