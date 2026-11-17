import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { get as httpGet, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { safeFetch } from "./assetDownloader.js";
import {
  captureSiteName,
  fetchLocalPageUrl,
  localUrlRewriter,
  rewriteStrings,
  resolveLocalCaptureTarget,
  startLocalPageServer,
  type LocalPageServer,
} from "./localPage.js";

let base: string;
let site: string;

beforeAll(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), "hf-local-page-")));
  site = join(base, "site");
  mkdirSync(join(site, "pages"), { recursive: true });
  writeFileSync(join(site, "index.html"), "<h1>home</h1>");
  writeFileSync(join(site, "pages", "about page.html"), "<h1>about</h1>");
  writeFileSync(join(site, "logo.png"), "png-bytes");
  writeFileSync(join(site, "app.cjs"), "window.cjs = 1;");
  writeFileSync(join(site, "runner"), "window.runner = 1;");
  for (const folder of [".git", ".hyperframes", ".aws"]) mkdirSync(join(site, folder));
  for (const file of [".env", ".env.local", ".git/config", ".hyperframes/x.json", ".npmrc"]) {
    writeFileSync(join(site, file), "SECRET=1");
  }
  writeFileSync(join(site, ".aws", "credentials"), "SECRET=1");
  writeFileSync(join(base, "secret.txt"), "outside the root");
  writeFileSync(join(base, "outside.html"), "<h1>outside</h1>");
  if (process.platform !== "win32") {
    symlinkSync(join(base, "secret.txt"), join(site, "link.txt"));
    symlinkSync(join(base, "outside.html"), join(site, "linked.html"));
  }
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

function getWithHost(
  url: string,
  host: string,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolveGet, rejectGet) => {
    const request = httpGet(url, { headers: { host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () =>
        resolveGet({ status: response.statusCode ?? 0, headers: response.headers, body }),
      );
    });
    request.on("error", rejectGet);
  });
}

describe("resolveLocalCaptureTarget", () => {
  it("accepts a path, a file:// URL or a directory, rooted at the file's directory", () => {
    const entry = join(site, "index.html");
    const expected = { root: site, entry, fileUrl: pathToFileURL(entry).href };
    expect(resolveLocalCaptureTarget(entry)).toEqual(expected);
    expect(resolveLocalCaptureTarget(pathToFileURL(entry).href)).toEqual(expected);
    expect(resolveLocalCaptureTarget(site)).toEqual(expected);
  });

  it("takes an explicit root that contains the file", () => {
    const entry = join(site, "pages", "about page.html");
    expect(resolveLocalCaptureTarget(entry, site).root).toBe(site);
    expect(resolveLocalCaptureTarget(entry).root).toBe(join(site, "pages"));
  });

  it("refuses a file outside the root and a missing file", () => {
    expect(() => resolveLocalCaptureTarget(join(site, "index.html"), join(site, "pages"))).toThrow(
      "outside the root",
    );
    expect(() => resolveLocalCaptureTarget(join(site, "missing.html"))).toThrow(
      "Local file not found",
    );
    expect(() => resolveLocalCaptureTarget("https://example.com/")).toThrow("Local file not found");
  });

  it.skipIf(process.platform === "win32")(
    "does not widen the default root to where a symlinked entry points",
    () => {
      expect(() => resolveLocalCaptureTarget(join(site, "linked.html"))).toThrow(
        "outside the root",
      );
    },
  );
});

describe("startLocalPageServer", () => {
  let server: LocalPageServer;

  beforeAll(async () => {
    const target = resolveLocalCaptureTarget(join(site, "pages", "about page.html"), site);
    server = await startLocalPageServer(target);
  });

  afterAll(() => server.close());

  it("serves the entry page and files inside the root", async () => {
    expect(server.url).toBe(`${server.origin}/pages/about%20page.html`);
    const page = await fetch(server.url);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toBe("<h1>about</h1>");
    expect(await (await fetch(`${server.origin}/logo.png`)).text()).toBe("png-bytes");
  });

  // fails without the fix: a capture page could make a file of the folder its origin's service worker.
  it("refuses a file asked for as a service worker's script, and serves it otherwise", async () => {
    const get = (headers: Record<string, string>) =>
      fetch(`${server.origin}/logo.png`, { headers });
    expect((await get({ "service-worker": "script" })).status).toBe(403);
    expect((await get({ "sec-fetch-dest": "serviceworker" })).status).toBe(403);
    expect((await get({ "sec-fetch-dest": "image" })).status).toBe(200);
  });

  it.each([
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/pages/..%2f..%2fsecret.txt",
    "/missing.png",
  ])("answers 404 for %s", async (path) => {
    const response = await fetch(`${server.origin}${path}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it.each([
    "/.env",
    "/.ENV",
    "/.env.local",
    "/.git/config",
    "/%2egit/config",
    "/.hyperframes/x.json",
    "/.npmrc",
    "/.aws/credentials",
  ])("keeps the private file %s from the page and the capture fetchers", async (path) => {
    const response = await fetch(`${server.origin}${path}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    const local = await safeFetch(`${server.origin}${path}`);
    expect(local?.status).toBe(404);
    expect(await local?.text()).not.toContain("SECRET");
  });

  it.skipIf(process.platform === "win32")("refuses a symlink that leaves the root", async () => {
    expect((await fetch(`${server.origin}/link.txt`)).status).toBe(404);
  });

  it.each(["capture-fixture.example.com", "127.0.0.1", "127.0.0.1:1", "localhost.example.com"])(
    "refuses Host %s before reading any file",
    async (host) => {
      const { status, headers, body } = await getWithHost(server.url, host);
      expect(status).toBe(403);
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(body).not.toContain("about");
    },
  );

  it("answers its own port by every loopback name, with nosniff", async () => {
    const port = new URL(server.origin).port;
    for (const host of [`127.0.0.1:${port}`, `LOCALHOST:${port}`, `[::1]:${port}`]) {
      const { status, headers, body } = await getWithHost(server.url, host);
      expect(status).toBe(200);
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(body).toBe("<h1>about</h1>");
    }
    expect(
      (await fetch(`${server.origin}/missing.png`)).headers.get("x-content-type-options"),
    ).toBe("nosniff");
  });

  it("names script and WebAssembly types, and leaves an unlisted type to the browser's sniffing", async () => {
    const cjs = await fetch(`${server.origin}/app.cjs`);
    expect(cjs.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(cjs.headers.get("x-content-type-options")).toBe("nosniff");
    const bare = await fetch(`${server.origin}/runner`);
    expect(await bare.text()).toBe("window.runner = 1;");
    expect(bare.headers.get("content-type")).toBe("application/octet-stream");
    expect(bare.headers.get("x-content-type-options")).toBeNull();
  });

  it("refuses methods other than GET and HEAD", async () => {
    expect((await fetch(server.url, { method: "POST" })).status).toBe(405);
  });

  it("lets the asset downloader read the active local origin, and only that origin", async () => {
    const response = await safeFetch(`${server.origin}/logo.png`);
    expect(await response?.text()).toBe("png-bytes");
    expect((await safeFetch(`${server.origin}/%2e%2e/secret.txt`))?.status).toBe(404);
    expect(fetchLocalPageUrl("http://127.0.0.1:1/logo.png")).toBeNull();
    expect(await safeFetch("http://127.0.0.1:1/logo.png")).toBeNull();
  });

  it("reads the active local origin from disk, so an environment proxy cannot intercept it", async () => {
    const networkFetch = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", networkFetch);
    try {
      const response = await safeFetch(`${server.origin}/pages/about%20page.html`);
      expect(response?.headers.get("content-type")).toContain("text/html");
      expect(await response?.text()).toBe("<h1>about</h1>");
      const head = await safeFetch(`${server.origin}/logo.png`, { method: "HEAD" });
      expect(head?.headers.get("content-type")).toBe("image/png");
      expect(await head?.text()).toBe("");
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops answering for the origin once closed", async () => {
    const target = resolveLocalCaptureTarget(site);
    const closed = await startLocalPageServer(target);
    await closed.close();
    expect(fetchLocalPageUrl(`${closed.origin}/index.html`)).toBeNull();
    expect(await safeFetch(`${closed.origin}/index.html`)).toBeNull();
  });
});

describe("localUrlRewriter", () => {
  const rewrite = localUrlRewriter("http://127.0.0.1:4100", "/srv/site");

  it("maps local-server URLs to file:// URLs of the same path in the root", () => {
    expect(rewrite(`url(http://127.0.0.1:4100/fonts/a%20b.woff2) "http://127.0.0.1:4100"`)).toBe(
      `url(${pathToFileURL("/srv/site/fonts/a b.woff2").href}) "${pathToFileURL("/srv/site/").href}"`,
    );
    expect(rewrite("http://127.0.0.1:4100/p.html?x=1#top")).toBe(
      `${pathToFileURL("/srv/site/p.html").href}?x=1#top`,
    );
  });

  it("leaves other origins alone, including a longer port with the same prefix", () => {
    const text = "http://127.0.0.1:41000/a https://example.com/a http://127.0.0.1:4101/a";
    expect(rewrite(text)).toBe(text);
  });

  it("matches the origin literally, not as a pattern", () => {
    expect(rewrite("http://127x0x0x1:4100/a")).toBe("http://127x0x0x1:4100/a");
    const plus = localUrlRewriter("http://a+b.example:4100", "/srv/site");
    expect(plus("http://aab.example:4100/x http://ab.example:4100/x")).toBe(
      "http://aab.example:4100/x http://ab.example:4100/x",
    );
    expect(plus("http://a+b.example:4100/x")).toBe(pathToFileURL("/srv/site/x").href);
  });

  it("rewrites every string inside a nested value", () => {
    expect(
      rewriteStrings({ a: ["http://127.0.0.1:4100/x.png", 3], b: { c: null } }, rewrite),
    ).toEqual({ a: [pathToFileURL("/srv/site/x.png").href, 3], b: { c: null } });
  });
});

describe("captureSiteName", () => {
  it("names an active local server after its page, and a website after its host", async () => {
    const server = await startLocalPageServer(
      resolveLocalCaptureTarget(join(site, "pages", "about page.html")),
    );
    try {
      expect(captureSiteName(server.url)).toBe("about-page");
    } finally {
      await server.close();
    }
    expect(captureSiteName(server.url)).toBe("127.0.0.1");
    expect(captureSiteName("https://www.example.com/x")).toBe("example.com");
  });
});
