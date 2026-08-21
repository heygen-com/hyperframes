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

// ── fetch-sfx ────────────────────────────────────────────────────────────────
// Regressions found while running the full product-launch workflow end to end
// (linear.app site showcase, 2026-07-30).

/** Runs the fetch-sfx subcommand. `neutralOut` is what the stub engine writes to --out. */
function runFetchSfx({ storyboard, neutralOut = { voices: [], bgm: null, sfx: [] } }) {
  const dir = mkdtempSync(join(tmpdir(), "product-launch-sfx-"));
  const engine = join(dir, "engine.mjs");
  writeFileSync(join(dir, "STORYBOARD.md"), storyboard);
  writeFileSync(
    engine,
    `import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
const request = JSON.parse(readFileSync(flag("--request"), "utf8"));
writeFileSync(new URL("request.json", import.meta.url), JSON.stringify(request));
writeFileSync(flag("--out"), ${JSON.stringify(JSON.stringify(neutralOut))});
`,
  );
  const result = spawnSync(
    process.execPath,
    [script, "fetch-sfx", "--hyperframes", dir, "--storyboard", join(dir, "STORYBOARD.md")],
    { encoding: "utf8", env: { ...process.env, HF_MEDIA_ENGINE: engine } },
  );
  return { dir, result };
}

const FRAME_WITH_SFX = (sfx) =>
  `---\nmessage: Test\n---\n\n## Frame 1 — Hook\n- duration: 3s\n- sfx: ${sfx}\n`;

test("fetch-sfx: `sfx: none` is an absence marker, not a cue named none", () => {
  const { dir, result } = runFetchSfx({ storyboard: FRAME_WITH_SFX("none") });

  assert.equal(result.status, 0, result.stderr);
  const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
  // Used to reach the engine as { sfx: ["none"] } — a cue that cannot resolve.
  assert.deepEqual(request.lines, []);
});

test("fetch-sfx: the other absence spellings are markers too", () => {
  for (const spelling of ["None", "n/a", "NA", "skip", "-", "—"]) {
    const { dir, result } = runFetchSfx({ storyboard: FRAME_WITH_SFX(spelling) });
    assert.equal(result.status, 0, result.stderr);
    const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
    assert.deepEqual(request.lines, [], `spelling: ${spelling}`);
  }
});

test("fetch-sfx: a real cue still reaches the engine, and mixed lists drop only the marker", () => {
  const { dir, result } = runFetchSfx({ storyboard: FRAME_WITH_SFX("whoosh, none, click") });

  assert.equal(result.status, 0, result.stderr);
  const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
  assert.deepEqual(request.lines, [{ id: "01", sfx: ["whoosh", "click"] }]);
});

test("fetch-sfx: carries bgm_pending through and warns that the snapshot has no bed", () => {
  const { dir, result } = runFetchSfx({
    storyboard: FRAME_WITH_SFX("whoosh"),
    // A detached Lyria/MusicGen generate that has not landed yet.
    neutralOut: { voices: [], bgm: null, bgm_pending: true, sfx: [] },
  });

  assert.equal(result.status, 0, result.stderr);
  const meta = JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8"));
  // The flag used to be dropped in the neutral → PL translation, making "not ready yet"
  // indistinguishable from "silent by design".
  assert.equal(meta.bgm_pending, true);
  assert.equal(meta.bgm, null);
  assert.match(result.stderr + result.stdout, /pending/i);
});

test("fetch-sfx: a resolved bed reports bgm_pending false and no warning", () => {
  const { dir, result } = runFetchSfx({
    storyboard: FRAME_WITH_SFX("whoosh"),
    neutralOut: { voices: [], bgm: { path: "assets/bgm/track.mp3", volume: 0.12 }, sfx: [] },
  });

  assert.equal(result.status, 0, result.stderr);
  const meta = JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8"));
  assert.equal(meta.bgm_pending, false);
  assert.equal(meta.bgm.path, "assets/bgm/track.mp3");
  assert.doesNotMatch(result.stderr, /pending/i);
});
