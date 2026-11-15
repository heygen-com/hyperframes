import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { isIP, type LookupFunction } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  resolve4: vi.fn(),
  execFile: vi.fn(),
  request: vi.fn(),
  undiciFetch: vi.fn(),
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
vi.mock("node:https", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:https")>()),
  request: mocks.request,
}));
vi.mock("undici", () => ({
  Agent: class {
    constructor(readonly options: { connect: { lookup: LookupFunction } }) {}
  },
  fetch: mocks.undiciFetch,
}));

import { downloadToTemp, UrlDownloadError } from "./urlDownloader.js";

type Route = { status: number; headers?: Record<string, string>; body?: string };
let routes: Record<string, Route> = {};
const BODY = "\u0000\u0001asset-bytes";

function route(url: string): Route {
  const found = routes[url];
  if (!found) throw new Error(`no route for ${url}`);
  return found;
}

/** The pinned capture transport: answers by the URL the request names. */
function serveCaptureTransport(): void {
  mocks.request.mockImplementation(
    (
      options: { path: string; headers: Record<string, string> },
      callback: (incoming: PassThrough) => void,
    ) => {
      const {
        status,
        headers = {},
        body = "",
      } = route(`https://${options.headers.host}${options.path}`);
      return Object.assign(new EventEmitter(), {
        destroy: vi.fn(),
        end: () => {
          const incoming = Object.assign(new PassThrough(), { statusCode: status, headers });
          callback(incoming);
          incoming.end(body);
        },
      });
    },
  );
}

/** The default transport: runs the connect lookup for a name, as undici does, and skips it for an IP literal. */
function serveDefaultTransport(): void {
  mocks.undiciFetch.mockImplementation(
    async (
      target: string,
      init: { dispatcher: { options: { connect: { lookup: LookupFunction } } } },
    ) => {
      const hostname = new URL(target).hostname;
      if (!isIP(hostname.replace(/^\[|\]$/g, ""))) {
        await new Promise<void>((resolve, reject) =>
          init.dispatcher.options.connect.lookup(hostname, {}, (error) =>
            error ? reject(new TypeError("fetch failed", { cause: error })) : resolve(),
          ),
        );
      }
      const { status, headers, body } = route(target);
      return new Response(body ?? null, { status, headers });
    },
  );
}

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
  serveCaptureTransport();
  serveDefaultTransport();
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
    expect(mocks.undiciFetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("refuses a name that has only IPv6 answers", async () => {
    answers([], ["2606:4700::6810:84e5"]);
    routes["https://v6only.assets-cdn.com/a.png"] = { status: 200, body: BODY };
    await expect(
      downloadToTemp("https://v6only.assets-cdn.com/a.png", tempDir()),
    ).rejects.toBeInstanceOf(UrlDownloadError);
    expect(mocks.undiciFetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
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
    expect(mocks.request).toHaveBeenCalledTimes(1);
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
      ).rejects.toMatchObject({ kind: "http_rejected", message: "Download URL is not permitted" });
      expect(viaEnvProxy).not.toHaveBeenCalled();
      expect(mocks.undiciFetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it("downloads from a public IPv4 host by dialling the checked address", async () => {
    answers(["93.184.216.34"], ["2606:2800:220:1:248:1893:25c8:1946"]);
    routes["https://cdn.assets-public.com/a.png"] = { status: 200, body: BODY };
    const path = await downloadToTemp("https://cdn.assets-public.com/a.png", tempDir());
    expect(readFileSync(path, "utf8")).toBe(BODY);
    expect(mocks.request.mock.calls[0]?.[0]).toMatchObject({
      hostname: "93.184.216.34",
      servername: "cdn.assets-public.com",
    });
  });
});

describe("downloads with the render-service setting off", () => {
  it("keep the default transport, which accepts a public IPv6 literal", async () => {
    vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "");
    routes["https://[2606:4700:4700::1111]/a.png"] = { status: 200, body: BODY };
    const path = await downloadToTemp("https://[2606:4700:4700::1111]/a.png", tempDir());
    expect(readFileSync(path, "utf8")).toBe(BODY);
    expect(mocks.undiciFetch).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
