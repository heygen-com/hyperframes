import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./audio.mjs", import.meta.url).pathname;

// The header of this adapter declares it "intentionally identical across the
// reusing skills" — pin that contract so a fix landing in one copy can't
// silently miss the other (the fully-silent marker bug did exactly that).
test("audio.mjs is byte-identical to pr-to-video's copy (the stated contract)", () => {
  const here = readFileSync(script, "utf8");
  const sibling = readFileSync(
    new URL("../../pr-to-video/scripts/audio.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(here, sibling);
});

// ── the canonical fully-silent marker (SKILL.md Step 3.1) ────────────────────
// Same contract as product-launch (see its audio.test.mjs): `music: none` in
// the storyboard's top YAML block + no SCRIPT.md ⇒ generate nothing; with
// narration ⇒ TTS runs, BGM off.

function runAudioRaw({ storyboard, scriptMd = null, preexistingMeta = null }) {
  const dir = mkdtempSync(join(tmpdir(), "faceless-audio-"));
  const engine = join(dir, "engine.mjs");
  writeFileSync(join(dir, "STORYBOARD.md"), storyboard);
  if (scriptMd != null) writeFileSync(join(dir, "SCRIPT.md"), scriptMd);
  if (preexistingMeta != null) writeFileSync(join(dir, "audio_meta.json"), preexistingMeta);
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
    [script, "--hyperframes", dir, "--storyboard", join(dir, "STORYBOARD.md")],
    { encoding: "utf8", env: { ...process.env, HF_MEDIA_ENGINE: engine } },
  );
  return { dir, result };
}

test("music: none + no SCRIPT.md = fully silent: no engine run, no audio_meta.json", () => {
  const { dir, result } = runAudioRaw({ storyboard: "---\nmessage: Test\nmusic: none\n---\n" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /marked silent/);
  assert.equal(existsSync(join(dir, "request.json")), false);
  assert.equal(existsSync(join(dir, "audio_meta.json")), false);
});

test("fully-silent run removes stale audio_meta.json from a previous non-silent run", () => {
  const { dir, result } = runAudioRaw({
    storyboard: "---\nmessage: Test\nmusic: none\n---\n",
    preexistingMeta: JSON.stringify({ bgm: { path: "old.mp3" }, voices: [], sfx: [] }),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(dir, "audio_meta.json")), false);
});

test("music: none with narration keeps TTS but turns BGM off (not fully silent)", () => {
  const { dir, result } = runAudioRaw({
    storyboard: "---\nmessage: Test\nmusic: none\n---\n",
    scriptMd: "## Hook (Frame 1)\n\n    Spoken line for frame one.\n",
  });

  assert.equal(result.status, 0, result.stderr);
  const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
  assert.equal(request.bgm.mode, "none");
  assert.equal(request.lines.length, 1);
});

test("a storyboard music mood still retrieves BGM (marker is exact, not fuzzy)", () => {
  const { dir, result } = runAudioRaw({
    storyboard: "---\nmessage: Test\nmusic: upbeat synthwave with heavy drums\n---\n",
  });

  assert.equal(result.status, 0, result.stderr);
  const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
  assert.equal(request.bgm.mode, "retrieve");
  assert.equal(request.bgm.query, "upbeat synthwave with heavy drums");
});
