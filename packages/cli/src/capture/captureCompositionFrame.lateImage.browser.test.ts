import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openSettledCompositionPage } from "./captureCompositionFrame.js";

// A red image added after load and served past the 1.5 s settle cap: render waits for it, so the
// settled page every snapshot, compare and check frame is taken from must wait too.
const IMAGE_MS = 3_000;
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);
const HTML = `<!doctype html><html><body style="margin:0;background:#000">
<div id="root" data-composition-id="main" data-width="320" data-height="180" data-duration="1"></div>
<script>
  window.__renderReady = true;
  addEventListener("load", () => {
    const image = document.createElement("img");
    image.src = "/late.png";
    image.style.cssText = "position:absolute;left:0;top:0;width:320px;height:180px";
    document.getElementById("root").appendChild(image);
  });
</script></body></html>`;

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/late.png") {
      setTimeout(() => res.writeHead(200, { "Content-Type": "image/png" }).end(RED_PNG), IMAGE_MS);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

it("waits for an image that lands after the settle cap, as render does", async () => {
  const { browser, page } = await openSettledCompositionPage(HTML, url, {
    renderReadyTimeoutMs: 5_000,
    renderReadyWarningSuffix: "test",
    browserGpuMode: "software",
  });
  try {
    const frame = await page.screenshot({ type: "png" });
    const { data, info } = await sharp(frame).raw().toBuffer({ resolveWithObject: true });
    const center =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect([...data.subarray(center, center + 3)]).toEqual([255, 0, 0]);
  } finally {
    await browser.close();
  }
}, 90_000);
