import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HTTPRequest } from "puppeteer-core";

import { injectStudioPreviewAugmentations } from "../../../studio-server/src/routes/preview.js";
import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const server = startServer();
const browser = await launchBrowser();
const project = mkdtempSync(join(tmpdir(), "hf-preview-error-"));

const FILM = "/fixtures/preview-error/index.html";
const RUNTIME = "/api/runtime.js";
// Studio's preview of a film, as its server sends it, whose runtime fails to load: the film's script then throws.
const preview = injectStudioPreviewAugmentations(
  `<!doctype html><html><head><script data-hyperframes-preview-runtime="1" src="${RUNTIME}"></script></head>
<body><div id="root" data-composition-id="main" data-width="640" data-height="360" data-duration="2"></div>
<script>window.__timelines.main = {};</script></body></html>`,
  RUNTIME,
  "signature",
  project,
  "index.html",
  { capture: false, gsapBaseUrl: "/vendor/", sandboxedCapture: false },
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
async function failure(sealed: boolean) {
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
  const open = await failure(false);
  const sealed = await failure(true);
  console.log(
    `[sealed-preview-error] unsealed ${JSON.stringify(open)}, sealed ${JSON.stringify(sealed)}`,
  );
  assert.match(open.error ?? "", /TypeError/, "unsealed reports the film's own error");
  assert.equal(sealed.error, open.error, "sealed reports what unsealed reports");
  assert.ok(
    sealed.ms < 1000,
    `sealed reports it within a second, not at the load limit: ${sealed.ms} ms`,
  );
} finally {
  await browser.close();
  await server.stop();
  rmSync(project, { recursive: true, force: true });
}
