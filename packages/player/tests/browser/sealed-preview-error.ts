import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HTTPRequest } from "puppeteer-core";

import { injectStudioPreviewAugmentations } from "../../../studio-server/src/routes/preview.js";
import { loadLimitMs, timelineNotFound } from "../../src/composition-probe.js";
import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const server = startServer();
const browser = await launchBrowser();
const project = mkdtempSync(join(tmpdir(), "hf-preview-error-"));

const FILM = "/fixtures/preview-error/index.html";
const RUNTIME = "/api/runtime.js";
// Studio's preview of a film, as its server sends it, whose runtime fails to load.
const previewOf = (filmScript: string) =>
  injectStudioPreviewAugmentations(
    `<!doctype html><html><head><script data-hyperframes-preview-runtime="1" src="${RUNTIME}"></script></head>
<body><div id="root" data-composition-id="main" data-width="640" data-height="360" data-duration="2"></div>
<script>${filmScript}</script></body></html>`,
    RUNTIME,
    "signature",
    project,
    "index.html",
    { capture: false, gsapBaseUrl: "/vendor/", sandboxedCapture: false },
  );
// The film's script then throws.
const throwing = previewOf("window.__timelines.main = {};");
// The film's script registers its own timeline, which an unsealed player could play without the runtime.
const quiet = previewOf(
  "window.__timelines = window.__timelines || {}; window.__timelines.main = { duration: () => 2, time: () => 0, seek() {}, play() {}, pause() {} };",
);

async function proxy(request: HTTPRequest) {
  const url = new URL(request.url());
  const answer = await fetch(`${server.origin}${url.pathname}${url.search}`);
  const contentType = answer.headers.get("content-type");
  await request.respond({
    status: answer.status,
    headers: contentType ? { "content-type": contentType } : {},
    body: Buffer.from(await answer.arrayBuffer()),
  });
}

/** What the player reports for that preview, and how long after the host page started. */
async function failure(sealed: boolean, preview: string) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === RUNTIME) return void request.abort("failed");
    if (path === FILM) return void request.respond({ contentType: "text/html", body: preview });
    void proxy(request);
  });
  await page.goto(`${server.origin}/host.html?fixture=preview-error${sealed ? "&sealed=1" : ""}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__playerReady || window.__playerError, {
    timeout: 60_000,
    polling: "raf",
  });
  const seen = await page.evaluate(() => ({
    error: window.__playerError ?? null,
    ms: Math.round(performance.now()),
  }));
  await page.close();
  return seen;
}

try {
  const open = await failure(false, throwing);
  const sealed = await failure(true, throwing);
  console.log(
    `[sealed-preview-error] unsealed ${JSON.stringify(open)}, sealed ${JSON.stringify(sealed)}`,
  );
  assert.match(open.error ?? "", /TypeError/, "unsealed reports the film's own error");
  assert.equal(sealed.error, open.error, "sealed reports what unsealed reports");
  assert.ok(
    sealed.ms < 1000,
    `sealed reports it within a second, not at the load limit: ${sealed.ms} ms`,
  );

  const quietOpen = await failure(false, quiet);
  const quietSealed = await failure(true, quiet);
  console.log(
    `[sealed-preview-error] quiet film: unsealed ${JSON.stringify(quietOpen)}, sealed ${JSON.stringify(quietSealed)}`,
  );
  const timedOut = timelineNotFound(loadLimitMs({ userAgent: await browser.userAgent() }));
  assert.equal(quietSealed.error, timedOut, "sealed times out without the runtime");
  assert.equal(
    quietOpen.error,
    timedOut,
    "unsealed times out as sealed does, not playing without it",
  );
  assert.ok(
    Math.abs(quietOpen.ms - quietSealed.ms) < 1000,
    `both report it at the same time: ${quietOpen.ms} vs ${quietSealed.ms} ms`,
  );
} finally {
  await browser.close();
  await server.stop();
  rmSync(project, { recursive: true, force: true });
}
