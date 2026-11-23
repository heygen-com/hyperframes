import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openSettledCompositionPage } from "../capture/captureCompositionFrame.js";

// Text over a two-tone backdrop, away from the origin: reading a clipped shot at the wrong offset picks the other tone.
const HTML = `<!doctype html><html><body style="margin:0">
<div data-composition-id="main" data-width="640" data-height="360" data-duration="1"
  style="position:relative;width:640px;height:360px;background:linear-gradient(90deg,#102040 50%,#f0e0c0 50%)">
  <p id="left" style="position:absolute;left:180px;top:150px;margin:0;font:32px sans-serif;color:#8090a0">Left copy</p>
  <p id="right" style="position:absolute;left:420px;top:230px;margin:0;font:32px sans-serif;color:#8090a0">Right copy</p>
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

type Box = { x: number; y: number; w: number; h: number };

it("measures the same contrast from a shot clipped to the text as from the full frame", async () => {
  const { browser, page } = await openSettledCompositionPage(HTML, url, {
    renderReadyTimeoutMs: 5_000,
    renderReadyWarningSuffix: "test",
    browserGpuMode: "software",
  });
  try {
    await page.addScriptTag({ content: SCRIPT });
    const measure = async (clipped: boolean) => {
      const candidates = (await page.evaluate("window.__contrastAuditPrepare()")) as {
        bbox: Box;
      }[];
      const x = Math.floor(Math.min(...candidates.map((c) => c.bbox.x)));
      const y = Math.floor(Math.min(...candidates.map((c) => c.bbox.y)));
      const right = Math.ceil(Math.max(...candidates.map((c) => c.bbox.x + c.bbox.w)));
      const bottom = Math.ceil(Math.max(...candidates.map((c) => c.bbox.y + c.bbox.h)));
      const clip = { x, y, width: right - x, height: bottom - y };
      const shot = await page.screenshot({
        encoding: "base64",
        omitBackground: true,
        ...(clipped ? { clip, captureBeyondViewport: false } : {}),
      });
      const region = clipped ? { clip, frameWidth: 640, frameHeight: 360 } : null;
      return page.evaluate(
        (png: string, items: unknown[], at: unknown) =>
          Reflect.apply(Reflect.get(window, "__contrastAuditFinish"), window, [png, 0, items, at]),
        shot,
        candidates,
        region,
      );
    };

    const full = (await measure(false)) as { bg: number[] }[];
    expect(full).toHaveLength(2);
    expect(full[0]?.bg).not.toEqual(full[1]?.bg);
    expect(await measure(true)).toEqual(full);
  } finally {
    await browser.close();
  }
}, 90_000);
