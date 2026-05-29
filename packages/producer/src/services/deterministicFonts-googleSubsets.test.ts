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

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cacheDir: string;
let prevCacheEnv: string | undefined;

beforeAll(() => {
  prevCacheEnv = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "hf-font-cache-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
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
