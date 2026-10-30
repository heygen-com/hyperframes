import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { readAudio } from "./read.js";
import { formatRead } from "./format.js";
import { READ_VERSION } from "./types.js";
import { cachedStems, fetchStems } from "./stems.js";

const RATE = 22_050;
const dir = mkdtempSync(join(tmpdir(), "hf-audio-read-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function wav(name: string, seconds: number, fill: (t: number) => number): string {
  const frames = Math.round(seconds * RATE);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++)
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, fill(i / RATE))) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  const path = join(dir, name);
  writeFileSync(path, Buffer.concat([header, data]));
  return path;
}

const voiced = (t: number) =>
  (t >= 0.5 && t < 2) || (t >= 3 && t < 4.5) ? 0.3 * Math.sin(2 * Math.PI * 180 * t) : 0;
const boom = (t: number) =>
  t < 2.4 ? 0 : 0.7 * Math.exp(-(t - 2.4) / 0.3) * Math.sin(2 * Math.PI * 55 * (t - 2.4));
const C_MAJOR = (t: number) =>
  [261.63, 329.63, 392].reduce((n, hz) => n + 0.06 * Math.sin(2 * Math.PI * hz * t), 0);
const bed = (t: number) =>
  t > 5 && t < 6
    ? 0
    : 0.08 * Math.sin(2 * Math.PI * 261.63 * t) + 0.08 * Math.sin(2 * Math.PI * 392 * t);

let server: Server;
let stalledPath: string | null = null;
let onStalled = () => {};
let stemCalls = 0;
let stemRequest: unknown = null;
const stemKeys: unknown[] = [];
const stemFiles: Record<string, string> = {};

async function body(req: IncomingMessage) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const origin = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Reply = (status: number, value: unknown) => void;

const routes = new Map<string, (reply: Reply, req: IncomingMessage, bytes: Buffer) => void>(
  Object.entries({
    "POST /v3/assets/direct-uploads": (reply) =>
      reply(200, {
        data: { asset_id: "episode", upload_url: `${origin()}/put`, upload_headers: {} },
      }),
    "PUT /put": (reply) => reply(200, {}),
    "POST /v3/assets/episode/complete": (reply) => reply(200, { data: { asset_id: "episode" } }),
    "POST /v3/audio/stems": (reply, req, bytes) => {
      expect(req.headers["x-api-key"]).toBe("test-key");
      stemCalls++;
      stemRequest = JSON.parse(bytes.toString());
      stemKeys.push(req.headers["idempotency-key"]);
      if (stemCalls === 1)
        return reply(409, { error: { code: "request_in_progress", message: "Retry shortly." } });
      reply(200, {
        data: {
          id: "job-1",
          status: "completed",
          stems: Object.keys(stemFiles).map((name) => ({
            name,
            url: `${origin()}/stem/${name}.wav`,
          })),
        },
      });
    },
  }),
);

beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.url === stalledPath) {
      onStalled();
      return;
    }
    const bytes = await body(req);
    const reply: Reply = (status, value) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    const route = routes.get(`${req.method} ${req.url}`);
    if (typeof route === "function") return route(reply, req, bytes);
    const stem = req.url?.match(/^\/stem\/(\w+)\.wav$/)?.[1];
    if (stem && stemFiles[stem]) return res.writeHead(200).end(readFileSync(stemFiles[stem]));
    res.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

beforeEach(() => {
  for (const name of ["HEYGEN_API_KEY", "HYPERFRAMES_API_KEY", "HEYGEN_ACCESS_TOKEN"])
    vi.stubEnv(name, "");
  vi.stubEnv("HEYGEN_API_URL", origin());
});

afterEach(() => {
  stalledPath = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete process.env.HYPERFRAMES_AUDIO_STEMS_URL;
  delete process.env.HYPERFRAMES_AUDIO_API_KEY;
});

const ffmpeg = findFfBinary("ffmpeg") && findFfBinary("ffprobe");

describe.skipIf(!ffmpeg)("readAudio", () => {
  it("reads the mix with its sidecar transcript when there are no stems, and reuses the cache", async () => {
    const path = wav("talk.wav", 6, (t) => voiced(t));
    writeFileSync(
      `${path}.transcript.json`,
      JSON.stringify({
        audio: "talk.wav",
        words: [
          { text: "一口气", start: 0.5, end: 1.4 },
          { text: "了解。", start: 1.4, end: 2 },
          { text: "伊朗", start: 3, end: 4.5 },
        ],
      }),
    );
    const cacheDir = join(dir, "cache-mix");
    const first = await readAudio(path, "talk.wav", { cacheDir, quality: "best" });
    expect(first.cached).toBe(false);
    expect(first.analysis).toMatchObject({ separation: "mix", stems: [], music: null });
    expect(first.analysis.voice!.sentences.map((s) => s.text)).toEqual(["一口气了解。", "伊朗"]);
    expect(first.analysis.voice!.medianPitchHz).toBeGreaterThan(170);
    expect(first.analysis.warnings.join("\n")).toContain("no HeyGen credential");
    const text = readFileSync(first.textPath, "utf8");
    expect(text).toContain('voice    "一口气了解。"');
    expect(text).toContain("pause    1.0 s, silent");
    const again = await readAudio(path, "talk.wav", { cacheDir, quality: "best" });
    expect(again.cached).toBe(true);
    writeFileSync(
      `${path}.transcript.json`,
      JSON.stringify({ words: [{ text: "换了", start: 0.5, end: 2 }] }),
    );
    const edited = await readAudio(path, "talk.wav", { cacheDir, quality: "best" });
    expect(edited.cached).toBe(false);
    expect(edited.analysis.voice!.sentences[0]!.text).toBe("换了");
  });

  it("separates through HeyGen's stems route with the CLI's HeyGen API key, then reads effects from the drums and the bed from the rest", async () => {
    stemFiles.vocals = wav("vocals.wav", 8, voiced);
    stemFiles.drums = wav("drums.wav", 8, boom);
    stemFiles.piano = wav("piano.wav", 8, bed);
    stemFiles.bass = wav("bass.wav", 8, () => 0);
    stemFiles.guitar = stemFiles.bass;
    stemFiles.other = stemFiles.bass;
    stemFiles["../../escape"] = stemFiles.bass;
    const path = wav("episode.wav", 8, (t) => voiced(t) + boom(t) + bed(t));
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    const cacheDir = join(dir, "cache-stems");
    const { analysis, textPath } = await readAudio(path, "episode.wav", {
      cacheDir,
      quality: "best",
    });
    expect(stemRequest).toEqual({ version: 1, audio: { type: "asset_id", asset_id: "episode" } });
    expect(stemKeys).toHaveLength(2);
    expect(stemKeys[1]).toBe(stemKeys[0]);
    expect(analysis).toMatchObject({
      separation: "stems",
      stems: ["vocals", "drums", "piano"].map((name) => ({ name, db: expect.any(Number) })),
      warnings: [expect.stringContaining("no transcript")],
    });
    expect(analysis.voice!.source).toBe("activity");
    expect(analysis.effects!.events.map((e) => [Math.round(e.t * 10) / 10, e.kind])).toEqual([
      [2.4, "boom"],
    ]);
    expect(analysis.effects!.events[0]!.overMusicDb).toBeGreaterThan(5);
    expect(analysis.music!.breaks.map((b) => Math.round(b.start))).toEqual([5]);
    expect(analysis.music!.segments.map((s) => s.entry)).toEqual(["start", "resumes"]);
    const text = readFileSync(textPath, "utf8");
    expect(text).toMatch(/stems: vocals -\d+ dB, drums -\d+ dB, piano -\d+ dB\n/);
    expect(text).toContain("effect   boom (S1): low");
    expect(analysis.ambience).toEqual([]);
    expect(existsSync(join(cacheDir, "stems"))).toBe(true);
    await readAudio(path, "episode.wav", { cacheDir, quality: "best" });
    expect(stemCalls).toBe(2);
  });

  it("reads a bed of noise as ambience, not music, and names only the stems that carry sound", async () => {
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const roomTone = new Float32Array(Math.round(6 * RATE)).map(() => 0.006 * noise());
    const path = wav("room.wav", 6, (t) => roomTone[Math.round(t * RATE)] ?? 0);
    const cacheDir = join(dir, "cache-room");
    const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
    const stemDir = join(cacheDir, "stems", sha.slice(0, 12));
    mkdirSync(stemDir, { recursive: true });
    writeFileSync(join(stemDir, "other.wav"), readFileSync(path));
    writeFileSync(join(stemDir, "silence.wav"), readFileSync(wav("room-silence.wav", 6, () => 0)));
    const names = ["vocals", "drums", "bass", "guitar", "piano"];
    writeFileSync(
      join(stemDir, "stems.json"),
      JSON.stringify({
        other: "other.wav",
        ...Object.fromEntries(names.map((n) => [n, "silence.wav"])),
      }),
    );
    const { analysis, textPath, jsonPath } = await readAudio(path, "room.wav", {
      cacheDir,
      quality: "best",
    });
    expect(analysis.stems).toEqual([{ name: "other", db: expect.any(Number) }]);
    expect(analysis.music!.segments).toEqual([]);
    expect(analysis.ambience).toEqual([
      { start: 0, end: expect.closeTo(6, 0), db: expect.any(Number) },
    ]);
    expect(analysis.ambience![0]!.db).toBeLessThan(-45);
    const text = readFileSync(textPath, "utf8");
    expect(text).toMatch(/stems: other -\d+ dB\n/);
    expect(text).toMatch(/ambience quiet, -\d+ dBFS/);
    expect(text).not.toContain("piece");
    expect(formatRead(analysis, [2, 3])).toContain("ambience quiet");
    expect(formatRead(analysis, [8, 9])).not.toContain("ambience quiet");
    expect(analysis.music!.energy).toEqual([]);
    const old = { analysis: { ...analysis, version: 2, stems: ["other"] }, transcriptKey: "none" };
    writeFileSync(jsonPath, JSON.stringify(old));
    const refreshed = await readAudio(path, "room.wav", { cacheDir });
    expect(refreshed.cached).toBe(false);
    expect(refreshed.analysis.version).toBe(READ_VERSION);
    expect(refreshed.analysis.stems).toEqual(analysis.stems);
    expect((await readAudio(path, "room.wav", { cacheDir })).cached).toBe(true);
  });

  it("does not measure an effect over music when its bed is only ambience", async () => {
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const samples = new Float32Array(6 * RATE).map(() => 0.006 * noise());
    const other = wav("effect-room.wav", 6, (t) => samples[Math.round(t * RATE)] ?? 0);
    const path = wav(
      "effect-in-room.wav",
      6,
      (t) => (samples[Math.round(t * RATE)] ?? 0) + boom(t),
    );
    const cacheDir = join(dir, "cache-effect-room");
    const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
    const stemDir = join(cacheDir, "stems", sha.slice(0, 12));
    mkdirSync(stemDir, { recursive: true });
    writeFileSync(join(stemDir, "other.wav"), readFileSync(other));
    writeFileSync(join(stemDir, "drums.wav"), readFileSync(wav("room-boom.wav", 6, boom)));
    writeFileSync(
      join(stemDir, "silence.wav"),
      readFileSync(wav("effect-silence.wav", 6, () => 0)),
    );
    writeFileSync(
      join(stemDir, "stems.json"),
      JSON.stringify({
        other: "other.wav",
        drums: "drums.wav",
        ...Object.fromEntries(["vocals", "bass", "guitar", "piano"].map((n) => [n, "silence.wav"])),
      }),
    );
    const { analysis, textPath } = await readAudio(path, "effect-in-room.wav", { cacheDir });
    expect(analysis.ambience).toHaveLength(1);
    expect(analysis.effects!.events).toHaveLength(1);
    expect(analysis.effects!.events[0]!.overMusicDb).toBeNull();
    expect(readFileSync(textPath, "utf8")).not.toContain("over music");
  });

  const loudPad = (t: number) => 2 * C_MAJOR(t);
  const fading = (from: number, seconds: number) => (t: number) =>
    t < 2 || t >= from + seconds
      ? 0
      : loudPad(t) * 10 ** ((-60 * Math.max(0, t - from)) / seconds / 20);
  const bridged = (t: number) =>
    t < 1 || t >= 10 ? 0 : loudPad(t) * (t >= 5 && t < 6 ? 10 ** (-30 / 20) : 1);

  it.each([
    ["a 4 s fade", fading(6, 4)],
    ["a 2 s fade", fading(7, 2)],
    ["a 1 s fade", fading(7.6, 1)],
    ["a bridge 30 dB down", bridged],
  ])("reads no effect where music ends in %s", async (name, music) => {
    const file = `${name.replace(/\W+/g, "-")}.wav`;
    const path = wav(file, 14, music);
    const cacheDir = join(dir, `cache-${file}`);
    const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
    const stemDir = join(cacheDir, "stems", sha.slice(0, 12));
    mkdirSync(stemDir, { recursive: true });
    writeFileSync(join(stemDir, "other.wav"), readFileSync(path));
    writeFileSync(join(stemDir, "silence.wav"), readFileSync(wav(`silent-${file}`, 14, () => 0)));
    writeFileSync(
      join(stemDir, "stems.json"),
      JSON.stringify({
        other: "other.wav",
        ...Object.fromEntries(
          ["vocals", "drums", "bass", "guitar", "piano"].map((n) => [n, "silence.wav"]),
        ),
      }),
    );
    const { analysis } = await readAudio(path, file, { cacheDir });
    expect(analysis.music!.segments.length).toBeGreaterThan(0);
    expect(analysis.effects!.events).toEqual([]);
  });

  it("falls back on partial stems and retries instead of caching unmeasured layers as silence", async () => {
    for (const name of Object.keys(stemFiles)) delete stemFiles[name];
    stemFiles.vocals = wav("partial-vocals.wav", 2, voiced);
    const path = wav("partial.wav", 2, voiced);
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    const cacheDir = join(dir, "cache-partial");
    const partial = await readAudio(path, "partial.wav", { cacheDir, quality: "best" });
    expect(partial.analysis).toMatchObject({ separation: "mix", effects: null, music: null });
    expect(partial.analysis.warnings.join("\n")).toContain("incomplete separation: missing drums");
    const callsBefore = stemCalls;
    const silence = wav("partial-silence.wav", 2, () => 0);
    for (const name of ["drums", "bass", "guitar", "piano", "other"]) stemFiles[name] = silence;
    const complete = await readAudio(path, "partial.wav", { cacheDir, quality: "best" });
    expect(complete.cached).toBe(false);
    expect(complete.analysis.separation).toBe("stems");
    expect(stemCalls).toBe(callsBefore + 1);

    const stemDir = join(cacheDir, "stems", complete.analysis.sha256.slice(0, 12));
    writeFileSync(join(stemDir, "stems.json"), JSON.stringify({ vocals: "vocals.audio" }));
    expect(cachedStems(stemDir)).toBeNull();
    const repaired = await readAudio(path, "partial.wav", { cacheDir, quality: "best" });
    expect(repaired.cached).toBe(false);
    expect(stemCalls).toBe(callsBefore + 2);
    expect(Object.keys(cachedStems(stemDir)!)).toHaveLength(6);
  });

  it.each(["/put", "/v3/audio/stems"])(
    "aborts a stalled %s request at the separation deadline",
    async (endpoint) => {
      const controller = new AbortController();
      const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
      stalledPath = endpoint;
      onStalled = () => controller.abort();
      const path = wav("timeout.wav", 1, voiced);
      await expect(
        fetchStems(path, join(dir, `timeout-${endpoint.replaceAll("/", "-")}`), {
          url: `${origin()}/v3/audio/stems`,
          headers: { "x-api-key": "test-key" },
          timeoutMs: 1000,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(timeout).toHaveBeenCalledWith(1000);
    },
  );

  it("reads the same effects and peaks from three encodings, says what plays in a pause, and weighs the voice against the music", async () => {
    let seed = 5;
    const hiss = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const tick = (at: number) => (t: number) =>
      t >= at && t < at + 0.004 ? 0.9 * Math.exp(-(t - at) / 0.001) * hiss() : 0;
    const clicks = [4, 4.5, 5, 5.5].map(tick);
    const beep = (t: number) => (t >= 3.9 && t < 4.1 ? 0.2 * Math.sin(2 * Math.PI * 1000 * t) : 0);
    const kick = (t: number) =>
      t < 6
        ? 0
        : 0.6 * Math.exp(-((t - 6) % 0.5) / 0.05) * Math.sin(2 * Math.PI * 60 * ((t - 6) % 0.5));
    const pad = (t: number) => (t < 6 ? 0 : C_MAJOR(t));
    const speech = (t: number) => (t >= 9 && t < 11 ? voiced(t - 8.5) : 0);
    const drums = (t: number) => clicks.reduce((n, c) => n + c(t), 0) + kick(t) + 0.05 * beep(t);
    const other = (t: number) => pad(t) + beep(t) + 0.1 * clicks.reduce((n, c) => n + c(t), 0);
    const sources = {
      vocals: wav("enc-vocals.wav", 14, (t) => voiced(t) * (t < 2 ? 1 : 0) + speech(t)),
      drums: wav("enc-drums.wav", 14, drums),
      other: wav("enc-other.wav", 14, other),
      silent: wav("enc-silent.wav", 14, () => 0),
    };
    const mix = wav(
      "enc-mix.wav",
      14,
      (t) => voiced(t) * (t < 2 ? 1 : 0) + speech(t) + drums(t) + other(t),
    );
    const encodings = {
      mono22: ["-ac", "1", "-ar", "22050"],
      mono44: ["-ac", "1", "-ar", "44100"],
      stereo48: ["-ac", "2", "-ar", "48000"],
    };
    const reads = [];
    for (const [name, args] of Object.entries(encodings)) {
      const path = join(dir, `enc-${name}.wav`);
      execFileSync(String(findFfBinary("ffmpeg")), ["-v", "error", "-y", "-i", mix, ...args, path]);
      const cacheDir = join(dir, `cache-enc-${name}`);
      const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
      const stemDir = join(cacheDir, "stems", sha.slice(0, 12));
      mkdirSync(stemDir, { recursive: true });
      const names: Record<string, string> = {};
      for (const [stem, source] of Object.entries({
        vocals: "vocals",
        drums: "drums",
        other: "other",
        bass: "silent",
        guitar: "silent",
        piano: "silent",
      })) {
        execFileSync(String(findFfBinary("ffmpeg")), [
          "-v",
          "error",
          "-y",
          "-i",
          sources[source as keyof typeof sources],
          ...args,
          "-c:a",
          "libmp3lame",
          "-b:a",
          "192k",
          "-f",
          "mp3",
          join(stemDir, `${stem}.audio`),
        ]);
        names[stem] = `${stem}.audio`;
      }
      writeFileSync(join(stemDir, "stems.json"), JSON.stringify(names));
      writeFileSync(
        `${path}.transcript.json`,
        JSON.stringify({
          words: [
            { text: "Hello.", start: 0.5, end: 1.9 },
            { text: "Under music.", start: 9, end: 10.9 },
          ],
        }),
      );
      reads.push(await readAudio(path, `enc-${name}.wav`, { cacheDir }));
    }
    const events = reads.map((r) => r.analysis.effects!.events);
    const heard = events.map((list) => list.map((e) => Math.round(e.t * 10) / 10));
    expect(heard[0]).toEqual([3.9, 4, 4.5, 5, 5.5]);
    expect(heard[1]).toEqual(heard[0]);
    expect(heard[2]).toEqual(heard[0]);
    for (const list of events.slice(1))
      list.forEach((e, i) =>
        expect(Math.abs(e.peakDb - events[0]![i]!.peakDb)).toBeLessThanOrEqual(1),
      );
    const { analysis, textPath } = reads[0]!;
    expect(analysis.music!.segments.map((m) => Math.round(m.start * 10) / 10)).toEqual([6]);
    const text = readFileSync(textPath, "utf8");
    expect(text).toMatch(/pause    7\.1 s; during it: 5 effects \(.+\), music 6\.0–9\.0/);
    expect(text).toMatch(/peak -\d+ dBFS, out of silence/);
    const [, under] = analysis.voice!.sentences;
    expect(under!.againstMusic).toEqual({
      voiceLufs: expect.any(Number),
      musicLufs: expect.any(Number),
    });
    expect(text).toMatch(/voice -\d+ LUFS, music -\d+ LUFS: voice \d+ dB over music/);
  });

  it("keeps audio on the machine by default, and reads neither voice nor effects from a bare mix", async () => {
    const path = wav("local.wav", 3, voiced);
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    const callsBefore = stemCalls;
    const { analysis } = await readAudio(path, "local.wav", { cacheDir: join(dir, "cache-local") });
    expect(analysis).toMatchObject({ separation: "mix", voice: null, effects: null });
    expect(analysis.warnings[0]).toContain("quality local keeps audio on this machine");
    expect(analysis.warnings[0]).toContain("--quality best");
    expect(stemCalls).toBe(callsBefore);
    expect(analysis.warnings[1]).toContain("no transcript and no stems");
  });
});
