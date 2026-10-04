// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _clearGoogleFontCssCacheForTests,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";

let cacheDir: string;
let previousCacheDir: string | undefined;
let restoreFetch: (() => void) | undefined;

beforeEach(() => {
  previousCacheDir = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "hf-oblique-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
  _clearGoogleFontCssCacheForTests();
});

afterEach(() => {
  restoreFetch?.();
  _clearGoogleFontCssCacheForTests();
  if (previousCacheDir === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = previousCacheDir;
  rmSync(cacheDir, { recursive: true, force: true });
});

it.each(["oblique", "oblique 10deg", "oblique 0deg 10deg", "oblique -12.5deg 2.5deg"])(
  "embeds every subset of an authored %s face in fail-closed mode",
  async (style) => {
    const subsets = ["U+0000-00FF", "U+0100-017F"];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://fonts.googleapis.com/")) {
        return new Response(
          subsets
            .map(
              (unicodeRange, index) => `@font-face {
          font-family: 'Roboto Flex'; font-style: ${style}; font-weight: 100 1000;
          src: url(https://fonts.gstatic.com/oblique-${index}.woff2) format('woff2');
          unicode-range: ${unicodeRange};
        }`,
            )
            .join("\n"),
        );
      }
      return new Response(url);
    });
    restoreFetch = () => fetchMock.mockRestore();
    const html = `<html><head><link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Roboto+Flex:slnt,wght@-10..0,100..1000">
      <style>p { font-family: 'Roboto Flex'; }</style></head><body><p>hello Ā</p></body></html>`;
    const result = await injectDeterministicFontFaces(html, { failClosedFontFetch: true });
    const faces = result.match(/@font-face\s*\{[^}]+\}/g) ?? [];
    expect(faces).toHaveLength(2);
    for (const [index, face] of faces.entries()) {
      expect(face).toContain(`font-style: ${style};`);
      expect(face).toContain("font-weight: 100 1000;");
      expect(face).toContain(`unicode-range: ${subsets[index]};`);
      expect(face).toContain(
        Buffer.from(`https://fonts.gstatic.com/oblique-${index}.woff2`).toString("base64"),
      );
    }
  },
);
