#!/usr/bin/env node
// paint.mjs — media-use paint: compile an image (or one video frame) into a
// standalone HyperFrames composition whose generated code repaints it in
// brushstrokes. Deterministic: same input + seed -> identical output files.
//
// Usage:
//   node paint.mjs --input photo.jpg [--out paint-photo] [options]
//
// The emitted folder is a standalone composition: mount it in a project, open
// it in Studio, or run `hyperframes check` on it as-is.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compileStrokes, DETAIL_PRESETS } from "./lib/paint-compiler.mjs";
import { emitComposition } from "./lib/paint-emit.mjs";

const WORK_LONG_EDGE = 640;

const { values: args } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    out: { type: "string", short: "o" },
    seed: { type: "string", default: "1337" },
    width: { type: "string", default: "1100" },
    duration: { type: "string", default: "12" },
    detail: { type: "string", default: "medium" },
    "video-position": { type: "string", default: "0" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (args.help || !args.input) {
  console.log(`media-use paint — compile an image into a brushstroke-code composition

Usage:
  node paint.mjs --input photo.jpg [--out paint-photo] [options]

The emitted folder is a standalone HyperFrames composition (index.html,
strokes.js, painter.js). strokes.js is the editable stroke data; painter.js
reveals it over --duration seconds and is seek-safe.

Options:
  --input <path>         source image or video (one frame is sampled)
  --out <dir>            output folder (default: paint-<basename>)
  --seed <n>             stroke randomness seed (default 1337)
  --width <px>           emitted canvas width (default 1100)
  --duration <s>         reveal duration in seconds (default 12)
  --detail <level>       low | medium | high (default medium)
  --video-position <s>   frame sample time for video inputs (default 0)
  --json                 machine-readable summary
  -h, --help`);
  process.exit(args.help ? 0 : 1);
}

const inputPath = resolve(String(args.input));
const detail = String(args.detail ?? "medium");
const layers = DETAIL_PRESETS[/** @type {"low" | "medium" | "high"} */ (detail)];
if (!layers) {
  console.error(`unknown --detail "${detail}": use low, medium, or high`);
  process.exit(1);
}
const seed = Number(args.seed);
const displayWidth = Number(args.width);
const duration = Number(args.duration);
if (!Number.isFinite(seed) || !Number.isFinite(displayWidth) || !Number.isFinite(duration)) {
  console.error("--seed, --width, and --duration must be numbers");
  process.exit(1);
}

function fail(message) {
  if (args.json) console.log(JSON.stringify({ error: message }));
  else console.error("error: " + message);
  process.exit(1);
}

function probe(path) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      path,
    ],
    { maxBuffer: 1024 * 1024, encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  const stream = parsed?.streams?.[0];
  if (!stream?.width || !stream?.height) fail("no video stream found in input");
  return { width: stream.width, height: stream.height };
}

async function decodeRgba(path, w, h, videoPosition) {
  const seek = Number(videoPosition) > 0 ? ["-ss", String(Number(videoPosition))] : [];
  const frameBytes = w * h * 4;
  const chunks = [];
  const child = spawn(
    "ffmpeg",
    [
      ...seek,
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      `scale=${w}:${h}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  const code = await new Promise((resolvePromise) => {
    child.on("exit", (c) => resolvePromise(c ?? 1));
    child.on("error", () => resolvePromise(1));
  });
  if (code !== 0) fail("ffmpeg failed to decode the input");
  const rgba = Buffer.concat(chunks);
  if (rgba.length !== frameBytes) fail(`decoded ${rgba.length} bytes; expected ${frameBytes}`);
  return new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
}

const meta = probe(inputPath);
const scale = Math.min(1, WORK_LONG_EDGE / Math.max(meta.width, meta.height));
const workW = Math.max(2, Math.round(meta.width * scale));
const workH = Math.max(2, Math.round(meta.height * scale));
const px = await decodeRgba(inputPath, workW, workH, args["video-position"]);

const compiled = compileStrokes(px, workW, workH, {
  seed,
  width: displayWidth,
  layers,
  paletteSize: 22,
  angleSmoothing: 4,
});

const outDir = resolve(String(args.out ?? `paint-${basename(inputPath).replace(/\.[^.]+$/, "")}`));
const files = emitComposition({
  id: `paint-${basename(inputPath)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .toLowerCase()}`,
  strokes: compiled.strokes,
  width: compiled.width,
  height: compiled.height,
  duration,
  background: compiled.background,
});
mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(outDir, name), content);
}

const summary = {
  out: outDir,
  files: Object.keys(files),
  strokes: compiled.strokes.length,
  width: compiled.width,
  height: compiled.height,
  duration,
  seed,
  detail,
  next: [`npx hyperframes check ${outDir}`, `npx hyperframes preview ${outDir}`],
};
if (args.json) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`paint: ${compiled.strokes.length} strokes -> ${outDir}`);
  console.log(`  ${Object.keys(files).join(", ")}`);
  console.log(`  validate: npx hyperframes check ${outDir}`);
}
