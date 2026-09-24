import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesizeGemini, GEMINI_TTS_MODEL } from "./gemini-tts.mjs";
import { pickProvider, resolveVoiceId, synthesizeOne } from "./tts.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "gemini-tts-"));
  const saved = { ...process.env };
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GCS_CREDS;
  t.after(() => {
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  });
  const wav = Buffer.alloc(48);
  wav.write("RIFF");
  wav.writeUInt32LE(40, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(4, 40);
  const audio = { type: "audio", mime_type: "audio/wav", data: wav.toString("base64") };
  const payload = { status: "completed", steps: [{ type: "model_output", content: [audio] }] };
  return {
    wav,
    audio,
    payload,
    args: { text: "Hello there.", voiceId: "Kore", wavAbs: join(dir, "voice", "one.wav") },
  };
}

test("Gemini preserves verbatim text, directs style separately, saves WAV and requests transcription", async (t) => {
  const { wav, payload, args } = fixture(t);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    assert.equal(options.headers["x-goog-api-key"], "test-gemini-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, GEMINI_TTS_MODEL);
    assert.equal(body.store, false);
    assert.deepEqual(body.input[0].content, [
      {
        type: "text",
        text: args.text,
        annotations: [{ type: "speech_metadata", style: "Warm and calm" }],
      },
    ]);
    assert.deepEqual(body.generation_config.speech_config, [{ voice: "Kore" }]);
    assert.equal(body.response_format.mime_type, "audio/wav");
    return Response.json(payload);
  });
  const result = await synthesizeOne({ ...args, provider: "gemini", style: "Warm and calm" });
  assert.deepEqual(result, { ok: true, words: null });
  assert.deepEqual(readFileSync(args.wavAbs), wav);
});

test("Flash-Lite and GOOGLE_API_KEY work without a Gemini key", async (t) => {
  const { payload, args } = fixture(t);
  delete process.env.GEMINI_API_KEY;
  process.env.GOOGLE_API_KEY = "test-google-key";
  assert.equal(pickProvider("gemini"), "gemini");
  assert.equal(await resolveVoiceId({ provider: "gemini" }), "Kore");
  const result = await synthesizeGemini(
    { ...args, model: "gemini-3.8-flash-lite-tts" },
    {
      fetchImpl: async (_, options) => {
        assert.equal(options.headers["x-goog-api-key"], "test-google-key");
        const body = JSON.parse(options.body);
        assert.equal(body.model, "gemini-3.8-flash-lite-tts");
        assert.equal(body.input[0].content[0].annotations, undefined);
        return Response.json(payload);
      },
    },
  );
  assert.equal(result.ok, true);
});

test("Gemini remains opt-in even with a key and preserves explicitly chosen voices", async (t) => {
  fixture(t);
  assert.notEqual(pickProvider(), "gemini");
  assert.equal(
    await resolveVoiceId({ provider: "gemini", userVoice: "voice_custom" }),
    "voice_custom",
  );
  delete process.env.GEMINI_API_KEY;
  assert.throws(() => pickProvider("gemini"), /GEMINI_API_KEY or GOOGLE_API_KEY/);
});

test("invalid config fails before spending a generation request", async (t) => {
  const { args } = fixture(t);
  const deps = { fetchImpl: () => assert.fail("must not call the API") };
  for (const change of [{ model: "gemini-2.5-flash" }, { speed: 1.2 }]) {
    const result = await synthesizeGemini({ ...args, ...change }, deps);
    assert.equal(result.ok, false);
    assert.ok(result.error);
  }
  delete process.env.GEMINI_API_KEY;
  assert.match((await synthesizeGemini(args, deps)).error, /needs GEMINI_API_KEY/);
  assert.equal(existsSync(args.wavAbs), false);
});

test("HTTP and network failures stay actionable without leaking the key", async (t) => {
  const { args } = fixture(t);
  const result = await synthesizeGemini(args, {
    fetchImpl: async () => new Response("quota exceeded test-gemini-key", { status: 429 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 429: quota exceeded/);
  assert.ok(!result.error.includes("test-gemini-key"));
  const timeout = await synthesizeGemini(args, {
    fetchImpl: async () => {
      throw new Error("timed out");
    },
  });
  assert.match(timeout.error, /timed out/);
  assert.equal(existsSync(args.wavAbs), false);
});

test("incomplete, missing, raw PCM and malformed audio cannot become a successful WAV", async (t) => {
  const { args, payload, audio } = fixture(t);
  const cases = [
    { ...payload, status: "incomplete" },
    { status: "completed", steps: [] },
    ...[{ ...audio, mime_type: "audio/l16" }, { ...audio, data: "not audio" }, audio].map(
      (part, i) => ({
        status: "completed",
        steps: [{ type: "model_output", content: i === 2 ? [part, part] : [part] }],
      }),
    ),
  ];
  for (const body of cases) {
    const result = await synthesizeGemini(args, { fetchImpl: async () => Response.json(body) });
    assert.equal(result.ok, false);
    assert.equal(existsSync(args.wavAbs), false);
  }
});

for (const model of [
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-pro-preview-tts",
  "gemini-2.5-flash-preview-tts",
]) {
  test(`${model} uses legacy delivery prompts and wraps PCM as mono WAV`, async (t) => {
    const { args, wav } = fixture(t);
    const pcm = wav.subarray(44);
    const result = await synthesizeGemini(
      { ...args, model, style: "Warm and clear" },
      {
        fetchImpl: async (_, options) => {
          const body = JSON.parse(options.body);
          assert.deepEqual(body.response_format, { type: "audio" });
          assert.equal(body.input[0].content[0].annotations, undefined);
          assert.ok(body.input[0].content[0].text.endsWith(args.text));
          assert.ok(body.input[0].content[0].text.includes("Warm and clear"));
          return Response.json({
            status: "completed",
            steps: [
              {
                type: "model_output",
                content: [
                  {
                    type: "audio",
                    mime_type: "audio/L16;codec=pcm;rate=24000",
                    data: pcm.toString("base64"),
                  },
                ],
              },
            ],
          });
        },
      },
    );
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(readFileSync(args.wavAbs), wav);
  });
}

test("service-account bearer and quota project reach synthesis, and token errors are redacted", async (t) => {
  const { args, payload } = fixture(t);
  const authenticate = () => ({
    headers: { Authorization: "Bearer secret-token", "x-goog-user-project": "test-project" },
    secret: "secret-token",
  });
  const ok = await synthesizeGemini(args, {
    authenticate,
    fetchImpl: async (_, options) => {
      assert.equal(options.headers.Authorization, "Bearer secret-token");
      assert.equal(options.headers["x-goog-user-project"], "test-project");
      assert.equal(options.headers["x-goog-api-key"], undefined);
      return Response.json(payload);
    },
  });
  assert.equal(ok.ok, true);
  const failed = await synthesizeGemini(args, {
    authenticate,
    fetchImpl: async () => new Response("denied secret-token", { status: 403 }),
  });
  assert.match(failed.error, /HTTP 403/);
  assert.ok(!failed.error.includes("secret-token"));
});

test("older models reject unsupported PCM and custom voices", async (t) => {
  const { args } = fixture(t);
  for (const mime of [
    "audio/l16",
    "audio/l16;rate=0",
    "audio/l16;rate=24000;channels=2",
    "audio/l16;rate=24000;codec=other",
  ]) {
    const result = await synthesizeGemini(
      { ...args, model: "gemini-3.1-flash-tts-preview" },
      {
        fetchImpl: async () =>
          Response.json({
            status: "completed",
            steps: [
              {
                type: "model_output",
                content: [{ type: "audio", mime_type: mime, data: "AAAAAA==" }],
              },
            ],
          }),
      },
    );
    assert.equal(result.ok, false);
    assert.equal(existsSync(args.wavAbs), false);
  }
  const result = await synthesizeGemini(
    { ...args, model: "gemini-2.5-pro-preview-tts", voiceId: "voice_custom" },
    { fetchImpl: () => assert.fail("must not generate") },
  );
  assert.match(result.error, /Custom Gemini voices require/);
});
