import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SELF_CONTAINED_FORMATS, probeFormat } from "./lib/media-input.mjs";

const scripts = fileURLToPath(new URL(".", import.meta.url));
const hasFfmpeg = spawnSync("ffprobe", ["-version"]).status === 0;
const posix = process.platform !== "win32";

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), "media-input-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A stand-in for `name` that records its arguments, one per line, and fails. */
function recorder(bin, name) {
  mkdirSync(bin, { recursive: true });
  const log = join(bin, `${name}.args`);
  writeFileSync(
    join(bin, name),
    `#!/bin/sh\nfor a in "$@"; do echo "$a"; done > "${log}"\nexit 1\n`,
    {
      mode: 0o755,
    },
  );
  return () => readFileSync(log, "utf8").trim().split("\n");
}

function withPath(t, path) {
  const saved = process.env.PATH;
  process.env.PATH = path;
  t.after(() => (process.env.PATH = saved));
}

// A script reader runs its script when the file is opened, so the reader list has to come before the file.
const assertListedBeforeFile = (args, file) => {
  const at = args.indexOf("-format_whitelist");
  assert.ok(at >= 0, args.join(" "));
  assert.equal(args[at + 1], SELF_CONTAINED_FORMATS);
  assert.ok(at < args.indexOf(file), args.join(" "));
};

test(
  "the probe names the readers it may use before ffprobe opens the file",
  { skip: !posix },
  (t) => {
    const dir = sandbox(t);
    const args = recorder(join(dir, "bin"), "ffprobe");
    withPath(t, `${join(dir, "bin")}${delimiter}${process.env.PATH}`);
    const file = join(dir, "clip.avs");
    writeFileSync(file, "Version()");
    assert.equal(probeFormat(file), null);
    assertListedBeforeFile(args(), file);
  },
);

test("the ffmpeg fallback names them too, when there is no ffprobe", { skip: !posix }, (t) => {
  const dir = sandbox(t);
  const args = recorder(join(dir, "bin"), "ffmpeg");
  withPath(t, join(dir, "bin"));
  const file = join(dir, "clip.avs");
  writeFileSync(file, "Version()");
  assert.equal(probeFormat(file), null);
  assertListedBeforeFile(args(), file);
});

test(
  "ordinary audio and video still probe; scripts and lists named as media do not",
  { skip: !hasFfmpeg },
  (t) => {
    const dir = sandbox(t);
    for (const name of ["a.wav", "a.mp3", "a.m4a", "a.mp4"]) {
      const made = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=duration=1",
        join(dir, name),
      ]);
      assert.equal(made.status, 0);
      assert.ok(probeFormat(join(dir, name)), name);
    }
    writeFileSync(join(dir, "script.avs"), "Version()");
    writeFileSync(join(dir, "list.wav"), `ffconcat version 1.0\nfile '${join(dir, "a.wav")}'\n`);
    writeFileSync(
      join(dir, "play.mp3"),
      `#EXTM3U\n#EXTINF:1,\n${join(dir, "a.wav")}\n#EXT-X-ENDLIST\n`,
    );
    for (const name of ["script.avs", "list.wav", "play.mp3"]) {
      assert.equal(probeFormat(join(dir, name)), null, name);
    }
  },
);

test("carve refuses a clip whose source is a script", { skip: !hasFfmpeg }, (t) => {
  const dir = sandbox(t);
  spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=2",
    join(dir, "bed.wav"),
  ]);
  writeFileSync(join(dir, "narration.avs"), "Version()");
  writeFileSync(
    join(dir, "index.html"),
    '<audio id="music-bed" src="bed.wav" data-start="0"></audio>\n' +
      '<audio id="narration" src="narration.avs" data-start="0"></audio>\n',
  );
  const run = spawnSync(process.execPath, [join(scripts, "carve.mjs"), "--comp", "index.html"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /cannot read it as media/);
});

test("the recording path refuses a recording that is a script", { skip: !hasFfmpeg }, (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, "take.avs"), "Version()");
  writeFileSync(
    join(dir, "audio_request.json"),
    JSON.stringify({ lines: [{ id: "01", audio: "take.avs", words: [] }] }),
  );
  const run = spawnSync(
    process.execPath,
    [join(scripts, "audio.mjs"), "--hyperframes", dir, "--only", "tts"],
    {
      encoding: "utf8",
      env: { ...process.env, HOME: dir },
    },
  );
  assert.match(run.stdout, /line 01: recording failed — omitted/);
  assert.match(run.stdout, /cannot read/);
});
