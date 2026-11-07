import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openSettledCompositionPage } from "../capture/captureCompositionFrame.js";

const TEXT = `x="20" font-family="sans-serif" font-weight="700" font-size="40"`;
const HTML = `<!doctype html><html><body style="margin:0">
<div data-composition-id="main" data-width="640" data-height="360" data-duration="1"
  style="position:relative;width:640px;height:360px;background:#0b0b14">
  <svg width="640" height="360" style="position:absolute;left:0;top:0">
    <defs>
      <linearGradient id="light"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e3f6ff"/></linearGradient>
      <linearGradient id="dim"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#202030"/></linearGradient>
      <linearGradient id="borrowed" href="#light" x1="0" x2="0" y2="1"/>
      <pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="#fff"/></pattern>
    </defs>
    <text id="light-text" ${TEXT} y="60" fill="url(#light)">Light gradient</text>
    <text id="dim-text" ${TEXT} y="140" fill="url(#dim)">Dim gradient</text>
    <text id="borrowed-text" ${TEXT} y="220" fill="url(#borrowed)">Borrowed stops</text>
    <text id="pattern-text" ${TEXT} y="300" fill="url(#dots)">Pattern fill</text>
  </svg>
</div><script>window.__renderReady = true;</script></body></html>`;
const SCRIPT = readFileSync(join(import.meta.dirname, "contrast-audit.browser.js"), "utf8");

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) =>
    res.writeHead(200, { "Content-Type": "text/html" }).end(HTML),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

// fails without the fix: a url(#gradient) fill was read as `color` (black), so near-white text failed at 1.07:1.
it("judges SVG gradient text by its stops and skips a pattern fill", async () => {
  const { browser, page } = await openSettledCompositionPage(HTML, url, {
    renderReadyTimeoutMs: 5_000,
    renderReadyWarningSuffix: "test",
    browserGpuMode: "software",
  });
  try {
    await page.addScriptTag({ content: SCRIPT });
    const candidates = await page.evaluate("window.__contrastAuditPrepare()");
    const shot = await page.screenshot({ encoding: "base64", omitBackground: true });
    const entries = (await page.evaluate(
      (png: string, items: unknown) =>
        Reflect.apply(Reflect.get(window, "__contrastAuditFinish"), window, [png, 0, items, null]),
      shot,
      candidates,
    )) as { selector: string; fg: string; wcagAA: boolean }[];
    const bySelector = Object.fromEntries(
      entries.map(({ selector, fg, wcagAA }) => [selector, { fg, wcagAA }]),
    );
    expect(bySelector).toEqual({
      "#light-text": { fg: "rgb(227,246,255)", wcagAA: true },
      "#dim-text": { fg: "rgb(32,32,48)", wcagAA: false },
      "#borrowed-text": { fg: "rgb(227,246,255)", wcagAA: true },
    });
  } finally {
    await browser.close();
  }
}, 90_000);
