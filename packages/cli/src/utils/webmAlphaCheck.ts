import { execFileSync } from "node:child_process";
import { findFFprobe } from "../browser/ffmpeg.js";
import { c } from "../ui/colors.js";

/**
 * True when an ffprobe `pix_fmt` string carries an alpha channel.
 *
 * HyperFrames always requests an alpha-capable pixel format for WebM
 * (`yuva420p`), so a probed WebM output that lacks alpha proves the local
 * ffmpeg/libvpx build silently dropped the alpha plane during encode.
 *
 * Covers the alpha families ffmpeg reports: planar YUV+A (`yuva*`), planar
 * RGB+A (`gbrap*`), grayscale+A (`ya8`/`ya16le`), and packed RGBA variants.
 */
export function pixelFormatHasAlpha(pixFmt: string): boolean {
  const f = pixFmt.trim().toLowerCase();
  if (!f) return false;
  return (
    f.startsWith("yuva") ||
    f.startsWith("gbrap") ||
    f.startsWith("ya") ||
    /rgba|argb|abgr|bgra/.test(f)
  );
}

/**
 * Advisory message when a WebM render lost its requested alpha channel, or
 * `undefined` when nothing is wrong / can't be determined.
 *
 * Pure over (format, probed pix_fmt) so the decision is unit-testable without
 * spawning ffprobe. Only WebM is checked — it's the format HyperFrames encodes
 * with `yuva420p`; MP4 is intentionally opaque and MOV/PNG-sequence carry alpha
 * through paths that don't hit libvpx-vp9. A missing `pixFmt` (probe failed)
 * stays silent rather than warning speculatively.
 */
export function webmAlphaAdvisory(format: string, pixFmt: string | undefined): string | undefined {
  if (format !== "webm") return undefined;
  if (!pixFmt || pixelFormatHasAlpha(pixFmt)) return undefined;
  return (
    `The WebM output is ${pixFmt} (opaque). Your ffmpeg build's VP9 encoder did not ` +
    `preserve the alpha channel HyperFrames requested (yuva420p), so any transparency ` +
    `was flattened. For guaranteed transparency, re-render with --format mov (ProRes 4444).`
  );
}

/**
 * Best-effort ffprobe of a file's first video stream `pix_fmt`. Returns
 * `undefined` on any failure (no ffprobe, spawn error, unreadable file) — this
 * is a diagnostic, never a reason to fail a completed render.
 */
function probeVideoPixelFormat(filePath: string): string | undefined {
  try {
    const ffprobePath = findFFprobe();
    if (!ffprobePath) return undefined;
    const raw = execFileSync(
      ffprobePath,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=pix_fmt",
        "-of",
        "default=nw=1:nk=1",
        filePath,
      ],
      { encoding: "utf-8", timeout: 15_000 },
    );
    return raw.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * After a completed WebM render, verify the output actually carries the alpha
 * channel HyperFrames requested. Some ffmpeg/libvpx builds silently encode
 * VP9 as opaque `yuv420p` even when handed alpha input and `-pix_fmt yuva420p`
 * — the render succeeds and looks fine in a player, but transparency is gone,
 * which the user only discovers after compositing. Surface it loudly here with
 * the concrete `--format mov` remedy. Best-effort and non-blocking.
 */
export function warnIfWebmAlphaDropped(outputPath: string, format: string, quiet: boolean): void {
  if (quiet || format !== "webm") return;
  const advisory = webmAlphaAdvisory(format, probeVideoPixelFormat(outputPath));
  if (!advisory) return;
  console.warn(`\n${c.warn("⚠")}  ${c.bold("Transparency not preserved")}`);
  console.warn(`   ${c.dim(advisory)}\n`);
}
