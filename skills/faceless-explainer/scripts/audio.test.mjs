import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./audio.mjs", import.meta.url).pathname;

function runAudio({ args = [], env = {}, storyboard = "---\nmessage: Test\n---\n" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "faceless-audio-"));
  const engine = join(dir, "engine.mjs");
  try {
    writeFileSync(join(dir, "STORYBOARD.md"), storyboard);
    writeFileSync(
      engine,
      `import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
const request = JSON.parse(readFileSync(flag("--request"), "utf8"));
writeFileSync(new URL("request.json", import.meta.url), JSON.stringify(request));
writeFileSync(flag("--out"), JSON.stringify({ voices: [], bgm: null, sfx: [] }));
`,
    );
    const result = spawnSync(
      process.execPath,
      [script, "--hyperframes", dir, "--storyboard", join(dir, "STORYBOARD.md"), ...args],
      { encoding: "utf8", env: { ...process.env, HF_MEDIA_ENGINE: engine, ...env } },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("passes --provider to the shared audio engine", () => {
  assert.equal(runAudio({ args: ["--provider", "kokoro"] }).provider, "kokoro");
});

test("uses HF_TTS_PROVIDER when --provider is omitted", () => {
  assert.equal(runAudio({ env: { HF_TTS_PROVIDER: "elevenlabs" } }).provider, "elevenlabs");
});

test("--provider takes precedence over HF_TTS_PROVIDER", () => {
  assert.equal(
    runAudio({ args: ["--provider", "kokoro"], env: { HF_TTS_PROVIDER: "elevenlabs" } }).provider,
    "kokoro",
  );
});

test("passes the storyboard language to multilingual transcription", () => {
  assert.equal(runAudio({ storyboard: "---\nmessage: Test\nlanguage: zh\n---\n" }).lang, "zh");
});

test("--lang takes precedence over the storyboard language", () => {
  assert.equal(
    runAudio({
      args: ["--lang", "ja"],
      storyboard: "---\nmessage: Test\nlanguage: zh\n---\n",
    }).lang,
    "ja",
  );
});

test("fetch-sfx preserves the current voice durations and manually staged BGM", () => {
  const dir = mkdtempSync(join(tmpdir(), "faceless-audio-sfx-"));
  const engine = join(dir, "engine.mjs");
  try {
    writeFileSync(
      join(dir, "STORYBOARD.md"),
      "---\nmessage: Test\n---\n\n## Frame 1\n\n- sfx: whoosh\n",
    );
    writeFileSync(
      join(dir, "audio_meta.json"),
      JSON.stringify({
        voices: [{ frame: 1, path: "voice.wav", duration_s: 7.5, words: [] }],
        bgm: { path: "manual-bgm.wav", volume: 0.2 },
        sfx: [],
      }),
    );
    writeFileSync(
      engine,
      `import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
writeFileSync(flag("--out"), JSON.stringify({
  voices: [{ id: "01", path: "voice.wav", duration_s: 3, words: [] }],
  bgm: { path: "stale-bgm.wav", volume: 0.1 },
  sfx: [{ id: "01", file: "whoosh.mp3", offset_s: 0, duration_s: 1, volume: 0.35 }]
}));`,
    );

    const result = spawnSync(
      process.execPath,
      [script, "fetch-sfx", "--hyperframes", dir, "--storyboard", join(dir, "STORYBOARD.md")],
      { encoding: "utf8", env: { ...process.env, HF_MEDIA_ENGINE: engine } },
    );
    assert.equal(result.status, 0, result.stderr);
    const meta = JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8"));
    assert.equal(meta.voices[0].duration_s, 7.5);
    assert.equal(meta.bgm.path, "manual-bgm.wav");
    assert.equal(meta.sfx[0].file, "whoosh.mp3");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
