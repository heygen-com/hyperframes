import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
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
