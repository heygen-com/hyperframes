import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  writeFileSync(join(base, "secret.txt"), "outside the root");
  writeFileSync(join(base, "outside.html"), "<h1>outside</h1>");
  if (process.platform !== "win32") {
    symlinkSync(join(base, "secret.txt"), join(site, "link.txt"));
    symlinkSync(join(base, "outside.html"), join(site, "linked.html"));
  }
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

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

  it.skipIf(process.platform === "win32")("refuses a symlink that leaves the root", async () => {
    expect((await fetch(`${server.origin}/link.txt`)).status).toBe(404);
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
