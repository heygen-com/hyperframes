import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { findSystemChrome } from "../../vite.browser";

const require = createRequire(import.meta.url);

/** Headless Chrome with the e2e launcher's flags; the test's own timeout bounds the launch. */
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

/** Shows `html` with the HyperFrames runtime; only its GSAP CDN script is served, nothing is fetched. */
export async function showWithRuntime(page: Page, html: string): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (request) =>
    request.url().endsWith("/gsap.min.js")
      ? request.respond({ body: readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8") })
      : request.abort("blockedbyclient"),
  );
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8"));
  await page.waitForFunction(() => "__player" in window);
}
