import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "./runFfmpeg.js";

// Up to 3 frames at 8x8 rgba; a 1- or 2-frame clip is still a whole sample.
const BYTES_PER_SAMPLE_FRAME = 8 * 8 * 4;
const MAX_SAMPLE_BYTES = BYTES_PER_SAMPLE_FRAME * 3;

/** true: every sampled alpha byte is 255; false: some transparency; undefined: malformed sample. */
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
 * Whether a video input that declares alpha decodes fully opaque (a remux can keep `alpha_mode=1`
 * while dropping the alpha sidecar). `decoder` must keep alpha. Any failure returns undefined.
 */
export async function probeInputAlphaPlane(
  videoPath: string,
  decoder: string,
  signal?: AbortSignal,
): Promise<boolean | undefined> {
  let probeDir: string | undefined;
  try {
    probeDir = mkdtempSync(join(tmpdir(), "hf-alpha-probe-"));
    const samplePath = join(probeDir, "alpha.raw");
    const result = await runFfmpeg(
      [
        "-v",
        "error",
        "-c:v",
        decoder,
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
      { timeout: 30_000, signal },
    );
    if (!result.success) return undefined;
    return sampledRgbaAlphaIsFullyOpaque(readFileSync(samplePath));
  } catch {
    return undefined;
  } finally {
    if (probeDir) rmSync(probeDir, { recursive: true, force: true });
  }
}

export function inputAlphaOpaqueWarning(src: string): string {
  return (
    `[hyperframes:render] WARNING: video src="${src}" declares an alpha channel ` +
    "but its first frames decode fully opaque. If it should be transparent, re-export " +
    "it with an alpha pixel format and avoid remuxing afterward, which can drop the " +
    "alpha while keeping the tag.\n"
  );
}
