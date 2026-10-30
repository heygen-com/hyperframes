import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { findFFmpeg } from "../browser/ffmpeg.js";

vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  refreshIfNeeded: async <T>(credential: T) => credential,
  resolveCloudBaseUrl: () => "https://api.test",
}));
vi.stubEnv("HEYGEN_API_KEY", "k");

const { transcribeWithHeygen, wordsOf } = await import("./transcribe.js");
const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-heygen-asr-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

const job = {
  id: "t1",
  status: "completed",
  model: "scribe-v2",
  language: "en",
  duration_seconds: 1.5,
  segments: [
    {
      speaker: "speaker_0",
      start: 0.1,
      end: 1.2,
      words: [
        { word: "Hello", start: 0.1, end: 0.5 },
        { word: "there", start: 0.6, end: 1.2, speaker: "speaker_1" },
        { word: " ", start: 1.2, end: 1.3 },
      ],
    },
  ],
};

describe("HeyGen transcription", () => {
  it("keeps each word's time and speaker, and drops blanks", () => {
    expect(wordsOf(job)).toEqual([
      { text: "Hello", start: 0.1, end: 0.5, speaker: "speaker_0" },
      { text: "there", start: 0.6, end: 1.2, speaker: "speaker_1" },
    ]);
  });

  it.skipIf(!ffmpeg)("sends the audio once and writes the transcript", async () => {
    const audio = join(dir, "a.wav");
    execFileSync(ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=300:d=1.5", audio]);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: job }), { status: 200 });
    });
    const out = join(dir, "transcript.json");
    const r = await transcribeWithHeygen(audio, out, { diarize: true });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      model: "scribe-v2",
      diarize: true,
      audio: { type: "base64", media_type: "audio/mpeg" },
    });
    expect(r).toMatchObject({
      detectedLanguage: "en",
      durationSeconds: 1.5,
      speechOnsetSeconds: 0.1,
    });
    expect(JSON.parse(readFileSync(out, "utf8"))).toHaveLength(2);
  });
});
