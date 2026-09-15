import { maskNonScannableRanges } from "@hyperframes/parsers/asset-resolution";
import {
  resolveLocalMediaCandidate,
  type HtmlSourceLike,
  type MediaStreamProbeResults,
} from "./mediaStreamProbe.js";
import type { HyperframeLintFinding } from "./types.js";
import { mediaSrcTagRe } from "./utils";

/**
 * Collects local `<video src>` references, resolved to their absolute path
 * and deduped by that path — the same file referenced twice only ends up as
 * one map entry, so `probeMediaStreams` only probes it once.
 *
 * Files that don't resolve to an existing local asset are skipped here —
 * `missing_local_asset` already reports those, and hevc_preview_codec never
 * probes a file that doesn't exist.
 */
export function collectLocalVideoCandidates(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
): Map<string, string> {
  const candidates = new Map<string, string>();
  const videoSrcRe = mediaSrcTagRe("video");

  for (const { html, compSrcPath } of htmlSources) {
    const scannable = maskNonScannableRanges(html);
    const re = new RegExp(videoSrcRe.source, videoSrcRe.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(scannable)) !== null) {
      const candidate = resolveLocalMediaCandidate(projectDir, compSrcPath, match[2] ?? "");
      if (!candidate || candidates.has(candidate.resolved)) continue;
      candidates.set(candidate.resolved, candidate.src);
    }
  }

  return candidates;
}

/**
 * INFO-only finding: a locally referenced `<video>` file is encoded as
 * HEVC/H.265. The render pipeline pre-decodes video with FFmpeg (never the
 * browser decoder) so rendering is unaffected, but live preview and the
 * embeddable player play the file directly in-browser, where HEVC support
 * varies. Never escalated beyond "info" — this must not fail lint or check.
 *
 * `candidates` maps each unique resolved file path to a display src string;
 * `probes` is the shared `probeMediaStreams` result for (at least) those
 * paths. A file whose probe is unknown (`null`/absent) is never reported.
 * `codec_name === "hevc"` is only ever carried by a video stream, so no
 * `codec_type` filter is needed; every video stream is considered, so a file
 * whose first video stream is H.264 but carries an HEVC stream later is also
 * reported.
 */
export function lintHevcPreviewCodec(
  candidates: ReadonlyMap<string, string>,
  probes: MediaStreamProbeResults,
): HyperframeLintFinding[] {
  const hevcSrcs: string[] = [];
  for (const [filePath, src] of candidates) {
    const streams = probes.get(filePath);
    if (streams?.some((stream) => stream.codec_name === "hevc")) hevcSrcs.push(src);
  }
  if (hevcSrcs.length === 0) return [];

  const unique = [...new Set(hevcSrcs)];
  return [
    {
      code: "hevc_preview_codec",
      severity: "info",
      message:
        `Video file(s) use the HEVC/H.265 codec: ${unique.join(", ")}. ` +
        "The render pipeline pre-decodes video with FFmpeg and never uses the browser's video decoder, so these render correctly. " +
        "Live preview/player playback automatically uses a cached H.264 proxy when the browser cannot decode HEVC. " +
        "If playback still fails, verify ffmpeg/ffprobe are installed and auto-proxying is enabled.",
      fixHint:
        unique.length === 1
          ? `If "${unique[0]}" fails to play in preview, run hyperframes doctor and confirm media.autoProxy is not false.`
          : "If these files fail to play in preview, run hyperframes doctor and confirm media.autoProxy is not false.",
    },
  ];
}
