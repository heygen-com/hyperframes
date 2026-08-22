/**
 * The font cache holds Google Fonts downloads between runs. It is an
 * optimisation: the bytes are still fetchable without it, so losing the place
 * to keep them is a slower render, not a failed one.
 *
 * It used to be fatal. `fontCacheDir` called `mkdirSync` unguarded during
 * compile, so an unwritable cache root threw straight out and a first-time user
 * lost their very first render to
 * `EPERM: operation not permitted, mkdir '<home>/.cache/hyperframes/fonts/inter'`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let lockedRoot: string;
let prevCacheEnv: string | undefined;

const FACE_URL = "https://fonts.gstatic.com/s/inter/v1/inter.woff2";
const FACE_BYTES = "INTER_BYTES";

beforeAll(() => {
  prevCacheEnv = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  lockedRoot = mkdtempSync(join(tmpdir(), "hf-font-locked-"));
  chmodSync(lockedRoot, 0o500);
  // A path *under* a read-only parent: creating it is what fails.
  process.env.HYPERFRAMES_FONT_CACHE_DIR = join(lockedRoot, "nested");
});

afterAll(() => {
  if (prevCacheEnv === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = prevCacheEnv;
  chmodSync(lockedRoot, 0o700);
  rmSync(lockedRoot, { recursive: true, force: true });
});

const fetchImpl = (async (input: unknown) => {
  const url = String(input);
  if (url.startsWith("https://fonts.googleapis.com/")) {
    return new Response(
      `@font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; src: url(${FACE_URL}) format('woff2'); }`,
      { status: 200 },
    );
  }
  if (url === FACE_URL) return new Response(FACE_BYTES, { status: 200 });
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;

const HTML = `<!doctype html><html><head><style>
  h1 { font-family: "Inter"; }
</style></head><body><h1>Upright</h1></body></html>`;

describe("unwritable font cache", () => {
  it("still resolves fonts instead of aborting the render", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");

    const result = await injectDeterministicFontFaces(HTML, {
      allowSystemFontCapture: false,
      fetchImpl,
    });

    // The point: we got here at all. Before the fallback this threw EACCES.
    expect(result).toContain('font-family: "Inter"');
    // And the fetched face still made it in, via the temp-directory cache.
    expect(result).toContain(Buffer.from(FACE_BYTES).toString("base64"));
  });
});
