import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { findReversions, frameHeight, parseArgs } from "./check-capture-reversion.mjs";

const OPTS = { window: 20, change: 1, same: 0.25 };
const SIZE = 4;

function frames(...levels) {
  return Buffer.concat(levels.map((v) => Buffer.alloc(SIZE, v)));
}

test("a region that returns to an earlier picture is flagged at the changed frame", () => {
  const hits = findReversions(frames(10, 10, 200, 10, 10), SIZE, OPTS);
  assert.deepEqual(
    hits.map((h) => [h.from, h.changed, h.back]),
    [[0, 2, 3]],
  );
});

test("a change that stays is not a reversion", () => {
  assert.deepEqual(findReversions(frames(10, 10, 200, 200, 200), SIZE, OPTS), []);
});

test("continuous motion never returns to an earlier picture", () => {
  assert.deepEqual(findReversions(frames(10, 30, 50, 70, 90), SIZE, OPTS), []);
});

test("a return further away than the window is ignored", () => {
  const far = frames(10, 200, 10);
  assert.deepEqual(findReversions(far, SIZE, { ...OPTS, window: 1 }), []);
});

test("the window boundary is inclusive", () => {
  const hits = findReversions(frames(10, 200, 10), SIZE, { ...OPTS, window: 2 });
  assert.equal(hits.length, 1);
});

test("a change below the threshold is not flagged, one above it is", () => {
  assert.deepEqual(findReversions(frames(10, 11, 10), SIZE, { ...OPTS, change: 1 }), []);
  assert.equal(findReversions(frames(10, 12, 10), SIZE, { ...OPTS, change: 1 }).length, 1);
});

test("a middle frame that matches only one side is not a reversion", () => {
  assert.deepEqual(findReversions(frames(10, 10, 10, 200), SIZE, OPTS), []);
});

test("hits come back ordered by the changed frame", () => {
  const hits = findReversions(frames(60, 10, 60, 10, 200, 60, 10), SIZE, OPTS);
  assert.deepEqual(
    hits.map((h) => h.changed),
    [1, 2, 4],
  );
});

test("the reported delta is the mean difference, not the sum", () => {
  const [hit] = findReversions(frames(10, 110, 10), SIZE, OPTS);
  assert.equal(hit.delta, 100);
});

test("frame height is even and never below 2", () => {
  assert.equal(frameHeight(1280, 200), 16);
  assert.equal(frameHeight(1280, 800), 60);
  assert.equal(frameHeight(1000, 2), 2);
});

test("a malformed option throws instead of reading as clean", () => {
  for (const bad of [
    "--crop=iw:200:0:0",
    "--window=abc",
    "--change=",
    "--same=-1",
    "--crp=1:1:0:0",
  ]) {
    assert.throws(() => parseArgs([bad, "v.webm"]), bad);
  }
});

test("options and paths are separated", () => {
  const { options, paths } = parseArgs(["--crop=1280:200:0:600", "--window=5", "a.webm", "b.webm"]);
  assert.deepEqual(paths, ["a.webm", "b.webm"]);
  assert.equal(options.crop, "1280:200:0:600");
  assert.equal(options.window, 5);
});

const SCRIPT = fileURLToPath(new URL("./check-capture-reversion.mjs", import.meta.url));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

function run(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function makeClip(dir, name, filter) {
  const path = join(dir, name);
  const r = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    filter,
    "-frames:v",
    "6",
    path,
  ]);
  assert.equal(r.status, 0, String(r.stderr));
  return path;
}

test("the CLI exits 2 with no videos, even when run through a symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "reversion-"));
  const link = join(dir, "check.mjs");
  symlinkSync(SCRIPT, link);
  for (const script of [SCRIPT, link]) {
    const r = run(script);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage/);
  }
});

test(
  "the CLI exits 0 clean, 1 flagged, 2 unreadable, and keeps going past a bad file",
  { skip: !hasFfmpeg },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "reversion-"));
    const still = makeClip(dir, "still.mp4", "color=c=black:s=64x64:r=10");
    const blink = makeClip(
      dir,
      "blink.mp4",
      "color=c=black:s=64x64:r=10,drawbox=x=0:y=0:w=64:h=64:c=white:t=fill:enable='between(n,2,2)'",
    );
    assert.equal(run(SCRIPT, still).status, 0);
    const flagged = run(SCRIPT, blink);
    assert.equal(flagged.status, 1);
    assert.match(flagged.stdout, /FLAGGED/);
    const mixed = run(SCRIPT, blink, join(dir, "missing.mp4"), still);
    assert.equal(mixed.status, 2);
    assert.match(mixed.stdout, /FLAGGED[\s\S]*clean/);
  },
);

test("a zero or fractional frame size throws instead of looping", () => {
  for (const bad of [0, -4, 1.5, Number.NaN]) {
    assert.throws(() => findReversions(frames(10, 10, 10), bad, OPTS), /positive integer/);
  }
});

test("a comparison past its deadline throws", () => {
  assert.throws(() => findReversions(frames(10, 200, 10), SIZE, OPTS, 0), /time limit/);
});

test("--timeout is parsed as seconds", () => {
  assert.equal(parseArgs(["--timeout=30", "v.webm"]).options.timeout, 30);
});

test("a comparison that outlives --timeout stops at the deadline, not after the frame", () => {
  const big = Buffer.alloc(SIZE * 400, 7);
  const opts = { window: 400, change: 0, same: 255 };
  const started = Date.now();
  assert.throws(() => findReversions(big, SIZE, opts, started + 20), /time limit/);
  assert.ok(Date.now() - started < 2000);
});

test("--timeout stops a hung ffmpeg or ffprobe wrapper, children included, with exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "reversion-"));
  for (const tool of ["ffmpeg", "ffprobe"]) {
    writeFileSync(join(dir, tool), "#!/bin/sh\nsleep 37.31\n");
    chmodSync(join(dir, tool), 0o755);
  }
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  for (const extra of [["--crop=32:32:0:0"], []]) {
    const started = Date.now();
    const r = spawnSync(process.execPath, [SCRIPT, "--timeout=1", ...extra, "any.mp4"], {
      encoding: "utf8",
      env,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /did not finish within 1s/);
    assert.ok(Date.now() - started < 10000);
  }
  const orphans = spawnSync("pgrep", ["-f", "sleep 37.31"], { encoding: "utf8" });
  assert.notEqual(orphans.status, 0, `orphaned children: ${orphans.stdout}`);
});

test("--timeout above the timer limit and inherited option names are rejected", () => {
  assert.throws(() => parseArgs(["--timeout=1e10", "v.mp4"]));
  assert.throws(() => parseArgs(["--constructor=5", "v.mp4"]));
});

test(
  "a flagged video is not hidden when a later one is missing or an earlier one is",
  { skip: !hasFfmpeg },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "reversion-"));
    const blink = makeClip(
      dir,
      "blink.mp4",
      "color=c=black:s=64x64:r=10,drawbox=x=0:y=0:w=64:h=64:c=white:t=fill:enable='between(n,2,2)'",
    );
    assert.equal(run(SCRIPT, join(dir, "missing.mp4"), blink).status, 2);
  },
);

test("SIGTERM to the checker also stops its ffmpeg child", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reversion-"));
  writeFileSync(join(dir, "ffmpeg"), "#!/bin/sh\nsleep 41.73\n");
  chmodSync(join(dir, "ffmpeg"), 0o755);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  const child = spawn(process.execPath, [SCRIPT, "--crop=32:32:0:0", "any.mp4"], { env });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  child.kill("SIGTERM");
  await new Promise((resolve) => child.on("close", resolve));
  const orphans = spawnSync("pgrep", ["-f", "sleep 41.73"], { encoding: "utf8" });
  assert.notEqual(orphans.status, 0, `orphaned children: ${orphans.stdout}`);
});
