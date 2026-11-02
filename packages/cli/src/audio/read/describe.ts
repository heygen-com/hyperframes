import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Span } from "@hyperframes/core/audio-analysis";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import {
  runFile,
  serviceAccess,
  serviceFailure,
  type ServiceAccess,
} from "../analysis/providers/shared.js";
import type { AudibleStem, Description } from "./types.js";

const MODEL = "gemini-4-argon";
const TIMEOUT_MS = 180_000;
const ATTEMPTS = 2;
const OVERALL_SCHEMA = {
  type: "object",
  properties: { overall: { type: "string" }, bgm_prompt: { type: ["string", "null"] } },
  required: ["overall", "bgm_prompt"],
  additionalProperties: false,
};

export const describeAccess = () => serviceAccess(null, "/v1/hyperframes/llm/messages", TIMEOUT_MS);

const seconds = (t: number) => String(Math.round(t * 100) / 100);
const spansText = (spans: readonly Span[]) =>
  spans.map((s) => `${seconds(s.start)}–${seconds(s.end)}`).join(", ") || "never";

function stemPrompt(name: string, duration: number): string {
  return [
    `This audio is one stem, "${name}", that an audio separator split out of a ${seconds(duration)} s soundtrack.`,
    "It holds only what the separator put in this stem.",
    "Describe what it holds: instruments or sounds, rhythm or pattern, feel, and how it changes over time, with the second of each change where you can hear it.",
    "If it holds sound effects, describe their sound and roughly when they occur.",
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
    "For overall, describe what the soundtrack holds, the music's style, instruments and feel, and how it is arranged over time, using the measured times. Use at most four sentences.",
    "For bgm_prompt, describe only the music as a prompt for a music generator: style, tempo, instruments, feel, and how it develops from start to end in order. No voice, no sound effects, no seconds or timestamps. Music means instruments or a beat carrying a tune or a groove; sound effects are not music, even when they come in a rhythm. Return null when there is no music.",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("the soundtrack answer did not match the required fields");
  return value.trim();
}

function descriptionOf(text: string): Description {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error("the soundtrack answer did not match the required fields");
  return {
    overall: requiredText(value.overall),
    bgmPrompt: value.bgm_prompt === null ? null : requiredText(value.bgm_prompt),
  };
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

const retryable = (status: number) => status === 429 || status >= 500;

function textPart(part: unknown): string {
  if (!isRecord(part) || part.type !== "text") return "";
  return typeof part.text === "string" ? part.text : "";
}

function textOf(answer: unknown): string {
  if (!isRecord(answer) || !Array.isArray(answer.content))
    throw new Error("the description service returned no text");
  const content: unknown[] = answer.content;
  const text = content.map(textPart).join("").trim();
  if (!text) throw new Error("the description service returned no text");
  return text;
}

async function generate(
  access: ServiceAccess,
  audio: Buffer | null,
  prompt: string,
  structured: boolean,
) {
  const sound = audio
    ? [
        {
          type: "audio",
          source: { type: "base64", media_type: "audio/mpeg", data: audio.toString("base64") },
        },
      ]
    : [];
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: [...sound, { type: "text", text: prompt }] }],
    ...(structured
      ? { output_config: { format: { type: "json_schema", schema: OVERALL_SCHEMA } } }
      : {}),
  });
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(access.url, {
      method: "POST",
      redirect: "error",
      headers: { ...access.headers, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(access.timeoutMs),
    });
    if (response.ok) return textOf(await response.json());
    if (attempt + 1 >= ATTEMPTS || !retryable(response.status))
      throw await serviceFailure(response, "the description service");
    await response.body?.cancel();
  }
}

interface Ask {
  path: string | null;
  prompt: string;
  structured?: boolean;
}

async function answers(asks: Ask[], cacheDir: string, access: ServiceAccess) {
  const dir = join(cacheDir, "describe");
  mkdirSync(dir, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), "hf-describe-"));
  try {
    // Wait for every conversion before removing their shared scratch directory.
    const settled = await Promise.allSettled(
      asks.map(async ({ path, prompt, structured = false }) => {
        const audio = path ? await mp3Of(path, scratch) : null;
        const hash = createHash("sha256")
          .update(MODEL)
          .update(prompt)
          .update(structured ? JSON.stringify(OVERALL_SCHEMA) : "plain");
        const id = (audio ? hash.update(audio) : hash).digest("hex");
        const file = join(dir, `${id.slice(0, 24)}.txt`);
        if (existsSync(file)) return readFileSync(file, "utf8");
        const text = await generate(access, audio, prompt, structured);
        if (structured) descriptionOf(text);
        writeFileSync(`${file}.tmp`, text);
        renameSync(`${file}.tmp`, file);
        return text;
      }),
    );
    return settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export interface Described {
  stems: AudibleStem[];
  description: Description | null;
}

export async function describeStems(
  stemPaths: Record<string, string>,
  measured: Measured,
  cacheDir: string,
  warnings: string[],
): Promise<Described> {
  const unavailable: Described = {
    stems: measured.stems.map((stem) => ({ ...stem, description: null })),
    description: null,
  };
  const heard = measured.stems.filter((stem) => stem.spans.length > 0);
  if (!heard.length) return unavailable;
  try {
    const access = await describeAccess();
    if (typeof access === "string") throw new Error(access);
    const perStem = await answers(
      heard.map((stem) => ({
        path: stemPaths[stem.name]!,
        prompt: stemPrompt(stem.name, measured.duration),
      })),
      cacheDir,
      access,
    );
    const stems = unavailable.stems.map((stem) => ({
      ...stem,
      description:
        perStem[heard.findIndex((heardStem) => heardStem.name === stem.name)]
          ?.replace(/\s+/g, " ")
          .trim() || null,
    }));
    const [overall] = await answers(
      [
        {
          path: null,
          prompt: overallPrompt({ ...measured, stems: stems.filter((stem) => stem.description) }),
          structured: true,
        },
      ],
      cacheDir,
      access,
    );
    if (!overall) throw new Error("the description service returned no soundtrack answer");
    return { stems, description: descriptionOf(overall) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(`stems not described: ${reason.replace(/\s+/g, " ").trim()}`);
    return unavailable;
  }
}
