import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./extract-audio-data.py", import.meta.url));
const python = ["python3", "python"].find(
  (name) =>
    spawnSync(name, ["-c", "import sys, numpy; assert sys.version_info >= (3, 9)"]).status === 0,
);
const skip =
  (!python && "needs Python 3.9+ with numpy") ||
  (process.platform === "win32" && "symbolic links need extra rights on Windows");

// A project can arrive with a link at the output name; the helper must replace it, not write through it.
function project(t) {
  const base = mkdtempSync(join(tmpdir(), "extract-audio-link-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(dir);
  mkdirSync(outside);
  writeFileSync(join(outside, "victim.txt"), "KEEP");
  const tone = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=1",
    join(dir, "in.wav"),
  ]);
  assert.equal(tone.status, 0);
  return { dir, outside };
}

const extract = (cwd, output) =>
  spawnSync(python, [SCRIPT, "in.wav", "-o", output], { cwd, encoding: "utf8" });

test("a link at audio-data.json is replaced and its target is left alone", { skip }, (t) => {
  const { dir, outside } = project(t);
  symlinkSync(join(outside, "victim.txt"), join(dir, "audio-data.json"));
  const run = extract(dir, "audio-data.json");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(join(outside, "victim.txt"), "utf8"), "KEEP");
  assert.ok(lstatSync(join(dir, "audio-data.json")).isFile());
  assert.equal(JSON.parse(readFileSync(join(dir, "audio-data.json"), "utf8")).fps, 30);
  assert.deepEqual(readdirSync(dir).sort(), ["audio-data.json", "in.wav"]);
});

test("an output folder that is a link is refused, and nothing is written there", { skip }, (t) => {
  const { dir, outside } = project(t);
  symlinkSync(outside, join(dir, "data"));
  const run = extract(dir, join("data", "audio-data.json"));
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /data: it is a link/);
  assert.deepEqual(readdirSync(outside), ["victim.txt"]);
});
