import { execFileSync } from "node:child_process";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
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
  /**
   * When true, the tag says alpha but every decoded sample byte reads
   * alpha=255 — either the composition has no transparent regions in the
   * samples, or libvpx-vp9 wrote the tag without emitting the alpha side data
   * (a known Windows-build quirk). Undefined when the pixel-level probe
   * couldn't run (no ffmpeg, decode error, malformed byte count) — an
   * inconclusive probe is not a warning trigger.
   */
  sampledAlphaFullyOpaque?: boolean;
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
  if (!probe.probed) return undefined;
  if (!probe.alphaMode) {
    return (
      "The WebM output has no VP9 alpha sidecar (the ALPHA_MODE stream tag is absent), " +
      "so transparency was flattened to opaque. Your ffmpeg/libvpx-vp9 build cannot emit " +
      "the alpha plane on this platform. For guaranteed transparency, re-render with " +
      "--format mov (ProRes 4444)."
    );
  }
  if (probe.sampledAlphaFullyOpaque) {
    return (
      "The WebM declares alpha (ALPHA_MODE=1) but every sampled decoded pixel " +
      "reads alpha=255. This may be intentional (the composition has no transparent " +
      "regions in the samples) OR your ffmpeg/libvpx-vp9 build wrote the tag without " +
      "emitting the alpha side data — a known Windows-build quirk. To rule it out, " +
      "re-render with --format mov (ProRes 4444), or with --format png-sequence and " +
      "encode the frames yourself: ffmpeg -framerate <fps> -i frame_%06d.png " +
      "-c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le out.mov"
    );
  }
  return undefined;
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
    const probe: WebmAlphaProbe = { probed: true, alphaMode };
    if (alphaMode) {
      const opaque = sampledAlphaIsFullyOpaque(filePath);
      // Only surface `true`; leave undefined otherwise so #2044's "silent on
      // working alpha" fast path is preserved when the pixel probe can't run
      // OR when the sample has any partial/transparent pixel.
      if (opaque === true) probe.sampledAlphaFullyOpaque = true;
    }
    return probe;
  } catch {
    return { probed: false, alphaMode: false };
  }
}

/**
 * Bytes per sampled frame at 8x8 rgba: 8 * 8 * 4 = 256. `-frames:v 3` samples
 * AT MOST 3 frames — a legitimate 1-frame WebM (a still) yields 256 bytes and
 * a 2-frame yields 512, both valid opaque samples that must be evaluated.
 */
const BYTES_PER_SAMPLE_FRAME = 8 * 8 * 4;
const MAX_SAMPLE_BYTES = BYTES_PER_SAMPLE_FRAME * 3;

/**
 * Force the libvpx-vp9 decoder (default decoder silently discards VP9 alpha
 * — see docs/guides/rendering.mdx) and sample up to 3 frames at 8x8 rgba.
 * Returns `true` iff every alpha byte across all sampled frames is 255,
 * `false` when any pixel shows partial/full transparency, `undefined` if the
 * probe couldn't run (no ffmpeg, decode error, or the byte count is not a
 * positive whole-frame multiple ≤ 768 — anything else is a malformed decode,
 * not a signal).
 *
 * Exported for direct unit testing; the pixel-level contract is too load-
 * bearing to only exercise through `webmAlphaAdvisory`.
 */
export function sampledAlphaIsFullyOpaque(filePath: string): boolean | undefined {
  const ffmpegPath = findFFmpeg();
  if (!ffmpegPath) return undefined;
  try {
    const buf = execFileSync(
      ffmpegPath,
      [
        "-v",
        "error",
        "-c:v",
        "libvpx-vp9",
        "-i",
        filePath,
        "-frames:v",
        "3",
        "-vf",
        "scale=8:8",
        "-pix_fmt",
        "rgba",
        "-f",
        "rawvideo",
        "-",
      ],
      { timeout: 30_000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] },
    );
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
  } catch {
    return undefined;
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
