import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { connect, isIP, type AddressInfo, type LookupFunction } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  resolve4: vi.fn(),
  execFile: vi.fn(),
  serverPort: 0,
  dialFailure: undefined as string | undefined,
}));

vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  class Resolver {
    resolve4 = mocks.resolve4;
    cancel() {}
  }
  const promises = { ...actual.promises, Resolver };
  return {
    ...actual,
    default: { ...actual, lookup: mocks.lookup, promises },
    lookup: mocks.lookup,
    promises,
  };
});
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: mocks.execFile,
}));
// The downloader's own lookup decides; an approved dial then lands on the local test server in clear text.
vi.mock("undici/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici/index.js")>();
  class Agent extends actual.Agent {
    constructor(options: { connect: { lookup: LookupFunction } }) {
      super({
        connect: (target, callback) => {
          const dial = (error: Error | null) => {
            if (error) return callback(error, null);
            if (mocks.dialFailure) {
              const failure = Object.assign(new Error(`connect ${mocks.dialFailure}`), {
                code: mocks.dialFailure,
              });
              return callback(failure, null);
            }
            const socket = connect(mocks.serverPort, "127.0.0.1");
            socket.once("connect", () => callback(null, socket));
            socket.once("error", (socketError) => callback(socketError, null));
          };
          const host = target.hostname.replace(/^\[|\]$/g, "");
          if (isIP(host)) return dial(null);
          options.connect.lookup(host, {}, (error) => dial(error));
        },
      });
    }
  }
  return { ...actual, Agent };
});

import { downloadToTemp, fetchPublicHttpsText, UrlDownloadError } from "./urlDownloader.js";

type Route = { status: number; headers?: Record<string, string>; body?: string | Buffer };
let routes: Record<string, Route | "drop"> = {};
let received: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
const BODY = "\u0000\u0001asset-bytes";
let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = `https://${req.headers.host}${req.url}`;
    received.push({ url, headers: req.headers });
    const found = routes[url];
    if (found === "drop") return req.socket.destroy();
    if (!found) return res.writeHead(599).end();
    res.writeHead(found.status, found.headers).end(found.body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  mocks.serverPort = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function answers(ipv4: string[], ipv6: string[] = []): void {
  const all = [
    ...ipv4.map((address) => ({ address, family: 4 })),
    ...ipv6.map((address) => ({ address, family: 6 })),
  ];
  mocks.lookup.mockImplementation((_host, _options, callback) => callback(null, all));
  if (ipv4.length) mocks.resolve4.mockResolvedValue(ipv4);
  else
    mocks.resolve4.mockRejectedValue(
      Object.assign(new Error("queryA ENODATA"), { code: "ENODATA" }),
    );
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-restricted-download-"));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  vi.resetAllMocks();
  routes = {};
  received = [];
  mocks.dialFailure = undefined;
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => {
    callback(new Error("Command failed"), "", "ENOTFOUND");
    return Object.assign(new EventEmitter(), { kill: vi.fn() });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("downloads on a render service follow the capture proxy's address rule", () => {
  beforeEach(() => vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "true"));

  it("refuses an IPv6 literal host before any request", async () => {
    routes["https://[2606:4700:4700::1111]/a.png"] = { status: 200, body: BODY };
    await expect(downloadToTemp("https://[2606:4700:4700::1111]/a.png", tempDir())).rejects.toThrow(
      /not permitted/,
    );
    expect(received).toEqual([]);
  });

  it("refuses a name that has only IPv6 answers", async () => {
    answers([], ["2606:4700::6810:84e5"]);
    routes["https://v6only.assets-cdn.com/a.png"] = { status: 200, body: BODY };
    await expect(
      downloadToTemp("https://v6only.assets-cdn.com/a.png", tempDir()),
    ).rejects.toBeInstanceOf(UrlDownloadError);
    expect(received).toEqual([]);
  });

  it("refuses a redirect hop to an IPv6 literal", async () => {
    answers(["93.184.216.34"]);
    routes["https://cdn.assets-public.com/a.png"] = {
      status: 302,
      headers: { location: "https://[2606:4700:4700::1111]/b.png" },
    };
    routes["https://[2606:4700:4700::1111]/b.png"] = { status: 200, body: BODY };
    await expect(
      downloadToTemp("https://cdn.assets-public.com/a.png", tempDir()),
    ).rejects.toMatchObject({
      kind: "http_rejected",
      message: "Download redirect target is not permitted",
    });
    expect(received.map((request) => request.url)).toEqual(["https://cdn.assets-public.com/a.png"]);
  });

  it.each([
    ["not matched by NO_PROXY", ""],
    ["matched by NO_PROXY", "assets.private-cdn.com"],
  ])(
    "behind an env proxy, refuses a name that resolves to a private address %s",
    async (_, noProxy) => {
      vi.stubEnv("HTTPS_PROXY", "http://proxy.corp-gateway.com:3128");
      vi.stubEnv("NODE_USE_ENV_PROXY", "1");
      vi.stubEnv("NO_PROXY", noProxy);
      const viaEnvProxy = vi.fn(async () => new Response(BODY));
      vi.stubGlobal("fetch", viaEnvProxy);
      answers(["10.1.2.3"]);
      routes["https://assets.private-cdn.com/a.png"] = { status: 200, body: BODY };
      await expect(
        downloadToTemp("https://assets.private-cdn.com/a.png", tempDir()),
      ).rejects.toMatchObject({
        kind: "http_rejected",
        retryable: false,
        message: "Download URL is not permitted",
      });
      expect(viaEnvProxy).not.toHaveBeenCalled();
      expect(received).toEqual([]);
    },
  );

  it("downloads from a public IPv4 host after checking its answers", async () => {
    answers(["93.184.216.34"], ["2606:2800:220:1:248:1893:25c8:1946"]);
    routes["https://cdn.assets-public.com/a.png"] = { status: 200, body: BODY };
    const path = await downloadToTemp("https://cdn.assets-public.com/a.png", tempDir());
    expect(readFileSync(path, "utf8")).toBe(BODY);
    expect(mocks.resolve4).toHaveBeenCalledWith("cdn.assets-public.com");
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("sends a User-Agent and Accept header", async () => {
    answers(["93.184.216.34"]);
    routes["https://upload.media-wiki-host.org/a.png"] = { status: 200, body: BODY };
    await downloadToTemp("https://upload.media-wiki-host.org/a.png", tempDir());
    expect(received[0]?.headers["user-agent"]).toBeTruthy();
    expect(received[0]?.headers.accept).toBe("*/*");
  });

  it("unpacks a gzip text response", async () => {
    answers(["93.184.216.34"]);
    routes["https://cdn.assets-public.com/app.js"] = {
      status: 200,
      headers: { "content-encoding": "gzip" },
      body: gzipSync("console.log('hello');"),
    };
    await expect(
      fetchPublicHttpsText("https://cdn.assets-public.com/app.js", { maxBytes: 1024 }),
    ).resolves.toBe("console.log('hello');");
  });

  it("stops a gzip text response whose unpacked size passes the cap", async () => {
    answers(["93.184.216.34"]);
    routes["https://cdn.assets-public.com/bomb.js"] = {
      status: 200,
      headers: { "content-encoding": "gzip" },
      body: gzipSync(Buffer.alloc(8 * 1024 * 1024)),
    };
    await expect(
      fetchPublicHttpsText("https://cdn.assets-public.com/bomb.js", { maxBytes: 64 * 1024 }),
    ).rejects.toMatchObject({ kind: "length_mismatch", retryable: false });
  });

  it("refuses a compressed asset download, as the default transport does", async () => {
    answers(["93.184.216.34"]);
    routes["https://cdn.assets-public.com/a.png"] = {
      status: 200,
      headers: { "content-encoding": "gzip" },
      body: gzipSync(BODY),
    };
    await expect(
      downloadToTemp("https://cdn.assets-public.com/a.png", tempDir()),
    ).rejects.toMatchObject({ kind: "http_rejected", retryable: false });
  });

  it("retries a gzip-encoded 5xx like any 5xx", async () => {
    answers(["93.184.216.34"]);
    routes["https://cdn.assets-public.com/a.png"] = {
      status: 503,
      headers: { "content-encoding": "gzip" },
      body: gzipSync("busy"),
    };
    await expect(
      downloadToTemp("https://cdn.assets-public.com/a.png", tempDir()),
    ).rejects.toMatchObject({ kind: "http_transient", retryable: true });
    expect(received).toHaveLength(2);
  });

  it.each(["EHOSTUNREACH", "ENETUNREACH"])(
    "retries an unreachable address (%s) as a network failure",
    async (code) => {
      answers(["93.184.216.34"]);
      mocks.dialFailure = code;
      await expect(
        downloadToTemp(`https://${code.toLowerCase()}.assets-public.com/a.png`, tempDir()),
      ).rejects.toMatchObject({ kind: "network", retryable: true });
      expect(mocks.resolve4).toHaveBeenCalledTimes(2);
    },
  );

  it("retries a connection dropped mid-response as a network failure", async () => {
    answers(["93.184.216.34"]);
    routes["https://cdn.assets-public.com/a.png"] = "drop";
    await expect(
      downloadToTemp("https://cdn.assets-public.com/a.png", tempDir()),
    ).rejects.toMatchObject({ kind: "network", retryable: true });
    expect(received).toHaveLength(2);
  });
});

describe("downloads with the render-service setting off", () => {
  it("keep the default lookup, and accept a public IPv6 literal", async () => {
    vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "");
    routes["https://[2606:4700:4700::1111]/a.png"] = { status: 200, body: BODY };
    const path = await downloadToTemp("https://[2606:4700:4700::1111]/a.png", tempDir());
    expect(readFileSync(path, "utf8")).toBe(BODY);
    expect(mocks.resolve4).not.toHaveBeenCalled();
  });
});
