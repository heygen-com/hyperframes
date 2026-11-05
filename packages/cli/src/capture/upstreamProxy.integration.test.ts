import { readFile } from "node:fs/promises";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { Socket } from "node:net";
import type { TLSSocket, ConnectionOptions } from "node:tls";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ resolve4: vi.fn(), certificate: "" }));

vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  return {
    ...real,
    promises: {
      ...real.promises,
      Resolver: class {
        resolve4 = transport.resolve4;
        cancel() {}
      },
    },
  };
});

// Trust the committed fixture certificate; verification itself stays on.
vi.mock("node:tls", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:tls")>();
  return {
    ...real,
    connect: (options: ConnectionOptions) =>
      real.connect({ ...options, ca: transport.certificate }),
  };
});

import { safeFetch } from "./assetDownloader.js";
import { publicRequest } from "./publicNetwork.js";
import { startCaptureProxy } from "./captureProxy.js";

const DESTINATION = "assets.capture-fixture.com";

type Received = { kind: "http" | "connect"; target: string; authorization?: string };
const received: Received[] = [];
type Delivered = { servername?: string; host?: string; path?: string };
const delivered: Delivered[] = [];
let refuseConnect = false;
let stallConnect = false;

// The destination is never listening on TCP: the fake upstream hands tunnels to it in-process.
const destination = createHttpsServer({}, (req, res) => {
  const servername = (req.socket as TLSSocket).servername;
  delivered.push({
    servername: typeof servername === "string" ? servername : undefined,
    host: req.headers.host,
    path: req.url,
  });
  res.end("secure fixture");
});
destination.on("tlsClientError", () => {});

const upstream: Server = createServer((req: IncomingMessage, res) => {
  received.push({
    kind: "http",
    target: req.url ?? "",
    authorization: req.headers["proxy-authorization"],
  });
  if (req.url?.endsWith("/stall")) return;
  if (req.url?.endsWith("/refuse")) return void res.writeHead(403).end();
  delivered.push({ host: req.headers.host, path: req.url });
  res.end("plain fixture");
});
const upstreamSockets = new Set<Socket>();
upstream.on("connection", (socket: Socket) => {
  upstreamSockets.add(socket);
  socket.once("close", () => upstreamSockets.delete(socket));
});
upstream.on("connect", (req, socket, head) => {
  received.push({
    kind: "connect",
    target: req.url ?? "",
    authorization: req.headers["proxy-authorization"],
  });
  if (stallConnect) return;
  if (refuseConnect) {
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  if (head.length) socket.unshift(head);
  destination.emit("connection", socket);
});

const dialed: string[] = [];
const realConnect = Socket.prototype.connect;
let upstreamPort = 0;
const auth = `Basic ${Buffer.from("fence:secret").toString("base64")}`;

function dialTarget(args: unknown[]): string {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === "object") {
    const options = first as { host?: string; port?: number; path?: string };
    return options.path ?? `${options.host ?? "localhost"}:${options.port}`;
  }
  return `${String(args[1] ?? "localhost")}:${String(first)}`;
}

describe("capture with the opt-in upstream proxy", () => {
  beforeAll(async () => {
    const fixture = (name: string) =>
      new URL(`./fixtures/capture-fixture-${name}`, import.meta.url);
    transport.certificate = await readFile(fixture("certificate.pem"), "utf8");
    destination.setSecureContext({
      key: await readFile(fixture("key.pem")),
      cert: transport.certificate,
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("Missing upstream port");
    upstreamPort = address.port;
  });

  beforeEach(() => {
    received.length = 0;
    delivered.length = 0;
    dialed.length = 0;
    refuseConnect = false;
    stallConnect = false;
    transport.resolve4.mockReset();
    transport.resolve4.mockRejectedValue(new Error("capture must not resolve names"));
    vi.stubEnv("HYPERFRAMES_CAPTURE_PROXY", `http://fence:secret@127.0.0.1:${upstreamPort}`);
    vi.spyOn(Socket.prototype, "connect").mockImplementation(function (
      this: Socket,
      ...args: unknown[]
    ) {
      dialed.push(dialTarget(args));
      return Reflect.apply(realConnect, this, args) as Socket;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const socket of upstreamSockets) socket.destroy();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("sends an HTTPS asset download through a CONNECT tunnel with TLS verified end to end", async () => {
    const response = await publicRequest(`https://${DESTINATION}/font.woff2?v=1`);
    expect(await response.text()).toBe("secure fixture");
    expect(delivered).toEqual([
      { servername: DESTINATION, host: DESTINATION, path: "/font.woff2?v=1" },
    ]);
    expect(received).toEqual([
      { kind: "connect", target: `${DESTINATION}:443`, authorization: auth },
    ]);
    expect(dialed).toEqual([`127.0.0.1:${upstreamPort}`]);
    expect(transport.resolve4).not.toHaveBeenCalled();
  });

  it("sends an HTTP asset download to the upstream in absolute form, without its fragment", async () => {
    const response = await publicRequest(`http://${DESTINATION}/logo.svg?v=2#icon`);
    expect(await response.text()).toBe("plain fixture");
    expect(delivered).toEqual([{ host: DESTINATION, path: `http://${DESTINATION}/logo.svg?v=2` }]);
    expect(received).toEqual([
      { kind: "http", target: `http://${DESTINATION}/logo.svg?v=2`, authorization: auth },
    ]);
    expect(dialed).toEqual([`127.0.0.1:${upstreamPort}`]);
    expect(transport.resolve4).not.toHaveBeenCalled();
  });

  it("still refuses literal private destinations and credentials before any socket opens", async () => {
    await expect(publicRequest("http://10.0.0.5/admin")).rejects.toThrow(/public IPv4/);
    await expect(publicRequest("https://169.254.169.254/latest")).rejects.toThrow(/public IPv4/);
    await expect(publicRequest("http://localhost/")).rejects.toThrow(/public hostname/);
    await expect(publicRequest("https://user:pw@example.com/")).rejects.toThrow(/credentials/);
    expect(received).toEqual([]);
    expect(dialed).toEqual([]);
  });

  it("does not trust the destination certificate just because a tunnel opened", async () => {
    await expect(publicRequest("https://other.capture-fixture.com/")).rejects.toThrow();
    expect(received.map((entry) => entry.target)).toEqual(["other.capture-fixture.com:443"]);
  });

  it("fails the download when the upstream refuses the tunnel", async () => {
    refuseConnect = true;
    await expect(publicRequest(`https://${DESTINATION}/`)).rejects.toThrow(/HTTP 403/);
  });

  it("surfaces an upstream refusal of a plain HTTP asset as a failed fetch", async () => {
    const response = await safeFetch(`http://${DESTINATION}/refuse`);
    expect(response?.status).toBe(403);
    expect(response?.ok).toBe(false);
    expect(received.map((entry) => entry.target)).toEqual([`http://${DESTINATION}/refuse`]);
  });

  it("cancels a download the upstream never answers, through both transports", async () => {
    stallConnect = true;
    const tunnel = new AbortController();
    const pendingTunnel = publicRequest(`https://${DESTINATION}/`, { signal: tunnel.signal });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    tunnel.abort(new Error("cancelled tunnel"));
    await expect(pendingTunnel).rejects.toThrow();
    const plain = new AbortController();
    const pendingPlain = publicRequest(`http://${DESTINATION}/stall`, { signal: plain.signal });
    await vi.waitFor(() => expect(received).toHaveLength(2));
    plain.abort(new Error("cancelled request"));
    await expect(pendingPlain).rejects.toThrow();
  });

  it("with HYPERFRAMES_CAPTURE_PROXY unset, ignores HTTPS_PROXY and keeps the pinned public-peer path", async () => {
    vi.stubEnv("HYPERFRAMES_CAPTURE_PROXY", "");
    vi.stubEnv("HTTPS_PROXY", `http://127.0.0.1:${upstreamPort}`);
    transport.resolve4.mockResolvedValue(["10.1.2.3"]);
    await expect(publicRequest(`https://${DESTINATION}/`)).rejects.toThrow(/non-public/);
    expect(transport.resolve4).toHaveBeenCalledWith(DESTINATION);
    expect(received).toEqual([]);
    expect(dialed).toEqual([]);
  });

  describe("browser proxy", () => {
    async function withCaptureProxy<T>(run: (port: number) => Promise<T>): Promise<T> {
      const proxy = await startCaptureProxy();
      try {
        return await run(Number(new URL(proxy.url).port));
      } finally {
        await proxy.close();
      }
    }

    function proxyGet(port: number, url: string): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path: url }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        req.end();
      });
    }

    function proxyConnect(
      port: number,
      authority: string,
    ): Promise<{ status: number; socket: Socket }> {
      return new Promise((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, method: "CONNECT", path: authority });
        req.on("connect", (res, socket) => resolve({ status: res.statusCode ?? 0, socket }));
        req.on("response", (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0, socket: res.socket });
        });
        req.on("error", reject);
        req.end();
      });
    }

    it("forwards page HTTP through the upstream and opens nothing else", async () => {
      await withCaptureProxy(async (port) => {
        const result = await proxyGet(port, `http://${DESTINATION}/index.html`);
        expect(result).toEqual({
          status: 200,
          body: "plain fixture",
        });
        expect(delivered).toEqual([
          { host: DESTINATION, path: `http://${DESTINATION}/index.html` },
        ]);
        expect(received).toEqual([
          { kind: "http", target: `http://${DESTINATION}/index.html`, authorization: auth },
        ]);
        expect(dialed.filter((target) => target !== `127.0.0.1:${port}`)).toEqual([
          `127.0.0.1:${upstreamPort}`,
        ]);
        expect(transport.resolve4).not.toHaveBeenCalled();
      });
    });

    it("chains browser CONNECT tunnels to the upstream", async () => {
      await withCaptureProxy(async (port) => {
        const { status, socket } = await proxyConnect(port, `${DESTINATION}:443`);
        expect(status).toBe(200);
        const tls = await vi.importActual<typeof import("node:tls")>("node:tls");
        const secure = tls.connect({ socket, servername: DESTINATION, ca: transport.certificate });
        const body = await new Promise<string>((resolve, reject) => {
          let text = "";
          secure.on("data", (chunk: Buffer) => (text += chunk.toString()));
          secure.on("end", () => resolve(text));
          secure.on("error", reject);
          secure.write(`GET /app.js HTTP/1.1\r\nHost: ${DESTINATION}\r\nConnection: close\r\n\r\n`);
        });
        expect(body).toContain("secure fixture");
        expect(delivered).toEqual([
          { servername: DESTINATION, host: DESTINATION, path: "/app.js" },
        ]);
        expect(received).toEqual([
          { kind: "connect", target: `${DESTINATION}:443`, authorization: auth },
        ]);
        expect(dialed.filter((target) => target !== `127.0.0.1:${port}`)).toEqual([
          `127.0.0.1:${upstreamPort}`,
        ]);
        expect(transport.resolve4).not.toHaveBeenCalled();
      });
    });

    it("refuses private literals before asking the upstream, and reports upstream refusals", async () => {
      await withCaptureProxy(async (port) => {
        expect((await proxyGet(port, "http://127.0.0.1/secret")).status).toBe(403);
        const privateTunnel = await proxyConnect(port, "10.0.0.1:443");
        expect(privateTunnel.status).toBe(403);
        privateTunnel.socket.destroy();
        expect(received).toEqual([]);
        refuseConnect = true;
        const refused = await proxyConnect(port, `${DESTINATION}:443`);
        expect(refused.status).toBe(502);
        refused.socket.destroy();
      });
    });
  });
});
