import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveSfx } from "./lib/sfx.mjs";

// Proves the relocated engine (skills/media-use/audio/) still resolves its
// bundled SFX library from the moved location — the path most likely to break
// on a subtree move. Offline (heygenOK:false), no network.

const HERE = dirname(fileURLToPath(import.meta.url));
const sfxLibDir = join(HERE, "..", "assets", "sfx"); // same offset the engine uses

test("explicit offline TTS provider bypasses expired HeyGen OAuth", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-expired-auth-"));
  const configDir = join(dir, "config");
  const requestPath = join(dir, "audio_request.json");
  const outPath = join(dir, "audio_meta.json");
  const engine = join(HERE, "audio.mjs");
  try {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "credentials"),
      JSON.stringify({
        oauth: {
          access_token: "expired",
          refresh_token: "offline-refresh-token",
          expires_at: "2000-01-01T00:00:00Z",
        },
      }),
    );
    writeFileSync(
      requestPath,
      JSON.stringify({ provider: "kokoro", lines: [], bgm: { mode: "none" } }),
    );
    const env = {
      ...process.env,
      HEYGEN_CONFIG_DIR: configDir,
      HYPERFRAMES_OAUTH_TOKEN_URL: "http://127.0.0.1:1/token",
    };
    delete env.HEYGEN_API_KEY;
    delete env.HYPERFRAMES_API_KEY;
    const result = spawnSync(
      process.execPath,
      [
        engine,
        "--request",
        requestPath,
        "--hyperframes",
        dir,
        "--out",
        outPath,
        "--only",
        "tts",
        "--provider",
        "kokoro",
      ],
      { encoding: "utf8", env },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(outPath, "utf8")).tts_provider, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bundled SFX library resolves from the relocated path", async () => {
  assert.ok(existsSync(join(sfxLibDir, "manifest.json")), "moved manifest is present");
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "1", name: "whoosh" }],
      heygenOK: false,
      hyperframesDir: dir,
      sfxLibDir,
    });
    assert.equal(sfx.length, 1, `expected 1 resolved cue, got anomalies: ${anomalies.join("; ")}`);
    assert.equal(sfx[0].source, "local");
    assert.match(sfx[0].file, /assets\/sfx\//);
    assert.ok(existsSync(join(dir, sfx[0].file)), "matched SFX copied into the project");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown cue is reported, not fatal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "1", name: "definitely-not-a-real-sfx" }],
      heygenOK: false,
      hyperframesDir: dir,
      sfxLibDir,
    });
    assert.equal(sfx.length, 0);
    assert.ok(anomalies.some((a) => /not in bundled library/.test(a)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
