// @vitest-environment node
// Family spellings that failed distributed renders closed although the browser draws them.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMBEDDED_FONT_DATA } from "./fontData.generated.js";
import {
  _clearGoogleFontCssCacheForTests,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";

const FONT_CACHE_ENV = "HYPERFRAMES_FONT_CACHE_DIR";
const originalFontCache = process.env[FONT_CACHE_ENV];
const fontCache = mkdtempSync(join(tmpdir(), "hf-font-field-families-"));

beforeEach(() => {
  process.env[FONT_CACHE_ENV] = fontCache;
  _clearGoogleFontCssCacheForTests();
});

afterAll(() => {
  rmSync(fontCache, { recursive: true, force: true });
  if (originalFontCache !== undefined) process.env[FONT_CACHE_ENV] = originalFontCache;
  else delete process.env[FONT_CACHE_ENV];
});

// Google Fonts answers 400 for a name it does not know; here it knows none.
const noGoogleFonts = (async () => new Response("", { status: 400 })) as unknown as typeof fetch;

const inject = (html: string) =>
  injectDeterministicFontFaces(html, {
    failClosedFontFetch: true,
    allowSystemFontCapture: false,
    fetchImpl: noGoogleFonts,
  });

const MONTSERRAT_400 = EMBEDDED_FONT_DATA.get("@fontsource/montserrat:400:normal");

describe("field font families under fail-closed", () => {
  it("reads a font shorthand whose weight is a var() ahead of the size", async () => {
    const html = `<html><head><style>
      :root { --font-display: Montserrat, sans-serif; --weight: 700; }
      h1 { font: var(--weight) 1000px/1000px var(--font-display); }
    </style></head><body><h1>hi</h1></body></html>`;

    const out = await inject(html);

    expect(out).toContain('font-family: "Montserrat"');
  });

  it("still takes a lone var() as the size when no literal size follows", async () => {
    const html = `<html><head><style>
      :root { --size: 40px; }
      h1 { font: var(--size) Montserrat; }
    </style></head><body><h1>hi</h1></body></html>`;

    expect(await inject(html)).toContain('font-family: "Montserrat"');
  });

  it("serves a class-style family name from the family it names", async () => {
    const html = `<html><head></head><body>
      <div style="font-family: font-Montserrat-400">hi</div>
    </body></html>`;

    const out = await inject(html);

    expect(MONTSERRAT_400).toBeDefined();
    expect(out).toContain('font-family: "font-Montserrat-400"');
    expect(out).toContain(`url("${MONTSERRAT_400}")`);
  });
});
