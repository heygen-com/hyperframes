// @vitest-environment node
/**
 * Regression test for the Google Fonts multi-subset cache collision.
 *
 * Google Fonts' css2 API returns ONE @font-face per (weight × unicode-range
 * subset) — e.g. for a single weight you get separate `vietnamese`,
 * `latin-ext`, and `latin` faces, each pointing at a DISTINCT woff2 whose
 * glyph coverage matches its `unicode-range`.
 *
 * The bug: the on-disk cache keyed woff2 files by `${weight}-${style}` only,
 * ignoring the subset. So all subsets of a weight collided on one filename —
 * only the FIRST subset in the CSS (vietnamese, for many display families)
 * was ever downloaded, and every later subset read that same file back.
 * Compounding it, the injected @font-face dropped `unicode-range`, so the face
 * claimed to cover every codepoint while only containing the first subset's
 * glyphs. Result: Latin letters absent from the embedded font fell back to a
 * different font (the visible "wrong A" glitch).
 *
 * These tests inject `fetchImpl` (no network) and a temp `HYPERFRAMES_FONT_CACHE_DIR`
 * so they are hermetic.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _clearGoogleFontCssCacheForTests,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";
import * as systemFontLocator from "./systemFontLocator.js";

beforeEach(() => {
  _clearGoogleFontCssCacheForTests();
  vi.spyOn(systemFontLocator, "locateSystemFontVariants").mockImplementation((family) =>
    family === "Hf Authored Fail Test"
      ? [{ path: localFontFile, format: "woff2", weight: "400", style: "normal" }]
      : [],
  );
});
afterEach(() => vi.restoreAllMocks());

let cacheDir: string;
let prevCacheEnv: string | undefined;
let localFontFile: string;
const LOCAL_FONT_BYTES = "LOCAL_ONLY_BYTES";

beforeAll(() => {
  prevCacheEnv = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "hf-font-cache-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
  localFontFile = join(cacheDir, "hf-authored-fail-test.woff2");
  writeFileSync(localFontFile, LOCAL_FONT_BYTES);
});

afterAll(() => {
  if (prevCacheEnv === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = prevCacheEnv;
  rmSync(cacheDir, { recursive: true, force: true });
});

const VIET_RANGE = "U+0102-0103, U+1EA0-1EF9, U+20AB";
const LATIN_RANGE = "U+0000-00FF, U+0131, U+2000-206F";
const VIET_URL = "https://fonts.gstatic.com/s/testfam/v1/VIET-subset.woff2";
const LATIN_URL = "https://fonts.gstatic.com/s/testfam/v1/LATIN-subset.woff2";
// distinct, identifiable "woff2" bodies (content need not be a real font here)
const VIET_BYTES = "VIET_SUBSET_BYTES";
const LATIN_BYTES = "LATIN_SUBSET_BYTES";
const b64 = (s: string) => Buffer.from(s).toString("base64");

// Two subsets for the SAME weight, vietnamese FIRST (as Google orders it for
// display families) then latin — exactly the shape that triggered the bug.
const CSS = `/* vietnamese */
@font-face {
  font-family: 'TestFam';
  font-style: normal;
  font-weight: 900;
  font-display: swap;
  src: url(${VIET_URL}) format('woff2');
  unicode-range: ${VIET_RANGE};
}
/* latin */
@font-face {
  font-family: 'TestFam';
  font-style: normal;
  font-weight: 900;
  font-display: swap;
  src: url(${LATIN_URL}) format('woff2');
  unicode-range: ${LATIN_RANGE};
}`;

function makeGoogleFetch(): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input);
    if (url.includes("css2")) return new Response(CSS, { status: 200 });
    if (url === VIET_URL) return new Response(VIET_BYTES, { status: 200 });
    if (url === LATIN_URL) return new Response(LATIN_BYTES, { status: 200 });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

const HTML = `<!doctype html><html><head><style>
  h1 { font-family: "TestFam", sans-serif; }
</style></head><body><h1>CATALOG</h1></body></html>`;

describe("Google Fonts multi-subset embedding", () => {
  it("downloads and embeds EACH subset distinctly (no cache collision)", async () => {
    const result = await injectDeterministicFontFaces(HTML, { fetchImpl: makeGoogleFetch() });

    // Both subsets' distinct bytes must be present — the latin subset must NOT
    // be clobbered by the vietnamese one. (Before the fix, the latin face
    // carried the vietnamese bytes because both shared one cache filename.)
    expect(result).toContain(b64(VIET_BYTES));
    expect(result).toContain(b64(LATIN_BYTES));
  });

  it("preserves each face's unicode-range so the browser picks the right subset per codepoint", async () => {
    const result = await injectDeterministicFontFaces(HTML, { fetchImpl: makeGoogleFetch() });

    expect(result).toContain(VIET_RANGE);
    expect(result).toContain(LATIN_RANGE);
    // the latin bytes and the latin range belong to the same @font-face block
    const faces = result.split("@font-face").filter((b) => b.includes("TestFam"));
    const latinFace = faces.find((f) => f.includes(b64(LATIN_BYTES)));
    expect(latinFace).toBeDefined();
    expect(latinFace).toContain(LATIN_RANGE);
  });
});

const AUTHORED_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Nunito+Sans:wght@400;600;700&display=swap";
const FRAUNCES_FILE = "https://fonts.gstatic.com/s/fraunces/authored.woff2";
const NUNITO_FILE = "https://fonts.gstatic.com/s/nunitosans/authored.woff2";
const WIDE_FILE = "https://fonts.gstatic.com/s/fraunces/wide.woff2";
const INTER_FILE = "https://fonts.gstatic.com/s/inter/v1/inter-supplement.woff2";

const AUTHORED_CSS = `@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url(${FRAUNCES_FILE}) format('woff2');
  unicode-range: U+0000-00FF;
}
@font-face {
  font-family: 'Nunito Sans';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(${NUNITO_FILE}) format('woff2');
  unicode-range: U+0000-00FF;
}`;

function authoredPage(head: string): string {
  return `<!doctype html><html><head>${head}</head><body><h1>Seconds</h1></body></html>`;
}

function isAuthoredRequest(url: string, href: string): boolean {
  return url === href || url.startsWith(`${href}&text=`);
}

function authoredFetch(cssStatus: number): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (isAuthoredRequest(url, AUTHORED_HREF))
      return new Response(cssStatus === 200 ? AUTHORED_CSS : "", { status: cssStatus });
    if (url.includes("family=Fraunces:ital,wght@")) {
      return new Response(
        `@font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 500; src: url(${WIDE_FILE}) format('woff2'); unicode-range: U+0000-00FF; }`,
        { status: 200 },
      );
    }
    if (url.includes("family=Inter:")) {
      return new Response(
        `@font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; src: url(${INTER_FILE}) format('woff2'); }`,
        { status: 200 },
      );
    }
    if (url === FRAUNCES_FILE) return new Response("FRAUNCES_LINKED", { status: 200 });
    if (url === NUNITO_FILE) return new Response("NUNITO_LINKED", { status: 200 });
    if (url === WIDE_FILE) return new Response("FRAUNCES_WIDE", { status: 200 });
    if (url === INTER_FILE) return new Response("INTER_BYTES", { status: 200 });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

describe("authored Google font stylesheet", () => {
  it("embeds the linked file and leaves it after the link", async () => {
    const { fetchImpl, urls } = authoredFetch(200);
    const result = await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${AUTHORED_HREF}">` +
          `<style>h1 { font-family: "Fraunces", serif; } p { font-family: "Nunito Sans", sans-serif; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false },
    );

    const cssUrls = urls.filter((url) => url.startsWith("https://fonts.googleapis.com/"));
    expect(cssUrls).toHaveLength(1);
    expect(cssUrls[0]?.startsWith(`${AUTHORED_HREF}&text=`)).toBe(true);
    expect(new URL(cssUrls[0] ?? "").searchParams.get("text") ?? "").toContain("S");
    expect(result).toContain(b64("FRAUNCES_LINKED"));
    expect(result).toContain(b64("NUNITO_LINKED"));
    expect(result).not.toContain(b64("FRAUNCES_WIDE"));
    const frauncesFace = result
      .split("@font-face")
      .find((block) => block.includes('font-family: "Fraunces"'));
    expect(frauncesFace).toBeDefined();
    expect(frauncesFace).not.toContain(b64("NUNITO_LINKED"));
    expect(result.indexOf("data-hyperframes-deterministic-fonts")).toBeGreaterThan(
      result.indexOf(AUTHORED_HREF),
    );
  });

  it("embeds the default request when Google rejects the page's link", async () => {
    const { fetchImpl, urls } = authoredFetch(400);
    const warnings: string[] = [];
    const result = await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${AUTHORED_HREF}"><style>h1 { font-family: "Fraunces", serif; }</style>`,
      ),
      {
        fetchImpl,
        allowSystemFontCapture: false,
        failClosedFontFetch: true,
        logger: { warn: (message) => warnings.push(message), info: () => {} },
      },
    );

    expect(urls.some((url) => url.includes("family=Fraunces:ital,wght@"))).toBe(true);
    expect(result).toContain(b64("FRAUNCES_WIDE"));
    const fallbackWarning = warnings.find((message) =>
      message.includes("google_font_link_fallback"),
    );
    expect(fallbackWarning).toContain("link_outcomes=http_400");
    expect(fallbackWarning).toContain("fallback_faces=1");
    expect(fallbackWarning).not.toContain("googleapis");
  });

  it("does not swap a link a transient failure blocked under fail-closed", async () => {
    const { fetchImpl, urls } = authoredFetch(503);
    const compile = injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${AUTHORED_HREF}"><style>h1 { font-family: "Fraunces", serif; }</style>`,
      ),
      {
        fetchImpl,
        allowSystemFontCapture: false,
        failClosedFontFetch: true,
        fontFetchRetryPolicy: { maxAttempts: 1 },
      },
    );

    await expect(compile).rejects.toThrow();
    expect(urls.some((url) => url.includes("ital,wght@"))).toBe(false);
  });

  it.each([
    [403, true],
    [404, true],
    [503, false],
    [200, true],
  ])(
    "embeds the default request when the link answers HTTP %s with no faces (fail-closed: %s)",
    async (status, failClosedFontFetch) => {
      const urls: string[] = [];
      const base = authoredFetch(200).fetchImpl;
      const fetchImpl = (async (input: unknown) => {
        const url = String(input);
        urls.push(url);
        if (isAuthoredRequest(url, AUTHORED_HREF)) return new Response("", { status });
        return base(url);
      }) as unknown as typeof fetch;
      const result = await injectDeterministicFontFaces(
        authoredPage(
          `<link rel="stylesheet" href="${AUTHORED_HREF}"><style>h1 { font-family: "Fraunces", serif; }</style>`,
        ),
        {
          fetchImpl,
          allowSystemFontCapture: false,
          failClosedFontFetch,
          fontFetchRetryPolicy: { maxAttempts: 1 },
        },
      );

      expect(urls.some((url) => url.includes("family=Fraunces:ital,wght@"))).toBe(true);
      expect(result).toContain(b64("FRAUNCES_WIDE"));
    },
  );

  it("keeps the linked faces without the default request when the link works", async () => {
    const { fetchImpl, urls } = authoredFetch(200);
    await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${AUTHORED_HREF}"><style>h1 { font-family: "Fraunces", serif; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false, failClosedFontFetch: true },
    );

    expect(urls.some((url) => url.includes("ital,wght@"))).toBe(false);
  });

  it("embeds the same faces in preview and render when the page's link is rejected", async () => {
    const html = authoredPage(
      `<link rel="stylesheet" href="${AUTHORED_HREF}"><style>h1 { font-family: "Fraunces", serif; }</style>`,
    );
    const preview = await injectDeterministicFontFaces(html, {
      fetchImpl: authoredFetch(400).fetchImpl,
      allowSystemFontCapture: false,
    });
    _clearGoogleFontCssCacheForTests();
    const render = await injectDeterministicFontFaces(html, {
      fetchImpl: authoredFetch(400).fetchImpl,
      allowSystemFontCapture: false,
      failClosedFontFetch: true,
    });

    expect(preview).toContain(b64("FRAUNCES_WIDE"));
    expect(render).toBe(preview);
  });

  it("renders fail-closed when a link asks for weights past the family's range", async () => {
    // Bricolage Grotesque spans 200..800; Google answers `wght@100..900` with HTTP 400.
    const href = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@100..900";
    const file = "https://fonts.gstatic.com/s/bricolagegrotesque/default.woff2";
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      if (url.startsWith(href)) return new Response("", { status: 400 });
      if (url.includes("family=Bricolage%20Grotesque:ital,wght@")) {
        return new Response(
          `@font-face { font-family: 'Bricolage Grotesque'; font-style: normal; font-weight: 200 800; src: url(${file}) format('woff2'); }`,
        );
      }
      if (url === file) return new Response("BRICOLAGE_DEFAULT");
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${href}"><style>h1 { font-family: "Bricolage Grotesque", sans-serif; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false, failClosedFontFetch: true },
    );

    expect(result).toContain(b64("BRICOLAGE_DEFAULT"));
  });

  it("renders fail-closed when a multi-family link silently drops one family", async () => {
    // Bricolage's opsz axis starts at 12; Google answers this link with 200 and only Hanken Grotesk.
    const href =
      "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@7..96,500&family=Hanken+Grotesk:wght@400;500;600&display=swap";
    const hanken = "https://fonts.gstatic.com/s/hankengrotesk/linked.woff2";
    const bricolage = "https://fonts.gstatic.com/s/bricolagegrotesque/default.woff2";
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      if (url.startsWith(href)) {
        return new Response(
          `@font-face { font-family: 'Hanken Grotesk'; font-style: normal; font-weight: 400; src: url(${hanken}) format('woff2'); }`,
        );
      }
      if (url.includes("family=Bricolage%20Grotesque:ital,wght@")) {
        return new Response(
          `@font-face { font-family: 'Bricolage Grotesque'; font-style: normal; font-weight: 200 800; src: url(${bricolage}) format('woff2'); }`,
        );
      }
      if (url === hanken) return new Response("HANKEN_LINKED");
      if (url === bricolage) return new Response("BRICOLAGE_DEFAULT");
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${href}">` +
          `<style>h1 { font-family: "Bricolage Grotesque"; } p { font-family: "Hanken Grotesk"; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false, failClosedFontFetch: true },
    );

    expect(result).toContain(b64("BRICOLAGE_DEFAULT"));
    expect(result).toContain(b64("HANKEN_LINKED"));
  });

  it("still requests by family name when the page has no Google link", async () => {
    const { fetchImpl, urls } = authoredFetch(200);
    const result = await injectDeterministicFontFaces(
      authoredPage(`<style>h1 { font-family: "Fraunces", serif; }</style>`),
      { fetchImpl, allowSystemFontCapture: false },
    );

    expect(urls.some((url) => url.includes("family=Fraunces:ital,wght@"))).toBe(true);
    expect(result).toContain(b64("FRAUNCES_WIDE"));
  });

  it("keeps a 400 900 weight span on every embedded subset", async () => {
    const href =
      "https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..900&display=swap";
    const latin = "https://fonts.gstatic.com/s/bodonimoda/latin.woff2";
    const latinExt = "https://fonts.gstatic.com/s/bodonimoda/latin-ext.woff2";
    const urls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (isAuthoredRequest(url, href)) {
        return new Response(
          `@font-face { font-family: 'Bodoni Moda'; font-style: normal; font-weight: 400 900; src: url(${latinExt}) format('woff2'); unicode-range: U+0100-02BA; }
@font-face { font-family: 'Bodoni Moda'; font-style: normal; font-weight: 400 900; src: url(${latin}) format('woff2'); unicode-range: U+0000-00FF; }`,
          { status: 200 },
        );
      }
      if (url === latin) return new Response("BODONI_LATIN", { status: 200 });
      if (url === latinExt) return new Response("BODONI_LATIN_EXT", { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${href}"><style>h1 { font-family: "Bodoni Moda", serif; font-weight: 700; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false },
    );

    const cssUrls = urls.filter((url) => url.startsWith("https://fonts.googleapis.com/"));
    expect(cssUrls).toHaveLength(1);
    expect(cssUrls[0]?.startsWith(`${href}&text=`)).toBe(true);
    const faces = result
      .split("@font-face")
      .slice(1)
      .filter((block) => block.includes('font-family: "Bodoni Moda"'));
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      expect(face).toContain("font-weight: 400 900;");
    }
    expect(result).toContain(b64("BODONI_LATIN"));
    expect(result).toContain(b64("BODONI_LATIN_EXT"));
  });

  it("still embeds Inter for Arial when the page links Arial", async () => {
    const { fetchImpl, urls } = authoredFetch(200);
    await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Arial">` +
          `<style>h1 { font-family: Arial, sans-serif; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false },
    );

    expect(urls.some((url) => url.includes("family=Arial"))).toBe(false);
    expect(urls.some((url) => url.includes("family=Inter:"))).toBe(true);
  });

  it("embeds the Google file named by an import, not the weight-only file", async () => {
    const { fetchImpl, urls } = authoredFetch(200);
    const result = await injectDeterministicFontFaces(
      authoredPage(
        `<style>@import url("${AUTHORED_HREF}"); h1 { font-family: "Fraunces", serif; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false },
    );

    const cssUrls = urls.filter((url) => url.startsWith("https://fonts.googleapis.com/"));
    expect(cssUrls.some((url) => url.startsWith(`${AUTHORED_HREF}&text=`))).toBe(true);
    expect(cssUrls.some((url) => url.includes("ital,wght@"))).toBe(false);
    expect(result).toContain(b64("FRAUNCES_LINKED"));
    expect(result).not.toContain(b64("FRAUNCES_WIDE"));
  });

  it("preserves a later weight-range link alongside the first static link", async () => {
    const narrow = "https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@400&display=swap";
    const wide =
      "https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..900&display=swap";
    const file = "https://fonts.gstatic.com/s/bodonimoda/range.woff2";
    const urls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (isAuthoredRequest(url, wide)) {
        return new Response(
          `@font-face { font-family: 'Bodoni Moda'; font-style: normal; font-weight: 400 900; src: url(${file}) format('woff2'); unicode-range: U+0000-00FF; }`,
          { status: 200 },
        );
      }
      if (url === file) return new Response("BODONI_RANGE", { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${narrow}">` +
          `<link rel="stylesheet" href="${wide}">` +
          `<style>h1 { font-family: "Bodoni Moda", serif; font-weight: 700; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false },
    );

    const cssUrls = urls.filter((url) => url.startsWith("https://fonts.googleapis.com/"));
    expect(cssUrls).toHaveLength(2);
    expect(cssUrls[0]?.startsWith(`${narrow}&text=`)).toBe(true);
    expect(cssUrls[1]?.startsWith(`${wide}&text=`)).toBe(true);
    expect(result).toContain("font-weight: 400 900;");
    expect(result).toContain(b64("BODONI_RANGE"));
  });

  it("preserves the first weight-range link alongside a later static link", async () => {
    const wide =
      "https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..900&display=swap";
    const narrow = "https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@400&display=swap";
    const file = "https://fonts.gstatic.com/s/bodonimoda/first-range.woff2";
    const urls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (isAuthoredRequest(url, wide)) {
        return new Response(
          `@font-face { font-family: 'Bodoni Moda'; font-style: normal; font-weight: 400 900; src: url(${file}) format('woff2'); unicode-range: U+0000-00FF; }`,
          { status: 200 },
        );
      }
      if (url === file) return new Response("BODONI_RANGE");
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${wide}">` +
          `<link rel="stylesheet" href="${narrow}">` +
          `<style>h1 { font-family: "Bodoni Moda", serif; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false },
    );

    const cssUrls = urls.filter((url) => url.startsWith("https://fonts.googleapis.com/"));
    expect(cssUrls).toHaveLength(2);
    expect(cssUrls[0]?.startsWith(`${wide}&text=`)).toBe(true);
    expect(cssUrls[1]?.startsWith(`${narrow}&text=`)).toBe(true);
  });

  it("leaves a link's own text list unchanged", async () => {
    const href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&text=Hi";
    const urls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url === href) {
        return new Response(
          `@font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 500; src: url(${FRAUNCES_FILE}) format('woff2'); unicode-range: U+0000-00FF; }`,
          { status: 200 },
        );
      }
      if (url === FRAUNCES_FILE) return new Response("FRAUNCES_LINKED", { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${href}"><style>h1 { font-family: "Fraunces", serif; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false },
    );

    expect(urls.filter((url) => url.startsWith("https://fonts.googleapis.com/"))).toEqual([href]);
  });

  it("does not append page text when the character set does not fit on the font URL", async () => {
    const href = "https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400";
    const file = "https://fonts.gstatic.com/s/notoserifjp/full.woff2";
    const many = Array.from({ length: 600 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("");
    const urls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url === href) {
        return new Response(
          `@font-face { font-family: 'Noto Serif JP'; font-style: normal; font-weight: 400; src: url(${file}) format('woff2'); unicode-range: U+3000-30FF; }`,
          { status: 200 },
        );
      }
      if (url === file) return new Response("NOTO_FULL", { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    await injectDeterministicFontFaces(
      `<!doctype html><html><head><link rel="stylesheet" href="${href}"><style>p { font-family: "Noto Serif JP", serif; }</style></head><body>${many}</body></html>`,
      { fetchImpl, allowSystemFontCapture: false },
    );

    expect(urls.filter((url) => url.startsWith("https://fonts.googleapis.com/"))).toEqual([href]);
  });

  it("does not embed a local file when the page's link failed", async () => {
    const href = "https://fonts.googleapis.com/css2?family=Hf+Authored+Fail+Test";
    const urls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      urls.push(String(input));
      return new Response("", { status: 400 });
    }) as unknown as typeof fetch;
    const result = await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${href}"><style>h1 { font-family: "Hf Authored Fail Test", serif; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: true },
    );

    expect(urls.some((url) => url.includes("ital,wght@"))).toBe(true);
    expect(result).not.toContain(b64(LOCAL_FONT_BYTES));
    expect(systemFontLocator.locateSystemFontVariants).not.toHaveBeenCalled();
  });

  it("still embeds a local file when the page has no Google link", async () => {
    const fetchImpl = (async () => new Response("", { status: 400 })) as unknown as typeof fetch;
    const result = await injectDeterministicFontFaces(
      authoredPage(`<style>h1 { font-family: "Hf Authored Fail Test", serif; }</style>`),
      { fetchImpl, allowSystemFontCapture: true },
    );

    expect(result).toContain(b64(LOCAL_FONT_BYTES));
    expect(systemFontLocator.locateSystemFontVariants).toHaveBeenCalledWith(
      "Hf Authored Fail Test",
    );
  });
});
