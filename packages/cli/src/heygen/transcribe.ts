// Transcription on HeyGen (`transcribe --engine heygen`): word times from its speech model, with speakers when asked.
// The route runs inside the POST and takes an API key; the Idempotency-Key makes a re-run free.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "../measure/media.js";
import { idempotencyKey, runJob } from "./v3.js";

const ROUTE = "/v3/audio/transcriptions";
const MODEL = "scribe-v2";

export interface HeygenTranscript {
  transcriptPath: string;
  model: string;
  detectedLanguage: string | null;
  durationSeconds: number;
  speechOnsetSeconds: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : []);

/** Words in the transcript file's own shape, `speaker` kept when the model labelled one. */
export function wordsOf(job: Record<string, unknown>) {
  return list(job.segments).flatMap((segment) =>
    list(segment.words).flatMap((w) => {
      const text = String(w.word ?? w.text ?? "").trim();
      if (!text || typeof w.start !== "number" || typeof w.end !== "number") return [];
      const speaker = w.speaker ?? segment.speaker;
      return [
        {
          text,
          start: w.start,
          end: w.end,
          ...(speaker !== undefined ? { speaker: String(speaker) } : {}),
        },
      ];
    }),
  );
}

export async function transcribeWithHeygen(
  inputPath: string,
  transcriptPath: string,
  opts: { diarize?: boolean; projectDir?: string; onStatus?: (message: string) => void } = {},
): Promise<HeygenTranscript> {
  const work = mkdtempSync(join(tmpdir(), "hf-heygen-asr-"));
  try {
    opts.onStatus?.("Preparing audio for HeyGen...");
    const mp3 = join(work, "audio.mp3");
    runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
      mp3,
    ]);
    const audio = readFileSync(mp3);
    const diarize = opts.diarize === true;
    opts.onStatus?.("Transcribing on HeyGen...");
    const job = await runJob(
      ROUTE,
      {
        model: MODEL,
        audio: { type: "base64", media_type: "audio/mpeg", data: audio.toString("base64") },
        diarize,
      },
      idempotencyKey(ROUTE, [audio, String(diarize)]),
      (id) => `${ROUTE}/${encodeURIComponent(id)}`,
      {
        log: { projectDir: opts.projectDir, what: `transcribe ${inputPath}` },
        timeoutMs: 10 * 60_000,
      },
    );
    const words = wordsOf(job);
    writeFileSync(transcriptPath, JSON.stringify(words, null, 2));
    return {
      transcriptPath,
      model: typeof job.model === "string" ? job.model : MODEL,
      detectedLanguage: typeof job.language === "string" ? job.language : null,
      durationSeconds:
        typeof job.duration_seconds === "number" ? job.duration_seconds : (words.at(-1)?.end ?? 0),
      speechOnsetSeconds: words[0]?.start ?? null,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
