import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request } from "node:http";
import {
  connect,
  createServer as createTcpServer,
  type Server as TcpServer,
  type Socket,
} from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  BROWSER_PROXY_MAX_CONNECTIONS,
  logRefusal,
  onRenderRefusal,
  POD_PROXY_MAX_CONNECTIONS,
  startCaptureProxy,
  type CaptureFailure,
} from "./captureProxy.js";
import { ABSOLUTE_MAX_WORKERS } from "../../utils/workerLimits.js";
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

  // fails without the fix: a name that would not resolve answered 403 and reported nothing, refused or failed.
  it("reports a name that would not resolve as a failed request, plain and tunneled", async () => {
    const failures: CaptureFailure[] = [];
    const refused: string[] = [];
    const proxy = await startCaptureProxy(null, (c) => refused.push(c), undefined, {
      onFailed: (failure) => failures.push(failure),
    });
    proxies.push(proxy);
    const plain = (path: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(proxy.url, { path }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        });
        req.on("error", reject);
        req.end();
      });
    const tunnel = (authority: string) =>
      new Promise<string>((resolve) => {
        const socket = connect(Number(new URL(proxy.url).port), "127.0.0.1");
        socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
        socket.once("data", (data) => {
          resolve(String(data).split("\r\n")[0]!);
          socket.destroy();
        });
      });
    resolveAddress.mockRejectedValue(new Error("DNS timed out"));
    expect(await plain("http://slow.example.com/")).toBe(403);
    expect(await tunnel("slow.example.com:443")).toBe("HTTP/1.1 403 Forbidden");
    expect(failures.map((failure) => failure.reason)).toEqual([
      "upstream_failed",
      "upstream_failed",
    ]);
    resolveAddress.mockRejectedValue(new NonPublicHostError("refused", "private"));
    expect(await plain("http://inside.example.com/")).toBe(403);
    expect(failures).toHaveLength(2);
    expect(refused).toEqual(["private"]);
  });

  // fails without the fix: writeHead threw on the status below 100 and the uncaught throw ended the host process.
  it("answers an upstream status below 100 with 502 and keeps serving, direct and through an upstream proxy", async () => {
    const target = createTcpServer((socket) => {
      socket.on("error", () => {});
      socket.once("data", (data) => {
        const status = /^GET \S*\/status\/(\d{3}) /.exec(String(data))?.[1] ?? "200";
        socket.end(`HTTP/1.1 ${status} Odd\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok`);
      });
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const port = (target.address() as { port: number }).port;
    resolveAddress.mockResolvedValue("127.0.0.1");
    try {
      for (const upstream of [null, { host: "127.0.0.1", port }]) {
        const failures: CaptureFailure[] = [];
        const proxy = await startCaptureProxy(upstream, undefined, undefined, {
          onFailed: (failure) => failures.push(failure),
        });
        proxies.push(proxy);
        const get = (path: string) =>
          new Promise<number>((resolve, reject) => {
            const req = request(
              proxy.url,
              { path: `http://odd.example.com:${port}${path}` },
              (res) => {
                res.resume();
                res.on("end", () => resolve(res.statusCode!));
              },
            );
            req.on("error", reject);
            req.end();
          });
        expect(await get("/status/099")).toBe(502);
        expect(await get("/status/000")).toBe(502);
        expect(await get("/fine")).toBe(200);
        expect(failures.map((failure) => failure.reason)).toEqual([
          "upstream_failed",
          "upstream_failed",
        ]);
      }
    } finally {
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it("listens on the fixed loopback port it is given", async () => {
    const free = createServer();
    await new Promise<void>((resolve) => free.listen(0, "127.0.0.1", resolve));
    const port = (free.address() as { port: number }).port;
    await new Promise<void>((resolve) => free.close(() => resolve()));
    const proxy = await startCaptureProxy(null, undefined, port);
    proxies.push(proxy);
    expect(proxy.url).toBe(`http://127.0.0.1:${port}`);
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

  describe("connection cap", () => {
    const sockets: Socket[] = [];
    const targets: TcpServer[] = [];
    afterEach(async () => {
      for (const socket of sockets.splice(0)) socket.destroy();
      await Promise.all(targets.splice(0).map((t) => new Promise((resolve) => t.close(resolve))));
    });

    async function tcpTarget(): Promise<number> {
      const target = createTcpServer((socket) => socket.on("error", () => {}));
      targets.push(target);
      await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
      return (target.address() as { port: number }).port;
    }

    /** The first status line the proxy answers a held-open CONNECT with, or "closed" when it drops the socket. */
    function openTunnel(proxyUrl: string, port: number): Promise<string> {
      return new Promise((resolve) => {
        const socket = connect(Number(new URL(proxyUrl).port), "127.0.0.1", () =>
          socket.write(
            `CONNECT tunnel.example.com:${port} HTTP/1.1\r\nHost: tunnel.example.com\r\n\r\n`,
          ),
        );
        sockets.push(socket);
        socket.on("error", () => {});
        socket.once("data", (data) => resolve(String(data).split("\r\n")[0]!));
        socket.once("close", () => resolve("closed"));
      });
    }

    it("holds more tunnels open at once than a browser's cap when given a pod's cap", async () => {
      resolveAddress.mockResolvedValue("127.0.0.1");
      const port = await tcpTarget();
      const proxy = await startCaptureProxy(null, undefined, undefined, { maxConnections: 200 });
      proxies.push(proxy);
      const answers = await Promise.all(
        Array.from({ length: 150 }, () => openTunnel(proxy.url, port)),
      );
      expect(answers.filter((a) => a === "HTTP/1.1 200 Connection Established")).toHaveLength(150);
    });

    it("reports a connection dropped at the cap, with the count of open connections", async () => {
      resolveAddress.mockResolvedValue("127.0.0.1");
      const port = await tcpTarget();
      const failures: CaptureFailure[] = [];
      const proxy = await startCaptureProxy(null, undefined, undefined, {
        onFailed: (failure) => failures.push(failure),
      });
      proxies.push(proxy);
      const answers = await Promise.all(
        Array.from({ length: BROWSER_PROXY_MAX_CONNECTIONS + 1 }, () =>
          openTunnel(proxy.url, port),
        ),
      );
      expect(answers.filter((a) => a === "closed")).toHaveLength(1);
      expect(failures).toEqual([{ reason: "connection_cap", open: BROWSER_PROXY_MAX_CONNECTIONS }]);
    });

    it("reports a tunnel whose upstream never connects", async () => {
      resolveAddress.mockResolvedValue("127.0.0.1");
      const closedPort = await tcpTarget();
      await new Promise((resolve) => targets.pop()!.close(resolve));
      const failures: CaptureFailure[] = [];
      const proxy = await startCaptureProxy(null, undefined, undefined, {
        onFailed: (failure) => failures.push(failure),
      });
      proxies.push(proxy);
      expect(await openTunnel(proxy.url, closedPort)).toBe("closed");
      expect(failures).toEqual([{ reason: "upstream_failed", open: 1 }]);
    });

    it("sizes a pod's cap for every browser the engine can run at once, plus the pod's own traffic", () => {
      expect(POD_PROXY_MAX_CONNECTIONS).toBe(
        (ABSOLUTE_MAX_WORKERS + 1) * BROWSER_PROXY_MAX_CONNECTIONS,
      );
    });
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
