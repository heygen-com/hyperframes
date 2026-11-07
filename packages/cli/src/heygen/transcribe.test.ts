import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
writeFileSync(join(dir, "index.html"), "");
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

  it.skipIf(!ffmpeg)("logs the job in the project, wherever the transcript goes", async () => {
    const audio = join(dir, "a.wav");
    execFileSync(ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=300:d=1.5", audio]);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: job })));
    mkdirSync(join(dir, "work"));
    await transcribeWithHeygen(audio, join(dir, "work", "transcript.json"));
    const rows = readFileSync(join(dir, ".hyperframes/heygen-jobs.jsonl"), "utf8");
    expect(JSON.parse(rows.trim().split("\n")[0]!).what).toBe(`transcribe ${audio}`);
  });

  it.skipIf(!ffmpeg)("keys the request and polls a pending transcription to the end", async () => {
    const audio = join(dir, "b.wav");
    execFileSync(ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=200:d=1", audio]);
    const calls: { url: string; method?: string; key: string | null }[] = [];
    const answers = [{ id: "t1", status: "pending" }, job];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method,
        key: new Headers(init.headers).get("Idempotency-Key"),
      });
      return new Response(JSON.stringify({ data: answers.shift() }), { status: 200 });
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let done = false;
    const pending = transcribeWithHeygen(audio, join(dir, "b.json")).finally(() => (done = true));
    while (!done) {
      await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(5000);
    }
    const r = await pending;
    vi.useRealTimers();
    expect(calls).toEqual([
      {
        url: "https://api.test/v3/audio/transcriptions",
        method: "POST",
        key: expect.stringMatching(/^hf-[0-9a-f]{40}$/),
      },
      { url: "https://api.test/v3/audio/transcriptions/t1", method: "GET", key: null },
    ]);
    expect(r.detectedLanguage).toBe("en");
  });

  it.skipIf(!ffmpeg)("turns a refusal into what to do next", async () => {
    const audio = join(dir, "c.wav");
    execFileSync(ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=250:d=1", audio]);
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { code: "api_key_required" } }), { status: 403 }),
    );
    await expect(transcribeWithHeygen(audio, join(dir, "c.json"))).rejects.toMatchObject({
      fix: "continue without this step",
    });
  });
});
