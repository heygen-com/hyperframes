#!/usr/bin/env node
// Renders the starter at 320x180 in both modes and checks the pixels that come out:
// - out-of-order seeks (4 s, 0 s, 4 s) give byte-identical PNGs for the same time;
// - a second page load draws the same 4 s still as the first (no per-load noise);
// - exported MP4 frames are neither blank nor frozen, and no step between frames jumps
//   (path mode renders with two workers, so their chunks must join seamlessly).
// Needs ffmpeg on PATH. See README.md.
//
//   node verify-render.mjs                     # uses `npx hyperframes`
//   HYPERFRAMES_CLI=path/to/hyperframes.mjs node verify-render.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EXAMPLE = fileURLToPath(new URL("..", import.meta.url));
const WIDTH = 320;
const HEIGHT = 180;
const PATH_SAMPLES = 2;
// Setup includes the tracer's first shader run, which takes about a minute on a software GPU.
const READY_MS = "170000";
const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" };
const cli = process.env.HYPERFRAMES_CLI
  ? [process.execPath, process.env.HYPERFRAMES_CLI]
  : ["npx", "--yes", "hyperframes"];
const scratch = mkdtempSync(join(tmpdir(), "path-traced-3d-verify-"));
const report = { size: `${WIDTH}x${HEIGHT}`, pathSamples: PATH_SAMPLES, steps: [] };

function fail(message) {
  throw new Error(message);
}

function replaceOnce(text, from, to) {
  if (!text.includes(from)) fail(`index.html no longer contains ${from}`);
  return text.replace(from, to);
}

// A copy of the starter at a small size, with the renderer chosen through the variable defaults
// (snapshot has no --variables flag, so the defaults are what both commands read).
function makeProject(name, { renderer, duration }) {
  const dir = join(scratch, name);
  cpSync(join(EXAMPLE, "index.html"), join(dir, "index.html"));
  cpSync(join(EXAMPLE, "assets"), join(dir, "assets"), { recursive: true });
  let html = readFileSync(join(dir, "index.html"), "utf8");
  html = html.replaceAll("1920", String(WIDTH)).replaceAll("1080", String(HEIGHT));
  html = html.replaceAll('data-duration="6"', `data-duration="${duration}"`);
  html = replaceOnce(html, '"default":"raster"', `"default":"${renderer}"`);
  html = replaceOnce(html, '"default":64', `"default":${PATH_SAMPLES}`);
  writeFileSync(join(dir, "index.html"), html);
  return dir;
}

function run(label, args) {
  const started = performance.now();
  const result = spawnSync(cli[0], [...cli.slice(1), ...args], { env, encoding: "utf8" });
  const seconds = Number(((performance.now() - started) / 1000).toFixed(1));
  report.steps.push({ step: label, wallSeconds: seconds, exit: result.status });
  if (result.status !== 0) {
    fail(`${label} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function decode(file) {
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 30 },
  );
  if (result.status !== 0) fail(`ffmpeg could not decode ${file}: ${result.stderr}`);
  const frameBytes = WIDTH * HEIGHT * 3;
  const frames = [];
  for (let at = 0; at + frameBytes <= result.stdout.length; at += frameBytes) {
    frames.push(result.stdout.subarray(at, at + frameBytes));
  }
  return frames;
}

function spread(pixels) {
  let sum = 0;
  let squares = 0;
  for (const value of pixels) {
    sum += value;
    squares += value * value;
  }
  const mean = sum / pixels.length;
  return Math.sqrt(squares / pixels.length - mean * mean);
}

function meanDifference(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 16);

function checkSeekOrder(renderer) {
  const dir = makeProject(`${renderer}-seek`, { renderer, duration: 6 });
  const out = join(dir, "shots");
  run(`${renderer} snapshot 4s, 0s, 4s`, [
    "snapshot",
    dir,
    "--at",
    "4,0,4",
    "--no-end",
    "--timeout",
    READY_MS,
    "-o",
    out,
  ]);
  const files = readdirSync(out)
    .filter((file) => /^frame-\d+-at-.*\.png$/.test(file))
    .sort();
  if (files.length !== 3) fail(`${renderer}: expected 3 stills, found ${files.join(", ")}`);
  const hashes = files.map((file) => sha(readFileSync(join(out, file))));
  const frames = files.map((file) => decode(join(out, file))[0]);
  report[`${renderer}SeekHashes`] = Object.fromEntries(files.map((file, i) => [file, hashes[i]]));
  if (hashes[0] !== hashes[2]) fail(`${renderer}: 4 s differs after seeking back from 0 s`);
  if (hashes[0] === hashes[1]) fail(`${renderer}: 0 s and 4 s are identical, nothing moved`);
  for (const [i, frame] of frames.entries()) {
    if (spread(frame) < 4) fail(`${renderer}: ${files[i]} is blank`);
  }
  return { atZero: frames[1], atFourHash: hashes[0] };
}

function checkReload(renderer, firstHash) {
  const dir = makeProject(`${renderer}-reload`, { renderer, duration: 6 });
  const out = join(dir, "shots");
  run(`${renderer} snapshot 4s in a new page`, [
    "snapshot",
    dir,
    "--at",
    "4",
    "--no-end",
    "--timeout",
    READY_MS,
    "-o",
    out,
  ]);
  const file = readdirSync(out).find((name) => /^frame-\d+-at-.*\.png$/.test(name));
  const hash = sha(readFileSync(join(out, file)));
  report[`${renderer}ReloadHash`] = hash;
  if (hash !== firstHash)
    fail(`${renderer}: a new page drew 4 s differently (${hash} vs ${firstHash})`);
}

function checkExport(renderer, { duration, fps, workers }) {
  const dir = makeProject(`${renderer}-export`, { renderer, duration });
  const output = join(dir, "out.mp4");
  run(`${renderer} render ${duration} s at ${fps} fps`, [
    "render",
    dir,
    "--fps",
    String(fps),
    "--workers",
    String(workers),
    "--player-ready-timeout",
    READY_MS,
    "-o",
    output,
  ]);
  const frames = decode(output);
  const expected = Math.round(duration * fps);
  const spreads = frames.map((frame) => Number(spread(frame).toFixed(1)));
  const firstToLast = Number(meanDifference(frames[0], frames.at(-1)).toFixed(2));
  // A jump shows up as one step between neighbouring frames far larger than the typical one:
  // a cold first frame, or grain that changes where one worker's chunk meets the next.
  const steps = frames.slice(1).map((frame, i) => meanDifference(frames[i], frame));
  const median = [...steps].sort((a, b) => a - b)[steps.length >> 1];
  const stepRatios = steps.map((step) => Number((step / median).toFixed(2)));
  report[`${renderer}Export`] = {
    workers,
    frames: frames.length,
    spreads,
    firstToLast,
    stepRatios,
  };
  if (frames.length !== expected)
    fail(`${renderer}: ${frames.length} frames, expected ${expected}`);
  if (spreads.some((value) => value < 4)) fail(`${renderer}: an exported frame is blank`);
  if (firstToLast < 0.5) fail(`${renderer}: first and last exported frames look the same`);
  if (stepRatios.some((ratio) => ratio > 3)) fail(`${renderer}: a frame-to-frame step jumps`);
}

try {
  run("check", [
    "check",
    makeProject("check", { renderer: "path", duration: 6 }),
    "--timeout",
    READY_MS,
  ]);
  const raster = checkSeekOrder("raster");
  const path = checkSeekOrder("path");
  checkReload("path", path.atFourHash);
  report.rasterVsPathAtZero = Number(meanDifference(raster.atZero, path.atZero).toFixed(2));
  if (report.rasterVsPathAtZero < 0.5) fail("path mode drew the same pixels as raster mode");
  checkExport("raster", { duration: 1, fps: 30, workers: 1 });
  checkExport("path", { duration: 0.8, fps: 10, workers: 2 });
  console.log(JSON.stringify(report, null, 2));
  console.log("PASS");
} catch (error) {
  console.error(JSON.stringify(report, null, 2));
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (!process.env.KEEP_VERIFY_OUTPUT) rmSync(scratch, { recursive: true, force: true });
  else console.log(`kept ${scratch}`);
}
