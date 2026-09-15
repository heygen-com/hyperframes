import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { rewriteAssetPath } from "@hyperframes/parsers/asset-paths";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import {
  cleanAssetUrl,
  isRemoteOrInlineUrl,
  isUnresolvedAssetPlaceholder,
  resolveExistingLocalAsset,
} from "@hyperframes/parsers/asset-resolution";

/** Structurally compatible with `project.ts`'s (unexported) `HtmlSource` —
 * duplicated as a shape, not imported, to avoid a circular import between
 * the probe-backed rules and `project.ts` (which imports them). */
export interface HtmlSourceLike {
  html: string;
  compSrcPath?: string;
}

/** One `streams[]` entry of `ffprobe -show_entries stream=codec_type,codec_name`. */
export interface ProbedStream {
  codec_type?: string;
  codec_name?: string;
}

/**
 * Probe outcome per absolute file path. Three states, and only one of them is
 * evidence: an array is what ffprobe reported (possibly empty); `null` means
 * ffprobe failed, timed out or returned something unparsable for that file;
 * an absent key means the file was never probed (no ffprobe binary, or not in
 * the requested set). Rules treat `null`/absent as "unknown" and emit nothing —
 * an ffprobe hiccup must never become a lint finding.
 */
export type MediaStreamProbeResults = ReadonlyMap<string, readonly ProbedStream[] | null>;

const PROBE_TIMEOUT_MS = 4000;
// Bounds concurrent ffprobe child processes for compositions referencing many media files.
const PROBE_CONCURRENCY = 8;

function execFileAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout.toString());
    });
  });
}

function parseProbedStreams(json: unknown): ProbedStream[] | null {
  if (typeof json !== "object" || json === null) return null;
  const streams = Reflect.get(json, "streams");
  if (!Array.isArray(streams)) return null;
  const out: ProbedStream[] = [];
  for (const stream of streams) {
    if (typeof stream !== "object" || stream === null) continue;
    const codecType = Reflect.get(stream, "codec_type");
    const codecName = Reflect.get(stream, "codec_name");
    out.push({
      ...(typeof codecType === "string" ? { codec_type: codecType } : {}),
      ...(typeof codecName === "string" ? { codec_name: codecName } : {}),
    });
  }
  return out;
}

/**
 * Every stream of the file, unfiltered. Deliberately NOT `-select_streams`:
 * one invocation serves every probe-backed rule (audio-stream presence for the
 * render contract, HEVC detection for preview), so a file referenced by both an
 * `<audio>` and a `<video>` is probed exactly once. Filtering to `v:0` here
 * would report zero streams for an audio-only file and turn every correct
 * `<audio src="music.mp3">` into a false error.
 */
async function probeStreams(ffprobePath: string, filePath: string): Promise<ProbedStream[] | null> {
  try {
    const stdout = await execFileAsync(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name",
      "-of",
      "json",
      "--",
      filePath,
    ]);
    return parseProbedStreams(JSON.parse(stdout));
  } catch {
    return null;
  }
}

/**
 * Probe each unique local file once, with bounded concurrency. Returns an
 * empty map when ffprobe cannot be resolved — callers see every file as
 * "unknown" and stay silent, so lint/check never fail just because ffprobe
 * is not installed.
 */
export async function probeMediaStreams(files: Iterable<string>): Promise<MediaStreamProbeResults> {
  const results = new Map<string, ProbedStream[] | null>();
  const unique = [...new Set(files)];
  if (unique.length === 0) return results;

  const ffprobePath = findFfBinary("ffprobe", { configuredMustExist: true });
  if (!ffprobePath) return results;

  let nextIndex = 0;
  const workerCount = Math.min(PROBE_CONCURRENCY, unique.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < unique.length) {
        const filePath = unique[nextIndex++];
        if (filePath === undefined) break;
        results.set(filePath, await probeStreams(ffprobePath, filePath));
      }
    }),
  );
  return results;
}

/**
 * Resolve an authored media `src` to an existing local file, the way every
 * probe-backed rule must: placeholders are rejected on the RAW value (because
 * `cleanAssetUrl()` splits on `?`/`#` and would chop inside a `${...}` token),
 * remote/inline URLs are skipped, and a sub-composition's relative path is
 * rewritten against its own directory before lookup.
 *
 * Files that do not resolve are skipped — `missing_local_asset` /
 * `audio_src_not_found` already report those, and a probe never runs on a
 * file that does not exist.
 */
export function resolveLocalMediaCandidate(
  projectDir: string,
  compSrcPath: string | undefined,
  rawSrc: string,
): { resolved: string; src: string } | null {
  if (isUnresolvedAssetPlaceholder(rawSrc)) return null;
  const src = cleanAssetUrl(rawSrc);
  if (!src || isRemoteOrInlineUrl(src)) return null;
  const rootRelative = compSrcPath
    ? rewriteAssetPath(compSrcPath, src, (path) => existsSync(join(projectDir, path)))
    : src;
  const resolvedAsset = resolveExistingLocalAsset(projectDir, rootRelative);
  return resolvedAsset ? { resolved: resolvedAsset.resolved, src } : null;
}
