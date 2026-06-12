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

function readToolVersion(binaryPath: string): string {
  try {
    const raw =
      execFileSync(binaryPath, ["-version"], { encoding: "utf-8", timeout: 5000 }).split("\n")[0] ??
      "";
    const version = parseToolVersion(raw);
    return version ? `${version} at ${binaryPath}` : binaryPath;
  } catch {
    return binaryPath;
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
    return { name: "FFmpeg", ok: true, level: "ok", detail: readToolVersion(path), path };
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
    return { name: "FFprobe", ok: true, level: "ok", detail: readToolVersion(path), path };
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

async function checkChrome(browserPath?: string): Promise<EnvironmentCheckOutcome> {
  if (browserPath) {
    if (existsSync(browserPath)) {
      return {
        name: "Chrome",
        ok: true,
        level: "ok",
        detail: `explicit: ${browserPath}`,
        path: browserPath,
      };
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

  const info = await findBrowser();
  if (info) {
    return {
      name: "Chrome",
      ok: true,
      level: "ok",
      detail: `${info.source}: ${info.executablePath}`,
      path: info.executablePath,
    };
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

function checkDisk(projectDir = "."): EnvironmentCheckOutcome {
  const freeMb = getFreeDiskMb(projectDir);
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
      detail: `${freeGb} GB free`,
      hint: "Renders produce large temp files. Free disk space before rendering.",
    };
  }
  return { name: "Disk", ok: true, level: "ok", detail: `${freeGb} GB free` };
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
    outcomes.push(checkDisk(options.projectDir));
  }

  if (options.includeWindowsUnc) {
    const unc = checkWindowsUncPath(options.projectDir);
    if (unc) outcomes.push(unc);
  }

  return {
    outcomes,
    ...(ffmpeg.path ? { ffmpegPath: ffmpeg.path } : {}),
    ...(ffprobe.path ? { ffprobePath: ffprobe.path } : {}),
    ...(browser ? { browser } : {}),
  };
}
