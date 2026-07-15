import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./audio.mjs", import.meta.url).pathname;

function runAudio({ args = [], env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "product-launch-audio-"));
  const engine = join(dir, "engine.mjs");
  writeFileSync(join(dir, "STORYBOARD.md"), "message: Test\n");
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
