import { execFileSync } from "node:child_process";
import { findFFprobe } from "../browser/ffmpeg.js";
import { c } from "../ui/colors.js";

/**
 * Result of probing a WebM's first video stream for its alpha sidecar.
 * `probed` distinguishes "ffprobe ran and reported a video stream" from a
 * failed/absent probe (so a probe failure stays silent, not a false warning).
 */
export interface WebmAlphaProbe {
  probed: boolean;
  /** True when the VP9 stream declares the alpha sidecar (ALPHA_MODE=1 tag). */
  alphaMode: boolean;
}

/**
 * Decide whether to warn that a WebM render lost its transparency, or
 * `undefined` when nothing is wrong / can't be determined.
 *
 * IMPORTANT — the signal is the `ALPHA_MODE=1` stream tag, NOT `pix_fmt`.
 * libvpx-vp9 stores the alpha plane in a Matroska BlockAdditional sidecar and
 * ALWAYS reports `pix_fmt=yuv420p` even for a correct transparent WebM (see
 * docs/guides/rendering.mdx and the webm-concat-copy smoke test). A working
 * encode writes `ALPHA_MODE=1`; an ffmpeg/libvpx build that can't emit the
 * sidecar omits the tag and produces genuinely opaque output. Keying on the
 * tag means builds that preserve alpha stay silent (no false positive) and
 * only builds that actually drop it get the warning.
 *
 * Pure over (format, probe) so the decision is unit-testable without spawning
 * ffprobe. Only WebM is checked; MP4 is intentionally opaque and MOV/PNG-seq
 * carry alpha through non-libvpx paths.
 */
export function webmAlphaAdvisory(format: string, probe: WebmAlphaProbe): string | undefined {
  if (format !== "webm") return undefined;
  if (!probe.probed || probe.alphaMode) return undefined;
  return (
    "The WebM output has no VP9 alpha sidecar (the ALPHA_MODE stream tag is absent), " +
    "so transparency was flattened to opaque. Your ffmpeg/libvpx-vp9 build cannot emit " +
    "the alpha plane on this platform. For guaranteed transparency, re-render with " +
    "--format mov (ProRes 4444)."
  );
}

/**
 * Best-effort ffprobe of a file's first video stream for the ALPHA_MODE tag.
 * Returns `{ probed: false }` on any failure (no ffprobe, spawn error,
 * unreadable file, no video stream) — this is a diagnostic, never a reason to
 * fail a completed render. The tag key is matched case-insensitively (ffprobe
 * surfaces it as `ALPHA_MODE`; some builds lower-case it).
 */
function probeWebmAlpha(filePath: string): WebmAlphaProbe {
  try {
    const ffprobePath = findFFprobe();
    if (!ffprobePath) return { probed: false, alphaMode: false };
    const raw = execFileSync(
      ffprobePath,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name:stream_tags=alpha_mode",
        "-of",
        "json",
        filePath,
      ],
      { encoding: "utf-8", timeout: 15_000 },
    );
    const parsed = JSON.parse(raw) as {
      streams?: Array<{ codec_name?: string; tags?: Record<string, string> }>;
    };
    const stream = parsed.streams?.[0];
    if (!stream || typeof stream.codec_name !== "string") {
      return { probed: false, alphaMode: false };
    }
    const tags = stream.tags ?? {};
    const alphaMode = Object.entries(tags).some(
      ([k, v]) => k.toLowerCase() === "alpha_mode" && String(v) === "1",
    );
    return { probed: true, alphaMode };
  } catch {
    return { probed: false, alphaMode: false };
  }
}

/**
 * After a completed WebM render, verify the output actually carries the alpha
 * sidecar. Some ffmpeg/libvpx-vp9 builds silently produce opaque output — the
 * render succeeds and looks fine in a player, but transparency is gone, which
 * the user only discovers after compositing. Surface it loudly here with the
 * concrete `--format mov` remedy. Best-effort and non-blocking; a build that
 * DOES preserve alpha (ALPHA_MODE=1) stays silent.
 */
export function warnIfWebmAlphaDropped(outputPath: string, format: string, quiet: boolean): void {
  if (quiet || format !== "webm") return;
  const advisory = webmAlphaAdvisory(format, probeWebmAlpha(outputPath));
  if (!advisory) return;
  console.warn(`\n${c.warn("⚠")}  ${c.bold("Transparency not preserved")}`);
  console.warn(`   ${c.dim(advisory)}\n`);
}
