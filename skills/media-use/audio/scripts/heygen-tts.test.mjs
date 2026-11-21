import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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

// fails without the fix: the narration and its word timings were written through links at -o and --words.
test("a link at the narration or words path is refused before anything is asked or written", () => {
  const dir = mkdtempSync(join(tmpdir(), "heygen-tts-link-"));
  const outside = join(dir, "outside.txt");
  writeFileSync(outside, "keep me");
  for (const [flag, name] of [
    ["-o", "narration.wav"],
    ["--words", "narration.words.json"],
  ]) {
    const path = join(dir, name);
    symlinkSync(outside, path);
    const args = flag === "-o" ? ["-o", path] : ["-o", join(dir, "n2.mp3"), "--words", path];
    const run = spawnSync(
      process.execPath,
      ["--import", refusing, script, "Hello", "--voice", "vc", ...args],
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
    assert.match(run.stderr, /is a link; nothing was written through it/);
    assert.equal(readFileSync(outside, "utf8"), "keep me");
  }
});
