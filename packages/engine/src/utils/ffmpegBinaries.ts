// fallow-ignore-file code-duplication
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { delimiter, join, resolve } from "path";

export const FFMPEG_PATH_ENV = "HYPERFRAMES_FFMPEG_PATH";
export const FFPROBE_PATH_ENV = "HYPERFRAMES_FFPROBE_PATH";

const pathCache = new Map<string, string | undefined>();

function findViaWhereOrWhich(name: "ffmpeg" | "ffprobe"): string | undefined {
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(command, [name], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const first = output
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return first ? resolve(first) : undefined;
  } catch {
    return undefined;
  }
}

// `where`/`which` themselves can be unavailable (a restricted/sandboxed shell
// without cmd.exe's where.exe on PATH) even when the target binary is
// directly executable and genuinely on PATH. Scanning PATH directories
// ourselves needs no external helper process, so it still resolves the
// binary in that case instead of falling through to a bare command name that
// a later non-shell `spawn()` can't resolve on its own.
export function findViaPathScan(name: "ffmpeg" | "ffprobe"): string | undefined {
  const pathEnv = process.env.PATH ?? process.env.Path ?? process.env.path;
  if (!pathEnv) return undefined;
  const candidateNames = process.platform === "win32" ? [`${name}.exe`, name] : [name];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const candidateName of candidateNames) {
      const candidate = join(dir, candidateName);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function findOnPath(name: "ffmpeg" | "ffprobe"): string | undefined {
  if (pathCache.has(name)) return pathCache.get(name);
  const resolved = findViaWhereOrWhich(name) ?? findViaPathScan(name);
  pathCache.set(name, resolved);
  return resolved;
}

function getConfiguredBinary(envName: string, binaryName: "ffmpeg" | "ffprobe"): string {
  const configured = process.env[envName]?.trim();
  if (configured) return resolve(configured);
  return findOnPath(binaryName) ?? binaryName;
}

export function getFfmpegBinary(): string {
  return getConfiguredBinary(FFMPEG_PATH_ENV, "ffmpeg");
}

export function getFfprobeBinary(): string {
  return getConfiguredBinary(FFPROBE_PATH_ENV, "ffprobe");
}

export function assertConfiguredFfmpegBinariesExist(): void {
  const ffmpegPath = process.env[FFMPEG_PATH_ENV]?.trim();
  if (ffmpegPath && !existsSync(ffmpegPath)) {
    throw new Error(
      `[FFmpeg] FFmpeg binary not found at ${FFMPEG_PATH_ENV}="${ffmpegPath}". ` +
        "Install FFmpeg or unset the override.",
    );
  }

  const ffprobePath = process.env[FFPROBE_PATH_ENV]?.trim();
  if (ffprobePath && !existsSync(ffprobePath)) {
    throw new Error(
      `[FFmpeg] FFprobe binary not found at ${FFPROBE_PATH_ENV}="${ffprobePath}". ` +
        "Install FFmpeg or unset the override.",
    );
  }
}
