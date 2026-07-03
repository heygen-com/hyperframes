import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFfmpegDurationBanner, ffprobeDuration, synthesizeOne } from "./tts.mjs";

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

// Regression: synthesizeHeygen used to collapse every failure (a real HTTP
// error from HeyGen, a missing audio_url, a failed transcode) into a bare
// { ok: false }, so callers could never tell a 402 plan-upgrade response
// from a transient 500 or a local ffmpeg problem. heygenJSON already throws
// a message carrying the HTTP status and response body — the fix is just to
// stop swallowing it. Exercised via the real synthesizeOne() -> heygenJSON()
// -> global fetch() path (heygenJSON has no seam to mock other than fetch
// itself, which is a real global here, not a per-module import).
test("synthesizeOne surfaces the real HeyGen HTTP error instead of a bare ok:false", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heygen-tts-error-"));
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.HEYGEN_API_KEY;
  try {
    process.env.HEYGEN_API_KEY = "fake-key-for-test";
    globalThis.fetch = async () => ({
      ok: false,
      status: 402,
      text: async () => JSON.stringify({ error: "plan_upgrade_required" }),
    });

    const result = await synthesizeOne({
      provider: "heygen",
      text: "hello",
      voiceId: "some-voice",
      wavAbs: join(dir, "out.wav"),
      hyperframesDir: dir,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /HTTP 402/);
    assert.match(result.error, /plan_upgrade_required/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.HEYGEN_API_KEY;
    else process.env.HEYGEN_API_KEY = originalApiKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthesizeOne reports a missing audio_url distinctly from an HTTP error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heygen-tts-no-url-"));
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.HEYGEN_API_KEY;
  try {
    process.env.HEYGEN_API_KEY = "fake-key-for-test";
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    });

    const result = await synthesizeOne({
      provider: "heygen",
      text: "hello",
      voiceId: "some-voice",
      wavAbs: join(dir, "out.wav"),
      hyperframesDir: dir,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /no audio_url/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.HEYGEN_API_KEY;
    else process.env.HEYGEN_API_KEY = originalApiKey;
    rmSync(dir, { recursive: true, force: true });
  }
});
