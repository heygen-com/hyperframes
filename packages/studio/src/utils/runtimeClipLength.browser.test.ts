// Real Chrome: a capture page's film length while the runtime lets go of a far clip it has already measured.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  STUDIO_PREVIEW_CAPTURE_MODE,
  STUDIO_PREVIEW_MARK_META,
} from "@hyperframes/core/studio-preview-mark";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";

const require = createRequire(import.meta.url);
const ORIGIN = "https://fixture.hyperframes.test";
const CLIP = readFileSync(new URL("../../tests/fixtures/clip-600s.webm", import.meta.url));

/** The clip trimmed to 37.43 s at 0, and untrimmed (600 s) at 300 s: the film is 900 s long. */
function filmHtml(): string {
  const gsap = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  return `<!doctype html><html><head><meta charset="UTF-8">
    <meta name="${STUDIO_PREVIEW_MARK_META}" content="${STUDIO_PREVIEW_CAPTURE_MODE}">
    <script>${gsap}</script><script>${runtime}</script></head><body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
      <video class="clip" src="${ORIGIN}/clip-600s.webm" data-start="0" data-duration="37.43" data-track-index="0" muted></video>
      <video id="far" class="clip" src="${ORIGIN}/clip-600s.webm" data-start="300" data-track-index="1" muted></video>
    </div>
    <script>window.__timelines = window.__timelines || {}; window.__timelines.main = gsap.timeline({ paused: true });</script>
    </body></html>`;
}

let browser: Browser;
beforeAll(async () => {
  browser = await launchTestChrome();
});
afterAll(() => closeTestChrome(browser));

// fails without the fix: each time the runtime let go of the far clip, the film fell back to 37.43 s.
it("keeps a far clip's measured length while the runtime lets go of it", async () => {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (url === `${ORIGIN}/index.html`)
      return void request.respond({ status: 200, contentType: "text/html", body: filmHtml() });
    if (url === `${ORIGIN}/clip-600s.webm`)
      return void request.respond({ status: 200, contentType: "video/webm", body: CLIP });
    void request.abort();
  });
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(
    () => (window as unknown as { __playerReady?: boolean }).__playerReady === true,
  );
  // Asks the far clip to load as a length read does, and notes the film's length every 16 ms for 2 s.
  const lengths = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const far = document.getElementById("far") as HTMLVideoElement;
        const player = (window as unknown as { __player: { getDuration(): number } }).__player;
        const seen: number[] = [];
        const started = performance.now();
        (function poll() {
          if (far.readyState < 1 && far.networkState !== 2) {
            far.preload = "metadata";
            far.load();
          }
          seen.push(player.getDuration());
          if (performance.now() - started > 2000) return resolve(seen);
          setTimeout(poll, 16);
        })();
      }),
  );
  await page.close();
  const measured = lengths.indexOf(900);
  expect(measured).toBeGreaterThanOrEqual(0);
  expect(lengths.slice(measured).filter((seconds) => seconds !== 900)).toEqual([]);
}, 30_000);
