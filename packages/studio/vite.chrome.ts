// Which Chrome Studio launches, for its dev server and its browser tests. No project imports: plain Node loads this
// file for the scripts in tests/e2e.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, win32 as pathWin32 } from "node:path";

function systemChromePaths(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    const programFiles = env["PROGRAMFILES"] ?? "C:\\Program Files";
    const programFilesX86 = env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const localAppData = env["LOCALAPPDATA"];
    return [
      pathWin32.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      pathWin32.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      ...(localAppData
        ? [pathWin32.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")]
        : []),
    ];
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

function findPuppeteerCacheChrome(
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
  platform: NodeJS.Platform,
  readDirectories: (path: string) => string[] = readdirSync,
): string | undefined {
  const chromeRoot = join(
    env["PUPPETEER_CACHE_DIR"] ?? join(homedir(), ".cache", "puppeteer"),
    "chrome",
  );
  let versionDirs: string[];
  try {
    versionDirs = readDirectories(chromeRoot);
  } catch {
    return undefined;
  }
  const buildOrder = (directory: string): number =>
    (directory.split("-").pop() ?? "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0)
      .reduce((order, part) => order * 100000 + part, 0);
  const relativeCandidates =
    platform === "win32"
      ? ["chrome-win64/chrome.exe"]
      : [
          "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "chrome-linux64/chrome",
        ];
  for (const directory of versionDirs.sort((left, right) => buildOrder(right) - buildOrder(left))) {
    for (const relativePath of relativeCandidates) {
      const executable = join(chromeRoot, directory, relativePath);
      if (pathExists(executable)) return executable;
    }
  }
  return undefined;
}

function versionBesideExecutable(
  executable: string,
  listEntries: (path: string) => string[],
): string | undefined {
  try {
    const versions = new Set(
      listEntries(pathWin32.dirname(executable)).flatMap(
        (name) => /^(\d+(?:\.\d+){3})(?:\.manifest)?$/.exec(name)?.[1] ?? [],
      ),
    );
    return versions.size === 1 ? `Chrome/${[...versions][0]}` : undefined;
  } catch {
    return undefined;
  }
}

export function browserVersion(
  executable: string,
  run: typeof execFileSync = execFileSync,
  platform: NodeJS.Platform = process.platform,
  listEntries: (path: string) => string[] = readdirSync,
): string | undefined {
  if (platform === "win32") {
    const beside = versionBesideExecutable(executable, listEntries);
    if (beside) return beside;
  }
  const options = { encoding: "utf8" as const, timeout: 5_000, windowsHide: true };
  const env = { ...process.env, HYPERFRAMES_CHROME_VERSION_PATH: executable };
  const script =
    "(Get-Item -LiteralPath $env:HYPERFRAMES_CHROME_VERSION_PATH).VersionInfo.ProductVersion";
  try {
    if (platform !== "win32") return run(executable, ["--version"], options).trim() || undefined;
    const v = run("powershell.exe", ["-NoProfile", "-Command", script], { ...options, env }).trim();
    return /^\d+(\.\d+){3}$/.test(v) ? `Chrome/${v}` : undefined;
  } catch {
    return undefined;
  }
}

function supportedSystemChrome(
  candidates: string[],
  versionOf: (path: string) => string | undefined,
): string | undefined {
  return candidates.find((candidate) => {
    const match = versionOf(candidate)?.match(/(?:Chrome|Chromium)[ /](\d+)/i);
    return match ? Number(match[1]) >= 134 : false;
  });
}

/** Resolve explicit overrides, Puppeteer's managed browser, then compatible system installs. */
export function findSystemChrome(
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
  versionOf: (path: string) => string | undefined = (path) =>
    browserVersion(path, undefined, platform),
  readDirectories: (path: string) => string[] = readdirSync,
): string | undefined {
  const override = [
    env["HYPERFRAMES_BROWSER_PATH"],
    env["PRODUCER_HEADLESS_SHELL_PATH"],
    env["PUPPETEER_EXECUTABLE_PATH"],
    env["CHROME_PATH"],
    env["CHROME_BIN"],
  ].find((candidate): candidate is string => Boolean(candidate) && pathExists(candidate));
  return (
    override ??
    findPuppeteerCacheChrome(env, pathExists, platform, readDirectories) ??
    supportedSystemChrome(systemChromePaths(env, platform).filter(pathExists), versionOf)
  );
}
