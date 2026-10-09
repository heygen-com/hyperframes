// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _clearGoogleFontCssCacheForTests,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";

const previousCacheDir = process.env.HYPERFRAMES_FONT_CACHE_DIR;
const cacheDir = mkdtempSync(join(tmpdir(), "hf-bundled-stylesheet-"));
const fetchMock = vi.spyOn(globalThis, "fetch");

afterEach(() => {
  fetchMock.mockRestore();
  _clearGoogleFontCssCacheForTests();
  if (previousCacheDir === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = previousCacheDir;
  rmSync(cacheDir, { recursive: true, force: true });
});

it("supplements bundled fonts with real italics even when the page imports only normal", async () => {
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
  _clearGoogleFontCssCacheForTests();
  const italicUrl = "https://fonts.gstatic.com/s/ebgaramond/italic.woff2";
  const normalUrl = "https://fonts.gstatic.com/s/ebgaramond/normal.woff2";
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("https://fonts.googleapis.com/")) {
      const italic = url.includes("ital,wght@");
      return new Response(`@font-face {
        font-family: 'EB Garamond';
        font-style: ${italic ? "italic" : "normal"};
        font-weight: 400;
        src: url(${italic ? italicUrl : normalUrl}) format('woff2');
        unicode-range: U+0000-00FF;
      }`);
    }
    if (url === italicUrl) return new Response("REAL_ITALIC_FONT");
    if (url === normalUrl) return new Response("NORMAL_FONT");
    return new Response("", { status: 404 });
  });

  const result = await injectDeterministicFontFaces(`<!doctype html><html><head><style>
    @import url("https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400&display=swap");
    p { font-family: "EB Garamond", serif; font-style: italic; }
  </style></head><body><p>lack technical skills</p></body></html>`);

  const italicFace = result.match(/@font-face\s*\{[^}]*font-style: italic[^}]*\}/)?.[0];
  expect(italicFace).toBeDefined();
  expect(italicFace).toContain('font-family: "EB Garamond"');
  expect(italicFace).toContain(Buffer.from("REAL_ITALIC_FONT").toString("base64"));
});
