import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openSettledCompositionPage } from "./captureCompositionFrame.js";

// GSAP from a slow CDN: a parser-blocking script holds DOMContentLoaded back.
const SCRIPT_DELAY_MS = 15_000;
const HTML = `<!doctype html><html><head><script src="/slow.js"></script></head>
<body><div data-composition-id="main" data-width="320" data-height="180" data-duration="1"></div></body></html>`;

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/slow.js") {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end("window.slowScriptRan = true;");
      }, SCRIPT_DELAY_MS);
      return;
    }
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

it("opens a composition whose parser-blocking script takes 15 s, as render does", async () => {
  const { browser, page } = await openSettledCompositionPage(HTML, url, {
    renderReadyTimeoutMs: 500,
    renderReadyWarningSuffix: "test",
    browserGpuMode: "software",
  });
  try {
    expect(await page.evaluate(() => Reflect.get(window, "slowScriptRan"))).toBe(true);
  } finally {
    await browser.close();
  }
}, 90_000);
