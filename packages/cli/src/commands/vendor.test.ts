import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import {
  GSAP_URL,
  lastJsonOutput,
  makeFixtureProject,
  makeRunner,
  spyOnConsole,
} from "./_offlineAssetsTestKit.js";

// withMeta just annotates the object; identity keeps the assertions simple.
vi.mock("../utils/updateCheck.js", () => ({ withMeta: (o: unknown) => o }));
// resolveProject reports invalid-dir failures to telemetry; keep tests silent.
vi.mock("../telemetry/events.js", () => ({ trackCommandFailure: () => {} }));

import vendorCommand, {
  resolveVendorTarget,
  rewriteHtmlReferences,
  toFetchableUrl,
  vendorFileName,
} from "./vendor.js";

const run = makeRunner(vendorCommand);

function fetchResponse(body: string, contentType: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

describe("toFetchableUrl", () => {
  it("allows http(s) and upgrades protocol-relative URLs to https", () => {
    expect(toFetchableUrl(GSAP_URL)).toBe(GSAP_URL);
    expect(toFetchableUrl("http://example.com/a.js")).toBe("http://example.com/a.js");
    expect(toFetchableUrl("//cdn.example.com/a.js")).toBe("https://cdn.example.com/a.js");
  });

  it("rejects non-http(s) schemes", () => {
    expect(toFetchableUrl("ftp://example.com/a.png")).toBeNull();
    expect(toFetchableUrl("file:///etc/passwd")).toBeNull();
    expect(toFetchableUrl("not a url")).toBeNull();
  });
});

describe("vendorFileName", () => {
  it("keeps the basename, appends a stable hash, and preserves the extension", () => {
    const name = vendorFileName(GSAP_URL);
    expect(name).toMatch(/^gsap\.min-[0-9a-f]{10}\.js$/);
    expect(vendorFileName(GSAP_URL)).toBe(name);
  });

  it("derives the extension from content-type when the URL has none", () => {
    expect(vendorFileName("https://fonts.example.com/inter", "font/woff2")).toMatch(/\.woff2$/);
  });
});

describe("resolveVendorTarget", () => {
  it("resolves plain filenames under the vendor directory", () => {
    const outDir = join("/tmp", "proj", "assets", "vendor");
    expect(resolveVendorTarget(outDir, "gsap.min-abc.js")).toBe(join(outDir, "gsap.min-abc.js"));
  });

  it("refuses filenames that would escape the vendor directory", () => {
    const outDir = join("/tmp", "proj", "assets", "vendor");
    expect(() => resolveVendorTarget(outDir, "../../../etc/passwd")).toThrow(
      /outside the vendor directory/,
    );
    expect(() => resolveVendorTarget(outDir, "/etc/passwd")).toThrow(
      /outside the vendor directory/,
    );
  });
});

describe("rewriteHtmlReferences", () => {
  it("rewrites to a path relative to the referencing file", () => {
    const html = `<script src="${GSAP_URL}"></script>`;
    const fromRoot = rewriteHtmlReferences(html, "index.html", [
      { rawUrl: GSAP_URL, vendorPath: "assets/vendor/gsap.min-abc.js" },
    ]);
    expect(fromRoot.rewritten).toBe(1);
    expect(fromRoot.html).toContain('src="assets/vendor/gsap.min-abc.js"');

    const fromScene = rewriteHtmlReferences(html, "scenes/intro.html", [
      { rawUrl: GSAP_URL, vendorPath: "assets/vendor/gsap.min-abc.js" },
    ]);
    expect(fromScene.html).toContain('src="../assets/vendor/gsap.min-abc.js"');
  });

  it("replaces longer URLs first so prefixes cannot clobber", () => {
    const html = `<script src="https://x.com/a.js"></script><script src="https://x.com/a.js.map"></script>`;
    const { html: out } = rewriteHtmlReferences(html, "index.html", [
      { rawUrl: "https://x.com/a.js", vendorPath: "v/a.js" },
      { rawUrl: "https://x.com/a.js.map", vendorPath: "v/a.js.map" },
    ]);
    expect(out).toContain('src="v/a.js"');
    expect(out).toContain('src="v/a.js.map"');
  });
});

describe("vendor command", () => {
  let dir: string;

  beforeEach(() => {
    consumeCommandResult();
    spyOnConsole();
    dir = makeFixtureProject("hf-vendor-cmd-");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    consumeCommandResult();
    rmSync(dir, { recursive: true, force: true });
  });

  it("downloads remotes, rewrites HTML, and writes the manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fetchResponse("/* gsap */", "text/javascript")),
    );

    await run({ dir, out: "assets/vendor", json: true, "strict-offline": true });
    expect(consumeCommandResult().exitCode).toBe(0);

    const output = lastJsonOutput();
    expect(output.ok).toBe(true);
    expect(output.remainingRemoteUrls).toEqual([]);
    expect(output.rewrittenReferences).toBe(1);

    const html = readFileSync(join(dir, "index.html"), "utf-8");
    expect(html).not.toContain("https://");
    expect(html).toMatch(/src="assets\/vendor\/gsap\.min-[0-9a-f]{10}\.js"/);

    const vendorFiles = readdirSync(join(dir, "assets", "vendor"));
    expect(vendorFiles).toContain("vendor-manifest.json");
    expect(vendorFiles.some((f) => f.startsWith("gsap.min-"))).toBe(true);

    const manifest = JSON.parse(
      readFileSync(join(dir, "assets", "vendor", "vendor-manifest.json"), "utf-8"),
    );
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]).toMatchObject({ url: GSAP_URL, bytes: 10 });
    expect(manifest.assets[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("--dry-run lists candidate downloads without touching the project", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await run({ dir, out: "assets/vendor", json: true, "dry-run": true });
    expect(consumeCommandResult().exitCode).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastJsonOutput().wouldDownload).toEqual([GSAP_URL]);
    expect(existsSync(join(dir, "assets", "vendor"))).toBe(false);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain(GSAP_URL);
  });

  it("reports failed downloads and exits 1 without rewriting their references", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );

    await run({ dir, out: "assets/vendor", json: true });
    expect(consumeCommandResult().exitCode).toBe(1);

    const output = lastJsonOutput();
    expect(output.ok).toBe(false);
    expect(output.failed).toEqual([{ url: GSAP_URL, error: "HTTP 404" }]);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain(GSAP_URL);
  });

  it("rejects downloads over the size cap without rewriting their references", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fetchResponse("0123456789", "text/javascript")),
    );

    await run({ dir, out: "assets/vendor", json: true, "max-bytes": "4" });
    expect(consumeCommandResult().exitCode).toBe(1);

    const output = lastJsonOutput();
    expect(output.ok).toBe(false);
    expect(output.failed).toEqual([
      { url: GSAP_URL, error: expect.stringMatching(/exceeds size cap/) },
    ]);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain(GSAP_URL);
  });

  it("refuses an --out directory outside the project", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await run({ dir, out: "../outside-vendor", json: true });
    expect(consumeCommandResult().exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastJsonOutput().error).toMatch(/inside the project directory/);
  });

  it("--strict-offline exits 1 when a non-vendorable remote (iframe) remains", async () => {
    writeFileSync(join(dir, "index.html"), `<iframe src="https://example.com/embed"></iframe>`);
    vi.stubGlobal("fetch", vi.fn());

    await run({ dir, out: "assets/vendor", json: true, "strict-offline": true });
    expect(consumeCommandResult().exitCode).toBe(1);

    const output = lastJsonOutput();
    expect(output.ok).toBe(false);
    expect(output.remainingRemoteUrls).toEqual(["https://example.com/embed"]);
  });
});
