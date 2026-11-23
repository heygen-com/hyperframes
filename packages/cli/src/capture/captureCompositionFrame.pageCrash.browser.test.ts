import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { openSettledCompositionPage } from "./captureCompositionFrame.js";

const HTML = `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-duration="1"></div></body></html>`;

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

// On main a crashed page's pending calls waited out the 180 s protocol timeout.
it("a call pending on a page whose renderer crashes fails at once, named as the crash", async () => {
  const { browser, page } = await openSettledCompositionPage(HTML, url, {
    renderReadyTimeoutMs: 500,
    renderReadyWarningSuffix: "test",
    browserGpuMode: "software",
  });
  try {
    const pending = page.evaluate(() => new Promise(() => {}));
    const session = await page.createCDPSession();
    void session.send("Page.crash").catch(() => undefined);
    const startedAt = Date.now();
    const error = await pending.then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(normalizeErrorMessage(error)).toMatch(
      /^The browser page crashed, most likely out of memory: /,
    );
  } finally {
    await browser.close();
  }
}, 60_000);
