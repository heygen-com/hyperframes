import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openSettledCompositionPage } from "./captureCompositionFrame.js";

// An image, then a fetched asset after the load event. The settle cap is lifted: a starved runner
// has not even loaded the page by the default 1.5 s, and the test is about waiting, not the cap.
const IMAGE_MS = 300;
const FETCH_MS = 500;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
const HTML = `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-duration="1"><img id="late" src="/late.png" /></div>
<script>
  window.__renderReady = true;
  fetch("/late.json").then((r) => r.text()).then((t) => { document.body.dataset.late = t; });
</script></body></html>`;

let server: Server;
let url: string;

const ROUTES: Record<string, { ms: number; type: string; body: string | Buffer }> = {
  "/": { ms: 0, type: "text/html; charset=utf-8", body: HTML },
  "/late.png": { ms: IMAGE_MS, type: "image/png", body: PNG },
  "/late.json": { ms: FETCH_MS, type: "application/json", body: '"arrived"' },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const route = ROUTES[req.url ?? "/"] ?? ROUTES["/"]!;
    setTimeout(() => res.writeHead(200, { "Content-Type": route.type }).end(route.body), route.ms);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

it("returns only once images and fetched assets that land after DOMContentLoaded are in", async () => {
  const { browser, page } = await openSettledCompositionPage(HTML, url, {
    renderReadyTimeoutMs: 5_000,
    renderReadyWarningSuffix: "test",
    lateSubresourceTimeoutMs: 60_000,
    browserGpuMode: "software",
  });
  try {
    expect(
      await page.evaluate(() => {
        const image = document.getElementById("late") as HTMLImageElement;
        return {
          complete: image.complete,
          width: image.naturalWidth,
          late: document.body.dataset.late,
        };
      }),
    ).toEqual({ complete: true, width: 1, late: '"arrived"' });
  } finally {
    await browser.close();
  }
}, 90_000);
