import puppeteer from "puppeteer-core";
import { findSystemChrome } from "../../vite.chrome.ts";

/** The Chrome every Studio browser acceptance test launches: the one Studio's dev server picks. */
export const resolveChromeExecutable = findSystemChrome;

/** `element` as laid out now; a shot past the viewport resizes the page mid-shot and Studio's dock re-lays out. */
export const screenshotInPlace = (element, options = {}) =>
  element.screenshot({ ...options, captureBeyondViewport: false });

/** Headless Chrome for a Studio browser gate; exits 2 when no Chrome is installed. */
export async function launchStudioChrome() {
  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    console.error("No Chrome executable found; set PUPPETEER_EXECUTABLE_PATH");
    process.exit(2);
  }
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  return { browser, executablePath };
}
