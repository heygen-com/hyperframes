import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readManifest } from "../../scripts/lib/manifest.mjs";
import { recordInManifest } from "./lib/media-record.mjs";
import { resolveSfx } from "./lib/sfx.mjs";

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

// Stand-ins on PATH for the Kokoro path: `tts` copies the line's text into the wav, `transcribe`
// reads it back as one word, and ffprobe reports a tenth of a second per byte.
const npxStub = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const [, command, input, ...rest] = process.argv.slice(2);
const after = (name) => rest[rest.indexOf(name) + 1];
if (command === "tts") {
  fs.mkdirSync(path.dirname(after("--output")), { recursive: true });
  fs.copyFileSync(input, after("--output"));
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
    for (const [name, source] of [
      ["npx", npxStub],
      ["ffprobe", ffprobeStub],
    ]) {
      writeFileSync(join(bin, name), source);
      chmodSync(join(bin, name), 0o755);
    }
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
            HEYGEN_CONFIG_DIR: dir,
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
