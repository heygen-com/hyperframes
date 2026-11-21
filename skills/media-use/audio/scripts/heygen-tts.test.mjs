import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./heygen-tts.mjs", import.meta.url));
// Every fetch answers as HeyGen does for a voice that no longer exists.
const refusing = `data:text/javascript,globalThis.fetch = async () => new Response(${JSON.stringify(
  JSON.stringify({ error: { code: "voice_not_found", message: "Voice not found: vc_gone" } }),
)}, { status: 404, headers: { "content-type": "application/json" } });`;

test("a refused speech prints HeyGen's own message, so a caller can act on it", () => {
  const dir = mkdtempSync(join(tmpdir(), "heygen-tts-"));
  const run = spawnSync(
    process.execPath,
    ["--import", refusing, script, "Hello", "--voice", "vc_gone", "-o", join(dir, "out.mp3")],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        HEYGEN_API_KEY: "",
        HYPERFRAMES_API_KEY: "",
        HEYGEN_ACCESS_TOKEN: "t",
      },
    },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /✗ heygen-tts: Voice not found: vc_gone\n/);
  assert.doesNotMatch(
    run.stderr,
    /HTTP 404|"error"/,
    "HeyGen's message alone, not the raw response",
  );
});

// Speech with one timed word; the audio itself is the file named by $TTS_AUDIO.
const speaking = `data:text/javascript,import { readFileSync } from "node:fs";
globalThis.fetch = async (url) => String(url).endsWith("/voices/speech")
  ? new Response(JSON.stringify({ data: { audio_url: "https://audio.example/a",
      word_timestamps: [{ word: "Hello", start: 0, end: 0.4 }] } }),
      { headers: { "content-type": "application/json" } })
  : new Response(readFileSync(process.env.TTS_AUDIO));`;

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const canLink = (() => {
  const dir = mkdtempSync(join(tmpdir(), "heygen-tts-link-"));
  try {
    symlinkSync(join(dir, "nowhere"), join(dir, "link"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

function speak(dir, args, audio) {
  return spawnSync(process.execPath, ["--import", speaking, script, "Hello", ...args], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      HEYGEN_API_KEY: "",
      HYPERFRAMES_API_KEY: "",
      HEYGEN_ACCESS_TOKEN: "t",
      TTS_AUDIO: audio,
    },
  });
}

test(
  "a link at the wav and words outputs is replaced, and the files it points at are kept",
  { skip: !canLink || !hasFfmpeg },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-tts-"));
    const outside = mkdtempSync(join(tmpdir(), "heygen-tts-outside-"));
    try {
      const audio = join(outside, "speech.wav");
      spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=0.5", audio]);
      const wavTarget = join(outside, "wav-target");
      const wordsTarget = join(outside, "words-target");
      writeFileSync(wavTarget, "keep me");
      writeFileSync(wordsTarget, "keep me too");
      symlinkSync(wavTarget, join(dir, "narration.wav"));
      symlinkSync(wordsTarget, join(dir, "words.json"));
      const run = speak(dir, ["--voice", "v1", "--words", "words.json"], audio);
      assert.equal(run.status, 0, run.stderr);
      assert.equal(readFileSync(wavTarget, "utf8"), "keep me");
      assert.equal(readFileSync(wordsTarget, "utf8"), "keep me too");
      assert.ok(lstatSync(join(dir, "narration.wav")).isFile());
      assert.ok(lstatSync(join(dir, "words.json")).isFile());
      assert.equal(JSON.parse(readFileSync(join(dir, "words.json"), "utf8"))[0].text, "Hello");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  },
);

test(
  "a dangling link at the mp3 and words outputs creates nothing where it points",
  { skip: !canLink },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-tts-"));
    const outside = mkdtempSync(join(tmpdir(), "heygen-tts-outside-"));
    try {
      const audio = join(outside, "speech.mp3");
      writeFileSync(audio, "mp3 bytes");
      symlinkSync(join(outside, "made.mp3"), join(dir, "narration.mp3"));
      symlinkSync(join(outside, "made.json"), join(dir, "words.json"));
      const run = speak(
        dir,
        ["--voice", "v1", "-o", "narration.mp3", "--words", "words.json"],
        audio,
      );
      assert.equal(run.status, 0, run.stderr);
      assert.equal(existsSync(join(outside, "made.mp3")), false);
      assert.equal(existsSync(join(outside, "made.json")), false);
      assert.equal(readFileSync(join(dir, "narration.mp3"), "utf8"), "mp3 bytes");
      assert.ok(lstatSync(join(dir, "words.json")).isFile());
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  },
);
