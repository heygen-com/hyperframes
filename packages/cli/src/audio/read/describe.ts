import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Span } from "@hyperframes/core/audio-analysis";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { runFile } from "../analysis/providers/shared.js";
import { MELODIC_GROUP, type AudibleStem, type Description } from "./types.js";

const MODEL = "gemini-4-argon";
const MODEL_ENV = "HYPERFRAMES_READ_AUDIO_MODEL";
/** "1" asks each stem's description for the second of each change it hears; off until that is judged accurate. */
const STEM_TIMES_ENV = "HYPERFRAMES_READ_AUDIO_STEM_TIMES";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 180_000;
const ATTEMPTS = 2;

export const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

const seconds = (t: number) => String(Math.round(t * 100) / 100);
const spansText = (spans: readonly Span[]) =>
  spans.map((s) => `${seconds(s.start)}–${seconds(s.end)}`).join(", ") || "never";

function stemPrompt(name: string, duration: number): string {
  const withTimes = process.env[STEM_TIMES_ENV] === "1";
  return [
    `This audio is ${
      name === MELODIC_GROUP
        ? `the "${name}" part: the piano, guitar and other stems an audio separator split out of a ${seconds(duration)} s soundtrack, mixed together`
        : `one stem, "${name}", that an audio separator split out of a ${seconds(duration)} s soundtrack`
    }.`,
    "It holds only what the separator put in it.",
    `Describe what it holds and what it does: instrument or sound, rhythm or pattern, feel, and how it changes over time${
      withTimes
        ? ", with the second of each change (enters, changes, stops, returns) where you can hear it; otherwise summarise without times."
        : "."
    }`,
    "If it is near empty or only bleed from other parts, say so in one sentence.",
    withTimes
      ? "Do not list sound effects and do not list individual hits or notes."
      : "Do not list sound effects.",
    `Plain text, at most ${withTimes ? "four" : "three"} sentences.`,
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
    `This is a ${seconds(duration)} s soundtrack.`,
    `Measured facts, in seconds; trust these times over your own estimates: ${facts.join("; ")}.`,
    "Answer in two parts, plain text, each starting with its label on a new line.",
    "OVERALL: at most four sentences: what the recording holds (voice, music, other sound), the music's style, instruments and feel, and how it is arranged over time, using the measured times. Do not list sound effects.",
    "GENERATOR: one line describing only the music as a prompt for a music generator: style, tempo, instruments, feel and arrangement. No voice, no sound effects, no times.",
  ].join("\n");
}

function parseOverall(text: string): Description | null {
  const overall = /OVERALL:\s*([\s\S]*?)(?:\n\s*\**GENERATOR:|$)/i.exec(text)?.[1];
  const generator = /GENERATOR:\s*([\s\S]*)$/i.exec(text)?.[1];
  const clean = (s: string | undefined) =>
    s?.replace(/\*\*/g, "").replace(/\s+/g, " ").trim() ?? "";
  const description = { overall: clean(overall), generator: clean(generator) };
  return description.overall && description.generator ? description : null;
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

async function generate(model: string, key: string, audio: Buffer, prompt: string) {
  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "audio/mpeg", data: audio.toString("base64") } },
          { text: prompt },
        ],
      },
    ],
  });
  let failure = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const answer = (await response.json().catch(() => ({}))) as Answer;
    if (response.ok) {
      const text = answer.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();
      if (text) return text;
      failure = "an empty answer";
    } else
      failure = `HTTP ${response.status}${answer.error?.message ? `: ${answer.error.message}` : ""}`;
    if (!response.ok && response.status !== 429 && response.status < 500) break;
  }
  throw new Error(failure);
}

interface Ask {
  label: string;
  path: string;
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
          const audio = await mp3Of(path, scratch);
          const id = createHash("sha256").update(model).update(prompt).update(audio).digest("hex");
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

/** Each audible stem described alone, and the whole recording once, by Gemini. */
export async function describeStems(
  recording: string,
  stemPaths: Record<string, string>,
  measured: Measured,
  cacheDir: string,
  warnings: string[],
): Promise<Described> {
  const heard = measured.stems.filter((stem) => stem.spans.length > 0);
  const asks: Ask[] = [
    { label: "the recording", path: recording, prompt: overallPrompt(measured) },
    ...heard.map((stem) => ({
      label: `stem ${stem.name}`,
      path: stemPaths[stem.name]!,
      prompt: stemPrompt(stem.name, measured.duration),
    })),
  ];
  const texts = await answers(asks, cacheDir, warnings);
  const [overall, ...perStem] = texts;
  const description = overall ? parseOverall(overall) : null;
  if (overall && !description)
    warnings.push("the recording not described: the answer had no OVERALL and GENERATOR parts");
  return {
    stems: measured.stems.map((stem) => ({
      ...stem,
      description: perStem[heard.indexOf(stem)]?.replace(/\s+/g, " ").trim() || null,
    })),
    description,
  };
}
