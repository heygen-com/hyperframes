import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { rewriteAssetPath } from "@hyperframes/parsers/asset-paths";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import {
  cleanAssetUrl,
  isRemoteOrInlineUrl,
  isUnresolvedAssetPlaceholder,
  maskNonScannableRanges,
  resolveExistingLocalAsset,
} from "@hyperframes/parsers/asset-resolution";
import type { HyperframeLintFinding } from "./types.js";
import { mediaSrcTagRe } from "./utils.js";

interface HtmlSourceLike {
  html: string;
  compSrcPath?: string;
}

const PROBE_TIMEOUT_MS = 4000;
const PROBE_CONCURRENCY = 8;

function execFileAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout.toString());
    });
  });
}

function hasAudioStream(json: unknown): boolean {
  if (typeof json !== "object" || json === null) return false;
  const streams = Reflect.get(json, "streams");
  if (!Array.isArray(streams)) return false;
  return streams.some((stream) => {
    if (typeof stream !== "object" || stream === null) return false;
    return Reflect.get(stream, "codec_type") === "audio";
  });
}

async function probeHasAudioStream(
  ffprobePath: string,
  filePath: string,
): Promise<boolean | null> {
  try {
    const stdout = await execFileAsync(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "json",
      "--",
      filePath,
    ]);
    return hasAudioStream(JSON.parse(stdout));
  } catch {
    return null;
  }
}

export function collectLocalAudioCandidates(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
): Map<string, string> {
  const candidates = new Map<string, string>();
  const audioSrcRe = mediaSrcTagRe("audio");

  for (const { html, compSrcPath } of htmlSources) {
    const scannable = maskNonScannableRanges(html);
    const re = new RegExp(audioSrcRe.source, audioSrcRe.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(scannable)) !== null) {
      const rawSrc = match[2] ?? "";
      if (isUnresolvedAssetPlaceholder(rawSrc)) continue;
      const src = cleanAssetUrl(rawSrc);
      if (!src || isRemoteOrInlineUrl(src)) continue;
      const rootRelative = compSrcPath
        ? rewriteAssetPath(compSrcPath, src, (path) => existsSync(join(projectDir, path)))
        : src;
      const resolvedAsset = resolveExistingLocalAsset(projectDir, rootRelative);
      if (!resolvedAsset || candidates.has(resolvedAsset.resolved)) continue;
      candidates.set(resolvedAsset.resolved, src);
    }
  }

  return candidates;
}

/** Match render's authored-audio contract without making an ffprobe failure a new lint failure. */
export async function lintAuthoredAudioMediaType(
  candidates: Map<string, string>,
): Promise<HyperframeLintFinding[]> {
  if (candidates.size === 0) return [];
  const ffprobePath = findFfBinary("ffprobe", { configuredMustExist: true });
  if (!ffprobePath) return [];

  const entries = [...candidates.entries()];
  const results = new Array<boolean | null>(entries.length).fill(null);
  let nextIndex = 0;
  const workerCount = Math.min(PROBE_CONCURRENCY, entries.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < entries.length) {
        const index = nextIndex++;
        const entry = entries[index];
        if (!entry) break;
        results[index] = await probeHasAudioStream(ffprobePath, entry[0]);
      }
    }),
  );

  const mismatchedSrcs = entries
    .filter((_, index) => results[index] === false)
    .map(([, src]) => src);
  if (mismatchedSrcs.length === 0) return [];

  return [
    {
      code: "authored_media_type_mismatch",
      severity: "error",
      message:
        `Authored <audio> element references media file(s) with no audio stream: ${mismatchedSrcs.join(", ")}. ` +
        "Render rejects this authored media element type mismatch.",
      fixHint:
        "Point each <audio> src at media containing an audio stream, or remove the element if no audio is intended.",
    },
  ];
}
