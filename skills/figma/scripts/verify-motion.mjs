#!/usr/bin/env node
/**
 * Objective fidelity gate for figma-motion imports (skill step 2b).
 *
 * Compares the HyperFrames render against Figma's own `export_video` output
 * using MOTION-ENERGY deltas: for each sample window [t, t+interval], the
 * frame difference ref(t+i)-ref(t) is compared (PSNR) against
 * render(t+i)-render(t). Static import divergence (fonts, rasterized edges,
 * subpixel geometry — the hybrid-fidelity ceiling) cancels out of both
 * deltas, so the score isolates choreography: trajectories, timing, easing.
 *
 * Calibration (SDS "Unlocked" card, 2026-07): a faithful translation scored
 * min 20.3dB / mean 27.7dB; a diverging one (invented retract keyframes,
 * wrong durations) scored min 5.0dB / mean 23.1dB. Default threshold 15dB
 * sits between with margin on both sides.
 *
 *   node verify-motion.mjs --reference figma-export.mp4 --render out.mp4 \
 *     [--crop WxH+X+Y] [--interval 0.2] [--min-motion-psnr 15]
 *
 * --crop selects the card region inside the (usually larger) composition
 * frame. Measure it from the render (the card's left/top edge + scaled
 * size), don't guess: a wrong crop reads as motion divergence.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const reference = arg("reference");
const render = arg("render");
if (!reference || !render) {
  console.error(
    "usage: verify-motion.mjs --reference ref.mp4 --render out.mp4 [--crop WxH+X+Y] [--interval 0.2] [--min-motion-psnr 15]",
  );
  process.exit(2);
}
const crop = arg("crop", null);
const interval = Number(arg("interval", "0.2"));
const minMotion = Number(arg("min-motion-psnr", "15"));

const ffprobe = (file) =>
  Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ])
      .toString()
      .trim(),
  );
const refDur = ffprobe(reference);
const renderDur = ffprobe(render);
const end = Math.min(refDur, renderDur) - interval - 0.01;

const dims = execFileSync("ffprobe", [
  "-v",
  "error",
  "-select_streams",
  "v",
  "-show_entries",
  "stream=width,height",
  "-of",
  "csv=p=0",
  reference,
])
  .toString()
  .trim()
  .split(",")
  .map(Number);
const [rw, rh] = dims;

let cropFilter = "";
if (crop) {
  const m = crop.match(/^(\d+)x(\d+)\+(\d+)\+(\d+)$/);
  if (!m) {
    console.error("bad --crop, expected WxH+X+Y");
    process.exit(2);
  }
  cropFilter = `crop=${m[1]}:${m[2]}:${m[3]}:${m[4]},`;
}

const dir = mkdtempSync(join(tmpdir(), "verify-motion-"));
const frame = (src, t, vf, dst) => {
  const args = ["-y", "-v", "error", "-ss", String(t), "-i", src, "-frames:v", "1"];
  if (vf) args.push("-vf", vf);
  execFileSync("ffmpeg", args.concat(dst));
};
const diff = (a, b, dst) =>
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    a,
    "-i",
    b,
    "-filter_complex",
    "blend=all_mode=difference",
    dst,
  ]);
const psnr = (a, b) => {
  // spawnSync with array args (no shell): psnr stats land on stderr
  const r = spawnSync("ffmpeg", ["-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const m = (r.stderr || "").match(/average:([\d.]+|inf)/);
  return m ? (m[1] === "inf" ? 99 : Number(m[1])) : NaN;
};

const renderVf = `${cropFilter}scale=${rw}:${rh}`;
const results = [];
for (let t = 0; t <= end; t = Math.round((t + interval) * 1000) / 1000) {
  const t1 = Math.round((t + interval) * 1000) / 1000;
  frame(reference, t, null, join(dir, "ra.png"));
  frame(reference, t1, null, join(dir, "rb.png"));
  frame(render, t, renderVf, join(dir, "oa.png"));
  frame(render, t1, renderVf, join(dir, "ob.png"));
  diff(join(dir, "ra.png"), join(dir, "rb.png"), join(dir, "rd.png"));
  diff(join(dir, "oa.png"), join(dir, "ob.png"), join(dir, "od.png"));
  results.push({
    t,
    motion: psnr(join(dir, "rd.png"), join(dir, "od.png")),
    abs: psnr(join(dir, "rb.png"), join(dir, "ob.png")),
  });
}
rmSync(dir, { recursive: true, force: true });

const min = Math.min(...results.map((r) => r.motion));
const mean = results.reduce((s, r) => s + r.motion, 0) / results.length;
for (const r of results)
  console.log(
    `window ${r.t.toFixed(2)}s→${(r.t + interval).toFixed(2)}s  motion-psnr=${r.motion.toFixed(2)}dB  (abs=${r.abs.toFixed(1)}dB)${r.motion < minMotion ? "  <-- BELOW THRESHOLD" : ""}`,
  );
console.log(
  `\nwindows=${results.length} min-motion=${min.toFixed(2)}dB mean-motion=${mean.toFixed(2)}dB threshold=${minMotion}dB`,
);
if (min < minMotion) {
  console.log(
    "VERDICT: FAIL — choreography diverges from the Figma export (check timings, invented keyframes, durations)",
  );
  process.exit(1);
}
console.log("VERDICT: PASS — motion matches the Figma export within the static-fidelity ceiling");
