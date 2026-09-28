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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { _clearGoogleFontCssCacheForTests } from "./deterministicFonts.js";

beforeEach(() => _clearGoogleFontCssCacheForTests());

let cacheDir: string;
let prevCacheEnv: string | undefined;
const LOCAL_FONT_DIR = join(homedir(), ".local", "share", "fonts");
const LOCAL_FONT_FILE = join(LOCAL_FONT_DIR, "hf-authored-fail-test.woff2");
const LOCAL_FONT_BYTES = "LOCAL_ONLY_BYTES";

beforeAll(() => {
  prevCacheEnv = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "hf-font-cache-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
  mkdirSync(LOCAL_FONT_DIR, { recursive: true });
  writeFileSync(LOCAL_FONT_FILE, LOCAL_FONT_BYTES);
});

afterAll(() => {
  if (prevCacheEnv === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = prevCacheEnv;
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(LOCAL_FONT_FILE, { force: true });
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
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    const result = await injectDeterministicFontFaces(HTML, { fetchImpl: makeGoogleFetch() });

    // Both subsets' distinct bytes must be present — the latin subset must NOT
    // be clobbered by the vietnamese one. (Before the fix, the latin face
    // carried the vietnamese bytes because both shared one cache filename.)
    expect(result).toContain(b64(VIET_BYTES));
    expect(result).toContain(b64(LATIN_BYTES));
  });

  it("preserves each face's unicode-range so the browser picks the right subset per codepoint", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
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
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
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

  it("does not replace a failed link with the weight-only file", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    const { fetchImpl, urls } = authoredFetch(400);
    const result = await injectDeterministicFontFaces(
      authoredPage(
        `<link rel="stylesheet" href="${AUTHORED_HREF}"><style>h1 { font-family: "Fraunces", serif; }</style>`,
      ),
      { fetchImpl, allowSystemFontCapture: false },
    );

    expect(urls.some((url) => url.includes("ital,wght@"))).toBe(false);
    expect(result).not.toContain(b64("FRAUNCES_WIDE"));
    expect(result).not.toContain("data-hyperframes-deterministic-fonts");
  });

  it("still requests by family name when the page has no Google link", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
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

    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
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
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
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
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
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

    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
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
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
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

    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
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

    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    await injectDeterministicFontFaces(
      `<!doctype html><html><head><link rel="stylesheet" href="${href}"><style>p { font-family: "Noto Serif JP", serif; }</style></head><body>${many}</body></html>`,
      { fetchImpl, allowSystemFontCapture: false },
    );

    expect(urls.filter((url) => url.startsWith("https://fonts.googleapis.com/"))).toEqual([href]);
  });

  it("does not embed a local file when the page's link failed", async () => {
    const href = "https://fonts.googleapis.com/css2?family=Hf+Authored+Fail+Test";
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
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

    expect(urls.some((url) => url.includes("ital,wght@"))).toBe(false);
    expect(result).not.toContain(b64(LOCAL_FONT_BYTES));
  });

  it("still embeds a local file when the page has no Google link", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    const fetchImpl = (async () => new Response("", { status: 400 })) as unknown as typeof fetch;
    const result = await injectDeterministicFontFaces(
      authoredPage(`<style>h1 { font-family: "Hf Authored Fail Test", serif; }</style>`),
      { fetchImpl, allowSystemFontCapture: true },
    );

    expect(result).toContain(b64(LOCAL_FONT_BYTES));
  });
});
