import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { rewriteAssetPath } from "@hyperframes/parsers/asset-paths";
import { parseNumeric } from "@hyperframes/parsers/composition-contract";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import {
  cleanAssetUrl,
  isRemoteOrInlineUrl,
  isUnresolvedAssetPlaceholder,
  maskNonScannableRanges,
  resolveExistingLocalAsset,
} from "@hyperframes/parsers/asset-resolution";
import { parseHTML } from "linkedom";
import type { HyperframeLintFinding } from "./types.js";
import { mediaSrcTagRe } from "./utils";

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
    execFile(file, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout.toString());
    });
  });
}

async function mapWithProbeConcurrency<T, R>(
  entries: T[],
  probe: (entry: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(entries.length);
  let nextIndex = 0;
  const workerCount = Math.min(PROBE_CONCURRENCY, entries.length);
  const runWorker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      if (index >= entries.length) return;
      const entry = entries[index];
      if (entry !== undefined) results[index] = await probe(entry);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

function resolveLocalVideoReference(
  projectDir: string,
  rawSrc: string,
  compSrcPath?: string,
): { resolved: string; src: string } | null {
  if (isUnresolvedAssetPlaceholder(rawSrc)) return null;
  const src = cleanAssetUrl(rawSrc);
  if (!src || isRemoteOrInlineUrl(src)) return null;
  const rootRelative = compSrcPath
    ? rewriteAssetPath(compSrcPath, src, (path) => existsSync(join(projectDir, path)))
    : src;
  const asset = resolveExistingLocalAsset(projectDir, rootRelative);
  return asset ? { resolved: asset.resolved, src } : null;
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
      "--",
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
  const videoSrcRe = mediaSrcTagRe("video");

  for (const { html, compSrcPath } of htmlSources) {
    const scannable = maskNonScannableRanges(html);
    const re = new RegExp(videoSrcRe.source, videoSrcRe.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(scannable)) !== null) {
      const rawSrc = match[2] ?? "";
      const reference = resolveLocalVideoReference(projectDir, rawSrc, compSrcPath);
      if (!reference || candidates.has(reference.resolved)) continue;
      candidates.set(reference.resolved, reference.src);
    }
  }

  return candidates;
}

interface LocalFiniteVideoSlot {
  src: string;
  file: string;
  elementId?: string;
  mediaStart: number;
}

interface UnresolvedFiniteVideoSlot extends Omit<LocalFiniteVideoSlot, "src"> {
  rawSrc: string;
}

function collectVideoElements(html: string): Element[] {
  const { document } = parseHTML(html);
  const roots: ParentNode[] = [document];
  const videos: Element[] = [];
  for (let index = 0; index < roots.length; index++) {
    const root = roots[index];
    if (!root) continue;
    videos.push(...root.querySelectorAll("video"));
    for (const template of root.querySelectorAll("template")) {
      roots.push((template as HTMLTemplateElement).content);
    }
  }
  return videos;
}

function readPositiveNumber(raw: string | null): number | null {
  const value = parseNumeric(raw);
  return value !== null && value > 0 ? value : null;
}

function readNonNegativeNumber(raw: string | null): number | null {
  const value = parseNumeric(raw);
  return value !== null && value >= 0 ? value : null;
}

function readFiniteVideoSlot(video: Element, file: string): UnresolvedFiniteVideoSlot | null {
  if (video.hasAttribute("loop")) return null;
  if (video.hasAttribute("data-var-src")) return null;
  if (video.hasAttribute("data-playback-start")) return null;
  if (readPositiveNumber(video.getAttribute("data-duration")) === null) return null;
  const mediaStart = readNonNegativeNumber(video.getAttribute("data-media-start"));
  if (mediaStart === null) return null;
  return {
    rawSrc: video.getAttribute("src") ?? "",
    file,
    ...(video.id ? { elementId: video.id } : {}),
    mediaStart,
  };
}

function collectLocalFiniteVideoSlots(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
): Map<string, LocalFiniteVideoSlot[]> {
  const slotsByPath = new Map<string, LocalFiniteVideoSlot[]>();
  for (const { html, compSrcPath } of htmlSources) {
    for (const video of collectVideoElements(html)) {
      const slot = readFiniteVideoSlot(video, compSrcPath ?? "index.html");
      if (!slot) continue;
      const reference = resolveLocalVideoReference(projectDir, slot.rawSrc, compSrcPath);
      if (!reference) continue;
      const slots = slotsByPath.get(reference.resolved) ?? [];
      slots.push({
        src: reference.src,
        file: slot.file,
        ...(slot.elementId ? { elementId: slot.elementId } : {}),
        mediaStart: slot.mediaStart,
      });
      slotsByPath.set(reference.resolved, slots);
    }
  }
  return slotsByPath;
}

function parsePositiveDuration(value: unknown): number | null {
  const duration = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function readPlayableVideoDuration(stdout: string): number | null {
  try {
    const metadata: unknown = JSON.parse(stdout);
    if (typeof metadata !== "object" || metadata === null) return null;
    const streams = Reflect.get(metadata, "streams");
    const stream = Array.isArray(streams)
      ? streams.find((candidate) => typeof candidate === "object" && candidate !== null)
      : null;
    const streamDuration = stream ? parsePositiveDuration(Reflect.get(stream, "duration")) : null;
    if (streamDuration !== null) return streamDuration;
    const format = Reflect.get(metadata, "format");
    return typeof format === "object" && format !== null
      ? parsePositiveDuration(Reflect.get(format, "duration"))
      : null;
  } catch {
    return null;
  }
}

async function probePlayableVideoDuration(
  ffprobePath: string,
  filePath: string,
): Promise<number | null> {
  try {
    return readPlayableVideoDuration(
      await execFileAsync(ffprobePath, [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=duration:format=duration",
        "-of",
        "json",
        "--",
        filePath,
      ]),
    );
  } catch {
    return null;
  }
}

export async function lintVideoMediaStartPastEof(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
): Promise<HyperframeLintFinding[]> {
  const slotsByPath = collectLocalFiniteVideoSlots(projectDir, htmlSources);
  if (slotsByPath.size === 0) return [];
  const ffprobePath = findFfBinary("ffprobe", { configuredMustExist: true });
  if (!ffprobePath) return [];

  const entries = [...slotsByPath.entries()];
  const durations = await mapWithProbeConcurrency(entries, (entry) =>
    probePlayableVideoDuration(ffprobePath, entry[0]),
  );
  const findings: HyperframeLintFinding[] = [];
  for (const [index, [, slots]] of entries.entries()) {
    const sourceDuration = durations[index];
    if (sourceDuration == null) continue;
    for (const slot of slots) {
      if (slot.mediaStart < sourceDuration) continue;
      findings.push({
        code: "video_media_start_at_or_past_eof",
        severity: "warning",
        message: `Video "${slot.src}" starts at ${slot.mediaStart}s, at or past its ${sourceDuration}s playable source duration. The video will hold its final frame for the explicit slot.`,
        file: slot.file,
        ...(slot.elementId ? { elementId: slot.elementId } : {}),
        fixHint: `Trim data-media-start below ${sourceDuration}s if this final-frame hold is unintended.`,
      });
    }
  }
  return findings;
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
  const isHevc = await mapWithProbeConcurrency(entries, (entry) =>
    probeIsHevc(ffprobePath, entry[0]),
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
