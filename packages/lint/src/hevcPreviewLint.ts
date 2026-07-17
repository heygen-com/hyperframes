import { execFile } from "node:child_process";
import { rewriteAssetPath } from "@hyperframes/parsers/asset-paths";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import {
  cleanAssetUrl,
  isRemoteOrInlineUrl,
  maskNonScannableRanges,
  resolveExistingLocalAsset,
} from "@hyperframes/parsers/asset-resolution";
import type { HyperframeLintFinding } from "./types.js";

/** Structurally compatible with `project.ts`'s (unexported) `HtmlSource` —
 * duplicated as a shape, not imported, to avoid a circular import between
 * this file and `project.ts` (which imports `lintHevcPreviewCodec` below). */
interface HtmlSourceLike {
  html: string;
  compSrcPath?: string;
}

const PROBE_TIMEOUT_MS = 4000;
// Bounds concurrent ffprobe child processes for compositions referencing many videos.
const PROBE_CONCURRENCY = 8;

function execFileAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, { timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout.toString());
    });
  });
}

function hasHevcStream(json: unknown): boolean {
  if (typeof json !== "object" || json === null) return false;
  const streams = Reflect.get(json, "streams");
  if (!Array.isArray(streams)) return false;
  return streams.some((stream) => {
    if (typeof stream !== "object" || stream === null) return false;
    return Reflect.get(stream, "codec_name") === "hevc";
  });
}

// Best-effort: any failure (ffprobe missing, times out, non-video file,
// unparsable output) resolves to "not HEVC" rather than throwing. This rule
// must never fail lint/check just because ffprobe isn't installed.
async function probeIsHevc(ffprobePath: string, filePath: string): Promise<boolean> {
  try {
    const stdout = await execFileAsync(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "json",
      filePath,
    ]);
    return hasHevcStream(JSON.parse(stdout));
  } catch {
    return false;
  }
}

/**
 * Collects local `<video src>` references, resolved to their absolute path
 * and deduped by that path — this is both the candidate set AND the in-run
 * probe cache for `lintHevcPreviewCodec` below: the same file referenced
 * twice only ends up as one map entry, so it's only probed once.
 *
 * Files that don't resolve to an existing local asset are skipped here —
 * `missing_local_asset` already reports those, and hevc_preview_codec never
 * probes a file that doesn't exist.
 */
// fallow-ignore-next-line complexity
export function collectLocalVideoCandidates(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
): Map<string, string> {
  const candidates = new Map<string, string>();
  const videoSrcRe = /<video\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

  for (const { html, compSrcPath } of htmlSources) {
    const scannable = maskNonScannableRanges(html);
    const re = new RegExp(videoSrcRe.source, videoSrcRe.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(scannable)) !== null) {
      const src = cleanAssetUrl(match[1] ?? "");
      if (!src) continue;
      if (isRemoteOrInlineUrl(src)) continue;
      if (/^__[A-Z_]+__$/.test(src)) continue;
      const rootRelative = compSrcPath ? rewriteAssetPath(compSrcPath, src) : src;
      const resolvedAsset = resolveExistingLocalAsset(projectDir, rootRelative);
      if (!resolvedAsset) continue;
      if (!candidates.has(resolvedAsset.resolved)) candidates.set(resolvedAsset.resolved, src);
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
 * `candidates` maps each unique resolved file path to a display src string
 * (already deduped by the caller, so each file is probed exactly once here);
 * files missing from disk are the caller's responsibility to have excluded —
 * `missing_local_asset` covers those and this rule never probes them.
 */
export async function lintHevcPreviewCodec(
  candidates: Map<string, string>,
): Promise<HyperframeLintFinding[]> {
  if (candidates.size === 0) return [];

  const ffprobePath = findFfBinary("ffprobe", { configuredMustExist: true });
  if (!ffprobePath) return [];

  const entries = [...candidates.entries()];
  const isHevc = new Array<boolean>(entries.length).fill(false);
  let nextIndex = 0;
  const workerCount = Math.min(PROBE_CONCURRENCY, entries.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < entries.length) {
        const index = nextIndex++;
        const entry = entries[index];
        if (!entry) break;
        isHevc[index] = await probeIsHevc(ffprobePath, entry[0]);
      }
    }),
  );

  const hevcSrcs = entries.filter((_, i) => isHevc[i]).map(([, src]) => src);
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
