import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FONT_ALIASES,
  FONT_ALIAS_KEYS,
  _clearGoogleFontCssCacheForTests,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";

describe("existing font-face recognition", () => {
  it.each([
    ['@font-face { font-family: "Existing Font"; src: url(font.woff2); }', false],
    ["@FONT-FACE\n{ FONT-FAMILY : 'EXISTING FONT'; }", false],
    ['@font-face { font-family:\u00a0"Existing Font"; }', false],
    ['@font-face { font-family:; font-family: "Existing Font"; }', false],
    [
      '@font-face { font-family: "Other Font"; } @font-face { font-family: "Existing Font"; }',
      false,
    ],
    ['@font-face { font-family: "Existing Font" }', true],
    ['@font-face { font-family: "Existing Font";', true],
    ['@font-face { font-family: "Other Font"; font-family: "Existing Font"; }', true],
    ['@font-face { font-family:   ; font-family: "Existing Font"; }', true],
  ])("preserves authored font and fallback decisions for %j", async (css, needsFallback) => {
    const html = `<html><head><style>${css}</style></head><body><p style="font-family: 'Existing Font';">Hello</p></body></html>`;
    let requests = 0;
    const fetchImpl = Object.assign(
      async () => {
        requests += 1;
        return new Response("", { status: 404 });
      },
      { preconnect: fetch.preconnect },
    );
    expect(
      await injectDeterministicFontFaces(html, { fetchImpl, allowSystemFontCapture: false }),
    ).toBe(html);
    expect(requests > 0).toBe(needsFallback);
  });

  it.each([
    "@font-face{{".repeat(100_000),
    "@font-face{{font-family:" + " ".repeat(100_000),
    "@font-face{{font-family::;" + "font-family::;".repeat(100_000),
  ])("handles a long incomplete font-face suffix", async (css) => {
    const html = `<html><head><style>${css}</style></head><body>Hello</body></html>`;
    expect(await injectDeterministicFontFaces(html, { allowSystemFontCapture: false })).toBe(html);
  });
});

describe("Google Fonts CSS request caching", () => {
  beforeEach(() => _clearGoogleFontCssCacheForTests());

  it("reuses one CSS lookup across separate compiles requesting the same family", async () => {
    // Same character repertoire (just reordered) so both compute the same
    // Google Fonts `text=` subset and thus the same request URL — isolates
    // the cache from font-text extraction, covered elsewhere.
    const htmlA = `<html><body><p style="font-family: 'Cache Probe Font';">Hello</p></body></html>`;
    const htmlB = `<html><body><p style="font-family: 'Cache Probe Font';">olleH</p></body></html>`;
    let requests = 0;
    const fetchImpl = Object.assign(
      async () => {
        requests += 1;
        return new Response("", { status: 404 });
      },
      { preconnect: fetch.preconnect },
    );
    await injectDeterministicFontFaces(htmlA, { fetchImpl, allowSystemFontCapture: false });
    await injectDeterministicFontFaces(htmlB, { fetchImpl, allowSystemFontCapture: false });
    expect(requests).toBe(1);
  });

  it("does not fail a concurrent caller when another caller sharing the lookup aborts", async () => {
    const prevCacheEnv = process.env.HYPERFRAMES_FONT_CACHE_DIR;
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-font-abort-isolation-"));
    process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
    try {
      const htmlA = `<html><head></head><body><p style="font-family: 'Abort Isolation Font';">Hello</p></body></html>`;
      const htmlB = `<html><head></head><body><p style="font-family: 'Abort Isolation Font';">olleH</p></body></html>`;
      const woff2Url = "https://fonts.gstatic.com/s/abortisolationfont/v1/font.woff2";
      const cssBody =
        `@font-face { font-style: normal; font-weight: 400; ` +
        `src: url(${woff2Url}) format('woff2'); }`;
      let resolveCss: (() => void) | undefined;
      // Mirrors real fetch(): the CSS request rejects if its own `init.signal`
      // aborts, so this proves the shared lookup isn't wired to any one
      // caller's signal. The woff2 request always succeeds immediately —
      // only the shared CSS lookup is under test here.
      const fetchImpl = Object.assign(
        async (url: string, init?: RequestInit) => {
          if (!url.includes("css2")) return new Response(new Uint8Array([0, 1, 2, 3]));
          return new Promise<Response>((resolve, reject) => {
            resolveCss = () => resolve(new Response(cssBody, { status: 200 }));
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          });
        },
        { preconnect: fetch.preconnect },
      );
      const controllerA = new AbortController();
      // A must populate the cache entry first, and both resolve to a real
      // face (not a 404) so failClosedFontFetch's own "unresolved font"
      // check can't confound the result with a leaked abort.
      const resultA = injectDeterministicFontFaces(htmlA, {
        fetchImpl,
        allowSystemFontCapture: false,
        abortSignal: controllerA.signal,
      });
      while (!resolveCss) await new Promise((r) => setTimeout(r, 0));
      const resultB = injectDeterministicFontFaces(htmlB, {
        fetchImpl,
        allowSystemFontCapture: false,
        failClosedFontFetch: true,
      });
      await new Promise((r) => setTimeout(r, 0));

      controllerA.abort();
      resolveCss();

      await expect(resultA).rejects.toThrow();
      expect(await resultB).toContain("@font-face");
    } finally {
      if (prevCacheEnv === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
      else process.env.HYPERFRAMES_FONT_CACHE_DIR = prevCacheEnv;
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

describe("FONT_ALIASES cross-platform coverage", () => {
  it("maps macOS sans-serif system fonts to inter", () => {
    expect(FONT_ALIASES["sf pro"]).toBe("inter");
    expect(FONT_ALIASES["sf pro display"]).toBe("inter");
    expect(FONT_ALIASES["sf pro text"]).toBe("inter");
    expect(FONT_ALIASES["sf pro rounded"]).toBe("inter");
    expect(FONT_ALIASES["avenir"]).toBe("inter");
    expect(FONT_ALIASES["avenir next"]).toBe("inter");
    expect(FONT_ALIASES["geneva"]).toBe("inter");
    expect(FONT_ALIASES["optima"]).toBe("inter");
    expect(FONT_ALIASES["lucida grande"]).toBe("inter");
  });

  it("maps Windows sans-serif system fonts to inter", () => {
    expect(FONT_ALIASES["calibri"]).toBe("inter");
    expect(FONT_ALIASES["candara"]).toBe("inter");
    expect(FONT_ALIASES["corbel"]).toBe("inter");
    expect(FONT_ALIASES["verdana"]).toBe("inter");
    expect(FONT_ALIASES["tahoma"]).toBe("inter");
    expect(FONT_ALIASES["trebuchet ms"]).toBe("inter");
    expect(FONT_ALIASES["lucida sans"]).toBe("inter");
    expect(FONT_ALIASES["lucida sans unicode"]).toBe("inter");
  });

  it("maps Linux sans-serif system fonts to inter", () => {
    expect(FONT_ALIASES["noto sans"]).toBe("inter");
    expect(FONT_ALIASES["dejavu sans"]).toBe("inter");
    expect(FONT_ALIASES["liberation sans"]).toBe("inter");
  });

  it("maps monospace system fonts to jetbrains-mono", () => {
    expect(FONT_ALIASES["sf mono"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["menlo"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["monaco"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["consolas"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["lucida console"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["lucida sans typewriter"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["andale mono"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["dejavu sans mono"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["liberation mono"]).toBe("jetbrains-mono");
  });

  it("maps serif system fonts to eb-garamond", () => {
    expect(FONT_ALIASES["georgia"]).toBe("eb-garamond");
    expect(FONT_ALIASES["palatino"]).toBe("eb-garamond");
    expect(FONT_ALIASES["palatino linotype"]).toBe("eb-garamond");
    expect(FONT_ALIASES["book antiqua"]).toBe("eb-garamond");
    expect(FONT_ALIASES["cambria"]).toBe("eb-garamond");
    expect(FONT_ALIASES["times"]).toBe("eb-garamond");
    expect(FONT_ALIASES["times new roman"]).toBe("eb-garamond");
    expect(FONT_ALIASES["dejavu serif"]).toBe("eb-garamond");
    expect(FONT_ALIASES["liberation serif"]).toBe("eb-garamond");
  });

  it("preserves all existing aliases", () => {
    expect(FONT_ALIASES["helvetica neue"]).toBe("inter");
    expect(FONT_ALIASES["arial"]).toBe("inter");
    expect(FONT_ALIASES["courier new"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["segoe ui"]).toBe("roboto");
    expect(FONT_ALIASES["futura"]).toBe("montserrat");
    expect(FONT_ALIASES["bebas neue"]).toBe("league-gothic");
  });

  it("exports FONT_ALIAS_KEYS containing all alias entries", () => {
    expect(FONT_ALIAS_KEYS).toBeInstanceOf(Set);
    expect(FONT_ALIAS_KEYS.has("sf mono")).toBe(true);
    expect(FONT_ALIAS_KEYS.has("menlo")).toBe(true);
    expect(FONT_ALIAS_KEYS.has("consolas")).toBe(true);
    expect(FONT_ALIAS_KEYS.has("inter")).toBe(true);
    expect(FONT_ALIAS_KEYS.size).toBe(Object.keys(FONT_ALIASES).length);
  });
});
