import { createServer, type IncomingMessage, type RequestOptions } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { createSocket } from "node:dgram";
import { createServer as createTcpServer } from "node:net";

const fixture = vi.hoisted(() => ({
  port: 0,
  privateHits: 0,
  publicHits: 0,
  rebound: false,
  dialed: [] as string[],
}));
vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  return {
    ...real,
    promises: {
      ...real.promises,
      Resolver: class {
        async resolve4(host: string) {
          if (host === "capture-fixture.example.com") {
            return [fixture.rebound ? "127.0.0.1" : "93.184.216.34"];
          }
          throw new Error("Fixture has no such DNS name");
        }
        cancel() {}
      },
    },
  };
});
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    execFile: (...args: Parameters<typeof real.execFile>) => {
      if (!(args[1] as string[] | undefined)?.includes("-e")) return real.execFile(...args);
      const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void;
      callback(new Error("Fixture has no system DNS"), "", "ENOTFOUND");
      return { once() {}, kill() {} } as unknown as ReturnType<typeof real.execFile>;
    },
  };
});
vi.mock("node:http", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:http")>();
  return {
    ...original,
    request(options: RequestOptions, listener?: (response: IncomingMessage) => void) {
      if (options.hostname === "93.184.216.34") {
        fixture.dialed.push(options.hostname);
        // Simulate the checked public peer with a local server; assert the actual dial input.
        expect(Number(options.port)).toBe(fixture.port);
        options = { ...options, hostname: "127.0.0.1" };
      }
      return original.request(options, listener);
    },
  };
});
import { launchCaptureBrowser } from "./launchCaptureBrowser.js";

const chrome = process.env.HYPERFRAMES_TEST_BROWSER_PATH;
describe.skipIf(!chrome || !existsSync(chrome))("real browser public transport", () => {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/private")) fixture.privateHits++;
    else fixture.publicHits++;
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: `http://127.0.0.1:${fixture.port}/private` });
      res.end();
    } else if (req.url === "/page") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<html><body>fixture<img src="http://127.0.0.1:${fixture.port}/private-image"><iframe src="http://127.0.0.1:${fixture.port}/private-frame"></iframe></body></html>`,
      );
    } else res.end("controlled fixture");
  });
  let capture: Awaited<ReturnType<typeof launchCaptureBrowser>>;
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    fixture.port = (server.address() as { port: number }).port;
    capture = await launchCaptureBrowser({
      executablePath: chrome!,
      protocolTimeout: 15_000,
      disableWebgl: true,
      width: 800,
      height: 600,
    });
  }, 20_000);
  afterAll(async () => {
    await capture?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("renders the public peer but never requests a private redirect or subresource", async () => {
    const page = await capture.browser.newPage();
    try {
      const base = `http://capture-fixture.example.com:${fixture.port}`;
      await page.goto(base + "/page", { waitUntil: "networkidle0", timeout: 10_000 });
      expect(await page.$eval("body", (body) => body.textContent)).toContain("fixture");
      await page
        .goto(base + "/redirect", { waitUntil: "domcontentloaded", timeout: 5_000 })
        .catch(() => {});
      expect(fixture.privateHits).toBe(0);
      expect(fixture.publicHits).toBeGreaterThan(0);
      expect(fixture.dialed.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 20_000);

  it("does not send direct WebRTC UDP to a private STUN peer", async () => {
    const udp = createSocket("udp4");
    let hits = 0;
    udp.on("message", () => {
      hits++;
    });
    await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
    const port = udp.address().port;
    const page = await capture.browser.newPage();
    try {
      await page.evaluate(async (port) => {
        const peer = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${port}` }] });
        try {
          peer.createDataChannel("probe");
          await peer.setLocalDescription(await peer.createOffer());
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } finally {
          peer.close();
        }
      }, port);
      expect(hits).toBe(0);
    } finally {
      await page.close();
      await new Promise<void>((resolve) => udp.close(() => resolve()));
    }
  }, 10_000);

  it("does not connect directly to a private WebRTC TURN TCP peer", async () => {
    let hits = 0;
    const tcp = createTcpServer((socket) => {
      hits++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
    const address = tcp.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    const page = await capture.browser.newPage();
    try {
      await page.evaluate(async (port) => {
        const peer = new RTCPeerConnection({
          iceServers: [
            {
              urls: `turn:127.0.0.1:${port}?transport=tcp`,
              username: "fixture",
              credential: "fixture",
            },
          ],
        });
        try {
          peer.createDataChannel("probe");
          await peer.setLocalDescription(await peer.createOffer());
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } finally {
          peer.close();
        }
      }, address.port);
      expect(hits).toBe(0);
    } finally {
      await page.close();
      await new Promise<void>((resolve) => tcp.close(() => resolve()));
    }
  }, 10_000);

  it("rechecks DNS on a later request and rejects a private rebinding answer", async () => {
    const page = await capture.browser.newPage();
    try {
      const base = `http://capture-fixture.example.com:${fixture.port}`;
      await page.goto(base + "/first", { waitUntil: "domcontentloaded" });
      const reachedBefore = fixture.publicHits;
      fixture.rebound = true;
      await page
        .goto(base + "/second", { waitUntil: "domcontentloaded", timeout: 5_000 })
        .catch(() => {});
      expect(fixture.publicHits).toBe(reachedBefore);
      expect(fixture.privateHits).toBe(0);
    } finally {
      fixture.rebound = false;
      await page.close();
    }
  }, 15_000);
});
