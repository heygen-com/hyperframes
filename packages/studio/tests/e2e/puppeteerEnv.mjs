/**
 * Shared browser-gate helper. Every e2e gate here needs to find a Chrome, and
 * one copy means a fix to the search order lands in all of them.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveChromeExecutable() {
  const chromeRoot = join(homedir(), ".cache", "puppeteer", "chrome");
  const builds = existsSync(chromeRoot) ? readdirSync(chromeRoot).sort().reverse() : [];
  const installedCandidates = builds.flatMap((build) =>
    [
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-linux64/chrome",
    ].map((relative) => join(chromeRoot, build, relative)),
  );
  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    ...installedCandidates,
  ].find((candidate) => candidate && existsSync(candidate));
}
