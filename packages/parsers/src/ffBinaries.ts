import { execFileSync } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { isTrustedExecutablePath, trustedPathDirs } from "./trustedExecutable.js";

/**
 * Shared FFmpeg/FFprobe binary resolution for every package that shells out
 * to them (engine, cli, lint, studio-server). Node-only: import via the
 * `@hyperframes/parsers/ff-binaries` subpath, never from a browser bundle.
 */

export {
  executableIn,
  findTrustedExecutable,
  isTrustedDirectory,
  isTrustedExecutablePath,
  pathEntries,
  trustedPathDirs,
} from "./trustedExecutable.js";
import { assertLiteralMediaInput } from "./literalMediaInput.js";

export const FFMPEG_PATH_ENV = "HYPERFRAMES_FFMPEG_PATH";
export const FFPROBE_PATH_ENV = "HYPERFRAMES_FFPROBE_PATH";

export type FfBinaryName = "ffmpeg" | "ffprobe";

const ENV_BY_NAME: Record<FfBinaryName, string> = {
  ffmpeg: FFMPEG_PATH_ENV,
  ffprobe: FFPROBE_PATH_ENV,
};

const pathLookupCache = new Map<FfBinaryName, string>();
// A miss is trusted briefly: callers probe per media file, and an install still shows up within seconds.
const MISS_TTL_MS = 5_000;
const lastMissAt = new Map<FfBinaryName, number>();

function candidateFileName(candidate: string): string {
  return candidate.split(/[\\/]/).at(-1)?.toLowerCase() ?? candidate.toLowerCase();
}

function chooseBestPathCandidate(
  name: FfBinaryName,
  candidates: readonly string[],
): string | undefined {
  const normalized = candidates.map((candidate) => candidate.trim()).filter(Boolean);
  return (
    normalized.find((candidate) => candidateFileName(candidate) === `${name}.exe`) ??
    normalized.find((candidate) => candidateFileName(candidate) === name) ??
    normalized.find((candidate) => !candidateFileName(candidate).match(/\.(cmd|bat)$/i)) ??
    normalized[0]
  );
}

const MACHO_CPU_X86_64 = 0x01000007;
const ROSETTA_RUNTIME = "/Library/Apple/usr/libexec/oah/libRosettaRuntime";

// A Mach-O built only for x86_64 (some npm packages ship one under darwin/arm64). A universal
// binary or an unreadable file is not one.
export function isX86OnlyMachO(file: string): boolean {
  const header = Buffer.alloc(8);
  try {
    const fd = openSync(file, "r");
    try {
      readSync(fd, header, 0, 8, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
  return header.readUInt32LE(0) === 0xfeedfacf && header.readUInt32LE(4) === MACHO_CPU_X86_64;
}

// Without Rosetta an Apple Silicon Mac cannot run an x86_64 binary, so it must not be chosen.
function runsOnThisMac(candidate: string): boolean {
  if (process.platform !== "darwin" || process.arch !== "arm64" || existsSync(ROSETTA_RUNTIME)) {
    return true;
  }
  if (!isX86OnlyMachO(candidate)) return true;
  const name = basename(candidate) as FfBinaryName;
  if (!skippedX86Binaries.has(name)) skippedX86Binaries.set(name, candidate);
  return false;
}

const skippedX86Binaries = new Map<FfBinaryName, string>();

/** The first x86_64-only `name` binary skipped on this Mac, for naming in the "not found" hint. */
export function getSkippedX86Binary(name: FfBinaryName): string | undefined {
  return skippedX86Binaries.get(name);
}

function isExecutablePathCandidate(candidate: string): boolean {
  if (process.platform === "win32") return existsSync(candidate);
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile() && runsOnThisMac(candidate);
  } catch {
    return false;
  }
}

function scanPath(name: FfBinaryName): string | undefined {
  const searchDirs = trustedPathDirs();
  if (searchDirs.length === 0) return undefined;

  const extensions =
    process.platform === "win32"
      ? [
          ".exe",
          ...new Set(
            (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
              .split(";")
              .map((ext) => ext.trim().toLowerCase())
              .filter(Boolean),
          ),
          "",
        ]
      : [""];
  const candidates: string[] = [];
  for (const dir of searchDirs) {
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      if (isExecutablePathCandidate(candidate)) candidates.push(candidate);
    }
  }
  return chooseBestPathCandidate(name, candidates);
}

// GUI/Dock/launchd-spawned processes on macOS don't inherit the shell PATH, so
// a PATH lookup fails even when ffmpeg is installed via Homebrew. Probe the
// well-known install dirs as a last resort. (No-op on Windows, where
// installer-added PATH entries cover it.)
const COMMON_BIN_DIRS =
  process.platform === "win32"
    ? []
    : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"];

// The npm installer package comes last: its binaries are old builds, so any system install wins.
function findInCommonDirsOrInstallerPackage(name: FfBinaryName): string | undefined {
  for (const dir of COMMON_BIN_DIRS) {
    const candidate = `${dir}/${name}`;
    if (isTrustedExecutablePath(candidate) && existsSync(candidate) && runsOnThisMac(candidate)) {
      return candidate;
    }
  }
  return findInInstallerPackage(name);
}

function binaryFileName(name: FfBinaryName): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function tryResolve(fromFile: string, request: string): string | undefined {
  try {
    return createRequire(fromFile).resolve(request);
  } catch {
    return undefined;
  }
}

// An @ffmpeg-installer / @ffprobe-installer package installed next to HyperFrames itself (a global
// or npx install), located but never loaded. A copy in the working directory is project content,
// so it is skipped. The platform package is resolved via the installer package first (pnpm layout).
function findInInstallerPackage(name: FfBinaryName): string | undefined {
  const project = import.meta.url;
  const platformManifest = `@${name}-installer/${process.platform}-${process.arch}/package.json`;
  const installer = tryResolve(project, `@${name}-installer/${name}/package.json`);
  const manifest =
    (installer && tryResolve(installer, platformManifest)) ?? tryResolve(project, platformManifest);
  const candidate = manifest && join(dirname(manifest), binaryFileName(name));
  return candidate && isTrustedExecutablePath(candidate) && isExecutablePathCandidate(candidate)
    ? candidate
    : undefined;
}

// No lookup program (`which`, `where`) runs by name: it could itself come from the project.
function searchSystem(name: FfBinaryName): string | undefined {
  return scanPath(name) ?? findInCommonDirsOrInstallerPackage(name);
}

function lookupOnSystem(name: FfBinaryName): string | undefined {
  const cached = pathLookupCache.get(name);
  if (cached) return cached;
  if (Date.now() - (lastMissAt.get(name) ?? -Infinity) < MISS_TTL_MS) return undefined;
  const found = searchSystem(name);
  if (!found) {
    lastMissAt.set(name, Date.now());
    return undefined;
  }
  const resolved = resolve(found);
  pathLookupCache.set(name, resolved);
  return resolved;
}

export interface FindFfBinaryOptions {
  /**
   * How to treat an env override that points at a missing file: `true`
   * reports the binary as not found (callers that surface an install hint or
   * skip probing), `false`/unset returns the configured path as-is (callers
   * that validate the override separately and want spawn errors to name the
   * path the user configured).
   */
  configuredMustExist?: boolean;
}

/**
 * Resolve an FFmpeg-family binary: env override first, then a native
 * in-process PATH scan, then well-known Unix install dirs,
 * then an `@ffmpeg-installer`/`@ffprobe-installer` package installed next to HyperFrames.
 * Discovery never returns a file in the working directory (see trustedExecutable.ts).
 * A found binary is cached for the process lifetime; a miss only for a few
 * seconds, so a long-running server sees an install made after it started. The env
 * override is re-read on every call.
 */
export function findFfBinary(
  name: FfBinaryName,
  options: FindFfBinaryOptions = {},
): string | undefined {
  const configured = process.env[ENV_BY_NAME[name]]?.trim();
  if (configured) {
    if (options.configuredMustExist && !existsSync(configured)) return undefined;
    return resolve(configured);
  }
  return lookupOnSystem(name);
}

/** {@link findFfBinary}, or an ENOENT error naming the override. Never the bare name for the OS to look up. */
export function requireFfBinary(name: FfBinaryName): string {
  const found = findFfBinary(name);
  if (found) return found;
  const message = `[FFmpeg] ${name} not found. Install FFmpeg or set ${ENV_BY_NAME[name]} to its absolute path.`;
  throw Object.assign(new Error(message), { code: "ENOENT" });
}

/** Test hook: drop cached system lookups so resolution can be re-exercised. */
export function clearFfBinaryLookupCache(): void {
  pathLookupCache.clear();
  lastMissAt.clear();
  skippedX86Binaries.clear();
}

/**
 * Concat input for a list HyperFrames wrote: entries open only as local mov, matroska or concat
 * files (an ffconcat entry is followed in safe mode), and `-xerror` fails at a refused entry.
 */
export function concatListInputArgs(concatListPath: string): string[] {
  return [
    "-xerror",
    "-protocol_whitelist",
    "file",
    "-f",
    "concat",
    "-safe",
    "0",
    "-format_whitelist",
    "concat,mov,matroska",
    "-i",
    concatListPath,
  ];
}

/** What a render service lets a media input open: containers that name no other file. */
export const SELF_CONTAINED_FORMATS =
  "mov,matroska,mxf,avi,mpeg,mpegts,mpegvideo,flv,asf,ogg,wav,mp3,aac,flac,aiff,gif,image2,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe";

// Demuxers that open other files or URLs on their own. hls and concat stay allowed: ffmpeg copies the
// format whitelist into every nested open, so a list cannot reach these, and the folder walk confines its paths.
const PATH_OPENING_DEMUXERS = new Set([
  "dash",
  "imf",
  "mlv",
  "vobsub",
  "dvdvideo",
  "sdp",
  "rtsp",
  "rtp",
  "sap",
  "avisynth",
  "vapoursynth",
  "lavfi",
]);

const TEXT_ART_DEMUXERS = new Set(["tty", "bin", "xbin", "idf", "adf"]);

/** A `-format_whitelist` value from a `-demuxers` listing; undefined when no row parses. */
function demuxersFromListing(listing: string): string | undefined {
  const row = /Is a device/.test(listing) ? /^ D[E ]([d ]) (\S+)/ : /^ D[E ]() (\S+)/;
  const names = new Set<string>();
  for (const line of listing.split("\n")) {
    const match = row.exec(line);
    if (!match || match[1] === "d") continue;
    const aliases = match[2]!.split(",");
    if (aliases.some((alias) => PATH_OPENING_DEMUXERS.has(alias) || TEXT_ART_DEMUXERS.has(alias)))
      continue;
    for (const alias of aliases) names.add(alias);
  }
  return names.size > 0 ? [...names].join(",") : undefined;
}

const demuxerLists = new Map<string, string>();
let listingOverride: string | undefined;

/** Tests feed a `-demuxers` listing so none spawns a binary; no argument forgets it. */
export function _setDemuxerListingForTests(listing?: string): void {
  listingOverride = listing;
  demuxerLists.clear();
}

export { assertLiteralMediaInput };

/** Every demuxer `listingBinary` reports that opens nothing by itself and is not text art, for reading `input`; one that cannot be asked gets the self-contained list, and is asked again. */
export function mediaInputFormatArgs(listingBinary: string, input: string): string[] {
  assertLiteralMediaInput(input);
  let formats = demuxerLists.get(listingBinary);
  if (formats === undefined) {
    try {
      formats = demuxersFromListing(
        listingOverride ??
          execFileSync(listingBinary, ["-hide_banner", "-demuxers"], {
            encoding: "utf8",
            timeout: 10_000,
            windowsHide: true,
            stdio: ["ignore", "pipe", "ignore"],
          }),
      );
    } catch {
      formats = undefined;
    }
    if (formats === undefined) return ["-format_whitelist", SELF_CONTAINED_FORMATS];
    demuxerLists.set(listingBinary, formats);
  }
  return ["-format_whitelist", formats];
}

const OUT_TIME = /^out_time_(?:us|ms)=(\d+)$/;

/** Hears the furthest output time, in seconds, that ffmpeg's `-progress pipe:1` lines on `stream` report. */
export function followFfmpegProgress(stream: Readable, onSeconds: (seconds: number) => void): void {
  let furthest = 0;
  let lineTail = "";
  stream.on("data", (chunk: Buffer) => {
    const lines = (lineTail + chunk.toString()).split("\n");
    lineTail = lines.pop() ?? "";
    for (const line of lines) {
      const reached = OUT_TIME.exec(line.trim());
      if (!reached) continue;
      const seconds = Number(reached[1]) / 1e6;
      if (seconds <= furthest) continue;
      furthest = seconds;
      onSeconds(seconds);
    }
  });
}
