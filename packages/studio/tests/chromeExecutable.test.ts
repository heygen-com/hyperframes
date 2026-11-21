import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveChromeExecutable } from "./e2e/chrome-executable.mjs";

const SYSTEM = "/usr/bin/google-chrome";
// Joined as the finder joins it, so the path matches on a Windows runner too.
const DOWNLOADED = join("/cache", "chrome", "linux-155.0.8059.39", "chrome-linux64", "chrome");
const OLD = () => "Google Chrome 113.0.5672.63";

describe("the Chrome Studio's browser test scripts launch", () => {
  // fails without the fix: the scripts' own list tried a system Chrome first and never read its version.
  it("is the downloaded Chrome, even beside a system Chrome", () => {
    const found = resolveChromeExecutable(
      { PUPPETEER_CACHE_DIR: "/cache" },
      (path) => path === SYSTEM || path === DOWNLOADED,
      "linux",
      OLD,
      () => ["linux-155.0.8059.39"],
    );
    expect(found).toBe(DOWNLOADED);
  });

  it("is never a system Chrome too old for Studio", () => {
    const found = resolveChromeExecutable(
      { PUPPETEER_CACHE_DIR: "/cache" },
      (path) => path === SYSTEM,
      "linux",
      OLD,
      () => [],
    );
    expect(found).toBeUndefined();
  });

  it("is the one an environment variable names, before either", () => {
    const found = resolveChromeExecutable(
      { PUPPETEER_CACHE_DIR: "/cache", CHROME_PATH: "/pinned/chrome" },
      () => true,
      "linux",
      OLD,
      () => ["linux-155.0.8059.39"],
    );
    expect(found).toBe("/pinned/chrome");
  });
});
