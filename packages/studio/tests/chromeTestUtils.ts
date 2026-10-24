import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer, { TimeoutError, type Browser, type Page } from "puppeteer-core";
import { browserVersion, findSystemChrome } from "../vite.browser";

const require = createRequire(import.meta.url);

const LAUNCH_TIMEOUT_MS = 20_000;
const LAUNCH_ATTEMPTS = 2;

/** Headless Chrome with the e2e launcher's flags. A launch stuck past 20 s (seen on Windows runners)
 * is killed and tried once more. On Windows Puppeteer reports it as "already running", not a timeout. */
export async function launchTestChrome(
  launch: typeof puppeteer.launch = (options) => puppeteer.launch(options),
): Promise<Browser> {
  const executablePath = findSystemChrome();
  if (!executablePath) throw new Error("no Chrome found: set HYPERFRAMES_BROWSER_PATH");
  const options = {
    executablePath,
    headless: true,
    dumpio: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    timeout: LAUNCH_TIMEOUT_MS,
  };
  const version = browserVersion(executablePath) ?? "version unavailable";
  for (let attempt = 1; attempt <= LAUNCH_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    console.info(
      `[studio-test-chrome] launch ${attempt}/${LAUNCH_ATTEMPTS}: ${executablePath} (${version})`,
    );
    try {
      const browser = await launch(options);
      console.info(
        `[studio-test-chrome] launch ${attempt}/${LAUNCH_ATTEMPTS} ready after ${Date.now() - startedAt} ms`,
      );
      return browser;
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[studio-test-chrome] launch ${attempt}/${LAUNCH_ATTEMPTS} failed after ${elapsed} ms: ${reason}`,
      );
      const stuck = error instanceof TimeoutError || elapsed >= LAUNCH_TIMEOUT_MS;
      if (!stuck || attempt === LAUNCH_ATTEMPTS) throw error;
    }
  }
  throw new Error("Chrome launch attempts exhausted");
}

/** Closes a test Chrome, killing it when close hangs (seen on Windows runners) so the test never times out. */
export async function closeTestChrome(
  browser: Browser | undefined,
  timeoutMs = 5_000,
): Promise<void> {
  if (!browser) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = await Promise.race([
    browser.close().then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => (timer = setTimeout(resolve, timeoutMs, false))),
  ]);
  clearTimeout(timer);
  if (closed) return;
  browser.process()?.kill("SIGKILL");
  await browser.disconnect().catch(() => undefined);
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
