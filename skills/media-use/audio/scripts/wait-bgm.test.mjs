import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./wait-bgm.mjs", import.meta.url), "utf8");
const start = source.indexOf("function readTail(");
const end = source.indexOf("\nfunction detectFailure(", start);
function load(read) {
  return runInNewContext(`${source.slice(start, end)}; readTail`, {
    readFileSync: read,
    existsSync: () => true,
    statSync: () => {
      throw new Error("pathname stat must not precede log read");
    },
  });
}

test("reads a log once without a separate pathname check", () => {
  let calls = 0;
  const read = load((path, encoding) => {
    calls++;
    assert.equal(path, "renderer.log");
    assert.equal(encoding, "utf8");
    return "prefix\nRuntimeError: failed";
  });
  assert.equal(read("renderer.log", 20), "RuntimeError: failed");
  assert.equal(calls, 1);
});

test("preserves UTF-16 character tail boundaries and zero-length tails", () => {
  const txt = "🎵日本語".repeat(2000);
  const read = load(() => txt);
  assert.equal(read("log"), txt.slice(-6000));
  assert.equal(read("log", 0), "");
});

for (const code of ["ENOENT", "ENOTDIR"]) {
  test(`a log removed during polling is absent (${code})`, () => {
    const read = load(() => {
      throw Object.assign(new Error(code), { code });
    });
    assert.equal(read("log"), "");
  });
}

test("preserves unexpected read errors", () => {
  const error = Object.assign(new Error("denied"), { code: "EACCES" });
  assert.throws(
    () =>
      load(() => {
        throw error;
      })("log"),
    (caught) => caught === error,
  );
});

test("empty log path does not access the filesystem", () => {
  assert.equal(
    load(() => {
      throw new Error("unexpected read");
    })(""),
    "",
  );
});

test("records locally made music as generated once it is ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-wait-bgm-"));
  try {
    mkdirSync(join(dir, "assets/bgm"), { recursive: true });
    writeFileSync(join(dir, "assets/bgm/track.wav"), "generated music");
    writeFileSync(
      join(dir, "audio_meta.json"),
      JSON.stringify({
        bgm: { path: "assets/bgm/track.wav" },
        bgm_pending: true,
        bgm_provider: "musicgen",
        bgm_mode: "detached-single",
      }),
    );
    const script = new URL("./wait-bgm.mjs", import.meta.url).pathname;
    const args = ["--audio-meta", join(dir, "audio_meta.json"), "--hyperframes", dir];

    const run = spawnSync(process.execPath, [script, ...args, "--timeout-ms", "1000"], {
      encoding: "utf8",
    });

    assert.equal(run.status, 0, run.stderr);
    const records = readFileSync(join(dir, ".media/manifest.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      records.map(({ path, type, source, provenance }) => [
        path,
        type,
        source,
        provenance.provider,
      ]),
      [["assets/bgm/track.wav", "bgm", "generated", "musicgen"]],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A finished-but-missing track with no live renderer, so wait-bgm reports on the log at once.
function waitWithLog(bgmLog, files = {}) {
  const base = mkdtempSync(join(tmpdir(), "mu-wait-bgm-"));
  const dir = join(base, "project");
  mkdirSync(join(dir, "assets/bgm"), { recursive: true });
  writeFileSync(join(base, "secret.txt"), "Traceback: SECRET-TOKEN-123");
  for (const [rel, make] of Object.entries(files)) make(join(dir, rel), base);
  writeFileSync(
    join(dir, "audio_meta.json"),
    JSON.stringify({
      bgm: { path: "assets/bgm/track.wav" },
      bgm_pending: true,
      bgm_pid: null,
      bgm_log: bgmLog(dir, base),
    }),
  );
  const script = new URL("./wait-bgm.mjs", import.meta.url).pathname;
  const run = spawnSync(
    process.execPath,
    [
      script,
      "--audio-meta",
      join(dir, "audio_meta.json"),
      "--hyperframes",
      dir,
      "--timeout-ms",
      "0",
    ],
    { encoding: "utf8", env: { ...process.env, HOME: base } },
  );
  try {
    assert.equal(run.status, 0, run.stderr);
    return readFileSync(join(dir, "bgm_status.json"), "utf8");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

for (const [label, bgmLog, files] of [
  ["an absolute path outside the project", (_dir, base) => join(base, "secret.txt")],
  ["a path that climbs out of the project", () => "../secret.txt"],
  [
    "a link in assets/bgm under the engine's log name",
    () => "assets/bgm/bgm-1.log",
    { "assets/bgm/bgm-1.log": (at, base) => symlinkSync(join(base, "secret.txt"), at) },
  ],
]) {
  test(`a bgm_log at ${label} is never read into bgm_status.json`, () => {
    const status = waitWithLog(bgmLog, files);
    assert.doesNotMatch(status, /SECRET-TOKEN/);
    const parsed = JSON.parse(status);
    assert.equal(parsed.log, null);
    assert.equal(parsed.error_tail, undefined);
    assert.equal(parsed.status, "timeout");
    assert.equal(parsed.log_tail, "");
  });
}

test("the engine's own crashed renderer log still reports the failure", () => {
  const status = JSON.parse(
    waitWithLog((dir) => join(dir, "assets/bgm/bgm-1700000000000.log"), {
      "assets/bgm/bgm-1700000000000.log": (at) =>
        writeFileSync(at, "loading model\nRuntimeError: CUDA out of memory\n"),
    }),
  );
  assert.equal(status.status, "failed");
  assert.match(status.error_tail, /^RuntimeError: CUDA out of memory/);
});

function runWait(dir, meta) {
  writeFileSync(join(dir, "audio_meta.json"), JSON.stringify(meta));
  const script = new URL("./wait-bgm.mjs", import.meta.url).pathname;
  const run = spawnSync(
    process.execPath,
    [
      script,
      "--audio-meta",
      join(dir, "audio_meta.json"),
      "--hyperframes",
      dir,
      "--timeout-ms",
      "0",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
}

test("a link planted at bgm_status.json is replaced, and the file it named is untouched", () => {
  const base = mkdtempSync(join(tmpdir(), "mu-wait-bgm-"));
  const dir = join(base, "project");
  try {
    mkdirSync(dir);
    writeFileSync(join(base, "theirs.txt"), "theirs");
    symlinkSync(join(base, "theirs.txt"), join(dir, "bgm_status.json"));
    runWait(dir, { bgm: null });
    assert.equal(readFileSync(join(base, "theirs.txt"), "utf8"), "theirs");
    assert.equal(lstatSync(join(dir, "bgm_status.json")).isSymbolicLink(), false);
    assert.equal(JSON.parse(readFileSync(join(dir, "bgm_status.json"), "utf8")).status, "disabled");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a track path outside the project is never reported ready or recorded", () => {
  const base = mkdtempSync(join(tmpdir(), "mu-wait-bgm-"));
  const dir = join(base, "project");
  try {
    mkdirSync(dir);
    writeFileSync(join(base, "theirs.wav"), "not ours");
    runWait(dir, { bgm: { path: "../theirs.wav" }, bgm_pending: true, bgm_provider: "musicgen" });
    const status = JSON.parse(readFileSync(join(dir, "bgm_status.json"), "utf8"));
    assert.equal(status.ready, false);
    assert.equal(status.path, null);
    assert.equal(existsSync(join(dir, ".media/manifest.jsonl")), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a pid whose log is not the engine's own is dropped with the log", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-wait-bgm-"));
  try {
    mkdirSync(join(dir, "assets/bgm"), { recursive: true });
    runWait(dir, {
      bgm: { path: "assets/bgm/track.wav" },
      bgm_pending: true,
      bgm_pid: process.pid,
      bgm_log: "/etc/hosts",
    });
    const status = JSON.parse(readFileSync(join(dir, "bgm_status.json"), "utf8"));
    assert.equal(status.pid, null);
    assert.equal(status.process_alive, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a ready track's path from audio_meta.json prints with control characters as escapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-wait-bgm-escape-"));
  try {
    const track = "assets/bgm/x\x1b[2J\x07.wav";
    mkdirSync(join(dir, "assets/bgm"), { recursive: true });
    writeFileSync(join(dir, track), "RIFF");
    writeFileSync(
      join(dir, "audio_meta.json"),
      JSON.stringify({ bgm: { path: track }, bgm_pending: true }),
    );
    const script = new URL("./wait-bgm.mjs", import.meta.url).pathname;
    const args = ["--audio-meta", join(dir, "audio_meta.json"), "--hyperframes", dir];
    const run = spawnSync(process.execPath, [script, ...args, "--timeout-ms", "0"], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /ready \(assets\/bgm\/x\\x1b\[2J\\x07\.wav/);
    for (const raw of ["\x1b", "\x07"]) assert.ok(!run.stdout.includes(raw), run.stdout);
    const status = JSON.parse(readFileSync(join(dir, "bgm_status.json"), "utf8"));
    assert.equal(status.path, track);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a broken audio_meta.json prints its bytes with control characters as escapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-wait-bgm-broken-"));
  try {
    writeFileSync(join(dir, "audio_meta.json"), '{"bgm": [ \x1b]0;x \x07 ]}');
    const script = new URL("./wait-bgm.mjs", import.meta.url).pathname;
    const args = ["--audio-meta", join(dir, "audio_meta.json"), "--hyperframes", dir];
    const run = spawnSync(process.execPath, [script, ...args, "--timeout-ms", "0"], {
      encoding: "utf8",
    });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /audio_meta\.json parse: .*\\x1b/);
    for (const raw of ["\x1b", "\x07"]) assert.ok(!run.stderr.includes(raw), run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
