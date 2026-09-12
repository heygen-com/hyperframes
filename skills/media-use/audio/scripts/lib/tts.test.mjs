import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  parseFfmpegDurationBanner,
  ffprobeDuration,
  synthesizeOne,
  synthesizeHeygen,
  synthesizeChatterbox,
  chatterboxAvailable,
  chatterboxBaseUrl,
  pickProvider,
  synthResult,
} from "./tts.mjs";

test("parseFfmpegDurationBanner reads ffmpeg's stderr Duration line", () => {
  const stderr = [
    "ffmpeg version 6.0",
    "Input #0, wav, from 'a.wav':",
    "  Duration: 00:00:03.42, bitrate: 705 kb/s",
    "At least one output file must be specified",
  ].join("\n");
  assert.equal(parseFfmpegDurationBanner(stderr), 3.42);
});

test("parseFfmpegDurationBanner handles an hours component", () => {
  const stderr = "  Duration: 01:02:03.50, start: 0.000000, bitrate: 128 kb/s";
  assert.equal(parseFfmpegDurationBanner(stderr), 3723.5);
});

test("parseFfmpegDurationBanner returns NaN when there is no Duration line", () => {
  assert.ok(Number.isNaN(parseFfmpegDurationBanner("ffmpeg: command not found")));
  assert.ok(Number.isNaN(parseFfmpegDurationBanner("")));
  assert.ok(Number.isNaN(parseFfmpegDurationBanner(undefined)));
});

// Regression for the actual bug: ffprobeDuration used to collapse "ffprobe
// binary is missing" (ENOENT — the "essentials"-style Windows ffmpeg build
// with no ffprobe.exe) and "file is genuinely unreadable" into the same NaN,
// giving audio.mjs no way to tell "measure differently" from "give up".
//
// Builds an isolated PATH containing only a fake `ffmpeg` stub (no `ffprobe`
// at all) so ffprobeDuration's spawnSync("ffprobe", ...) call ENOENTs for
// real, then verifies it recovers the duration via the ffmpeg fallback
// instead of returning NaN.
test("ffprobeDuration falls back to ffmpeg when the ffprobe binary itself is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-ffprobe-fallback-"));
  const fakeFfmpeg = join(dir, "ffmpeg");
  writeFileSync(
    fakeFfmpeg,
    "#!/bin/sh\necho 'Duration: 00:00:02.50, start: 0.000000, bitrate: 128 kb/s' 1>&2\nexit 1\n",
  );
  chmodSync(fakeFfmpeg, 0o755);
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = dir; // only the fake ffmpeg resolves; no real ffprobe on this PATH
    assert.equal(ffprobeDuration("/does/not/matter.wav"), 2.5);
  } finally {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ffprobeDuration returns NaN when neither ffprobe nor ffmpeg resolve", () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-no-binaries-"));
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = dir; // empty directory — nothing resolves
    assert.ok(Number.isNaN(ffprobeDuration("/does/not/matter.wav")));
  } finally {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthesizeOne(elevenlabs) creates the output dir before writing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-el-mkdir-"));
  const wavAbs = join(dir, "assets", "voice", "line-0.wav"); // nested, not yet created
  const savedKey = process.env.ELEVENLABS_API_KEY;
  try {
    // Unset the key so the Python side fails fast — the mkdir must run before
    // the spawn regardless, which is what this guards.
    delete process.env.ELEVENLABS_API_KEY;
    await synthesizeOne({
      provider: "elevenlabs",
      text: "hi",
      voiceId: "v",
      wavAbs,
      hyperframesDir: dir,
    });
    assert.ok(existsSync(dirname(wavAbs)), "output directory should be created");
  } finally {
    if (savedKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = savedKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthesizeHeygen surfaces a thrown HTTP error (e.g. 402) instead of swallowing it", async () => {
  const res = await synthesizeHeygen(
    { text: "hi", voiceId: "v1", lang: "en", speed: 1, wavAbs: "/tmp/x.wav" },
    {
      heygenAuthHeaders: () => ({}),
      heygenJSON: async () => {
        throw new Error("HeyGen POST /voices/speech → HTTP 402\nplan_upgrade_required");
      },
    },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /402/);
  assert.match(res.error, /plan_upgrade_required/);
});

test("synthesizeHeygen surfaces a failed audio_url fetch with its status", async () => {
  const res = await synthesizeHeygen(
    { text: "hi", voiceId: "v1", lang: "en", speed: 1, wavAbs: "/tmp/x.wav" },
    {
      heygenAuthHeaders: () => ({}),
      heygenJSON: async () => ({ data: { audio_url: "http://audio.example/x" } }),
      fetch: async () => ({ ok: false, status: 403 }),
    },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /HTTP 403/);
});

test("synthesizeHeygen reports a missing audio_url", async () => {
  const res = await synthesizeHeygen(
    { text: "hi", voiceId: "v1", lang: "en", speed: 1, wavAbs: "/tmp/x.wav" },
    { heygenAuthHeaders: () => ({}), heygenJSON: async () => ({}) },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /no audio_url/);
});

test("synthesizeHeygen reports wav transcode failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-tts-test-"));
  try {
    const res = await synthesizeHeygen(
      { text: "hi", voiceId: "v1", lang: "en", speed: 1, wavAbs: join(dir, "voice.wav") },
      {
        heygenAuthHeaders: () => ({}),
        heygenJSON: async () => ({ data: { audio_url: "http://audio.example/x" } }),
        fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }),
        transcodeToWav: () => false,
      },
    );
    assert.equal(res.ok, false);
    assert.equal(res.error, "wav transcode failed (ffmpeg)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthResult names a non-zero subprocess exit", () => {
  const res = synthResult({ status: 2 }, "/tmp/none.wav", "kokoro (npx hyperframes tts)");
  assert.equal(res.ok, false);
  assert.match(res.error, /kokoro .* exited with status 2/);
});

test("chatterboxBaseUrl defaults to the local server, trims a trailing slash from the override", () => {
  const saved = process.env.CHATTERBOX_BASE_URL;
  try {
    delete process.env.CHATTERBOX_BASE_URL;
    assert.equal(chatterboxBaseUrl(), "http://127.0.0.1:4123/v1");
    process.env.CHATTERBOX_BASE_URL = "http://example.internal:9000/v1/";
    assert.equal(chatterboxBaseUrl(), "http://example.internal:9000/v1");
  } finally {
    if (saved === undefined) delete process.env.CHATTERBOX_BASE_URL;
    else process.env.CHATTERBOX_BASE_URL = saved;
  }
});

test("chatterboxAvailable is false on a connection failure (no server running)", async () => {
  const saved = process.env.CHATTERBOX_BASE_URL;
  try {
    // Port 1 is reserved and nothing will ever answer on it — a fast, reliable "down" server.
    process.env.CHATTERBOX_BASE_URL = "http://127.0.0.1:1/v1";
    assert.equal(await chatterboxAvailable(), false);
  } finally {
    if (saved === undefined) delete process.env.CHATTERBOX_BASE_URL;
    else process.env.CHATTERBOX_BASE_URL = saved;
  }
});

test("pickProvider(chatterbox) rejects when no server is reachable", async () => {
  const saved = process.env.CHATTERBOX_BASE_URL;
  try {
    process.env.CHATTERBOX_BASE_URL = "http://127.0.0.1:1/v1";
    await assert.rejects(() => pickProvider("chatterbox"), /no healthy server/);
  } finally {
    if (saved === undefined) delete process.env.CHATTERBOX_BASE_URL;
    else process.env.CHATTERBOX_BASE_URL = saved;
  }
});

test("pickProvider rejects an unknown provider name, listing chatterbox in the valid set", async () => {
  await assert.rejects(() => pickProvider("bogus"), /heygen \| chatterbox \| elevenlabs \| kokoro/);
});

test("synthesizeChatterbox creates the output dir and writes the response bytes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-chatterbox-mkdir-"));
  try {
    const wavAbs = join(dir, "assets", "voice", "line-0.wav"); // nested, not yet created
    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    const res = await synthesizeChatterbox(
      { text: "hi", speed: 1, wavAbs },
      {
        fetch: async () => ({
          ok: true,
          status: 200,
          arrayBuffer: async () => fakeBytes.buffer,
        }),
      },
    );
    assert.equal(res.ok, true);
    assert.equal(res.words, null);
    assert.ok(existsSync(wavAbs), "wav file should be written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthesizeChatterbox surfaces a non-200 response with its status and body", async () => {
  const res = await synthesizeChatterbox(
    { text: "hi", speed: 1, wavAbs: "/tmp/does-not-matter.wav" },
    {
      fetch: async () => ({
        ok: false,
        status: 503,
        text: async () => "model not loaded",
      }),
    },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /HTTP 503/);
  assert.match(res.error, /model not loaded/);
});

test("synthesizeChatterbox surfaces a thrown network error", async () => {
  const res = await synthesizeChatterbox(
    { text: "hi", speed: 1, wavAbs: "/tmp/does-not-matter.wav" },
    {
      fetch: async () => {
        throw new Error("fetch failed: ECONNREFUSED");
      },
    },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /ECONNREFUSED/);
});
