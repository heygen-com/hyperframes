// Fast-capture benchmark — renders a fixed set of opaque compositions in ONE
// capture mode (baseline or fast) and records wall-time + sample frames.
// Run once per mode (separate processes = no warm-cache cross-contamination),
// then feed both output dirs to de-benchmark-compare.mjs.
//
// Browser pool is disabled so each render gets a fresh browser (clean timing,
// no cross-mode contamination). Capture backend is controlled by
// PRODUCER_BROWSER_GPU_MODE (set it the SAME for both modes for a fair compare).
//
// Local:
//   PRODUCER_BROWSER_GPU_MODE=hardware bun de-benchmark.mjs baseline /tmp/bench/local-base
//   PRODUCER_BROWSER_GPU_MODE=hardware bun de-benchmark.mjs fast     /tmp/bench/local-fast
// Docker (SwiftShader): PRODUCER_BROWSER_GPU_MODE unset/software.

import { createRenderJob, executeRenderJob } from "./src/index.ts";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const MODE = process.argv[2]; // "baseline" | "fast"
const OUT = process.argv[3];
const REPS = Number.parseInt(process.argv[4] ?? "1", 10);
if (MODE !== "baseline" && MODE !== "fast") {
  console.error("usage: de-benchmark.mjs <baseline|fast> <outDir> [reps]");
  process.exit(2);
}

// Pure CSS/GSAP, opaque (mp4), no video/audio, fast page-ready — isolates
// capture cost.
const COMPS = [
  "gsap-letters-render-compat",
  "css-import-scoping",
  "font-variant-numeric",
];

process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE = MODE === "fast" ? "true" : "false";
process.env.PRODUCER_ENABLE_BROWSER_POOL = "false";

mkdirSync(OUT, { recursive: true });

function ffprobeFrames(mp4) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
        "stream=nb_read_frames", "-of", "default=nk=1:nw=1", mp4],
      { encoding: "utf8" },
    );
    return Number.parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function extractFrames(mp4, dir) {
  mkdirSync(dir, { recursive: true });
  // three frames at ~25/50/75% of the clip
  for (const [i, t] of [0.25, 0.5, 0.75].entries()) {
    try {
      execFileSync(
        "ffmpeg",
        ["-y", "-ss", String(t * 4), "-i", mp4, "-frames:v", "1",
          join(dir, `frame_${i}.png`)],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
    } catch {
      /* best effort */
    }
  }
}

async function main() {
  // Warmup: absorb one-time cold-start (Chrome launch, GPU probe, font/asset
  // init) so the timed renders below reflect steady-state capture cost.
  {
    const warm = createRenderJob({
      fps: 30, quality: "high", format: "mp4", workers: 1, useGpu: false, hdrMode: "force-sdr",
    });
    const t0 = Date.now();
    await executeRenderJob(warm, resolve("tests", COMPS[0], "src"), join(OUT, "_warmup.mp4"));
    console.log(`[bench:${MODE}] warmup = ${Date.now() - t0}ms (discarded)`);
  }

  const results = [];
  for (const comp of COMPS) {
    const projectDir = resolve("tests", comp, "src");
    const output = join(OUT, `${comp}.mp4`);
    let best = Infinity;
    for (let r = 0; r < REPS; r++) {
      const job = createRenderJob({
        fps: 30,
        quality: "high",
        format: "mp4",
        workers: 1,
        useGpu: false,
        hdrMode: "force-sdr",
      });
      const t0 = Date.now();
      await executeRenderJob(job, projectDir, output);
      const ms = Date.now() - t0;
      best = Math.min(best, ms);
      console.log(`[bench:${MODE}] ${comp} rep${r} = ${ms}ms`);
    }
    const frames = ffprobeFrames(output);
    extractFrames(output, join(OUT, comp));
    results.push({ comp, ms: best, frames });
  }
  writeFileSync(
    join(OUT, "timing.json"),
    JSON.stringify(
      { mode: MODE, platform: process.platform, arch: process.arch,
        browserGpuMode: process.env.PRODUCER_BROWSER_GPU_MODE ?? "software", results },
      null, 2,
    ),
  );
  console.log(`[bench:${MODE}] wrote ${join(OUT, "timing.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
