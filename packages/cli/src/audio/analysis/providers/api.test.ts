import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  rhythm,
  signalProvider,
  type AudioSignal,
  type AudioCapability,
} from "@hyperframes/core/audio-analysis";
import { analyzeSignal } from "../analyze.js";
import { apiProvider, type AudioApiRequest, type AudioApiResponse } from "./api.js";

const RATE = 22_050;
const UPLOAD_RATE = 16_000;

/** Clicks every half second from 0.25 s: a grid the signal tracker finds. */
function clicks(seconds: number): AudioSignal {
  const samples = new Float32Array(seconds * RATE);
  let state = 7;
  for (let t = 0.25; t < seconds; t += 0.5)
    for (let i = 0; i < 0.05 * RATE; i++) {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      samples[Math.round(t * RATE) + i]! +=
        0.5 * ((state / 2_147_483_648) * 2 - 1) * Math.exp(-i / (0.01 * RATE));
    }
  return { sampleRate: RATE, channels: [samples] };
}

interface Received {
  method: string;
  url: string | undefined;
  apiKey: string | undefined;
  authorization: string | undefined;
  idempotencyKey: string | undefined;
  request: AudioApiRequest;
  audio: { type: string; bytes: Uint8Array };
}

let server: Server;
let received: Received[] = [];
let reply: (request: AudioApiRequest) => { status: number; body: unknown } = () => ({
  status: 500,
  body: {},
});
let enveloped = true;
let uploads = 0;
let uploadedBytes = new Uint8Array();

async function readBytes(req: IncomingMessage) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const bytes = await readBytes(req);
    if (req.url === "/v3/assets/direct-uploads") {
      expect(req.headers["x-api-key"]).toBe("test-key");
      expect(req.headers.authorization).toBeUndefined();
      const input = JSON.parse(bytes.toString());
      expect(input).toMatchObject({ filename: "audio.wav", content_type: "audio/wav" });
      uploads++;
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          data: {
            asset_id: "uploaded-audio",
            upload_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/put`,
            upload_headers: { "content-type": "audio/wav" },
          },
        }),
      );
      return;
    }
    if (req.url === "/put") {
      expect(req.method).toBe("PUT");
      expect(req.headers["x-api-key"]).toBeUndefined();
      expect(req.headers.authorization).toBeUndefined();
      expect(req.headers["content-type"]).toBe("audio/wav");
      uploadedBytes = new Uint8Array(bytes);
      res.writeHead(200).end();
      return;
    }
    if (req.url === "/v3/assets/uploaded-audio/complete") {
      expect(req.headers["x-api-key"]).toBe("test-key");
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ data: { asset_id: "uploaded-audio" } }));
      return;
    }
    expect(req.headers["content-type"]).toBe("application/json");
    const form = {
      request: JSON.parse(bytes.toString()) as AudioApiRequest,
      audio: { type: "audio/wav", bytes: uploadedBytes },
    };
    received.push({
      method: req.method!,
      url: req.url,
      apiKey: req.headers["x-api-key"] as string | undefined,
      authorization: req.headers.authorization,
      idempotencyKey: req.headers["idempotency-key"] as string | undefined,
      ...form,
    });
    const { status, body } = reply(form.request);
    const sent = status === 200 && enveloped ? { data: body } : body;
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(sent));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

const serverOrigin = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

beforeEach(() => {
  for (const name of ["HEYGEN_API_KEY", "HYPERFRAMES_API_KEY", "HEYGEN_ACCESS_TOKEN"])
    vi.stubEnv(name, "");
  vi.stubEnv("HEYGEN_API_URL", serverOrigin());
});

afterEach(() => {
  received = [];
  uploads = 0;
  enveloped = true;
  vi.unstubAllEnvs();
  delete process.env.HYPERFRAMES_AUDIO_API_URL;
  delete process.env.HYPERFRAMES_AUDIO_API_KEY;
});

function configure() {
  process.env.HYPERFRAMES_AUDIO_API_URL = `${serverOrigin()}/v1/audio`;
  process.env.HYPERFRAMES_AUDIO_API_KEY = "test-key";
}

describe("apiProvider", () => {
  it("is unavailable without a HeyGen credential", async () => {
    expect(await apiProvider.available!()).toEqual({
      ok: false,
      reason: expect.stringContaining("no HeyGen credential"),
    });
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    expect(await apiProvider.available!()).toEqual({ ok: true });
  });

  it("calls HeyGen's audio analysis route with the CLI's HeyGen API key", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    reply = () => ({ status: 200, body: { version: 1, beats: { times: [0.25, 0.75] } } });
    await apiProvider.analyze("beats", clicks(2), {});
    expect(received.map((r) => [r.url, r.apiKey])).toEqual([["/v3/audio/analysis", "test-key"]]);
  });

  it("stays off when the host blanks HYPERFRAMES_AUDIO_API_URL, whatever HeyGen credential it holds", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "gateway-token");
    process.env.HYPERFRAMES_AUDIO_API_URL = "";
    process.env.HYPERFRAMES_AUDIO_API_KEY = "";
    expect(await apiProvider.available!()).toEqual({
      ok: false,
      reason: "HYPERFRAMES_AUDIO_API_URL is empty, which turns this service off",
    });
  });

  it("never sends the HeyGen credential to a service named by HYPERFRAMES_AUDIO_API_URL", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "heygen-key");
    process.env.HYPERFRAMES_AUDIO_API_URL = "http://127.0.0.1:1/";
    expect(await apiProvider.available!()).toEqual({
      ok: false,
      reason: "HYPERFRAMES_AUDIO_API_URL is set but HYPERFRAMES_AUDIO_API_KEY is not",
    });
    process.env.HYPERFRAMES_AUDIO_API_KEY = "k";
    expect(await apiProvider.available!()).toEqual({ ok: true });
  });

  it("refuses redirects without sending the API key to another origin", async () => {
    const forwarded: string[] = [];
    const destination = createServer((req, res) => {
      forwarded.push(req.headers["x-api-key"]?.toString() ?? "");
      res.writeHead(200).end("{}");
    });
    await new Promise<void>((done) => destination.listen(0, "127.0.0.1", done));
    const address = destination.address();
    if (!address || typeof address === "string") throw new Error("No destination port");
    const redirect = createServer((_req, res) => {
      res.writeHead(307, { location: `http://127.0.0.1:${address.port}/` }).end();
    });
    await new Promise<void>((done) => redirect.listen(0, "127.0.0.1", done));
    try {
      const source = redirect.address();
      if (!source || typeof source === "string") throw new Error("No redirect port");
      process.env.HYPERFRAMES_AUDIO_API_URL = `http://127.0.0.1:${source.port}/`;
      process.env.HYPERFRAMES_AUDIO_API_KEY = "test-key";
      await expect(apiProvider.analyze("beats", clicks(1), {})).rejects.toThrow();
      expect(forwarded).toEqual([]);
    } finally {
      await Promise.all([
        new Promise<void>((done) => redirect.close(() => done())),
        new Promise<void>((done) => destination.close(() => done())),
      ]);
    }
  });

  it("posts the audio and the capabilities, and snaps each answered beat onto the signal's own", async () => {
    configure();
    const signal = clicks(12);
    const measured = rhythm(signal).beats.times;
    // The service is 30 ms late on every beat, and invents one between two real beats.
    const answered = [...measured.map((t) => t + 0.03), 3.5].sort((a, b) => a - b);
    reply = () => ({
      status: 200,
      body: {
        version: 1,
        source: "stand-in",
        time_resolution_seconds: 1 / 32,
        beats: { times: answered },
        downbeats: { times: measured.filter((_, k) => k % 4 === 0).map((t) => t - 0.02), meter: 4 },
      } satisfies AudioApiResponse,
    });
    const analysis = await analyzeSignal(
      signal,
      { quality: "best", capabilities: ["beats", "downbeats", "bpm"] },
      [apiProvider, signalProvider],
    );

    expect(received).toHaveLength(1);
    const [call] = received;
    expect(call).toMatchObject({ method: "POST", apiKey: "test-key", authorization: undefined });
    expect(call!.idempotencyKey).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/,
    );
    expect(call!.request).toEqual({
      version: 1,
      capabilities: ["beats", "downbeats"],
      audio: { type: "asset_id", asset_id: "uploaded-audio" },
    });
    expect(call!.audio.type).toBe("audio/wav");
    expect(Buffer.from(call!.audio.bytes.subarray(0, 4)).toString()).toBe("RIFF");
    expect(call!.audio.bytes.length).toBe(44 + 12 * UPLOAD_RATE * 2);

    expect(analysis.provenance).toEqual({ beats: "api", downbeats: "api", bpm: "api" });
    const beats = analysis.values.beats as { times: number[]; snap: object; source: string };
    expect(beats.times).toEqual([...measured, 3.5].sort((a, b) => a - b));
    expect(beats.source).toBe("stand-in");
    expect(beats.snap).toEqual({
      reference: "signal beats",
      toleranceMs: 125,
      snapped: measured.length,
      unsnapped: [3.5],
      medianShiftMs: 30,
    });
    expect((analysis.values.downbeats as { times: number[] }).times).toEqual(
      measured.filter((_, k) => k % 4 === 0),
    );
    expect((analysis.values.bpm as { value: number }).value).toBeCloseTo(120, 0);
  });

  it.each<{ capabilities: AudioCapability[] }>([
    { capabilities: ["bpm"] },
    { capabilities: ["beats", "bpm"] },
    { capabilities: ["bpm", "beats"] },
  ])("keeps a BPM signal pin local for $capabilities", async ({ capabilities }) => {
    configure();
    reply = () => ({ status: 200, body: { version: 1, beats: { times: [0.5, 1, 1.5] } } });
    const analysis = await analyzeSignal(clicks(8), {
      quality: "best",
      capabilities,
      provider: { bpm: "signal" },
    });
    expect(received).toHaveLength(0);
    expect(analysis.provenance.bpm).toBe("signal");
    expect(analysis.values.bpm).toMatchObject({ value: expect.any(Number) });
    if (capabilities.includes("beats")) expect(analysis.provenance.beats).toBe("signal");
  });

  it.each([
    { beats: "api", bpm: "signal" },
    { beats: "signal", bpm: "api" },
  ])(
    "rejects conflicting beats/BPM pins before any capability uploads audio: %j",
    async (provider) => {
      configure();
      reply = () => ({
        status: 200,
        body: { version: 1, describe: { tags: [] }, beats: { times: [0.5, 1] } },
      });
      await expect(
        analyzeSignal(clicks(8), {
          quality: "best",
          capabilities: ["describe", "beats", "bpm"],
          provider,
        }),
      ).rejects.toThrow("beats and bpm must use the same provider");
      expect(received).toHaveLength(0);
    },
  );

  it("asks for sections and describe on their own, and moves inner section boundaries onto beats", async () => {
    configure();
    const signal = clicks(12);
    const beat = rhythm(signal).beats.times.find((t) => Math.abs(t - 6.25) < 0.05)!;
    reply = () => ({
      status: 200,
      body: {
        version: 1,
        sections: {
          spans: [
            { start: 0, end: 6.3, label: "intro" },
            { start: 6.3, end: 12 },
          ],
        },
        describe: { text: "clicks", tags: [{ label: "click", score: 0.9 }] },
      },
    });
    const analysis = await analyzeSignal(
      signal,
      { quality: "best", capabilities: ["sections", "describe"] },
      [apiProvider, signalProvider],
    );
    expect(received.map((r) => r.request.capabilities)).toEqual([["sections"], ["describe"]]);
    expect(new Set(received.map((r) => r.idempotencyKey)).size).toBe(2);
    expect(uploads).toBe(1);
    expect(received.every((r) => r.request.audio.asset_id === "uploaded-audio")).toBe(true);
    expect(analysis.values.sections).toMatchObject({
      spans: [
        { start: 0, end: beat, label: "intro" },
        { start: beat, end: 12 },
      ],
      snap: { snapped: 2, unsnapped: [] },
    });
    expect(analysis.values.describe).toEqual({
      text: "clicks",
      tags: [{ label: "click", score: 0.9 }],
    });
  });

  it("falls through to signal processing with a warning when the service fails or answers in another shape", async () => {
    configure();
    reply = () => ({ status: 503, body: { error: { message: "busy" } } });
    const failed = await analyzeSignal(clicks(8), { quality: "best", capabilities: ["beats"] }, [
      apiProvider,
      signalProvider,
    ]);
    expect(failed.provenance.beats).toBe("signal");
    expect(failed.warnings).toEqual([
      "beats: used signal; api failed (the service answered 503: busy)",
    ]);

    reply = () => ({ status: 200, body: { version: 1, beats: { times: ["soon"] } } });
    const garbled = await analyzeSignal(clicks(8), { quality: "best", capabilities: ["beats"] }, [
      apiProvider,
      signalProvider,
    ]);
    expect(garbled.provenance.beats).toBe("signal");
    expect(garbled.warnings[0]).toContain("api failed (the service answered beats in a shape");
  });

  it("uploads the channels averaged to one at 16 kHz, with nothing above 8 kHz folded back in", async () => {
    configure();
    const rate = 44_100;
    const tone = (hz: number) =>
      Float32Array.from(
        { length: 2 * rate },
        (_, k) => 0.3 * Math.sin((2 * Math.PI * hz * k) / rate),
      );
    const [low, side, high] = [tone(440), tone(2_000), tone(9_000)];
    const left = low.map((v, k) => v + side[k]! + high[k]!);
    const right = low.map((v, k) => v - side[k]! + high[k]!);
    reply = () => ({ status: 200, body: { version: 1, describe: { tags: [] } } });
    await analyzeSignal(
      { sampleRate: rate, channels: [left, right] },
      { quality: "best", capabilities: ["describe"] },
      [apiProvider],
    );

    const wav = Buffer.from(received[0]!.audio.bytes);
    expect([wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt16LE(34)]).toEqual([
      1,
      UPLOAD_RATE,
      16,
    ]);
    const samples = Array.from(
      { length: (wav.length - 44) / 2 },
      (_, k) => wav.readInt16LE(44 + 2 * k) / 32767,
    );
    const level = (hz: number) => {
      let re = 0;
      let im = 0;
      samples.forEach((v, k) => {
        re += v * Math.cos((2 * Math.PI * hz * k) / UPLOAD_RATE);
        im += v * Math.sin((2 * Math.PI * hz * k) / UPLOAD_RATE);
      });
      return (2 * Math.hypot(re, im)) / samples.length;
    };
    expect(level(440)).toBeCloseTo(0.3, 2);
    expect(level(2_000)).toBeLessThan(0.005);
    expect(level(7_000)).toBeLessThan(0.005);
  });

  it.each([
    { phase: Math.PI, quiet: 1, expected: 0.7 },
    { phase: Math.PI * 0.9, quiet: 1, expected: 0.7 },
    { phase: Math.PI, quiet: 0.8, expected: 0.7 },
    { phase: Math.PI / 2, quiet: 1, expected: 0.7 / Math.sqrt(2) },
    { phase: 0, quiet: 1, expected: 0.7 },
  ])(
    "preserves stereo energy for phase $phase and channel gain $quiet",
    async ({ phase, quiet, expected }) => {
      configure();
      const rate = 44_100;
      const left = Float32Array.from(
        { length: rate },
        (_, k) => 0.7 * quiet * Math.sin((2 * Math.PI * 440 * k) / rate),
      );
      const right = Float32Array.from(
        { length: rate },
        (_, k) => 0.7 * Math.sin((2 * Math.PI * 440 * k) / rate + phase),
      );
      reply = () => ({ status: 200, body: { version: 1, describe: { tags: [] } } });
      await analyzeSignal(
        { sampleRate: rate, channels: [left, right] },
        { quality: "best", capabilities: ["describe"] },
        [apiProvider],
      );
      const wav = Buffer.from(received[0]!.audio.bytes);
      expect(wav.readUInt32LE(24)).toBe(UPLOAD_RATE);
      let energy = 0;
      for (let k = 0; k < UPLOAD_RATE; k++) energy += (wav.readInt16LE(44 + 2 * k) / 32767) ** 2;
      expect(Math.sqrt((2 * energy) / UPLOAD_RATE)).toBeCloseTo(expected, 2);
    },
  );

  it("reads an answer sent without the data envelope too", async () => {
    configure();
    enveloped = false;
    reply = () => ({ status: 200, body: { version: 1, describe: { text: "bare", tags: [] } } });
    const analysis = await analyzeSignal(
      clicks(2),
      { quality: "best", capabilities: ["describe"] },
      [apiProvider],
    );
    expect(analysis.values.describe).toEqual({ text: "bare", tags: [] });
  });

  it("never sends the key anywhere but the x-api-key header", async () => {
    configure();
    reply = () => ({ status: 401, body: { error: { message: "bad key" } } });
    const analysis = await analyzeSignal(
      clicks(8),
      { quality: "best", capabilities: ["describe"] },
      [apiProvider],
    );
    expect(JSON.stringify(analysis)).not.toContain("test-key");
    const [call] = received;
    expect(call).toMatchObject({ apiKey: "test-key", authorization: undefined });
    expect(JSON.stringify(call!.request)).not.toContain("test-key");
  });
});
