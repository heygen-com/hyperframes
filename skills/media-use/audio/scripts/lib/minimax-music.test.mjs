import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MINIMAX_MUSIC_AUDIO_FORMATS,
  MINIMAX_MUSIC_COVER_LIMITS,
  MINIMAX_MUSIC_DEFAULT_MODEL,
  MINIMAX_MUSIC_ENDPOINTS,
  MINIMAX_MUSIC_MODELS,
  MINIMAX_MUSIC_OUTPUT_FORMATS,
  MINIMAX_MUSIC_STREAM_OUTPUT_FORMATS,
  MINIMAX_MUSIC_URL_TTL_HOURS,
  buildMiniMaxMusicRequest,
  generateMiniMaxMusic,
  parseMiniMaxMusicResponse,
  parseMiniMaxMusicStream,
  writeMiniMaxMusic,
} from "./minimax-music.mjs";

test("exports the current endpoints, models, and formats", () => {
  assert.deepEqual(MINIMAX_MUSIC_ENDPOINTS, {
    global_en: "https://api.minimax.io/v1/music_generation",
    cn_zh: "https://api.minimaxi.com/v1/music_generation",
  });
  assert.equal(MINIMAX_MUSIC_DEFAULT_MODEL, "music-3.0");
  assert.deepEqual(MINIMAX_MUSIC_MODELS.generation, [
    "music-3.0",
    "music-2.6",
    "music-3.0-free",
    "music-2.6-free",
  ]);
  assert.deepEqual(MINIMAX_MUSIC_MODELS.cover, ["music-cover", "music-cover-free"]);
  assert.deepEqual(MINIMAX_MUSIC_OUTPUT_FORMATS, ["url", "hex"]);
  assert.deepEqual(MINIMAX_MUSIC_STREAM_OUTPUT_FORMATS, ["hex"]);
  assert.deepEqual(MINIMAX_MUSIC_AUDIO_FORMATS, ["mp3", "wav", "pcm"]);
  assert.equal(MINIMAX_MUSIC_URL_TTL_HOURS, 24);
});

test("builds generation requests with lyrics and China-only watermarking", () => {
  assert.deepEqual(
    buildMiniMaxMusicRequest({
      region: "cn_zh",
      prompt: "Bright cinematic instrumental",
      lyrics: "A new day begins",
      stream: false,
      outputFormat: "url",
      audioFormat: "mp3",
      lyricsOptimizer: true,
      isInstrumental: false,
      aigcWatermark: true,
    }),
    {
      model: "music-3.0",
      prompt: "Bright cinematic instrumental",
      lyrics: "A new day begins",
      stream: false,
      output_format: "url",
      audio_setting: { format: "mp3" },
      lyrics_optimizer: true,
      is_instrumental: false,
      aigc_watermark: true,
    },
  );
});

test("validates music cover inputs and publishes their limits", () => {
  assert.deepEqual(MINIMAX_MUSIC_COVER_LIMITS, {
    inputMinSeconds: 6,
    inputMaxSeconds: 360,
    inputMaxBytes: 50 * 1024 * 1024,
  });
  assert.throws(
    () => buildMiniMaxMusicRequest({ model: "music-cover" }),
    /exactly one of audioUrl or audioBase64/,
  );
  const request = buildMiniMaxMusicRequest({
    model: "music-cover-free",
    audioUrl: "https://media.example.test/source.wav",
    coverFeatureId: "feature-1",
  });
  assert.equal(request.audio_url, "https://media.example.test/source.wav");
  assert.equal(request.cover_feature_id, "feature-1");
  assert.equal(
    buildMiniMaxMusicRequest({
      model: "music-cover",
      audioBase64: Buffer.from("audio").toString("base64"),
    }).audio_base64,
    "YXVkaW8=",
  );
});

test("parses completed JSON responses and rejects API errors", () => {
  assert.deepEqual(
    parseMiniMaxMusicResponse({
      data: { status: 2, audio: "494433" },
      base_resp: { status_code: 0 },
    }),
    { status: 2, audio: "494433", completed: true },
  );
  assert.throws(
    () =>
      parseMiniMaxMusicResponse({
        data: { status: 2 },
        base_resp: { status_code: 1001, status_msg: "invalid request" },
      }),
    /1001: invalid request/,
  );
});

test("combines streaming hex chunks without duplicating the final summary", () => {
  const stream = [
    'data: {"data":{"status":1,"audio":"4944"},"base_resp":{"status_code":0}}',
    'data: {"data":{"status":1,"audio":"33"},"base_resp":{"status_code":0}}',
    'data: {"data":{"status":2,"audio":"494433"},"base_resp":{"status_code":0}}',
    "data: [DONE]",
  ].join("\n");
  assert.deepEqual(parseMiniMaxMusicStream(stream), {
    audio: "494433",
    status: 2,
    completed: true,
  });
});

test("sends bearer authorization and decodes hex audio", async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return new Response(
      JSON.stringify({
        data: { status: 2, audio: "494433" },
        base_resp: { status_code: 0 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const result = await generateMiniMaxMusic({
    apiKey: "test-key",
    fetchImpl,
    prompt: "Instrumental bed",
  });
  assert.equal(request.url, MINIMAX_MUSIC_ENDPOINTS.global_en);
  assert.equal(request.init.headers.Authorization, "Bearer test-key");
  assert.equal(JSON.parse(request.init.body).model, "music-3.0");
  assert.deepEqual(result.audioBytes, Buffer.from("ID3"));
});

test("downloads URL output before writing the music file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "minimax-music-"));
  const outputPath = join(directory, "track.mp3");
  const fetchImpl = async (url) => {
    if (url === MINIMAX_MUSIC_ENDPOINTS.global_en) {
      return new Response(
        JSON.stringify({
          data: { status: 2, audio: "https://media.example.test/track.mp3" },
          base_resp: { status_code: 0 },
        }),
        { status: 200 },
      );
    }
    assert.equal(url, "https://media.example.test/track.mp3");
    return new Response(Buffer.from("music"), { status: 200 });
  };
  try {
    await writeMiniMaxMusic({
      outputPath,
      apiKey: "test-key",
      fetchImpl,
      outputFormat: "url",
      audioFormat: "mp3",
    });
    assert.deepEqual(await readFile(outputPath), Buffer.from("music"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
