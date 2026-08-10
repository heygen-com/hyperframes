/**
 * Regression test for cross-typeface alias supplementation.
 *
 * A family in FONT_ALIAS_MAP resolves to a canonical bundled typeface — e.g.
 * `Noto Sans` → Inter. `buildFontFaceCss` emits the canonical's embedded faces
 * under the authored family name, then queries Google Fonts to fill the weights
 * and styles the bundle lacks.
 *
 * The bug: that supplementary query used the *authored* name, so a
 * cross-typeface alias regained faces from the very typeface the alias exists to
 * replace. No canonical bundle ships an italic face, so every italic Google
 * served for the authored name was injected — `Noto Sans` came out as Inter
 * upright plus real Noto Sans italic, two typefaces under one `font-family`.
 *
 * These tests inject `fetchImpl` (no network) and a temp `HYPERFRAMES_FONT_CACHE_DIR`
 * so they are hermetic.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMBEDDED_FONT_DATA } from "./fontData.generated.js";

let cacheDir: string;
let prevCacheEnv: string | undefined;

beforeAll(() => {
  prevCacheEnv = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "hf-font-alias-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
});

afterAll(() => {
  if (prevCacheEnv === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = prevCacheEnv;
  rmSync(cacheDir, { recursive: true, force: true });
});

// One woff2 per typeface Google could serve, with identifiable bodies so every
// injected `src` can be traced back to the family that was queried.
const SERVED_FACES: Record<string, { url: string; bytes: string }> = {
  Inter: {
    url: "https://fonts.gstatic.com/s/inter/v1/inter-supplement.woff2",
    bytes: "INTER_FETCHED_BYTES",
  },
  "Noto Sans": {
    url: "https://fonts.gstatic.com/s/notosans/v1/notosans-supplement.woff2",
    bytes: "NOTO_SANS_FETCHED_BYTES",
  },
  Montserrat: {
    url: "https://fonts.gstatic.com/s/montserrat/v1/montserrat-supplement.woff2",
    bytes: "MONTSERRAT_FETCHED_BYTES",
  },
};

const b64 = (s: string) => Buffer.from(s).toString("base64");

// 300 normal + 400 italic: no CANONICAL_FONTS bundle ships either, so both are
// classified "missing from the bundle" and injected.
function cssFor(family: string): string {
  const url = SERVED_FACES[family]?.url;
  if (!url) return "";
  return `@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: 300;
  src: url(${url}) format('woff2');
}
@font-face {
  font-family: '${family}';
  font-style: italic;
  font-weight: 400;
  src: url(${url}) format('woff2');
}`;
}

function makeGoogleFetch(queriedFamilies: string[]): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("https://fonts.googleapis.com/")) {
      const family = new URL(url).searchParams.get("family")?.split(":", 1)[0] ?? "";
      queriedFamilies.push(family);
      return new Response(cssFor(family), { status: 200 });
    }
    const served = Object.values(SERVED_FACES).find((face) => face.url === url);
    if (served) return new Response(served.bytes, { status: 200 });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

function htmlRequesting(family: string): string {
  return `<!doctype html><html><head><style>
  h1 { font-family: "${family}"; }
</style></head><body><h1>Upright</h1></body></html>`;
}

function injectedSrcs(html: string): string[] {
  return [...html.matchAll(/src:\s*url\("([^"]+)"\)/g)].map((match) => match[1] ?? "");
}

function bundledUris(packageName: string): Set<string> {
  return new Set(
    [...EMBEDDED_FONT_DATA]
      .filter(([key]) => key.startsWith(`${packageName}:`))
      .map(([, uri]) => uri),
  );
}

describe("aliased font-family supplementation", () => {
  it("supplements a cross-typeface alias from the canonical family", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    const queriedFamilies: string[] = [];
    const result = await injectDeterministicFontFaces(htmlRequesting("Noto Sans"), {
      allowSystemFontCapture: false,
      fetchImpl: makeGoogleFetch(queriedFamilies),
    });

    // "Noto Sans" aliases to Inter, so the supplementary query asks for Inter.
    expect(queriedFamilies).toEqual(["Inter"]);

    // The authored spelling still names the family, so authored CSS keeps matching.
    expect(result).toContain('font-family: "Noto Sans"');

    // Every injected face is Inter — either the embedded bundle or the Inter
    // fetch. None carry the real Noto Sans the alias exists to replace.
    const canonicalUris = bundledUris("@fontsource/inter");
    canonicalUris.add(`data:font/woff2;base64,${b64(SERVED_FACES.Inter!.bytes)}`);
    const srcs = injectedSrcs(result);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(canonicalUris.has(src)).toBe(true);
    expect(result).not.toContain(b64(SERVED_FACES["Noto Sans"]!.bytes));
  });

  it("collapses a variable font's shared source into one weight-range rule", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    // Google serves Inter as a variable font: one woff2 for every static weight.
    const sharedUrl = "https://fonts.gstatic.com/s/inter/v1/inter-variable.woff2";
    const css = [100, 200, 300, 500]
      .map(
        (weight) => `@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: ${weight};
  src: url(${sharedUrl}) format('woff2');
}`,
      )
      .join("\n");
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("https://fonts.googleapis.com/"))
        return new Response(css, { status: 200 });
      if (url === sharedUrl) return new Response("INTER_VARIABLE_BYTES", { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await injectDeterministicFontFaces(htmlRequesting("Noto Sans"), {
      allowSystemFontCapture: false,
      fetchImpl,
    });

    // One rule spanning the run, not four rules carrying the same blob.
    const variableUri = `data:font/woff2;base64,${b64("INTER_VARIABLE_BYTES")}`;
    // 100-300 collapse into one rule; 500 stays separate because the bundle
    // serves 400 and a 100-500 range would shadow that embedded face.
    const occurrences = result.split(variableUri).length - 1;
    expect(occurrences).toBe(2);
    expect(result).toContain("font-weight: 100 300;");
    expect(result).toContain("font-weight: 500;");
  });

  it("collapses shared sources when Google interleaves subsets without text=", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    // Without `text=` Google orders the response weight-major, subset-minor,
    // so the faces sharing one variable source are never adjacent.
    const latinUrl = "https://fonts.gstatic.com/s/inter/v1/inter-latin-variable.woff2";
    const latinExtUrl = "https://fonts.gstatic.com/s/inter/v1/inter-latinext-variable.woff2";
    const LATIN = "U+0000-00FF";
    const LATIN_EXT = "U+0100-024F";
    const subsets = [
      { url: latinUrl, range: LATIN },
      { url: latinExtUrl, range: LATIN_EXT },
    ];
    const css = [100, 200, 300, 500]
      .flatMap((weight) =>
        subsets.map(
          (subset) => `@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: ${weight};
  src: url(${subset.url}) format('woff2');
  unicode-range: ${subset.range};
}`,
        ),
      )
      .join("\n");

    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("https://fonts.googleapis.com/")) {
        // The request must not carry `text=`, or Google would return one
        // subset and the interleaving under test would not occur.
        expect(new URL(url).searchParams.get("text")).toBeNull();
        return new Response(css, { status: 200 });
      }
      if (url === latinUrl) return new Response("LATIN_VARIABLE_BYTES", { status: 200 });
      if (url === latinExtUrl) return new Response("LATINEXT_VARIABLE_BYTES", { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    // Enough unique characters that extractGoogleFontsText exceeds its budget
    // and returns undefined, which is what drops `text=` in production.
    const manyUniqueChars = Array.from({ length: 400 }, (_, index) =>
      String.fromCodePoint(0x4e00 + index),
    ).join("");
    const html = `<!doctype html><html><head><style>
  h1 { font-family: "Noto Sans"; }
</style></head><body><h1>${manyUniqueChars}</h1></body></html>`;

    const result = await injectDeterministicFontFaces(html, {
      allowSystemFontCapture: false,
      fetchImpl,
    });

    // Per subset: 100-300 collapse into one rule, 500 stays separate because
    // the bundle covers 400. Two rules per subset, not one per weight.
    for (const bytes of ["LATIN_VARIABLE_BYTES", "LATINEXT_VARIABLE_BYTES"]) {
      const uri = `data:font/woff2;base64,${b64(bytes)}`;
      expect(result.split(uri).length - 1).toBe(2);
    }
    expect(result.split("font-weight: 100 300;").length - 1).toBe(2);
    expect(result.split("font-weight: 500;").length - 1).toBe(2);
  });

  it("keeps overlapping subsets in response order when collapsing", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    // Real Google output has codepoints in more than one subset (U+0304 and
    // friends). Overlapping `unicode-range` rules resolve last-defined-first,
    // so collapsing must not move a subset ahead of one declared after it.
    const firstUrl = "https://fonts.gstatic.com/s/inter/v1/inter-first.woff2";
    const secondUrl = "https://fonts.gstatic.com/s/inter/v1/inter-second.woff2";
    const OVERLAPPING = "U+0000-00FF, U+0304";
    const css = [100, 200, 500]
      .flatMap((weight) =>
        [
          { url: firstUrl, range: "U+0000-00FF" },
          { url: secondUrl, range: OVERLAPPING },
        ].map(
          (subset) => `@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: ${weight};
  src: url(${subset.url}) format('woff2');
  unicode-range: ${subset.range};
}`,
        ),
      )
      .join("\n");

    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("https://fonts.googleapis.com/"))
        return new Response(css, { status: 200 });
      if (url === firstUrl) return new Response("FIRST_BYTES", { status: 200 });
      if (url === secondUrl) return new Response("SECOND_BYTES", { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await injectDeterministicFontFaces(htmlRequesting("Noto Sans"), {
      allowSystemFontCapture: false,
      fetchImpl,
    });

    // 100-200 and 500 are separate runs per source because the bundle covers
    // 400, so each source is emitted twice. The interleaving must survive
    // collapsing: source-major grouping would emit FIRST, FIRST, SECOND, SECOND
    // and hand the shared codepoints to the wrong subset.
    const order = [...result.matchAll(/base64,([A-Za-z0-9+/=]+)/g)]
      .map((match) => match[1] ?? "")
      .filter((data) => data === b64("FIRST_BYTES") || data === b64("SECOND_BYTES"))
      .map((data) => (data === b64("FIRST_BYTES") ? "FIRST" : "SECOND"));
    expect(order).toEqual(["FIRST", "SECOND", "FIRST", "SECOND"]);
  });

  it("has a canonical display name for every alias target", async () => {
    const { FONT_ALIAS_MAP, resolveAliasDisplayName } =
      await import("@hyperframes/core/fonts/aliases");
    // The supplementary fetch is skipped outright when this lookup fails, so
    // every alias must resolve or its family silently loses Google's weights.
    for (const alias of Object.keys(FONT_ALIAS_MAP)) {
      expect(resolveAliasDisplayName(alias)).toBeString();
    }
  });

  it("still supplements a self-referencing alias from its own family", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    const queriedFamilies: string[] = [];
    const result = await injectDeterministicFontFaces(htmlRequesting("Montserrat"), {
      allowSystemFontCapture: false,
      fetchImpl: makeGoogleFetch(queriedFamilies),
    });

    expect(queriedFamilies).toEqual(["Montserrat"]);
    expect(result).toContain(b64(SERVED_FACES.Montserrat!.bytes));
  });
});
