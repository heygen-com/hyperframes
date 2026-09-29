import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Resolve the same Chrome binary for every local Studio browser acceptance test. */
export function resolveChromeExecutable() {
  const chromeRoot = join(homedir(), ".cache", "puppeteer", "chrome");
  const builds = existsSync(chromeRoot) ? readdirSync(chromeRoot).sort().reverse() : [];
  const installed = builds.flatMap((build) =>
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
    ...installed,
  ].find((candidate) => candidate && existsSync(candidate));
}
