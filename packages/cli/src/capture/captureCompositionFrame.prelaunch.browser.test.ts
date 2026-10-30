import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  openSettledCompositionPage,
  prelaunchCompositionBrowser,
} from "./captureCompositionFrame.js";

const html = (width: number) =>
  `<!doctype html><html><body><div data-composition-id="main" data-width="${width}" data-height="360" data-duration="1"></div><script>window.__renderReady = true;</script></body></html>`;

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) =>
    res.writeHead(200, { "Content-Type": "text/html" }).end(html(640)),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

it.each([
  { guess: 640, reused: true },
  { guess: 800, reused: false },
])(
  "uses a browser started early only if it got the same launch ($guess px guess)",
  async ({ guess, reused }) => {
    const prelaunched = prelaunchCompositionBrowser(html(guess), "software");
    const early = (await prelaunched.launched)?.browser;
    expect(early?.connected).toBe(true);
    const { browser } = await openSettledCompositionPage(html(640), url, {
      renderReadyTimeoutMs: 5_000,
      renderReadyWarningSuffix: "test",
      browserGpuMode: "software",
      prelaunched,
    });
    try {
      await prelaunched.discard();
      expect(browser === early).toBe(reused);
      expect(early?.connected).toBe(reused);
      expect(browser.connected).toBe(true);
    } finally {
      await browser.close();
      await early?.close().catch(() => undefined);
    }
  },
  90_000,
);
