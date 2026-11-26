import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readManifest } from "../../scripts/lib/manifest.mjs";
import { recordInManifest } from "./lib/media-record.mjs";
import { resolveSfx } from "./lib/sfx.mjs";
import { afterEach, beforeEach } from "node:test";
import { mediaTransport } from "../../scripts/lib/media-fetch.mjs";

// These tests stub globalThis.fetch; media downloads reach the same stub.
const transportFetch = mediaTransport.fetch;
beforeEach(() => {
  mediaTransport.fetch = (url, init) => globalThis.fetch(url, init);
});
afterEach(() => {
  mediaTransport.fetch = transportFetch;
});

// Proves the relocated engine (skills/media-use/audio/) still resolves its
// bundled SFX library from the moved location — the path most likely to break
// on a subtree move. Openverse is unreachable unless a test serves it.
const offline = async () => {
  throw new TypeError("fetch failed");
};
globalThis.fetch = offline;

const HERE = dirname(fileURLToPath(import.meta.url));
const sfxLibDir = join(HERE, "..", "assets", "sfx"); // same offset the engine uses

test("bundled SFX library resolves from the relocated path", async () => {
  assert.ok(existsSync(join(sfxLibDir, "manifest.json")), "moved manifest is present");
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "1", name: "whoosh" }],
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
      hyperframesDir: dir,
      sfxLibDir,
    });
    assert.equal(sfx.length, 0);
    assert.ok(anomalies.some((a) => /not in bundled library/.test(a)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a person's own file under a bundled name survives, and the cue gets the next free name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    const own = join(dir, "assets", "sfx", "whoosh.mp3");
    mkdirSync(dirname(own), { recursive: true });
    writeFileSync(own, "the person's own whoosh");
    const resolve = () =>
      resolveSfx({
        cues: [{ id: "1", name: "whoosh" }],
        hyperframesDir: dir,
        sfxLibDir,
      });

    const first = await resolve();
    const second = await resolve();

    assert.equal(readFileSync(own, "utf8"), "the person's own whoosh");
    assert.deepEqual(
      [first, second].map(({ sfx }) => [sfx[0].file, sfx[0].source]),
      [
        ["assets/sfx/whoosh-2.mp3", "local"],
        ["assets/sfx/whoosh-2.mp3", "local"],
      ],
    );
    assert.deepEqual(
      readFileSync(join(dir, "assets/sfx/whoosh-2.mp3")),
      readFileSync(join(sfxLibDir, "whoosh.mp3")),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two effects never share a file when one's name is taken by the person, run after run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    mkdirSync(join(dir, "assets", "sfx"), { recursive: true });
    writeFileSync(join(dir, "assets", "sfx", "glitch.mp3"), "the person's own glitch");
    globalThis.fetch = async (url) => {
      const query = new URL(url).searchParams.get("q");
      if (query)
        return Response.json({
          results: [
            {
              license: "cc0",
              filetype: "mp3",
              duration: 500,
              url: `https://sound.test/${encodeURIComponent(query)}`,
            },
          ],
        });
      return new Response(`bytes of ${new URL(url).pathname}`);
    };
    const run = async (names) => {
      const { sfx } = await resolveSfx({
        cues: names.map((name, index) => ({ id: String(index), name })),
        hyperframesDir: dir,
        sfxLibDir,
      });
      const files = sfx.map(({ file }) => file);
      recordInManifest(
        dir,
        [...new Set(files)].map((path) => ({ path, type: "sfx", source: "search" })),
      );
      return files;
    };
    try {
      assert.deepEqual(await run(["glitch"]), ["assets/sfx/glitch-2.mp3"]);
      assert.deepEqual(await run(["glitch", "glitch 2", "glitch"]), [
        "assets/sfx/glitch-2.mp3",
        "assets/sfx/glitch-2-2.mp3",
        "assets/sfx/glitch-2.mp3",
      ]);
    } finally {
      globalThis.fetch = offline;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The engine owns speed parsing; a fallback before the check would turn 0 or junk into 1.
function runEngineWith(request, ...args) {
  const dir = mkdtempSync(join(tmpdir(), "audio-speed-range-"));
  try {
    writeFileSync(join(dir, "audio_request.json"), JSON.stringify({ lines: [], ...request }));
    return spawnSync(process.execPath, [join(HERE, "audio.mjs"), "--hyperframes", dir, ...args], {
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const [label, request, args, shown] of [
  ["request speed 5", { speed: 5 }, [], "5"],
  ["request speed 0", { speed: 0 }, [], "0"],
  ["request speed -1", { speed: -1 }, [], "-1"],
  ["request speed text", { speed: "fast" }, [], '"fast"'],
  ["--speed 0", {}, ["--speed", "0"], '"0"'],
  ["--speed text", { speed: 1 }, ["--speed", "abc"], '"abc"'],
]) {
  test(`${label} stops the engine before any TTS runs`, () => {
    const r = runEngineWith(request, ...args);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(`speed must be above 0 and at most 3, got ${shown}`), r.stderr);
  });
}

test("a numeric string speed, as the adapters forward it, passes the check", () => {
  assert.doesNotMatch(runEngineWith({ speed: "0.8" }, "--only", "tts").stderr, /speed must/);
});

// Stand-ins for the Kokoro path: the CLI handed over in HYPERFRAMES_CLI_ENTRY copies the line's
// text file into the wav for `tts` and reads it back as one word for `transcribe`, and ffprobe on PATH
// reports a tenth of a second per byte.
const cliStub = `const fs = require("node:fs");
const path = require("node:path");
const [command, input, ...rest] = process.argv.slice(2);
const after = (name) => rest[rest.indexOf(name) + 1];
if (command === "tts") {
  fs.mkdirSync(path.dirname(after("--output")), { recursive: true });
  fs.copyFileSync(after("--text-file"), after("--output"));
} else {
  const text = fs.readFileSync(input, "utf8");
  const words = [{ text, start: 0, end: 1 }];
  fs.writeFileSync(path.join(after("--dir"), "transcript.json"), JSON.stringify(words));
}
`;
const ffprobeStub = `#!${process.execPath}
console.log(require("node:fs").statSync(process.argv.at(-1)).size / 10);
`;

test("re-voicing one line keeps every other voice", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "audio-partial-tts-"));
  try {
    const bin = join(dir, "bin");
    const project = join(dir, "project");
    mkdirSync(bin);
    mkdirSync(project);
    const cli = join(bin, "cli.cjs");
    writeFileSync(cli, cliStub);
    writeFileSync(join(bin, "ffprobe"), ffprobeStub);
    chmodSync(join(bin, "ffprobe"), 0o755);
    const run = (lines, args = ["--only", "tts"]) => {
      const request = { provider: "kokoro", lines };
      writeFileSync(join(project, "audio_request.json"), JSON.stringify(request));
      const r = spawnSync(
        process.execPath,
        [join(HERE, "audio.mjs"), "--hyperframes", project, ...args],
        {
          encoding: "utf8",
          timeout: 15000,
          env: {
            ...process.env,
            PATH: bin,
            HYPERFRAMES_CLI_ENTRY: cli,
            HYPERFRAMES_CONFIG_DIR: dir,
            HEYGEN_API_KEY: "",
            HYPERFRAMES_API_KEY: "",
            HYPERFRAMES_MEDIA_HOME: dir,
          },
        },
      );
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(readFileSync(join(project, "audio_meta.json"), "utf8"));
    };
    run(["a", "b", "c"].map((id) => ({ id, text: `line ${id}` })));
    const meta = run([{ id: "b", text: "line b, again" }]);
    assert.deepEqual(
      meta.voices.map((v) => [v.id, v.path, v.duration_s, v.words[0].text]),
      [
        ["a", "assets/voice/a.wav", 0.6, "line a"],
        ["b", "assets/voice/b.wav", 1.3, "line b, again"],
        ["c", "assets/voice/c.wav", 0.6, "line c"],
      ],
    );
    assert.equal(meta.total_duration_s, 2.5);
    // Only the re-voiced line is recorded again; the kept voices keep their own records.
    assert.deepEqual(
      readManifest(project).map((record) => record.description),
      ["line a", "line b", "line c", "line b, again"],
    );
    // A full run without --only still replaces the voices, so a removed line goes away.
    const full = run(
      ["a", "c"].map((id) => ({ id, text: `line ${id}` })),
      [],
    );
    assert.deepEqual(
      full.voices.map((v) => v.id),
      ["a", "c"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A BGM job carried over from audio_meta.json keeps its pid and log only when the log is the
// engine's own in assets/bgm; any other log is dropped so wait-bgm never reads it.
for (const [label, bgmLog, kept] of [
  ["an outside log is dropped", () => "/etc/hosts", false],
  ["a climbing log is dropped", () => "../../.hyperframes/credentials", false],
  ["the engine's own log is kept", (dir) => join(dir, "assets/bgm/bgm-1700000000000.log"), true],
]) {
  test(`a run without bgm: ${label}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "audio-bgm-carry-"));
    try {
      mkdirSync(join(dir, "assets/bgm"), { recursive: true });
      writeFileSync(join(dir, "assets/bgm/bgm-1700000000000.log"), "rendering");
      writeFileSync(join(dir, "audio_request.json"), JSON.stringify({ lines: [] }));
      const log = bgmLog(dir);
      writeFileSync(
        join(dir, "audio_meta.json"),
        JSON.stringify({
          bgm: { path: "assets/bgm/track.wav" },
          bgm_pending: true,
          bgm_pid: 4242,
          bgm_log: log,
        }),
      );
      const run = spawnSync(
        process.execPath,
        [join(HERE, "audio.mjs"), "--hyperframes", dir, "--only", "sfx"],
        { encoding: "utf8", env: { ...process.env, HOME: dir } },
      );
      assert.equal(run.status, 0, run.stderr);
      const meta = JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8"));
      assert.equal(meta.bgm_pending, true);
      assert.equal(meta.bgm_log, kept ? log : null);
      assert.equal(meta.bgm_pid, kept ? 4242 : null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("an audio_meta.json in the project that links outside it is refused and left alone", () => {
  const base = mkdtempSync(join(tmpdir(), "audio-meta-link-"));
  const dir = join(base, "project");
  try {
    mkdirSync(dir);
    writeFileSync(join(base, "theirs.json"), "{}");
    symlinkSync(join(base, "theirs.json"), join(dir, "audio_meta.json"));
    writeFileSync(join(dir, "audio_request.json"), JSON.stringify({ lines: [] }));
    const run = spawnSync(
      process.execPath,
      [join(HERE, "audio.mjs"), "--hyperframes", dir, "--only", "sfx"],
      { encoding: "utf8", env: { ...process.env, HOME: dir } },
    );
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /audio_meta\.json leads outside the project folder/);
    assert.equal(readFileSync(join(base, "theirs.json"), "utf8"), "{}");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("line ids and the voice from audio_request.json print with control characters as escapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "audio-escape-"));
  try {
    const id = "v\x1b[2J\x07";
    writeFileSync(
      join(dir, "audio_request.json"),
      JSON.stringify({ voice: `am_${id}`, lines: [{ id, text: "" }] }),
    );
    const run = spawnSync(
      process.execPath,
      [join(HERE, "audio.mjs"), "--hyperframes", dir, "--only", "tts"],
      { encoding: "utf8", env: { ...process.env, HOME: dir } },
    );
    assert.equal(run.status, 0, run.stderr);
    const shown = run.stdout + run.stderr;
    assert.match(shown, /line v\\x1b\[2J\\x07: empty text/);
    for (const raw of ["\x1b", "\x07"]) assert.ok(!shown.includes(raw), JSON.stringify(shown));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a broken audio_request.json prints its bytes with control characters as escapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "audio-broken-request-"));
  try {
    writeFileSync(join(dir, "audio_request.json"), '{"lines": [ \x1b]0;x \x07 ]}');
    const run = spawnSync(process.execPath, [join(HERE, "audio.mjs"), "--hyperframes", dir], {
      encoding: "utf8",
      env: { ...process.env, HOME: dir },
    });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /audio_request\.json parse: .*\\x1b/);
    for (const raw of ["\x1b", "\x07"]) assert.ok(!run.stderr.includes(raw), run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// With --only, bgm_provider and sfx carry over from audio_meta.json unchanged into the summary.
for (const only of ["tts", "sfx"]) {
  test(`--only ${only}: values kept from audio_meta.json print with control characters as escapes`, () => {
    const dir = mkdtempSync(join(tmpdir(), "audio-kept-escape-"));
    try {
      writeFileSync(join(dir, "audio_request.json"), JSON.stringify({ lines: [] }));
      const kept = {
        bgm: { path: "assets/bgm/track.wav" },
        bgm_provider: "p\x1b[2J\x07",
        sfx: { length: "n\x1b]0;x\x07" },
      };
      writeFileSync(join(dir, "audio_meta.json"), JSON.stringify(kept));
      const run = spawnSync(
        process.execPath,
        [join(HERE, "audio.mjs"), "--hyperframes", dir, "--only", only],
        { encoding: "utf8", env: { ...process.env, HOME: dir } },
      );
      assert.equal(run.status, 0, run.stderr);
      const shown = run.stdout + run.stderr;
      assert.match(shown, /bgm: p\\x1b\[2J\\x07/);
      if (only === "tts") assert.match(shown, /sfx: n\\x1b\]0;x\\x07/);
      for (const raw of ["\x1b", "\x07"]) assert.ok(!shown.includes(raw), JSON.stringify(shown));
      const meta = JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8"));
      assert.equal(meta.bgm_provider, kept.bgm_provider);
      if (only === "tts") assert.deepEqual(meta.sfx, kept.sfx);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("a broken audio_meta.json prints its bytes with control characters as escapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "audio-broken-meta-"));
  try {
    writeFileSync(join(dir, "audio_request.json"), JSON.stringify({ lines: [] }));
    writeFileSync(join(dir, "audio_meta.json"), '{"sfx": [ \x1b]0;x \x07 ]}');
    const run = spawnSync(
      process.execPath,
      [join(HERE, "audio.mjs"), "--hyperframes", dir, "--only", "sfx"],
      { encoding: "utf8", env: { ...process.env, HOME: dir } },
    );
    assert.notEqual(run.status, 0, run.stdout);
    assert.match(run.stderr, /audio_meta\.json at .*: .*\\x1b/);
    for (const raw of ["\x1b", "\x07"]) assert.ok(!run.stderr.includes(raw), run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
