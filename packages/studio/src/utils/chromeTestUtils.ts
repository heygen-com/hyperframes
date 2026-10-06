import puppeteer, { type Browser } from "puppeteer-core";
import { findSystemChrome } from "../../vite.browser";

/**
 * Headless system Chrome with the flags of Studio's e2e launcher (tests/e2e/chrome-executable.mjs).
 * The calling test's timeout bounds the launch, not puppeteer's 30 s default.
 */
export async function launchTestChrome(): Promise<Browser> {
  const executablePath = findSystemChrome();
  if (!executablePath) throw new Error("no Chrome found: set HYPERFRAMES_BROWSER_PATH");
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    timeout: 0,
  });
}
