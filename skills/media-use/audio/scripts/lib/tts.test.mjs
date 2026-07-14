import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  parseFfmpegDurationBanner,
  cartesiaAvailable,
  ffprobeDuration,
  pickProvider,
  resolveVoiceId,
  synthesizeOne,
  synthesizeHeygen,
  synthResult,
} from "./tts.mjs";

const CARTESIA_SKYLAR_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

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

test("pickProvider preserves explicit existing provider choices", () => {
  assert.equal(pickProvider("kokoro"), "kokoro");
});

test("cartesiaAvailable skips the SDK probe when CARTESIA_API_KEY is missing", () => {
  const savedKey = process.env.CARTESIA_API_KEY;
  let probeCount = 0;
  try {
    delete process.env.CARTESIA_API_KEY;
    assert.equal(
      cartesiaAvailable(
        () => {
          probeCount += 1;
          return { status: 0 };
        },
        () => {
          throw new Error("Python invocation must not resolve without a key");
        },
      ),
      false,
    );
    assert.equal(probeCount, 0);
  } finally {
    restoreEnv("CARTESIA_API_KEY", savedKey);
  }
});

test("cartesiaAvailable requires a successful import cartesia probe", () => {
  const savedKey = process.env.CARTESIA_API_KEY;
  const captured = [];
  try {
    process.env.CARTESIA_API_KEY = "test-cartesia-key";
    const invokePython = (args) => ({ cmd: "fake-python", args: ["-3", ...args] });
    const failed = cartesiaAvailable((cmd, args, opts) => {
      captured.push({ cmd, args, opts });
      return { status: 1 };
    }, invokePython);
    const succeeded = cartesiaAvailable((cmd, args, opts) => {
      captured.push({ cmd, args, opts });
      return { status: 0 };
    }, invokePython);
    assert.equal(failed, false);
    assert.equal(succeeded, true);
    assert.deepEqual(captured, [
      {
        cmd: "fake-python",
        args: ["-3", "-c", "import cartesia"],
        opts: { stdio: "ignore" },
      },
      {
        cmd: "fake-python",
        args: ["-3", "-c", "import cartesia"],
        opts: { stdio: "ignore" },
      },
    ]);
  } finally {
    restoreEnv("CARTESIA_API_KEY", savedKey);
  }
});

test("pickProvider chooses HeyGen before ElevenLabs, Cartesia, and Kokoro", () => {
  assert.equal(
    pickProvider(undefined, {
      heygenAvailable: () => true,
      elevenlabsAvailable: () => true,
      cartesiaAvailable: () => true,
    }),
    "heygen",
  );
});

test("pickProvider chooses ElevenLabs before Cartesia and Kokoro", () => {
  assert.equal(
    pickProvider(undefined, {
      heygenAvailable: () => false,
      elevenlabsAvailable: () => true,
      cartesiaAvailable: () => true,
    }),
    "elevenlabs",
  );
});

test("pickProvider chooses Cartesia before Kokoro", () => {
  assert.equal(
    pickProvider(undefined, {
      heygenAvailable: () => false,
      elevenlabsAvailable: () => false,
      cartesiaAvailable: () => true,
    }),
    "cartesia",
  );
});

test("pickProvider falls back to Kokoro when no cloud provider is available", () => {
  assert.equal(
    pickProvider(undefined, {
      heygenAvailable: () => false,
      elevenlabsAvailable: () => false,
      cartesiaAvailable: () => false,
    }),
    "kokoro",
  );
});

test("pickProvider rejects forced Cartesia when CARTESIA_API_KEY is missing", () => {
  const savedKey = process.env.CARTESIA_API_KEY;
  try {
    delete process.env.CARTESIA_API_KEY;
    assert.throws(
      () => pickProvider("cartesia"),
      /provider=cartesia but \$CARTESIA_API_KEY is not set/,
    );
  } finally {
    restoreEnv("CARTESIA_API_KEY", savedKey);
  }
});

test("pickProvider honors forced Cartesia with a key without probing SDK importability", () => {
  const savedKey = process.env.CARTESIA_API_KEY;
  try {
    process.env.CARTESIA_API_KEY = "test-cartesia-key";
    assert.equal(
      pickProvider("cartesia", {
        cartesiaAvailable: () => {
          throw new Error("forced selection must not probe the SDK");
        },
      }),
      "cartesia",
    );
  } finally {
    restoreEnv("CARTESIA_API_KEY", savedKey);
  }
});

test("resolveVoiceId preserves existing ElevenLabs and Kokoro defaults", async () => {
  assert.equal(
    await resolveVoiceId({ provider: "elevenlabs", userVoice: null, lang: "en" }),
    "21m00Tcm4TlvDq8ikWAM",
  );
  assert.equal(
    await resolveVoiceId({ provider: "kokoro", userVoice: null, lang: "en" }),
    "am_michael",
  );
});

test("resolveVoiceId uses Skylar for Cartesia by default", async () => {
  assert.equal(
    await resolveVoiceId({ provider: "cartesia", userVoice: null, lang: "en-US" }),
    CARTESIA_SKYLAR_VOICE_ID,
  );
});

test("resolveVoiceId preserves an explicit Cartesia voice", async () => {
  assert.equal(
    await resolveVoiceId({ provider: "cartesia", userVoice: "custom-cartesia-voice", lang: "en" }),
    "custom-cartesia-voice",
  );
});

test("synthesizeOne(Cartesia) invokes the SDK contract and writes a non-empty WAV", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-cartesia-success-"));
  const wavAbs = join(dir, "assets", "voice", "line-0.wav");
  const argsPath = join(dir, "cartesia-args.json");
  const fakePython = join(dir, "fake-python.mjs");
  const savedKey = process.env.CARTESIA_API_KEY;
  const savedArgsPath = process.env.CARTESIA_FAKE_ARGS_PATH;
  const savedPath = process.env.PATH;
  try {
    process.env.CARTESIA_API_KEY = "test-cartesia-key";
    process.env.CARTESIA_FAKE_ARGS_PATH = argsPath;
    process.env.PATH = dir;
    writeFileSync(
      fakePython,
      [
        'import { writeFileSync } from "node:fs";',
        "const args = process.argv.slice(2);",
        "writeFileSync(process.env.CARTESIA_FAKE_ARGS_PATH, JSON.stringify(args));",
        "const wavAbs = args.at(-1);",
        'writeFileSync(wavAbs, Buffer.from("RIFFcartesia-test-wav"));',
      ].join("\n"),
    );

    const result = await synthesizeOne(
      {
        provider: "cartesia",
        text: "Hello from Cartesia",
        voiceId: CARTESIA_SKYLAR_VOICE_ID,
        lang: "pt-BR",
        speed: 1.25,
        wavAbs,
        hyperframesDir: dir,
      },
      {
        cartesia: {
          pythonInvocation: (args) => ({ cmd: process.execPath, args: [fakePython, ...args] }),
        },
      },
    );

    assert.deepEqual(result, { ok: true, words: null });
    assert.ok(readFileSync(wavAbs).length > 0);
    const invokedArgs = JSON.parse(readFileSync(argsPath, "utf8"));
    assert.equal(invokedArgs[0], "-c");
    assert.match(invokedArgs[1], /Cartesia/);
    assert.equal(invokedArgs[3], "2026-03-01");
    assert.equal(invokedArgs[4], "sonic-3.5");
    assert.equal(invokedArgs[5], CARTESIA_SKYLAR_VOICE_ID);
    assert.equal(invokedArgs[6], "pt");
    assert.equal(invokedArgs[7], "wav");
    assert.equal(invokedArgs[8], "pcm_s16le");
    assert.equal(invokedArgs[9], "44100");
    assert.equal(invokedArgs[10], "1.25");
    assert.equal(invokedArgs[11], wavAbs);
    assert.ok(invokedArgs.every((arg) => !String(arg).includes(process.env.CARTESIA_API_KEY)));
  } finally {
    restoreEnv("CARTESIA_API_KEY", savedKey);
    restoreEnv("CARTESIA_FAKE_ARGS_PATH", savedArgsPath);
    restoreEnv("PATH", savedPath);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthesizeOne(Cartesia) reports a named non-zero Python exit without fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-cartesia-exit-"));
  let spawnCount = 0;
  try {
    const result = await synthesizeOne(
      {
        provider: "cartesia",
        text: "failure",
        voiceId: CARTESIA_SKYLAR_VOICE_ID,
        lang: "fr-FR",
        speed: 1,
        wavAbs: join(dir, "voice.wav"),
        hyperframesDir: dir,
      },
      {
        cartesia: {
          pythonInvocation: (args) => ({ cmd: "fake-python", args }),
          spawnP: async () => {
            spawnCount += 1;
            return { status: 7 };
          },
        },
      },
    );
    assert.deepEqual(result, {
      ok: false,
      words: null,
      error: "cartesia (python) exited with status 7",
    });
    assert.equal(spawnCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthesizeOne(Cartesia) reports missing SDK output without fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-cartesia-output-"));
  let spawnCount = 0;
  try {
    const result = await synthesizeOne(
      {
        provider: "cartesia",
        text: "missing output",
        voiceId: CARTESIA_SKYLAR_VOICE_ID,
        lang: "en-US",
        speed: 1,
        wavAbs: join(dir, "voice.wav"),
        hyperframesDir: dir,
      },
      {
        cartesia: {
          pythonInvocation: (args) => ({ cmd: "fake-python", args }),
          spawnP: async () => {
            spawnCount += 1;
            return { status: 0 };
          },
        },
      },
    );
    assert.deepEqual(result, {
      ok: false,
      words: null,
      error: "cartesia (python) produced no wav file",
    });
    assert.equal(spawnCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthesizeOne(Cartesia) reports output directory creation failure without spawning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-cartesia-mkdir-"));
  let spawnCount = 0;
  try {
    const result = await synthesizeOne(
      {
        provider: "cartesia",
        text: "directory failure",
        voiceId: CARTESIA_SKYLAR_VOICE_ID,
        lang: "en-US",
        speed: 1,
        wavAbs: join(dir, "voice", "line-0.wav"),
        hyperframesDir: dir,
      },
      {
        cartesia: {
          mkdirSync: () => {
            throw new Error("read-only filesystem");
          },
          pythonInvocation: (args) => ({ cmd: "fake-python", args }),
          spawnP: async () => {
            spawnCount += 1;
            return { status: 0 };
          },
        },
      },
    );

    assert.deepEqual(result, {
      ok: false,
      words: null,
      error: "cartesia (python): failed to create output directory (read-only filesystem)",
    });
    assert.equal(spawnCount, 0);
  } finally {
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
