import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { findBrowser, type BrowserResult } from "./manager.js";
import {
  FFMPEG_PATH_ENV,
  FFPROBE_PATH_ENV,
  findFFmpeg,
  findFFprobe,
  getFFmpegInstallHint,
} from "./ffmpeg.js";
import {
  chromeDepsInstallCommand,
  detectLinuxDistro,
  distroLabel,
  probeChromeSharedLibs,
} from "./linuxDeps.js";
import { getFreeDiskMb } from "../telemetry/system.js";

export type EnvironmentCheckLevel = "ok" | "warn" | "error";

export interface EnvironmentCheckOutcome {
  name: string;
  ok: boolean;
  detail: string;
  level: EnvironmentCheckLevel;
  title?: string;
  hint?: string;
  path?: string;
}

export interface EnvironmentCheckResult {
  outcomes: EnvironmentCheckOutcome[];
  ffmpegPath?: string;
  ffprobePath?: string;
  browser?: BrowserResult;
}

export interface EnvironmentCheckOptions {
  projectDir?: string;
  diskPaths?: string[];
  browserPath?: string;
  includeBrowser?: boolean;
  includeDisk?: boolean;
  includeWindowsUnc?: boolean;
}

export function parseToolVersion(raw: string): string {
  const m = raw.match(/(ffmpeg|ffprobe)\s+version\s+([\d][\d.\-\w]*)/i);
  return m ? `${m[1]} ${m[2]}` : raw.trim();
}

function configuredMissingDetail(envName: string): string | undefined {
  const configured = process.env[envName]?.trim();
  if (!configured || existsSync(configured)) return undefined;
  return `Configured path does not exist: ${envName}="${configured}"`;
}

type ToolVersionResult = { ok: true; detail: string } | { ok: false; detail: string };

function readToolVersion(binaryPath: string): ToolVersionResult {
  try {
    const raw =
      execFileSync(binaryPath, ["-version"], { encoding: "utf-8", timeout: 5000 }).split("\n")[0] ??
      "";
    const version = parseToolVersion(raw);
    return { ok: true, detail: version ? `${version} at ${binaryPath}` : binaryPath };
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
    const exitDetail = typeof status === "number" ? ` (exit code ${status})` : "";
    return {
      ok: false,
      detail: `Failed to run "${binaryPath}" -version${exitDetail}.`,
    };
  }
}

function checkFFmpeg(): EnvironmentCheckOutcome {
  const missingConfigured = configuredMissingDetail(FFMPEG_PATH_ENV);
  if (missingConfigured) {
    return {
      name: "FFmpeg",
      ok: false,
      level: "error",
      title: "FFmpeg not found",
      detail: missingConfigured,
      hint: getFFmpegInstallHint(),
    };
  }

  const path = findFFmpeg();
  if (path) {
    const version = readToolVersion(path);
    if (!version.ok) {
      return {
        name: "FFmpeg",
        ok: false,
        level: "error",
        title: "FFmpeg cannot start",
        detail: version.detail,
        hint: "Install a working 64-bit FFmpeg build with all required runtime DLLs.",
        path,
      };
    }
    return { name: "FFmpeg", ok: true, level: "ok", detail: version.detail, path };
  }

  return {
    name: "FFmpeg",
    ok: false,
    level: "error",
    title: "FFmpeg not found",
    detail: "FFmpeg is required to encode video. The render cannot proceed without it.",
    hint: getFFmpegInstallHint(),
  };
}

function checkFFprobe(): EnvironmentCheckOutcome {
  const missingConfigured = configuredMissingDetail(FFPROBE_PATH_ENV);
  if (missingConfigured) {
    return {
      name: "FFprobe",
      ok: false,
      level: "error",
      title: "FFprobe not found",
      detail: missingConfigured,
      hint: getFFmpegInstallHint(),
    };
  }

  const path = findFFprobe();
  if (path) {
    const version = readToolVersion(path);
    return { name: "FFprobe", ok: true, level: "ok", detail: version.detail, path };
  }

  return {
    name: "FFprobe",
    ok: false,
    level: "error",
    title: "FFprobe not found",
    detail:
      "FFprobe is required to probe media assets. It ships with FFmpeg but was not found on PATH.",
    hint: getFFmpegInstallHint(),
  };
}

/**
 * A Chrome binary can exist on disk yet be unlaunchable because its system
 * shared libraries (libnss3, libatk, ...) aren't installed — the dominant WSL
 * first-render failure. When that's the case, downgrade the "found" outcome to
 * a render-blocking error carrying the exact per-distro install command, so the
 * user hits it in `doctor`/pre-flight instead of a cryptic
 * `Failed to launch the browser process` mid-render. No-op off Linux and when
 * `ldd` can't run (probe inconclusive).
 */
function chromeSharedLibOutcome(
  executablePath: string,
  found: EnvironmentCheckOutcome,
): EnvironmentCheckOutcome {
  if (process.platform !== "linux") return found;
  const probe = probeChromeSharedLibs(executablePath);
  if (probe.probeUnavailable || probe.ok) return found;

  const distro = detectLinuxDistro();
  return {
    name: "Chrome",
    ok: false,
    level: "error",
    title: "Chrome cannot launch (missing system libraries)",
    detail: `Chrome at ${executablePath} is missing shared libraries on ${distroLabel(distro)}: ${probe.missing.join(", ")}`,
    hint: chromeDepsInstallCommand(distro.family),
    path: executablePath,
  };
}

async function checkChrome(browserPath?: string): Promise<EnvironmentCheckOutcome> {
  if (browserPath) {
    if (existsSync(browserPath)) {
      return chromeSharedLibOutcome(browserPath, {
        name: "Chrome",
        ok: true,
        level: "ok",
        detail: `explicit: ${browserPath}`,
        path: browserPath,
      });
    }
    return {
      name: "Chrome",
      ok: false,
      level: "error",
      title: "Chrome not found",
      detail: `Chrome binary not found at "${browserPath}".`,
      hint: "Run: npx hyperframes browser ensure",
    };
  }

  // A corrupt/partial browser cache (stub files where a version dir is
  // expected, missing executable, malformed metadata) makes findBrowser throw.
  // That is the exact condition this check exists to report, so treat any
  // failure as "Chrome not found" rather than letting it crash the caller
  // (notably `doctor`, which is documented to exit 0 even when checks fail).
  let info: Awaited<ReturnType<typeof findBrowser>>;
  try {
    info = await findBrowser();
  } catch {
    info = undefined;
  }
  if (info) {
    return chromeSharedLibOutcome(info.executablePath, {
      name: "Chrome",
      ok: true,
      level: "ok",
      detail: `${info.source}: ${info.executablePath}`,
      path: info.executablePath,
    });
  }

  return {
    name: "Chrome",
    ok: false,
    level: "error",
    title: "Chrome not found",
    detail: "Chrome Headless Shell is required for local rendering.",
    hint: "Run: npx hyperframes browser ensure",
  };
}

export function checkDisk(
  path = ".",
  freeDiskMb: (path: string) => number | null = getFreeDiskMb,
): EnvironmentCheckOutcome {
  const freeMb = freeDiskMb(path);
  if (freeMb === null) {
    return { name: "Disk", ok: true, level: "ok", detail: "Unable to check" };
  }
  const freeGb = (freeMb / 1024).toFixed(1);
  if (freeMb < 1024) {
    return {
      name: "Disk",
      ok: false,
      level: "error",
      title: "Low disk space",
      detail: `${freeGb} GB free at ${path}`,
      hint: "Renders produce large temp files. Free disk space before rendering.",
    };
  }
  return { name: "Disk", ok: true, level: "ok", detail: `${freeGb} GB free at ${path}` };
}

function checkWindowsUncPath(projectDir = process.cwd()): EnvironmentCheckOutcome | undefined {
  if (platform() !== "win32") return undefined;
  if (!projectDir.startsWith("\\\\")) return undefined;
  return {
    name: "Windows path",
    ok: true,
    level: "warn",
    detail: `UNC path: ${projectDir}`,
    hint: "Chrome may fail to launch from a network share. Use a local drive if render startup fails.",
  };
}

// fallow-ignore-next-line complexity
export async function runEnvironmentChecks(
  options: EnvironmentCheckOptions = {},
): Promise<EnvironmentCheckResult> {
  const outcomes: EnvironmentCheckOutcome[] = [];

  const ffmpeg = checkFFmpeg();
  outcomes.push(ffmpeg);

  const ffprobe = checkFFprobe();
  outcomes.push(ffprobe);

  let browser: BrowserResult | undefined;
  if (options.includeBrowser) {
    const chrome = await checkChrome(options.browserPath);
    outcomes.push(chrome);
    if (chrome.ok && chrome.path) {
      browser = {
        executablePath: chrome.path,
        source: options.browserPath ? "env" : "cache",
      };
    }
  }

  if (options.includeDisk) {
    const diskPaths = [...new Set(options.diskPaths ?? [options.projectDir ?? "."])];
    outcomes.push(...diskPaths.map((path) => checkDisk(path)));
  }

  if (options.includeWindowsUnc) {
    const unc = checkWindowsUncPath(options.projectDir);
    if (unc) outcomes.push(unc);
  }

  return {
    outcomes,
    ...(ffmpeg.ok && ffmpeg.path ? { ffmpegPath: ffmpeg.path } : {}),
    ...(ffprobe.path ? { ffprobePath: ffprobe.path } : {}),
    ...(browser ? { browser } : {}),
  };
}
