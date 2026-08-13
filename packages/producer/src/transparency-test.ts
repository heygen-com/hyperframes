/**
 * Transparency Regression Test
 *
 * Exercises the alpha-output pipelines (webm + gif + png-sequence) end-to-end
 * against `tests/transparency-regression/`, then renders the real page-side
 * shader fixture to GIF. Asserts that:
 *
 *   1. Pixels that were transparent in the browser stay transparent in the
 *      output (alpha = 0).
 *   2. Pixels covered by the opaque red `.card` element stay fully opaque
 *      (alpha = 255) and keep their red color.
 *   3. GIF's RGBA disk-frame path still captures the authored WebGL shader
 *      transition instead of the virtual-time DOM fallback.
 *
 * This is intentionally NOT wired into `regression-harness.ts` — the harness
 * compares each fixture against a golden MP4, but transparency requires a
 * different validation strategy (pixel inspection of the alpha channel). Run
 * this script via `bun run --filter @hyperframes/producer test:transparency`
 * or directly via `tsx src/transparency-test.ts` from this package.
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodePng, psnrDb, runFfmpeg } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "./services/renderOrchestrator.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(moduleDir, "../tests/transparency-regression");
const FIXTURE_SRC = join(FIXTURE_DIR, "src");
const SHADER_FIXTURE_DIR = resolve(moduleDir, "../tests/page-side-shader-compositor-render-compat");
const SHADER_FIXTURE_SRC = join(SHADER_FIXTURE_DIR, "src");
const SHADER_GOLDEN = join(SHADER_FIXTURE_DIR, "output", "output.mp4");

const WIDTH = 200;
const HEIGHT = 200;
const FPS: import("@hyperframes/core").Fps = { num: 30, den: 1 };
const PNG_SEQUENCE_FRAME_COUNT = FPS.num / FPS.den;
const TRANSPARENT_X = 10; // expected fully transparent
const TRANSPARENT_Y = 10;
const OPAQUE_X = 100; // inside the 50–150 red card
const OPAQUE_Y = 100;

function pixelOffset(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function assertAlphaPixel(
  png: { data: Uint8Array; width: number; height: number },
  x: number,
  y: number,
  expectAlpha: "transparent" | "opaque-red",
  label: string,
): void {
  assert.equal(png.width, WIDTH, `${label}: width mismatch`);
  assert.equal(png.height, HEIGHT, `${label}: height mismatch`);
  const off = pixelOffset(x, y, png.width);
  const r = png.data[off + 0];
  const g = png.data[off + 1];
  const b = png.data[off + 2];
  const a = png.data[off + 3];
  if (expectAlpha === "transparent") {
    assert.equal(
      a,
      0,
      `${label}: pixel (${x},${y}) expected fully transparent (alpha=0), got rgba(${r},${g},${b},${a})`,
    );
  } else {
    assert.equal(
      a,
      255,
      `${label}: pixel (${x},${y}) expected fully opaque (alpha=255), got rgba(${r},${g},${b},${a})`,
    );
    assert.ok(
      typeof r === "number" && r >= 240,
      `${label}: pixel (${x},${y}) expected red >= 240, got rgba(${r},${g},${b},${a})`,
    );
    assert.ok(
      typeof g === "number" && g <= 30,
      `${label}: pixel (${x},${y}) expected green <= 30, got rgba(${r},${g},${b},${a})`,
    );
    assert.ok(
      typeof b === "number" && b <= 30,
      `${label}: pixel (${x},${y}) expected blue <= 30, got rgba(${r},${g},${b},${a})`,
    );
  }
}

async function extractFirstFrameFromWebm(webmPath: string, outPng: string): Promise<void> {
  // VP9 alpha is encoded as a separate intra-frame stream inside the WebM,
  // and ffmpeg's default decoder path silently discards it. Forcing the
  // libvpx-vp9 decoder via `-c:v libvpx-vp9` BEFORE `-i` is what engages
  // the alpha-aware decode — without it the captured transparent pixels
  // come out opaque even when the file was correctly encoded as yuva420p.
  // `-update 1` permits writing a single PNG (no `%d` pattern in the path)
  // and silences the otherwise-noisy ffmpeg warning.
  const result = await runFfmpeg(
    [
      "-y",
      "-c:v",
      "libvpx-vp9",
      "-i",
      webmPath,
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgba",
      "-update",
      "1",
      outPng,
    ],
    { timeout: 60_000 },
  );
  if (!result.success) {
    throw new Error(
      `ffmpeg failed extracting frame 0 from ${webmPath}: ${result.stderr.slice(-400)}`,
    );
  }
}

async function extractFirstFrameFromGif(gifPath: string, outPng: string): Promise<void> {
  const result = await runFfmpeg(
    ["-y", "-i", gifPath, "-frames:v", "1", "-pix_fmt", "rgba", "-update", "1", outPng],
    { timeout: 60_000 },
  );
  if (!result.success) {
    throw new Error(
      `ffmpeg failed extracting frame 0 from ${gifPath}: ${result.stderr.slice(-400)}`,
    );
  }
}

async function extractFrameAtIndex(
  inputPath: string,
  frameIndex: number,
  outPng: string,
): Promise<void> {
  const result = await runFfmpeg(
    [
      "-y",
      "-i",
      inputPath,
      "-vf",
      `select=eq(n\\,${frameIndex})`,
      "-frames:v",
      "1",
      "-update",
      "1",
      outPng,
    ],
    { timeout: 60_000 },
  );
  if (!result.success) {
    throw new Error(
      `ffmpeg failed extracting frame ${frameIndex} from ${inputPath}: ${result.stderr.slice(-400)}`,
    );
  }
}

async function runWebmCheck(workRoot: string): Promise<void> {
  console.log("\n[webm] rendering transparency-regression …");
  const outDir = join(workRoot, "webm");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "out.webm");

  const job = createRenderJob({
    fps: FPS,
    quality: "draft",
    format: "webm",
  });

  await executeRenderJob(job, FIXTURE_SRC, outPath);
  assert.equal(job.status, "complete", `webm render did not complete: status=${job.status}`);
  assert.ok(existsSync(outPath), `webm output not written to ${outPath}`);
  const size = (await import("node:fs")).statSync(outPath).size;
  assert.ok(size > 0, `webm output ${outPath} is empty`);
  console.log(`[webm] rendered ${outPath} (${size} bytes)`);

  const framePng = join(outDir, "frame-0.png");
  await extractFirstFrameFromWebm(outPath, framePng);
  const decoded = decodePng(readFileSync(framePng));
  assertAlphaPixel(decoded, TRANSPARENT_X, TRANSPARENT_Y, "transparent", "webm");
  assertAlphaPixel(decoded, OPAQUE_X, OPAQUE_Y, "opaque-red", "webm");
  console.log("[webm] PASS — transparent + opaque-red pixels verified");
}

async function runGifCheck(workRoot: string): Promise<void> {
  console.log("\n[gif] rendering transparency-regression …");
  const outDir = join(workRoot, "gif");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "out.gif");

  const job = createRenderJob({
    fps: { num: 15, den: 1 },
    quality: "draft",
    format: "gif",
    gifLoop: 0,
  });

  await executeRenderJob(job, FIXTURE_SRC, outPath);
  assert.equal(job.status, "complete", `gif render did not complete: status=${job.status}`);
  assert.ok(existsSync(outPath), `gif output not written to ${outPath}`);
  const size = (await import("node:fs")).statSync(outPath).size;
  assert.ok(size > 0, `gif output ${outPath} is empty`);
  console.log(`[gif] rendered ${outPath} (${size} bytes)`);

  const framePng = join(outDir, "frame-0.png");
  await extractFirstFrameFromGif(outPath, framePng);
  const decoded = decodePng(readFileSync(framePng));
  assertAlphaPixel(decoded, TRANSPARENT_X, TRANSPARENT_Y, "transparent", "gif");
  assertAlphaPixel(decoded, OPAQUE_X, OPAQUE_Y, "opaque-red", "gif");
  console.log("[gif] PASS — transparent + opaque-red pixels verified");
}

async function runGifShaderTransitionCheck(workRoot: string): Promise<void> {
  console.log("\n[gif-shader] rendering page-side shader transition …");
  const outDir = join(workRoot, "gif-shader");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "out.gif");

  const job = createRenderJob({
    fps: { num: 15, den: 1 },
    quality: "draft",
    format: "gif",
    gifLoop: 0,
    workers: 1,
  });

  await executeRenderJob(job, SHADER_FIXTURE_SRC, outPath);
  assert.equal(job.status, "complete", `gif shader render did not complete: status=${job.status}`);
  assert.ok(existsSync(outPath), `gif shader output not written to ${outPath}`);

  const gifBefore = join(outDir, "gif-before.png");
  const gifTransition = join(outDir, "gif-transition.png");
  const goldenBefore = join(outDir, "golden-before.png");
  const goldenTransition = join(outDir, "golden-transition.png");
  await Promise.all([
    extractFrameAtIndex(outPath, 7, gifBefore),
    extractFrameAtIndex(outPath, 17, gifTransition),
    extractFrameAtIndex(SHADER_GOLDEN, 14, goldenBefore),
    extractFrameAtIndex(SHADER_GOLDEN, 34, goldenTransition),
  ]);

  const beforePsnr = await psnrDb(readFileSync(gifBefore), readFileSync(goldenBefore));
  const transitionPsnr = await psnrDb(readFileSync(gifTransition), readFileSync(goldenTransition));
  assert.ok(
    beforePsnr >= 25,
    `gif shader control frame expected >=25 dB against the golden, got ${beforePsnr.toFixed(2)} dB`,
  );
  assert.ok(
    transitionPsnr >= 20,
    `gif shader transition expected >=20 dB against the golden, got ${transitionPsnr.toFixed(2)} dB`,
  );
  console.log(
    `[gif-shader] PASS — control ${beforePsnr.toFixed(2)} dB, transition ${transitionPsnr.toFixed(2)} dB`,
  );
}

async function runPngSequenceCheck(workRoot: string): Promise<void> {
  console.log("\n[png-sequence] rendering transparency-regression …");
  const outDir = join(workRoot, "pngs");
  // executeRenderJob mkdirs outputPath itself; deliberately leave it absent.

  const job = createRenderJob({
    fps: FPS,
    quality: "draft",
    format: "png-sequence",
  });

  await executeRenderJob(job, FIXTURE_SRC, outDir);
  assert.equal(
    job.status,
    "complete",
    `png-sequence render did not complete: status=${job.status}`,
  );
  assert.ok(existsSync(outDir), `png-sequence output dir missing: ${outDir}`);

  const frames = readdirSync(outDir)
    .filter((name) => name.startsWith("frame_") && name.endsWith(".png"))
    .sort();
  assert.equal(
    frames.length,
    PNG_SEQUENCE_FRAME_COUNT, // 1 second at 30fps = 30 frames
    `png-sequence expected ${PNG_SEQUENCE_FRAME_COUNT} frames, got ${frames.length}: ${frames.join(",")}`,
  );
  assert.equal(frames[0], "frame_000001.png", "first frame should be frame_000001.png");
  assert.equal(
    frames[frames.length - 1],
    `frame_${String(PNG_SEQUENCE_FRAME_COUNT).padStart(6, "0")}.png`,
    `last frame should be frame_${String(PNG_SEQUENCE_FRAME_COUNT).padStart(6, "0")}.png`,
  );
  console.log(`[png-sequence] wrote ${frames.length} frames to ${outDir}`);

  const firstFrame = frames[0];
  if (!firstFrame) throw new Error("png-sequence: first frame missing");
  const decoded = decodePng(readFileSync(join(outDir, firstFrame)));
  assertAlphaPixel(decoded, TRANSPARENT_X, TRANSPARENT_Y, "transparent", "png-sequence");
  assertAlphaPixel(decoded, OPAQUE_X, OPAQUE_Y, "opaque-red", "png-sequence");
  console.log("[png-sequence] PASS — transparent + opaque-red pixels verified");
}

async function main(): Promise<void> {
  if (!existsSync(FIXTURE_SRC)) {
    throw new Error(`Fixture missing: ${FIXTURE_SRC}`);
  }
  if (!existsSync(SHADER_FIXTURE_SRC) || !existsSync(SHADER_GOLDEN)) {
    throw new Error(`Shader fixture or golden missing: ${SHADER_FIXTURE_DIR}`);
  }
  const workRoot = mkdtempSync(join(tmpdir(), "hf-transparency-"));
  const keepWork = process.env.KEEP_TEMP === "1";
  console.log(`work dir: ${workRoot}${keepWork ? " (KEEP_TEMP=1)" : ""}`);

  try {
    await runWebmCheck(workRoot);
    await runGifCheck(workRoot);
    await runGifShaderTransitionCheck(workRoot);
    await runPngSequenceCheck(workRoot);
    console.log("\nAll transparency assertions passed.");
  } finally {
    if (!keepWork) {
      try {
        rmSync(workRoot, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}

main().catch((err) => {
  console.error("\nTransparency regression test FAILED:");
  console.error(err);
  process.exitCode = 1;
});
