import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

/**
 * Shared FFmpeg/FFprobe binary resolution for every package that shells out
 * to them (engine, cli, lint, studio-server). Node-only: import via the
 * `@hyperframes/parsers/ff-binaries` subpath, never from a browser bundle.
 */

export const FFMPEG_PATH_ENV = "HYPERFRAMES_FFMPEG_PATH";
export const FFPROBE_PATH_ENV = "HYPERFRAMES_FFPROBE_PATH";

export type FfBinaryName = "ffmpeg" | "ffprobe";

const ENV_BY_NAME: Record<FfBinaryName, string> = {
  ffmpeg: FFMPEG_PATH_ENV,
  ffprobe: FFPROBE_PATH_ENV,
};

const pathLookupCache = new Map<FfBinaryName, string | undefined>();

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

function isExecutablePathCandidate(candidate: string): boolean {
  if (process.platform === "win32") return existsSync(candidate);
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function scanPath(name: FfBinaryName): string | undefined {
  const pathValue = process.env.PATH;
  if (!pathValue) return undefined;

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
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      if (isExecutablePathCandidate(candidate)) candidates.push(candidate);
    }
  }
  return chooseBestPathCandidate(name, candidates);
}

// GUI/Dock/launchd-spawned processes on macOS don't inherit the shell PATH, so
// `which ffmpeg` fails even when ffmpeg is installed via Homebrew. Probe the
// well-known install dirs as a last resort. (No-op on Windows, where `where`
// and installer-added PATH entries cover it.)
const COMMON_BIN_DIRS =
  process.platform === "win32"
    ? []
    : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"];

function findInCommonDirs(name: FfBinaryName): string | undefined {
  for (const dir of COMMON_BIN_DIRS) {
    const candidate = `${dir}/${name}`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function findInProjectLocalBin(name: FfBinaryName): string | undefined {
  const extension = process.platform === "win32" ? ".exe" : "";
  const candidate = resolve(".hyperframes", "bin", `${name}${extension}`);
  return existsSync(candidate) ? candidate : undefined;
}

function lookupOnSystem(name: FfBinaryName): string | undefined {
  if (pathLookupCache.has(name)) return pathLookupCache.get(name);
  let found: string | undefined;
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(command, [name], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    found = chooseBestPathCandidate(name, output.split(/\r?\n/));
  } catch {
    found = scanPath(name);
  }
  found ??= findInProjectLocalBin(name);
  found ??= findInCommonDirs(name);
  const resolved = found ? resolve(found) : undefined;
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
 * Resolve an FFmpeg-family binary: env override first, then `which`/`where`,
 * then a manual PATH scan (covers Windows PATHEXT), a project-local
 * `.hyperframes/bin`, then well-known Unix install dirs. System lookups are
 * cached per binary for the process lifetime; the env override is re-read on
 * every call.
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

/** Test hook: drop cached system lookups so resolution can be re-exercised. */
export function clearFfBinaryLookupCache(): void {
  pathLookupCache.clear();
}
