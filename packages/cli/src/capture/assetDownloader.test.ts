import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadAndRewriteFonts,
  isPrivateUrl,
  safeFetch,
  toStandaloneSvg,
} from "./assetDownloader.js";

describe("isPrivateUrl — SSRF denylist (security: F-003)", () => {
  it("blocks loopback, private, and metadata IPv4", () => {
    for (const u of [
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/", // cloud metadata
    ]) {
      expect(isPrivateUrl(u), u).toBe(true);
    }
  });

  it("blocks 0.0.0.0 and the 0.0.0.0/8 range", () => {
    expect(isPrivateUrl("http://0.0.0.0/")).toBe(true);
    expect(isPrivateUrl("http://0.1.2.3/")).toBe(true);
  });

  it("blocks IPv6 loopback, IPv4-mapped, ULA, and link-local", () => {
    for (const u of [
      "http://[::1]/",
      "http://[::ffff:169.254.169.254]/", // IPv4-mapped metadata
      "http://[fd00::1]/", // unique-local fc00::/7
      "http://[fe80::1]/", // link-local fe80::/10
    ]) {
      expect(isPrivateUrl(u), u).toBe(true);
    }
  });

  it("still blocks alternate IPv4 encodings (WHATWG canonicalization)", () => {
    expect(isPrivateUrl("http://2130706433/")).toBe(true); // decimal 127.0.0.1
    expect(isPrivateUrl("http://0x7f000001/")).toBe(true); // hex
  });

  it("blocks non-http(s) schemes and internal suffixes", () => {
    expect(isPrivateUrl("file:///etc/passwd")).toBe(true);
    expect(isPrivateUrl("http://db.internal/")).toBe(true);
    expect(isPrivateUrl("http://svc.local/")).toBe(true);
  });

  it("allows ordinary public URLs", () => {
    expect(isPrivateUrl("https://example.com/logo.png")).toBe(false);
    expect(isPrivateUrl("https://cdn.jsdelivr.net/a.svg")).toBe(false);
  });
});

describe("safeFetch — re-validates the denylist on every redirect hop (security: F-002)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("blocks a public URL that redirects to a private/metadata host", async () => {
    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input === "https://public.example/logo.png") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      // The metadata host must NEVER be fetched.
      throw new Error(`safeFetch followed a redirect to a private host: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await safeFetch("https://public.example/logo.png");
    expect(res).toBeNull();
    // First (public) hop fetched; the redirect target was rejected before fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("follows a redirect to another public host and returns the final response", async () => {
    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input === "https://a.example/x")
        return new Response(null, { status: 301, headers: { location: "https://b.example/y" } });
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await safeFetch("https://a.example/x");
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe("ok");
  });

  it("returns null when the initial URL is private", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await safeFetch("http://169.254.169.254/");
    expect(res).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("toStandaloneSvg — scraped inline SVGs must survive as .svg files", () => {
  it("adds the SVG namespace that outerHTML omits for inline SVG", () => {
    const inline = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
    const out = toStandaloneSvg(inline);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    // Nothing else may change — the path geometry is the brand mark.
    expect(out).toContain('<path d="M0 0h24v24H0z"/>');
    expect(out.endsWith("</svg>")).toBe(true);
  });

  it("leaves an SVG that already declares xmlns untouched", () => {
    const already = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect/></svg>';
    expect(toStandaloneSvg(already)).toBe(already);
  });

  it("declares xmlns:xlink only when an xlink: attribute is actually used", () => {
    const withXlink = '<svg viewBox="0 0 8 8"><use xlink:href="#a"/></svg>';
    expect(toStandaloneSvg(withXlink)).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    const without = '<svg viewBox="0 0 8 8"><use href="#a"/></svg>';
    expect(toStandaloneSvg(without)).not.toContain("xmlns:xlink");
  });

  it("is idempotent and preserves attributes on the root", () => {
    const inline = '<svg class="logo" width="120" height="24" fill="currentColor"><g/></svg>';
    const once = toStandaloneSvg(inline);
    expect(toStandaloneSvg(once)).toBe(once);
    for (const attr of ['class="logo"', 'width="120"', 'height="24"', 'fill="currentColor"']) {
      expect(once).toContain(attr);
    }
  });

  it("returns non-SVG input unchanged rather than corrupting it", () => {
    expect(toStandaloneSvg("<div>not an svg</div>")).toBe("<div>not an svg</div>");
  });
});

describe("downloadAndRewriteFonts — attempt caps", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function expectFailedFontAttempts(css: string, expectedAttempts: number): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "hf-font-attempts-"));
    const fetchMock = vi.fn(async () => new Response("failed", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await downloadAndRewriteFonts(css, dir);
      expect(fetchMock).toHaveBeenCalledTimes(expectedAttempts);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("counts failed requests toward the global 30-font cap", async () => {
    const css = Array.from(
      { length: 35 },
      (_, i) =>
        `@font-face { font-family: Family${i}; src: url(https://fonts${i}.example/font-${i}.woff2); }`,
    ).join("\n");
    await expectFailedFontAttempts(css, 30);
  });

  it("counts failed requests toward the six-attempt per-family cap", async () => {
    const css = Array.from(
      { length: 10 },
      (_, i) =>
        `@font-face { font-family: Shared; src: url(https://fonts.example/font-${i}.woff2); }`,
    ).join("\n");
    await expectFailedFontAttempts(css, 6);
  });

  it("does not start a font request after the capture budget is exhausted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-font-budget-"));
    const css = "@font-face { font-family: Budget; src: url(https://fonts.example/budget.woff2); }";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await downloadAndRewriteFonts(css, dir, { remainingMs: () => 0 });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
