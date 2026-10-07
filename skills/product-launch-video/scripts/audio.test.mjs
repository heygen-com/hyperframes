import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("passes Gemini model and delivery style through the workflow adapter", () => {
  const request = runAudio({
    args: [
      "--provider",
      "gemini",
      "--tts-model",
      "gemini-3.8-flash-lite-tts",
      "--style",
      "Warm and calm",
    ],
  });
  assert.equal(request.provider, "gemini");
  assert.equal(request.tts_model, "gemini-3.8-flash-lite-tts");
  assert.equal(request.style, "Warm and calm");
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

// ── the canonical fully-silent marker (SKILL.md Step 3.1) ────────────────────
// `music: none` in the storyboard's top YAML block + no SCRIPT.md marks the
// project fully silent: generate must produce nothing (an absent
// audio_meta.json is what assemble treats as silent) and clear stale meta.

/** Like runAudio, but with a caller-controlled storyboard and no request assertion. */
function runAudioRaw({ storyboard, scriptMd = null, preexistingMeta = null, files = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "product-launch-audio-"));
  const engine = join(dir, "engine.mjs");
  writeFileSync(join(dir, "STORYBOARD.md"), storyboard);
  if (scriptMd != null) writeFileSync(join(dir, "SCRIPT.md"), scriptMd);
  if (preexistingMeta != null) writeFileSync(join(dir, "audio_meta.json"), preexistingMeta);
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "");
  }
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
  // The engine was never invoked...
  assert.equal(existsSync(join(dir, "request.json")), false);
  // ...and no meta exists (absence ⇒ assemble treats the film as silent).
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

test('a quoted music: "none" is still the silent marker (frontmatter stripQuotes)', () => {
  // YAML authors quote scalars freely; the vendored storyboard parser strips
  // matching quotes at parse time (storyboard.mjs stripQuotes), so the marker
  // must not depend on the unquoted spelling.
  const { dir, result } = runAudioRaw({
    storyboard: '---\nmessage: Test\nmusic: "none"\n---\n',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /marked silent/);
  assert.equal(existsSync(join(dir, "audio_meta.json")), false);
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
function runFetchSfx({
  storyboard,
  neutralOut = { voices: [], bgm: null, sfx: [] },
  preexistingMeta = null,
  files = [],
}) {
  const dir = mkdtempSync(join(tmpdir(), "product-launch-sfx-"));
  const engine = join(dir, "engine.mjs");
  writeFileSync(join(dir, "STORYBOARD.md"), storyboard);
  if (preexistingMeta != null)
    writeFileSync(join(dir, "audio_meta.json"), JSON.stringify(preexistingMeta));
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "");
  }
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

// ── host audio (lib/host-audio.mjs) ─────────────────────────────────────────
// A host app's own music or sound, listed in audio_meta.json as "source": "host", survives every audio pass.

const HOST_WHOOSH = {
  frame: 1,
  file: "assets/sfx/custom-whoosh.mp3",
  offset_s: 0,
  duration_s: 2,
  source: "host",
};
const HOST_BED = { path: "assets/bgm/host.mp3", source: "host" };

test("fetch-sfx keeps a host sound and looks up no cue for its frame", () => {
  const { dir, result } = runFetchSfx({
    storyboard: FRAME_WITH_SFX("whoosh"),
    preexistingMeta: { bgm: null, voices: [], sfx: [HOST_WHOOSH] },
    files: [HOST_WHOOSH.file],
    neutralOut: { voices: [], bgm: null, sfx: [{ id: "01", file: "assets/sfx/whoosh.mp3" }] },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "request.json"), "utf8")).lines, []);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8")).sfx, [
    HOST_WHOOSH,
  ]);
});

test("fetch-sfx keeps a host bed the storyboard does not look up", () => {
  const { dir, result } = runFetchSfx({
    storyboard: FRAME_WITH_SFX("whoosh"),
    preexistingMeta: { bgm: HOST_BED, voices: [], sfx: [] },
    files: [HOST_BED.path],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8")).bgm, HOST_BED);
});

test("music: none + no SCRIPT.md with a sound cue is not silent: audio_meta.json stays for fetch-sfx", () => {
  const { dir, result } = runAudioRaw({
    storyboard:
      "---\nmessage: Test\nmusic: none\n---\n\n## Frame 1 — Hook\n- duration: 3s\n- sfx: whoosh\n",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /marked silent/);
  assert.equal(existsSync(join(dir, "request.json")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8")).sfx, []);
});

test("generate keeps a host bed when there is no narration and music: none", () => {
  const { dir, result } = runAudioRaw({
    storyboard: "---\nmessage: Test\nmusic: none\n---\n",
    preexistingMeta: JSON.stringify({ bgm: HOST_BED, voices: [], sfx: [] }),
    files: [HOST_BED.path],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8")).bgm, HOST_BED);
});

test("fetch-sfx stops on an audio_meta.json that does not parse, so host entries are not lost", () => {
  const { dir, result } = runFetchSfx({ storyboard: FRAME_WITH_SFX("whoosh") });
  writeFileSync(
    join(dir, "audio_meta.json"),
    '{ "bgm": { "path": "assets/bgm/host.mp3", "source": "host" }, }',
  );
  const again = spawnSync(
    process.execPath,
    [script, "fetch-sfx", "--hyperframes", dir, "--storyboard", join(dir, "STORYBOARD.md")],
    { encoding: "utf8", env: { ...process.env, HF_MEDIA_ENGINE: join(dir, "engine.mjs") } },
  );

  assert.equal(again.status, 1);
  assert.match(again.stderr, /does not parse/);
  assert.match(readFileSync(join(dir, "audio_meta.json"), "utf8"), /host\.mp3/);
});

test("re-running generate with no narration keeps the sounds fetch-sfx found", () => {
  const storyboard =
    "---\nmessage: Test\nmusic: none\n---\n\n## Frame 1 — Hook\n- duration: 3s\n- sfx: whoosh\n";
  const { dir, result } = runAudioRaw({ storyboard });
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(
    join(dir, "audio_engine_meta.json"),
    JSON.stringify({
      voices: [{ id: "01", path: "old.wav" }],
      bgm: { path: "old.mp3" },
      sfx: [{ id: "01", file: "assets/sfx/whoosh.mp3" }],
    }),
  );
  const again = spawnSync(
    process.execPath,
    [script, "--hyperframes", dir, "--storyboard", join(dir, "STORYBOARD.md")],
    {
      encoding: "utf8",
    },
  );

  assert.equal(again.status, 0, again.stderr);
  const meta = JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8"));
  assert.deepEqual(
    meta.sfx.map((s) => s.file),
    ["assets/sfx/whoosh.mp3"],
  );
  assert.deepEqual(meta.voices, []);
  assert.equal(meta.bgm, null);
});
