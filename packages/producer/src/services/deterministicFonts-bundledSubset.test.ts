/**
 * Regression test for the coverage a bundled face claims.
 *
 * `scripts/generate-font-data.ts` embeds the `-latin-` subset file of every
 * canonical family, so an embedded face carries only Google's `latin` subset.
 * The emitted `@font-face` used to omit `unicode-range` — advertising full
 * coverage — and the supplementary Google fetch then skipped every subset of a
 * weight the bundle "covered". A bundled family therefore could not render the
 * scripts its own subset omits: `Noto Sans JP` weight 400 carries 218
 * codepoints with no kana and no kanji.
 *
 * These tests inject `fetchImpl` (no network) and a temp
 * `HYPERFRAMES_FONT_CACHE_DIR` so they are hermetic.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cacheDir: string;
let prevCacheEnv: string | undefined;

beforeAll(() => {
  prevCacheEnv = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "hf-font-subset-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
});

afterAll(() => {
  if (prevCacheEnv === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = prevCacheEnv;
  rmSync(cacheDir, { recursive: true, force: true });
});

const LATIN_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, " +
  "U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const JAPANESE_RANGE = "U+3041-3096, U+30A0-30FF, U+4E00-9FFF";

const LATIN_URL = "https://fonts.gstatic.com/s/notosansjp/v1/notosansjp-latin.woff2";
const JAPANESE_URL = "https://fonts.gstatic.com/s/notosansjp/v1/notosansjp-japanese.woff2";

// Weight 400 is in the embedded bundle; Google serves it as two subset faces.
const GOOGLE_CSS = `@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 400;
  src: url(${JAPANESE_URL}) format('woff2');
  unicode-range: ${JAPANESE_RANGE};
}
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 400;
  src: url(${LATIN_URL}) format('woff2');
  unicode-range: ${LATIN_RANGE};
}`;

const googleFetch = (async (input: unknown) => {
  const url = String(input);
  if (url.startsWith("https://fonts.googleapis.com/")) {
    return new Response(GOOGLE_CSS, { status: 200 });
  }
  if (url === JAPANESE_URL) return new Response("JAPANESE_SUBSET_BYTES", { status: 200 });
  if (url === LATIN_URL) return new Response("LATIN_SUBSET_BYTES", { status: 200 });
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;

const HTML = `<!doctype html><html><head><style>
  h1 { font-family: "Noto Sans JP"; }
</style></head><body><h1>日本語</h1></body></html>`;

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("bundled subset coverage", () => {
  it("declares the bundle's subset and keeps the subsets it omits", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    const result = await injectDeterministicFontFaces(HTML, {
      allowSystemFontCapture: false,
      fetchImpl: googleFetch,
    });

    // Every emitted face declares a unicode-range: none claims full coverage.
    const faces = result.match(/@font-face \{[\s\S]*?\}/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) expect(face).toContain("unicode-range:");

    // The embedded faces declare the latin subset they actually ship.
    expect(result).toContain(`unicode-range: ${LATIN_RANGE};`);

    // Weight 400 is in the bundle, but its Japanese subset is still injected —
    // otherwise a family documented as CJK cannot render Japanese.
    expect(result).toContain(b64("JAPANESE_SUBSET_BYTES"));
    expect(result).toContain(`unicode-range: ${JAPANESE_RANGE};`);

    // The latin face for that same weight is still skipped: the bundle has it.
    expect(result).not.toContain(b64("LATIN_SUBSET_BYTES"));
  });
});
