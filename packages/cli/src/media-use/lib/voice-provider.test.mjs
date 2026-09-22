import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { heygenTtsGenerate } from "./voice-provider.mjs";

test("tags TTS generation but not voice discovery with the media-use client source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "media-use-voice-provider-"));
  const capturePath = join(dir, "argv.log");
  const heygenPath = join(dir, "heygen");
  const previousPath = process.env.PATH;
  const previousCapturePath = process.env.HEYGEN_CAPTURE_PATH;

  writeFileSync(
    heygenPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$HEYGEN_CAPTURE_PATH"
case "$*" in
  *"voice list"*) printf '%s\\n' '{"data":[{"voice_id":"voice-123"}]}' ;;
  *"voice speech create"*) printf '%s\\n' '{"data":{"audio_url":"https://example.com/voice.mp3","duration":1.5}}' ;;
esac
`,
  );
  chmodSync(heygenPath, 0o755);
  process.env.PATH = `${dir}:${previousPath ?? ""}`;
  process.env.HEYGEN_CAPTURE_PATH = capturePath;

  try {
    const result = await heygenTtsGenerate("Hello from media-use", {});
    const invocations = readFileSync(capturePath, "utf8").trim().split("\n");

    assert.equal(invocations.length, 2);
    assert.match(invocations[0], /^voice list /);
    assert.doesNotMatch(invocations[0], /X-HeyGen-Client-Source/);
    assert.match(invocations[1], /voice speech create/);
    assert.match(invocations[1], /X-HeyGen-Client-Source: media-use/);
    assert.equal(result?.url, "https://example.com/voice.mp3");
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousCapturePath === undefined) delete process.env.HEYGEN_CAPTURE_PATH;
    else process.env.HEYGEN_CAPTURE_PATH = previousCapturePath;
    rmSync(dir, { recursive: true, force: true });
  }
});
