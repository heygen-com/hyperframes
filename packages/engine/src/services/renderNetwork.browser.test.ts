import { spawnSync } from "node:child_process";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type RequestOptions, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { closeCaptureSession, createCaptureSession, type CaptureSession } from "./frameCapture.js";

const { REBINDING, dialed } = vi.hoisted(() => ({
  REBINDING: "rebind.hf-test",
  dialed: [] as string[],
}));

// A rebinding name: every address check hears the public 8.8.8.8, a connection made by name lands on 127.0.0.1.
vi.mock("node:dns/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns/promises")>();
  const lookup = ((host: string, options?: object) =>
    host === REBINDING
      ? Promise.resolve([{ address: "8.8.8.8", family: 4 }])
      : real.lookup(host, options as never)) as typeof real.lookup;
  return { ...real, lookup, default: { ...real, lookup } };
});
vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  class Resolver extends real.promises.Resolver {
    override resolve4(host: string): Promise<string[]> {
      return host === REBINDING ? Promise.resolve(["8.8.8.8"]) : super.resolve4(host);
    }
  }
  const promises = { ...real.promises, Resolver };
  return { ...real, promises, default: { ...real, promises } };
});
vi.mock("node:http", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:http")>();
  const request = ((options: RequestOptions, callback?: (res: IncomingMessage) => void) => {
    const host = options.hostname ?? "";
    if (host !== REBINDING && host !== "8.8.8.8") return real.request(options, callback);
    dialed.push(host);
    // The public peer is offline here; a dial by name is what the rebinding answer reaches.
    return host === "8.8.8.8"
      ? real.request(
          {
            ...options,
            hostname: "offline.invalid",
            lookup: (_h, _o, cb) => cb(new Error("offline"), "", 4),
          },
          callback,
        )
      : real.request({ ...options, hostname: "127.0.0.1" }, callback);
  }) as typeof real.request;
  return { ...real, request, default: { ...real, request } };
});
// Chrome's own resolver agrees with the connection-time answer.
vi.mock("./browserManager.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./browserManager.js")>();
  return {
    ...real,
    buildChromeArgs: (...args: Parameters<typeof real.buildChromeArgs>) => [
      ...real.buildChromeArgs(...args),
      `--host-resolver-rules=MAP ${REBINDING} 127.0.0.1`,
    ],
  };
});

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

const SHARED_WORKER = `onconnect = (e) => { const port = e.ports[0];
  port.onmessage = (m) => fetch(m.data, { method: "POST", body: "x" }).then(() => port.postMessage("reached"), () => port.postMessage("refused")); };`;
const SERVICE_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (m) => fetch(m.data).then(() => m.source.postMessage("reached"), () => m.source.postMessage("refused")));`;
const DEDICATED_WORKER = `onmessage = (m) => fetch(m.data).then(() => postMessage("reached"), () => postMessage("refused"));`;

function listen(server: Server | UdpSocket): Promise<number> {
  return new Promise((resolve) => {
    const bound = () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    };
    if ("bind" in server) server.bind(0, "127.0.0.1", bound);
    else server.listen(0, "127.0.0.1", bound);
  });
}

describe.skipIf(!hasBrowser)("a render page on a restricted host", () => {
  let site: Server;
  let stash: Server;
  let stun: UdpSocket;
  let siteOrigin: string;
  let stashPort: number;
  let stunPort: number;
  let session: CaptureSession;
  let outputDir: string;
  // Every TCP connection and UDP packet the stand-in private host receives.
  const reached: string[] = [];

  beforeAll(async () => {
    vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "true");
    site = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://site").pathname;
      if (path.startsWith("/redirect/")) {
        res.writeHead(302, { location: decodeURIComponent(path.slice("/redirect/".length)) });
        return void res.end();
      }
      const scripts: Record<string, string> = {
        "/shared-worker.js": SHARED_WORKER,
        "/sw.js": SERVICE_WORKER,
        "/worker.js": DEDICATED_WORKER,
      };
      const script = scripts[path];
      res.writeHead(200, {
        "content-type": script ? "text/javascript" : path === "/" ? "text/html" : "text/plain",
      });
      res.end(script ?? (path === "/" ? "<!doctype html><title>render</title>" : "asset"));
    });
    stash = createServer((_req, res) => {
      reached.push("http");
      res.end("secret");
    });
    stash.on("connection", () => reached.push("tcp"));
    stash.on("upgrade", (_req, socket) => socket.destroy());
    stun = createSocket("udp4");
    stun.on("message", () => reached.push("udp"));
    // The render file server's own address form.
    siteOrigin = `http://localhost:${await listen(site)}`;
    stashPort = await listen(stash);
    stunPort = await listen(stun);
    outputDir = mkdtempSync(join(tmpdir(), "hf-render-network-"));
    session = await createCaptureSession(
      siteOrigin,
      outputDir,
      { width: 320, height: 180, fps: { num: 30, den: 1 }, format: "jpeg" },
      null,
      { forceScreenshot: true, enableBrowserPool: false },
    );
  });
  afterEach(() => {
    reached.length = 0;
    dialed.length = 0;
    stash.closeAllConnections();
  });
  afterAll(async () => {
    if (session) await closeCaptureSession(session);
    site?.close();
    stash?.close();
    stun?.close();
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  async function page(): Promise<Page> {
    await session.page.goto(`${siteOrigin}/`, { waitUntil: "load" });
    return session.page;
  }
  const stashUrl = (path: string, host = "127.0.0.1") => `http://${host}:${stashPort}${path}`;

  it("loads from its own server", async () => {
    const p = await page();
    expect(await p.evaluate((u) => fetch(u).then((r) => r.text()), `${siteOrigin}/asset.txt`)).toBe(
      "asset",
    );
  });

  it("cannot POST to another local port from the page", async () => {
    const p = await page();
    const answer = await p.evaluate(
      (u) =>
        fetch(u, { method: "POST", body: "x" }).then(
          () => "reached",
          () => "refused",
        ),
      stashUrl("/page"),
    );
    expect({ answer, reached }).toEqual({ answer: "refused", reached: [] });
  });

  it("cannot reach it from an iframe", async () => {
    const p = await page();
    await p.evaluate(
      (src) =>
        new Promise<void>((resolve) => {
          const frame = document.createElement("iframe");
          frame.onload = () => resolve();
          frame.onerror = () => resolve();
          frame.src = src;
          document.body.append(frame);
        }),
      stashUrl("/frame"),
    );
    expect(reached).toEqual([]);
  });

  it("cannot reach it from a dedicated worker", async () => {
    const p = await page();
    const answer = await p.evaluate(
      ([src, target]) =>
        new Promise<string>((resolve) => {
          const worker = new Worker(src!);
          worker.onmessage = (m) => resolve(String(m.data));
          worker.onerror = () => resolve("worker failed");
          worker.postMessage(target);
        }),
      [`${siteOrigin}/worker.js`, stashUrl("/worker")],
    );
    expect({ answer, reached }).toEqual({ answer: "refused", reached: [] });
  });

  it("cannot POST to it from a shared worker", async () => {
    const p = await page();
    const answer = await p.evaluate(
      ([src, target]) =>
        new Promise<string>((resolve) => {
          const worker = new SharedWorker(src!);
          worker.port.onmessage = (m) => resolve(String(m.data));
          worker.onerror = () => resolve("worker failed");
          worker.port.postMessage(target);
        }),
      [`${siteOrigin}/shared-worker.js`, stashUrl("/shared-worker")],
    );
    expect({ answer, reached }).toEqual({ answer: "refused", reached: [] });
  });

  it("cannot reach it from a service worker", async () => {
    const p = await page();
    const answer = await p.evaluate(
      async ([src, target]) => {
        await navigator.serviceWorker.register(src!);
        const registration = await navigator.serviceWorker.ready;
        return new Promise<string>((resolve) => {
          navigator.serviceWorker.onmessage = (m) => resolve(String(m.data));
          registration.active!.postMessage(target);
        });
      },
      [`${siteOrigin}/sw.js`, stashUrl("/service-worker")],
    );
    expect({ answer, reached }).toEqual({ answer: "refused", reached: [] });
  });

  it("cannot open a WebSocket to it", async () => {
    const p = await page();
    await p.evaluate(
      (u) =>
        new Promise<void>((resolve) => {
          const socket = new WebSocket(u);
          socket.onopen = socket.onerror = socket.onclose = () => resolve();
        }),
      `ws://127.0.0.1:${stashPort}/ws`,
    );
    expect(reached).toEqual([]);
  });

  it("cannot send WebRTC traffic to it, over UDP or TCP", async () => {
    const p = await page();
    const gathered = p.evaluate(
      async ([stunUrl, turnUrl]) => {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: stunUrl! }, { urls: turnUrl!, username: "u", credential: "p" }],
        });
        pc.createDataChannel("x");
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === "complete") resolve();
          pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && resolve();
        });
        pc.close();
      },
      [`stun:127.0.0.1:${stunPort}`, `turn:127.0.0.1:${stashPort}?transport=tcp`],
    );
    // A packet that does arrive ends the wait early; gathering completing is the clean end.
    const firstPacket = new Promise<void>((resolve) => {
      stun.once("message", () => resolve());
      stash.once("connection", () => resolve());
    });
    await Promise.race([gathered, firstPacket]);
    expect(reached).toEqual([]);
  });

  it("cannot prefetch or preload from it", async () => {
    const p = await page();
    await p.evaluate(
      (urls) =>
        Promise.all(
          urls.map(
            ([rel, href]) =>
              new Promise<void>((resolve) => {
                const link = document.createElement("link");
                link.rel = rel!;
                if (rel === "preload") link.as = "fetch";
                link.crossOrigin = "anonymous";
                link.onload = link.onerror = () => resolve();
                link.href = href!;
                document.head.append(link);
              }),
          ),
        ),
      [
        ["prefetch", stashUrl("/prefetch")],
        ["preload", stashUrl("/preload")],
      ],
    );
    expect(reached).toEqual([]);
  });

  it("cannot be redirected to it by its own server", async () => {
    const p = await page();
    const answer = await p.evaluate(
      (u) =>
        fetch(u).then(
          () => "reached",
          () => "refused",
        ),
      `${siteOrigin}/redirect/${encodeURIComponent(stashUrl("/redirected"))}`,
    );
    expect({ answer, reached }).toEqual({ answer: "refused", reached: [] });
  });

  it("cannot reach it through a name that rebinds from public to private", async () => {
    const p = await page();
    const answer = await p.evaluate(
      (u) =>
        fetch(u).then(
          () => "reached",
          () => "refused",
        ),
      stashUrl("/rebound", REBINDING),
    );
    expect({ answer, reached }).toEqual({ answer: "refused", reached: [] });
    expect(dialed).toEqual(["8.8.8.8"]);
  });
});
