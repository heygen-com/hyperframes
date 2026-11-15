import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
import { logRefusal, onRenderRefusal, startCaptureProxy } from "./captureProxy.js";
import { NonPublicHostError } from "./publicNetwork.js";

const { resolveAddress } = vi.hoisted(() => ({ resolveAddress: vi.fn() }));
vi.mock("./publicNetwork.js", async (actual) => ({
  ...(await actual<typeof import("./publicNetwork.js")>()),
  resolvePublicAddress: resolveAddress,
}));

describe("capture proxy", () => {
  const proxies: Awaited<ReturnType<typeof startCaptureProxy>>[] = [];
  afterEach(async () => {
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
    vi.restoreAllMocks();
    resolveAddress.mockReset();
  });

  async function proxyGet(url: string, onRefused?: (hostClass: string) => void): Promise<number> {
    const proxy = await startCaptureProxy(undefined, onRefused);
    proxies.push(proxy);
    return new Promise((resolve, reject) => {
      const req = request(proxy.url, { path: url }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("refuses a private target before opening an upstream connection", async () => {
    resolveAddress.mockRejectedValue(new Error("Private destination"));
    expect(await proxyGet("http://127.0.0.1/private")).toBe(403);
    expect(resolveAddress).toHaveBeenCalledWith("127.0.0.1");
  });

  it("reports the class of every address refusal, plain and tunneled", async () => {
    resolveAddress.mockRejectedValue(new NonPublicHostError("refused", "link-local"));
    const refused: string[] = [];
    expect(await proxyGet("http://metadata.example.com/", (c) => refused.push(c))).toBe(403);
    const proxy = await startCaptureProxy(undefined, (c) => refused.push(c));
    proxies.push(proxy);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(proxy.url, { method: "CONNECT", path: "metadata.example.com:443" });
      req.on("connect", (res, socket) => {
        socket.destroy();
        resolve(res.statusCode!);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
    expect(refused).toEqual(["link-local", "link-local"]);
  });

  it("logs a refusal as one countable line that names only the class", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logRefusal("carrier-grade");
    expect(warn.mock.calls).toEqual([["[CaptureProxy:REFUSED] class=carrier-grade"]]);
  });

  it("hands each refusal to subscribers in the context the render started the proxy in", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveAddress.mockRejectedValue(new NonPublicHostError("refused", "private"));
    const renderContext = new AsyncLocalStorage<string>();
    const seen: [string, string | undefined][] = [];
    const unsubscribe = onRenderRefusal((c) => seen.push([c, renderContext.getStore()]));
    try {
      const proxy = await renderContext.run("render-a", () =>
        startCaptureProxy(undefined, logRefusal),
      );
      proxies.push(proxy);
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(proxy.url, { path: "http://inside.example.com/" }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        });
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(403);
      expect(seen).toEqual([["private", "render-a"]]);
    } finally {
      unsubscribe();
    }
    logRefusal("private");
    expect(seen).toHaveLength(1);
  });

  it("reports nothing for a refusal that is not about the address", async () => {
    resolveAddress.mockRejectedValue(new Error("DNS timed out"));
    const refused: string[] = [];
    expect(await proxyGet("http://slow.example.com/", (c) => refused.push(c))).toBe(403);
    expect(await proxyGet("file:///etc/passwd", (c) => refused.push(c))).toBe(403);
    expect(refused).toEqual([]);
  });

  it("refuses URL credentials and non-http requests", async () => {
    expect(await proxyGet("http://user:secret@example.com/")).toBe(403);
    expect(await proxyGet("file:///etc/passwd")).toBe(403);
    expect(resolveAddress).not.toHaveBeenCalled();
  });

  it("does not dial after teardown while DNS is pending", async () => {
    let hits = 0;
    const target = createServer((_req, res) => {
      hits++;
      res.end("fixture");
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    let release: (address: string) => void = () => {};
    let entered: () => void = () => {};
    const resolving = new Promise<void>((resolve) => {
      entered = resolve;
    });
    resolveAddress.mockImplementation(() => {
      entered();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const proxy = await startCaptureProxy();
    proxies.push(proxy);
    const finished = new Promise<void>((resolve) => {
      const req = request(proxy.url, { path: `http://fixture.example.com:${address.port}/late` });
      req.on("error", () => resolve());
      req.end();
    });
    try {
      await resolving;
      await proxy.close();
      release("127.0.0.1");
      await finished;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(hits).toBe(0);
    } finally {
      target.closeAllConnections();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it("closes idle CONNECT clients during teardown", async () => {
    const proxy = await startCaptureProxy();
    proxies.push(proxy);
    const socket = connect(Number(new URL(proxy.url).port), "127.0.0.1");
    socket.on("error", () => {});
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await proxy.close();
    await closed;
  });
});
