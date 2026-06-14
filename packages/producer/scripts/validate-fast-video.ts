/**
 * Validate the fast-capture (drawElementImage) VIDEO path on real Linux.
 *
 * drawElementImage draws a snapshot taken at the paint event; capturing video
 * needs a fresh per-frame paint. On Linux headless-shell that paint comes from
 * the per-frame HeadlessExperimental.beginFrame — so video should capture
 * correctly there (see docs/fast-capture-limitations.md, Limitation 2). This
 * could not be validated under Docker-on-rosetta (renders hung); this script is
 * meant to run on a native amd64 Linux runner inside Dockerfile.test.
 *
 * Renders a video composition twice — baseline (screenshot) and fast
 * (drawElement) — and asserts the fast output matches the baseline (PSNR above
 * threshold), proving the video was captured and not dropped to black.
 *
 *   PRODUCER_VALIDATE_COMP=sub-composition-video \
 *   bunx tsx scripts/validate-fast-video.ts
 *
 * Exit 0 = fast video matches baseline; exit 1 = regression (black/stale video).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRenderJob, executeRenderJob } from "../src/index.js";

// `||` not `??` — the workflow passes empty strings on a push trigger (inputs
// are only populated for workflow_dispatch), and "" must fall through to the default.
const COMP = process.env.PRODUCER_VALIDATE_COMP || "sub-composition-video";
const MIN_PSNR = Number.parseFloat(process.env.PRODUCER_VALIDATE_MIN_PSNR || "25");
const work = mkdtempSync(join(tmpdir(), "fastvideo-"));

process.env.PRODUCER_ENABLE_BROWSER_POOL = "false";

async function render(mode: "baseline" | "fast", out: string): Promise<void> {
  process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE = mode === "fast" ? "true" : "false";
  const job = createRenderJob({
    fps: 30,
    quality: "high",
    format: "mp4",
    workers: 1,
    useGpu: false,
    hdrMode: "force-sdr",
  });
  await executeRenderJob(job, resolve("tests", COMP, "src"), out);
}

function psnr(a: string, b: string): number {
  const out = execFileSync(
    "bash",
    ["-c", `ffmpeg -y -i "${a}" -i "${b}" -lavfi psnr -f null - 2>&1`],
    { encoding: "utf8" },
  );
  const m = out.match(/average:(\S+)/);
  if (!m) throw new Error(`ffmpeg psnr produced no average:\n${out}`);
  return m[1] === "inf" ? Number.POSITIVE_INFINITY : Number.parseFloat(m[1]);
}

async function main(): Promise<void> {
  const baseline = join(work, "baseline.mp4");
  const fast = join(work, "fast.mp4");
  console.log(`[validate-fast-video] comp=${COMP} minPsnr=${MIN_PSNR}`);
  await render("baseline", baseline);
  await render("fast", fast);
  const db = psnr(baseline, fast);
  console.log(`[validate-fast-video] fast-vs-baseline PSNR = ${db} dB`);
  if (db < MIN_PSNR) {
    console.error(
      `[validate-fast-video] FAIL — ${db} dB < ${MIN_PSNR} dB. Fast capture dropped video ` +
        `(stale/black snapshot). The Linux BeginFrame paint path is not capturing video.`,
    );
    process.exit(1);
  }
  console.log("[validate-fast-video] PASS — fast video matches baseline.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
