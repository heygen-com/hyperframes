import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openSettledCompositionPage } from "./captureCompositionFrame.js";

// A WebGL scene drawn on seek, as a Three.js composition does: with the context's default buffer the
// pixels are gone once the frame is presented, so the motion check read every sample as the same blank.
const HTML = `<!doctype html><html><body style="margin:0;background:#000">
<div id="root" data-composition-id="main" data-width="320" data-height="180" data-duration="1">
<canvas id="gl" width="64" height="36"></canvas></div>
<script>
  window.__renderReady = true;
  const gl = document.getElementById("gl").getContext("webgl");
  window.draw = (r) => { gl.clearColor(r, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); };
  window.draw(1);
  window.readBack = () => {
    const scratch = document.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    const context = scratch.getContext("2d");
    context.drawImage(document.getElementById("gl"), 0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  };
</script></body></html>`;

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

it("keeps a WebGL canvas readable after it is presented, so motion drawn on it can be seen", async () => {
  const { browser, page } = await openSettledCompositionPage(HTML, url, {
    renderReadyTimeoutMs: 5_000,
    renderReadyWarningSuffix: "test",
    browserGpuMode: "software",
  });
  try {
    expect(await page.evaluate(() => (window as any).readBack())).toEqual([255, 0, 0, 255]);
    // The page keeps no list of the 2d canvases it makes, which the check's own scratch canvases would fill.
    expect(await page.evaluate(() => "__hf_canvas_2d" in window)).toBe(false);
  } finally {
    await browser.close();
  }
}, 90_000);
