import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { startCaptureProxy } from "./captureProxy.js";

const { resolveAddress } = vi.hoisted(() => ({ resolveAddress: vi.fn() }));
vi.mock("./publicNetwork.js", () => ({ resolvePublicAddress: resolveAddress }));

describe("capture proxy", () => {
  const proxies: Awaited<ReturnType<typeof startCaptureProxy>>[] = [];
  afterEach(async () => {
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
    vi.restoreAllMocks();
    resolveAddress.mockReset();
  });

  async function proxyGet(url: string): Promise<number> {
    const proxy = await startCaptureProxy();
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
