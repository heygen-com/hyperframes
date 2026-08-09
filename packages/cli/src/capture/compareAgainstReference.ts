/**
 * `hyperframes compare --against <reference>`: measure a composition against
 * the artifact it is supposed to reproduce.
 *
 * Produces the three instruments an agent otherwise hand-builds every time:
 * a reference-over-replica contact sheet, a red/cyan deviation overlay, and
 * numeric ink-bounding-box + SSIM deltas per sampled time.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import sharp from "sharp";
import { findFFmpeg, getFFmpegInstallHint } from "../browser/ffmpeg.js";
import { createContactSheet } from "./contactSheet.js";
import {
  AUDIT_SEEK_OPTIONS,
  openSettledCompositionPage,
  runFfmpegOnce,
  seekCompositionTimeline,
} from "./captureCompositionFrame.js";
import { serveStaticProjectHtml } from "../utils/staticProjectServer.js";
import {
  boundsDeviation,
  inkBounds,
  meanAbsDiff,
  meanSignedDiff,
  parseSsimAll,
  redCyanOverlayRaw,
  type BoundsDeviation,
} from "../utils/referenceDiff.js";

const FFMPEG_TIMEOUT_MS = 60_000;
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
  ".mpeg",
  ".mpg",
  ".ogv",
]);

export interface ReferenceCompareOptions {
  /** Prepared replica project directory (contains index.html). */
  projectDir: string;
  /** Reference video or still image. */
  referencePath: string;
  /** Timeline times in seconds, sampled in both reference and replica. */
  times: number[];
  /** Contact sheet output path. */
  outPath: string;
  timeoutMs: number;
}

export interface ReferenceSample {
  time: number;
  /** Full-frame SSIM (1 = identical); null when ffmpeg could not measure it. */
  ssim: number | null;
  meanAbsDiff: number;
  /** Signed counterpart of meanAbsDiff; close to it means a uniform level shift. */
  meanSignedDiff: number;
  deviation: BoundsDeviation;
  overlay: string;
}

export interface ReferenceCompareResult {
  sheet: string;
  samples: ReferenceSample[];
  /** Lowest SSIM across samples, or null when none could be measured. */
  worstSsim: number | null;
}

function isVideoReference(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function overlayPathFor(outPath: string, index: number): string {
  const dir = dirname(outPath);
  const stem = basename(outPath, extname(outPath));
  return join(dir, `${stem}-overlay-${String(index + 1).padStart(2, "0")}.png`);
}

async function extractReferenceFrame(
  ffmpegPath: string,
  referencePath: string,
  time: number,
  outPath: string,
): Promise<void> {
  const result = await runFfmpegOnce(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(time),
      "-i",
      referencePath,
      "-frames:v",
      "1",
      "-y",
      outPath,
    ],
    FFMPEG_TIMEOUT_MS,
  );
  if (result.timedOut) {
    throw new Error(`ffmpeg timed out extracting the reference frame at t=${time}s`);
  }
  if (result.code !== 0 || !existsSync(outPath)) {
    const detail = result.stderr.trim() ? `: ${result.stderr.trim()}` : "";
    throw new Error(
      `ffmpeg could not extract a reference frame at t=${time}s (past the end of ${basename(referencePath)}?)${detail}`,
    );
  }
}

/** Screenshot the composition at every sampled time, reusing one browser session. */
async function captureReplicaFrames(
  options: ReferenceCompareOptions,
  frameDir: string,
): Promise<string[]> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const html = await bundleToSingleHtml(options.projectDir);
  const server = await serveStaticProjectHtml(options.projectDir, html);
  try {
    const { browser, page } = await openSettledCompositionPage(html, server.url, {
      renderReadyTimeoutMs: options.timeoutMs,
      renderReadyWarningSuffix: "reference comparison may be inaccurate",
    });
    try {
      const paths: string[] = [];
      for (const [index, time] of options.times.entries()) {
        // The producer bridge is the same seek target `render` drives, so a
        // video-backed composition lands on the frame the render would emit.
        await seekCompositionTimeline(page, time, AUDIT_SEEK_OPTIONS);
        const framePath = join(frameDir, `replica-${String(index + 1).padStart(2, "0")}.png`);
        await page.screenshot({ path: framePath, type: "png" });
        paths.push(framePath);
      }
      return paths;
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}

async function frameSsim(
  ffmpegPath: string,
  referencePath: string,
  replicaPath: string,
): Promise<number | null> {
  // ffmpeg's own ssim filter, rather than a reimplementation of the standard.
  const result = await runFfmpegOnce(
    ffmpegPath,
    [
      "-hide_banner",
      "-i",
      referencePath,
      "-i",
      replicaPath,
      "-lavfi",
      "[0:v][1:v]ssim",
      "-f",
      "null",
      "-",
    ],
    FFMPEG_TIMEOUT_MS,
  );
  if (result.timedOut || result.code !== 0) return null;
  return parseSsimAll(result.stderr);
}

async function grayscalePlane(path: string, width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp(path)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export async function compareAgainstReference(
  options: ReferenceCompareOptions,
): Promise<ReferenceCompareResult> {
  if (!existsSync(options.referencePath)) {
    throw new Error(`Reference not found: ${options.referencePath}`);
  }
  const ffmpegPath = findFFmpeg();
  if (!ffmpegPath) {
    throw new Error(`--against needs ffmpeg on PATH. Install it: ${getFFmpegInstallHint()}`);
  }

  const workDir = mkdtempSync(join(tmpdir(), "hf-compare-against-"));
  try {
    const referenceFrames: string[] = [];
    for (const [index, time] of options.times.entries()) {
      const framePath = join(workDir, `reference-${String(index + 1).padStart(2, "0")}.png`);
      if (isVideoReference(options.referencePath)) {
        await extractReferenceFrame(ffmpegPath, options.referencePath, time, framePath);
      } else {
        // A still reference is the same target at every sampled time.
        await sharp(options.referencePath).png().toFile(framePath);
      }
      referenceFrames.push(framePath);
    }

    const replicaFrames = await captureReplicaFrames(options, workDir);

    mkdirSync(dirname(options.outPath), { recursive: true });
    const samples: ReferenceSample[] = [];
    // Replicas are normalized to reference dimensions so SSIM, the overlay and
    // the sheet all read the same pixels.
    const normalizedReplicas: string[] = [];

    for (const [index, time] of options.times.entries()) {
      const referenceFrame = referenceFrames[index]!;
      const meta = await sharp(referenceFrame).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (width <= 0 || height <= 0) {
        throw new Error(`Could not read reference frame dimensions at t=${time}s`);
      }

      const normalized = join(workDir, `replica-norm-${String(index + 1).padStart(2, "0")}.png`);
      await sharp(replicaFrames[index]!).resize(width, height, { fit: "fill" }).toFile(normalized);
      normalizedReplicas.push(normalized);

      const referenceGray = await grayscalePlane(referenceFrame, width, height);
      const replicaGray = await grayscalePlane(normalized, width, height);

      const overlay = overlayPathFor(options.outPath, index);
      await sharp(redCyanOverlayRaw(referenceGray, replicaGray, width, height), {
        raw: { width, height, channels: 3 },
      })
        .png()
        .toFile(overlay);

      samples.push({
        time,
        ssim: await frameSsim(ffmpegPath, referenceFrame, normalized),
        meanAbsDiff: meanAbsDiff(referenceGray, replicaGray),
        meanSignedDiff: meanSignedDiff(referenceGray, replicaGray),
        deviation: boundsDeviation(
          inkBounds(referenceGray, width, height),
          inkBounds(replicaGray, width, height),
        ),
        overlay,
      });
    }

    await createContactSheet([...referenceFrames, ...normalizedReplicas], options.outPath, {
      cols: options.times.length,
      maxImages: options.times.length * 2,
      labelMode: "custom",
      labels: [
        ...options.times.map((time) => `reference t=${time}s`),
        ...options.times.map((time) => `replica t=${time}s`),
      ],
    });

    const measured = samples.flatMap((sample) => (sample.ssim === null ? [] : [sample.ssim]));
    return {
      sheet: options.outPath,
      samples,
      worstSsim: measured.length > 0 ? Math.min(...measured) : null,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
