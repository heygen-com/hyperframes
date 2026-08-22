/**
 * Alpha-plane probe for video INPUTS.
 *
 * `alpha_mode=1` (or an alpha-capable `pix_fmt`) is metadata that can outlive
 * the alpha it describes: a remux can keep the tag while dropping the
 * BlockAdditional sidecar that carries the VP9 alpha plane, so a file can
 * keep promising transparency it no longer contains. Such an input renders
 * as a solid opaque rectangle over whatever is beneath it, and nothing tells
 * the user their file — not the renderer — is the problem.
 *
 * This module answers one question about a video input: it declares alpha,
 * but does the decoded alpha plane come out uniformly opaque? The answer is
 * surfaced as a warning only, never an error — an opaque video used as a
 * full-frame background is perfectly legitimate, so this can never fail a
 * render.
 *
 * The sibling CLI-side check (`packages/cli/src/utils/webmAlphaCheck.ts`)
 * verifies the same property on the render OUTPUT after a WebM encode; this
 * probe is the input-side counterpart, implemented in the engine so it runs
 * for every render path (local CLI, Docker, cloud) at the point where all
 * input metadata is already in hand.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "./runFfmpeg.js";

/**
 * Bytes per sampled frame at 8x8 rgba: 8 * 8 * 4 = 256. `-frames:v 3` samples
 * AT MOST 3 frames — a legitimate 1-frame WebM (a still) yields 256 bytes and
 * a 2-frame yields 512, both valid opaque samples that must be evaluated.
 * Mirrors the byte accounting in the CLI's `webmAlphaCheck.sampledAlphaIsFullyOpaque`.
 */
const BYTES_PER_SAMPLE_FRAME = 8 * 8 * 4;
const MAX_SAMPLE_BYTES = BYTES_PER_SAMPLE_FRAME * 3;

/**
 * Decode a raw rgba sample buffer and decide whether the alpha plane is
 * uniformly opaque. Pure — exported so tests exercise the shipped byte logic
 * directly without spawning ffmpeg.
 *
 * Returns:
 *  - `true`  — every alpha byte across all sampled frames is 255;
 *  - `false` — any pixel shows partial or full transparency;
 *  - `undefined` — the sample is malformed (empty, oversized, or not a
 *    positive whole-frame byte count). An inconclusive probe is not a warning
 *    trigger.
 */
export function sampledRgbaAlphaIsFullyOpaque(buf: Buffer): boolean | undefined {
  if (
    buf.length === 0 ||
    buf.length > MAX_SAMPLE_BYTES ||
    buf.length % BYTES_PER_SAMPLE_FRAME !== 0
  ) {
    return undefined;
  }
  for (let i = 3; i < buf.length; i += 4) {
    if (buf[i] !== 255) return false;
  }
  return true;
}

/**
 * Sample a video input's alpha plane and report whether it decodes fully
 * opaque. Runs ffmpeg with the libvpx-vp9 input decoder forced (the default
 * decoder silently discards VP9 alpha), sampling up to 3 frames at 8x8 rgba —
 * the same command the CLI's post-render WebM check uses. The decision to
 * sample a few frames rather than the first frame only is deliberate: it
 * catches a clip that is opaque at the head and transparent later, at a fixed
 * ~768-byte ceiling.
 *
 * Best-effort and non-blocking: any failure (missing binary, decode error,
 * malformed output) returns `undefined` — a diagnostic can never take down a
 * render.
 */
export async function probeInputAlphaPlane(videoPath: string): Promise<boolean | undefined> {
  const probeDir = mkdtempSync(join(tmpdir(), "hf-alpha-probe-"));
  const samplePath = join(probeDir, "alpha.raw");
  try {
    const result = await runFfmpeg(
      [
        "-v",
        "error",
        "-c:v",
        "libvpx-vp9",
        "-i",
        videoPath,
        "-frames:v",
        "3",
        "-vf",
        "scale=8:8",
        "-pix_fmt",
        "rgba",
        "-f",
        "rawvideo",
        samplePath,
      ],
      { timeout: 30_000 },
    );
    if (!result.success) return undefined;
    let buf: Buffer;
    try {
      buf = readFileSync(samplePath);
    } catch {
      return undefined;
    }
    return sampledRgbaAlphaIsFullyOpaque(buf);
  } catch {
    return undefined;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

/**
 * The stderr warning line written when a video input declares alpha but its
 * decoded alpha plane is uniformly opaque. Matches the existing
 * `[hyperframes:render] WARNING:` convention in videoFrameExtractor (missing
 * src, unwritable cache dir) so the same surface carries the same shape.
 * Pure — exported for tests.
 */
export function inputAlphaOpaqueWarning(src: string): string {
  return (
    `[hyperframes:render] WARNING: video src="${src}" declares an alpha channel ` +
    "but decodes fully opaque. Transparency will not composite. If it should " +
    "be transparent, re-export with `-pix_fmt yuva420p` and avoid remuxing " +
    "afterward, which can drop the alpha sidecar while keeping the tag.\n"
  );
}
