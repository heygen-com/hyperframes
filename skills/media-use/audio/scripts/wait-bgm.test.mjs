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

// fails without the fix: any file at the track name counted as the finished track.
test("the track that was there when the job started is not the finished track; a file put there since is", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-wait-bgm-"));
  try {
    mkdirSync(join(dir, "assets/bgm"), { recursive: true });
    const track = join(dir, "assets/bgm/track.wav");
    writeFileSync(track, "last run's track");
    const old = lstatSync(track);
    const wait = (replaces) => {
      writeFileSync(
        join(dir, "audio_meta.json"),
        JSON.stringify({
          bgm: { path: "assets/bgm/track.wav" },
          bgm_pending: true,
          bgm_replaces: replaces,
        }),
      );
      const script = new URL("./wait-bgm.mjs", import.meta.url).pathname;
      const args = ["--audio-meta", join(dir, "audio_meta.json"), "--hyperframes", dir];
      const run = spawnSync(process.execPath, [script, ...args, "--timeout-ms", "0"]);
      assert.equal(run.status, 0, String(run.stderr));
      return JSON.parse(readFileSync(join(dir, "bgm_status.json"), "utf8")).status;
    };

    assert.equal(wait({ ino: old.ino, size: old.size, mtime_ms: old.mtimeMs }), "timeout");
    assert.equal(wait({ ino: old.ino + 1, size: old.size, mtime_ms: old.mtimeMs }), "ready");
    assert.equal(wait(null), "ready");
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

// Time moves on every read and by the full length of every wait, as it does on a loaded machine. The wall
// clock can also step back, as it does when the system time is corrected. Every wait is logged.
const MOVING_CLOCK = `
import { appendFileSync, writeFileSync } from "node:fs";
let now = performance.now();
Object.defineProperty(performance, "now", { value: () => (now += 1), configurable: true });
let wall = Date.now();
const back = Boolean(process.env.WALL_CLOCK_STEPS_BACK);
Date.now = () => (wall += back ? -1000 : 1);
const wait = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms = 0, ...rest) => {
  appendFileSync(process.env.WAITS, ms + "\\n");
  if (process.env.TRACK_DURING_WAIT) writeFileSync(process.env.TRACK_DURING_WAIT, "RIFF");
  now += ms;
  if (!back) wall += ms;
  return wait(fn, 0, ...rest);
};
`;

const waitsIn = (dir) =>
  readFileSync(join(dir, "waits"), "utf8").split("\n").filter(Boolean).map(Number);

function waitOnMovingClock(dir, timeoutMs, env = {}, intervalMs = timeoutMs) {
  writeFileSync(join(dir, "waits"), "");
  writeFileSync(join(dir, "clock.mjs"), MOVING_CLOCK);
  writeFileSync(
    join(dir, "audio_meta.json"),
    JSON.stringify({ bgm: { path: "assets/bgm/track.wav" }, bgm_pending: true }),
  );
  const script = new URL("./wait-bgm.mjs", import.meta.url).pathname;
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      join(dir, "clock.mjs"),
      script,
      "--audio-meta",
      join(dir, "audio_meta.json"),
      "--hyperframes",
      dir,
      "--timeout-ms",
      String(timeoutMs),
      "--interval-ms",
      String(intervalMs),
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, WAITS: join(dir, "waits"), ...env },
    },
  );
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(readFileSync(join(dir, "bgm_status.json"), "utf8")).status;
}

// fails without the fix: a tick between starting the clock and the first look skipped every look.
test("a finished track is ready with --timeout-ms 0 even when the clock moves before the first look", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-wait-bgm-"));
  try {
    mkdirSync(join(dir, "assets/bgm"), { recursive: true });
    writeFileSync(join(dir, "assets/bgm/track.wav"), "RIFF");
    assert.equal(waitOnMovingClock(dir, 0), "ready");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// fails without the fix: the wait ended at the deadline without looking again.
test("a track that lands during the last wait is ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-wait-bgm-"));
  try {
    mkdirSync(join(dir, "assets/bgm"), { recursive: true });
    const track = join(dir, "assets/bgm/track.wav");
    assert.equal(waitOnMovingClock(dir, 100, { TRACK_DURING_WAIT: track }, 1000), "ready");
    const waits = waitsIn(dir);
    assert.ok(waits.length > 0 && waits.every((ms) => ms <= 100), `waits: ${waits}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// fails without the fix: elapsed time came from the wall clock, so a step back made a zero timeout wait.
test("a zero timeout looks once and never waits, even when the wall clock steps back", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-wait-bgm-"));
  try {
    mkdirSync(join(dir, "assets/bgm"), { recursive: true });
    assert.equal(waitOnMovingClock(dir, 0, { WALL_CLOCK_STEPS_BACK: "1" }), "timeout");
    assert.deepEqual(waitsIn(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
