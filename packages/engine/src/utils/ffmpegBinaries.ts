// fallow-ignore-file code-duplication
import { execFileSync } from "child_process";
import { accessSync, constants, existsSync } from "fs";
import { delimiter, join, resolve } from "path";

export const FFMPEG_PATH_ENV = "HYPERFRAMES_FFMPEG_PATH";
export const FFPROBE_PATH_ENV = "HYPERFRAMES_FFPROBE_PATH";

const pathCache = new Map<string, string | undefined>();

function candidateFileName(candidate: string): string {
  return candidate.split(/[\\/]/).at(-1)?.toLowerCase() ?? candidate.toLowerCase();
}

function chooseBestPathCandidate(
  name: "ffmpeg" | "ffprobe",
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

function scanPath(name: "ffmpeg" | "ffprobe"): string | undefined {
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

function isExecutablePathCandidate(candidate: string): boolean {
  if (process.platform === "win32") return existsSync(candidate);
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(name: "ffmpeg" | "ffprobe"): string | undefined {
  if (pathCache.has(name)) return pathCache.get(name);
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
  const resolved = found ? resolve(found) : undefined;
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
        `Install FFmpeg or unset the override.${pathEncodingHint(ffmpegPath)}`,
    );
  }

  const ffprobePath = process.env[FFPROBE_PATH_ENV]?.trim();
  if (ffprobePath && !existsSync(ffprobePath)) {
    throw new Error(
      `[FFmpeg] FFprobe binary not found at ${FFPROBE_PATH_ENV}="${ffprobePath}". ` +
        `Install FFmpeg or unset the override.${pathEncodingHint(ffprobePath)}`,
    );
  }
}

function pathEncodingHint(configuredPath: string): string {
  if (!configuredPath.includes("\uFFFD")) return "";
  return " The path contains a Unicode replacement character, which usually means it was mangled while being copied or decoded.";
}
