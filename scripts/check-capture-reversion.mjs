#!/usr/bin/env node
// Flags a capture region that briefly returns to an older picture (A, B, A frames).
// node scripts/check-capture-reversion.mjs [--crop=W:H:X:Y] [--window=N] [--change=D] [--same=D] [--timeout=S] <video>...
// Frames are cropped, 96px wide, gray; D is mean abs pixel diff (0-255). Exit 0 clean, 1 flagged, 2 could not check.

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WIDTH = 96;
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 86400;
const USAGE =
  "usage: node scripts/check-capture-reversion.mjs [--crop=W:H:X:Y] [--window=N] [--change=D] [--same=D] [--timeout=S] <video> ...";

/** Output frame height for a source of cw x ch scaled to WIDTH: even, at least 2. */
export function frameHeight(cw, ch) {
  return Math.max(2, 2 * Math.round((WIDTH * (ch / cw)) / 2));
}

const live = new Set();
const killGroup = (child) => {
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid);
  } catch {}
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    live.forEach(killGroup);
    process.exit(2);
  });
}

/** Runs a tool to completion, killing its whole process group if it outlives timeoutMs. */
function runTool(cmd, args, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: process.platform !== "win32" });
    const chunks = [];
    let stderr = "";
    live.add(child);
    const timer = setTimeout(() => {
      killGroup(child);
      reject(new Error(`${cmd} did not finish within ${timeoutMs / 1000}s for ${label}`));
    }, timeoutMs);
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (error) => {
      live.delete(child);
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      live.delete(child);
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${cmd} exited ${code} for ${label}: ${stderr}`));
    });
  });
}

function readFrames(path, crop, height, timeoutMs) {
  const scale = `scale=${WIDTH}:${height}:flags=area,format=gray`;
  const vf = crop ? `crop=${crop},${scale}` : scale;
  return runTool(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", vf, "-f", "rawvideo", "-"],
    timeoutMs,
    path,
  );
}

/** Source video size, used to derive the output frame height when no crop is given. */
async function probeSize(path, timeoutMs) {
  const args = ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height"];
  const out = await runTool("ffprobe", [...args, "-of", "csv=p=0", path], timeoutMs, path);
  const [w, h] = out.toString().trim().split(",").map(Number);
  if (!(w > 0) || !(h > 0)) throw new Error(`ffprobe found no video size in ${path}`);
  return [w, h];
}

function dist(buf, frameSize, a, b) {
  let sum = 0;
  const ao = a * frameSize;
  const bo = b * frameSize;
  for (let p = 0; p < frameSize; p++) sum += Math.abs(buf[ao + p] - buf[bo + p]);
  return sum / frameSize;
}

function peakBetween(buf, frameSize, i, k, change) {
  let peak = -1;
  let peakD = change;
  for (let j = i + 1; j < k; j++) {
    const d = Math.min(dist(buf, frameSize, i, j), dist(buf, frameSize, j, k));
    if (d > peakD) {
      peak = j;
      peakD = d;
    }
  }
  return { peak, delta: peakD };
}

// fallow-ignore-next-line complexity
export function findReversions(buf, frameSize, { window, change, same }, deadline = Infinity) {
  if (!Number.isInteger(frameSize) || frameSize <= 0) {
    throw new Error(`frame size must be a positive integer, got ${frameSize}`);
  }
  const count = Math.floor(buf.length / frameSize);
  const byPeak = new Map();
  for (let i = 0; i < count; i++) {
    for (let k = i + 2; k <= Math.min(count - 1, i + window); k++) {
      if (Date.now() > deadline) throw new Error("comparison did not finish within the time limit");
      if (dist(buf, frameSize, i, k) > same) continue;
      const { peak, delta } = peakBetween(buf, frameSize, i, k, change);
      const known = byPeak.get(peak);
      if (peak >= 0 && (!known || known.delta < delta)) {
        byPeak.set(peak, { from: i, changed: peak, back: k, delta });
      }
    }
  }
  return [...byPeak.values()].sort((x, y) => x.changed - y.changed);
}

/** Options and video paths from argv; throws on a malformed flag so a typo cannot read as "clean". */
export function parseArgs(argv) {
  const options = {
    crop: undefined,
    window: 20,
    change: 1.0,
    same: 0.25,
    timeout: DEFAULT_TIMEOUT_S,
  };
  const paths = [];
  for (const arg of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(arg);
    if (!m) {
      if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
      paths.push(arg);
    } else if (m[1] === "crop") {
      if (!/^[1-9]\d*:[1-9]\d*:\d+:\d+$/.test(m[2]))
        throw new Error(`--crop needs W:H:X:Y, got ${m[2]}`);
      options.crop = m[2];
    } else if (Object.hasOwn(options, m[1])) {
      const n = Number(m[2]);
      if (m[2] === "" || !Number.isFinite(n) || n < 0 || (m[1] === "timeout" && n > MAX_TIMEOUT_S))
        throw new Error(`--${m[1]} needs a number, got ${m[2]}`);
      options[m[1]] = n;
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }
  return { options, paths };
}

// fallow-ignore-next-line complexity
async function checkVideo(path, options) {
  const deadline = Date.now() + options.timeout * 1000;
  const left = () => Math.max(1, deadline - Date.now());
  const [cw, ch] = options.crop
    ? options.crop.split(":").map(Number)
    : await probeSize(path, left());
  const height = frameHeight(cw, ch);
  const frameSize = WIDTH * height;
  const buf = await readFrames(path, options.crop, height, left());
  const frames = Math.floor(buf.length / frameSize);
  if (frames === 0) throw new Error(`no frames decoded from ${path}`);
  const hits = findReversions(buf, frameSize, options, deadline);
  const crop = options.crop ? `  crop=${options.crop}` : "";
  console.log(
    `${hits.length ? "FLAGGED" : "clean"}  ${path}${crop}  (${frames} frames checked, 0-${frames - 1})`,
  );
  for (const h of hits) {
    console.log(
      `  frame ${h.changed} differs (mean diff ${h.delta.toFixed(2)}) between frame ${h.from} and frame ${h.back}, which match`,
    );
  }
  return hits.length > 0;
}

/** Checks every video; 2 if any could not be checked, else 1 if any is flagged, else 0. */
// fallow-ignore-next-line complexity
async function main(argv) {
  let code = 0;
  try {
    const { options, paths } = parseArgs(argv);
    if (paths.length === 0) throw new Error(USAGE);
    for (const path of paths) {
      try {
        if (await checkVideo(path, options)) code = Math.max(code, 1);
      } catch (error) {
        console.error(`check-capture-reversion: ${error.message}`);
        code = 2;
      }
    }
  } catch (error) {
    console.error(`check-capture-reversion: ${error.message}`);
    code = 2;
  }
  process.exit(code);
}

const entry = process.argv[1] && realpathSync(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
