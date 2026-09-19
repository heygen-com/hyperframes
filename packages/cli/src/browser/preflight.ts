import { existsSync } from "node:fs";
import { platform } from "node:os";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { ensureBrowser, findBrowser, type BrowserResult } from "./manager.js";
import {
  macosOldChromeRefusal,
  MACOS_OLD_CHROME_REMEDIATION,
  macosRefusesManagedChrome,
} from "./macosOldChromeCrash.js";
import { FFMPEG_PATH_ENV, FFPROBE_PATH_ENV, getFFmpegInstallHint } from "./ffmpeg.js";
import {
  chromeDepsInstallCommand,
  detectLinuxDistro,
  distroLabel,
  parseLddMissingLibs,
} from "./linuxDeps.js";
import { getFreeDiskMb } from "../telemetry/system.js";
import { runCancellableProcess } from "../utils/cancellableProcess.js";

export type EnvironmentCheckLevel = "ok" | "warn" | "error";

export interface EnvironmentCheckOutcome {
  name: string;
  ok: boolean;
  detail: string;
  level: EnvironmentCheckLevel;
  title?: string;
  hint?: string;
  path?: string;
  /** Major version parsed from the tool's own `-version`/`--version` output, when available. */
  versionMajor?: number;
}

export interface EnvironmentCheckResult {
  outcomes: EnvironmentCheckOutcome[];
  ffmpegPath?: string;
  ffprobePath?: string;
  browser?: BrowserResult;
  ffmpegVersionMajor?: number;
  browserVersionMajor?: number;
}

export interface EnvironmentCheckOptions {
  projectDir?: string;
  diskPaths?: string[];
  browserPath?: string;
  includeBrowser?: boolean;
  includeDisk?: boolean;
  includeWindowsUnc?: boolean;
  signal?: AbortSignal;
}

export function parseToolVersion(raw: string): string {
  const m = raw.match(/(ffmpeg|ffprobe)\s+version\s+([\d][\d.\-\w]*)/i);
  return m ? `${m[1]} ${m[2]}` : raw.trim();
}

/** First `X.Y`-shaped number in a version banner (ffmpeg/ffprobe/Chrome all share this shape). */
export function extractMajorVersion(raw: string): number | undefined {
  const m = raw.match(/\b(\d+)\.\d+/);
  return m?.[1] ? Number(m[1]) : undefined;
}

function configuredMissingDetail(envName: string): string | undefined {
  const configured = process.env[envName]?.trim();
  if (!configured || existsSync(configured)) return undefined;
  return `Configured path does not exist: ${envName}="${configured}"`;
}

type ToolVersionResult =
  | { ok: true; detail: string; majorVersion?: number }
  | { ok: false; detail: string };

// fallow-ignore-next-line complexity
async function readToolVersion(
  binaryPath: string,
  signal?: AbortSignal,
): Promise<ToolVersionResult> {
  try {
    const output = (
      await runCancellableProcess(binaryPath, ["-version"], {
        signal,
        timeoutMs: 5000,
      })
    ).stdout;
    const raw = output.split("\n")[0] ?? "";
    const version = parseToolVersion(raw);
    return {
      ok: true,
      detail: version ? `${version} at ${binaryPath}` : binaryPath,
      majorVersion: extractMajorVersion(raw),
    };
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    const status =
      typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
    const exitDetail = typeof status === "number" ? ` (exit code ${status})` : "";
    return {
      ok: false,
      detail: `Failed to run "${binaryPath}" -version${exitDetail}.`,
    };
  }
}

async function checkFFmpeg(signal?: AbortSignal): Promise<EnvironmentCheckOutcome> {
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

  const path = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (path) {
    const version = await readToolVersion(path, signal);
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
    return {
      name: "FFmpeg",
      ok: true,
      level: "ok",
      detail: version.detail,
      path,
      versionMajor: version.majorVersion,
    };
  }

  return {
    name: "FFmpeg",
    ok: false,
    level: "error",
    title: "FFmpeg not found",
    // Second sentence dropped: "the render cannot proceed" is already said by
    // the error this accompanies, and in Studio by the disabled Export button.
    detail: "FFmpeg is required to encode video.",
    hint: getFFmpegInstallHint(),
  };
}

async function checkFFprobe(signal?: AbortSignal): Promise<EnvironmentCheckOutcome> {
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

  const path = findFfBinary("ffprobe", { configuredMustExist: true });
  if (path) {
    const version = await readToolVersion(path, signal);
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
// fallow-ignore-next-line complexity
async function chromeSharedLibOutcome(
  executablePath: string,
  found: EnvironmentCheckOutcome,
  signal?: AbortSignal,
): Promise<EnvironmentCheckOutcome> {
  if (process.platform !== "linux") return found;
  let probe;
  if (!existsSync(executablePath)) {
    probe = { ok: true, missing: [], probeUnavailable: true };
  } else {
    try {
      const result = await runCancellableProcess("ldd", [executablePath], {
        signal,
        timeoutMs: 5000,
      });
      probe = parseLddMissingLibs(result.stdout);
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      const stdout =
        typeof error === "object" && error !== null && "stdout" in error
          ? String(error.stdout ?? "")
          : "";
      const killed =
        typeof error === "object" && error !== null && "killed" in error && error.killed === true;
      probe =
        stdout && !killed
          ? parseLddMissingLibs(stdout)
          : { ok: true, missing: [], probeUnavailable: true };
    }
  }
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

function chromeLaunchFailureDetails(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const status = "status" in error ? error.status : undefined;
  const signal = "signal" in error ? error.signal : undefined;
  const code = "code" in error ? error.code : undefined;
  return [
    typeof status === "number" ? `exit code ${status}` : "",
    typeof signal === "string" ? `signal ${signal}` : "",
    typeof code === "string" ? code : "",
  ]
    .filter(Boolean)
    .join(", ");
}

async function chromeLaunchOutcome(
  executablePath: string,
  found: EnvironmentCheckOutcome,
  signal?: AbortSignal,
): Promise<EnvironmentCheckOutcome> {
  const libraries = await chromeSharedLibOutcome(executablePath, found, signal);
  if (!libraries.ok) return libraries;
  try {
    const { stdout } = await runCancellableProcess(executablePath, ["--version"], {
      signal,
      timeoutMs: 5000,
      maxBufferBytes: 64 * 1024,
    });
    return { ...found, versionMajor: extractMajorVersion(stdout) };
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    const details = chromeLaunchFailureDetails(error);
    return {
      name: "Chrome",
      ok: false,
      level: "error",
      title: "Chrome cannot start",
      detail: `Failed to run "${executablePath}" --version${details ? ` (${details})` : ""}.`,
      hint:
        "Select a working Chrome/Chromium binary for this OS and architecture with " +
        "HYPERFRAMES_BROWSER_PATH, or reinstall with: npx hyperframes browser ensure --force",
      path: executablePath,
    };
  }
}

const macosOldChromeOutcome = (): EnvironmentCheckOutcome => ({
  name: "Chrome",
  ok: false,
  level: "error",
  title: "Chrome cannot run on this macOS",
  detail: macosOldChromeRefusal(),
  hint: MACOS_OLD_CHROME_REMEDIATION,
});

async function resolveBrowserForCheck(signal?: AbortSignal) {
  // A corrupt/partial browser cache (stub files where a version dir is
  // expected, missing executable, malformed metadata) makes findBrowser throw.
  // That is the exact condition this check exists to report, so treat any
  // failure as "Chrome not found" rather than letting it crash the caller
  // (notably `doctor`, which is documented to exit 0 even when checks fail).
  try {
    return signal
      ? await ensureBrowser({ preferManagedChrome: true, signal })
      : await findBrowser();
  } catch {
    if (signal?.aborted) signal.throwIfAborted();
    return undefined;
  }
}

async function checkChrome(
  browserPath?: string,
  signal?: AbortSignal,
): Promise<EnvironmentCheckOutcome> {
  if (browserPath) {
    if (existsSync(browserPath)) {
      return chromeLaunchOutcome(
        browserPath,
        {
          name: "Chrome",
          ok: true,
          level: "ok",
          detail: `explicit: ${browserPath}`,
          path: browserPath,
        },
        signal,
      );
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

  const info = await resolveBrowserForCheck(signal);
  if (info && macosRefusesManagedChrome(info)) return macosOldChromeOutcome();
  if (info) {
    return chromeLaunchOutcome(
      info.executablePath,
      {
        name: "Chrome",
        ok: true,
        level: "ok",
        detail: `${info.source}: ${info.executablePath}`,
        path: info.executablePath,
      },
      signal,
    );
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

  const ffmpeg = await checkFFmpeg(options.signal);
  outcomes.push(ffmpeg);

  const ffprobe = await checkFFprobe(options.signal);
  outcomes.push(ffprobe);

  let browser: BrowserResult | undefined;
  let browserVersionMajor: number | undefined;
  if (options.includeBrowser) {
    const chrome = await checkChrome(options.browserPath, options.signal);
    outcomes.push(chrome);
    if (chrome.ok && chrome.path) {
      browser = {
        executablePath: chrome.path,
        source: options.browserPath ? "env" : "cache",
      };
    }
    browserVersionMajor = chrome.versionMajor;
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
    ...(ffmpeg.versionMajor != null ? { ffmpegVersionMajor: ffmpeg.versionMajor } : {}),
    ...(browserVersionMajor != null ? { browserVersionMajor } : {}),
  };
}
