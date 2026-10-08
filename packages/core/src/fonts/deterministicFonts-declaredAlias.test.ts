// @vitest-environment node
/**
 * Declared-family alias resolution.
 *
 * The bug: an agent wrote `font-family: "Saira ExtraCondensed"` while the same
 * document imported `family=Saira+Extra+Condensed`. Google Fonts answers
 * `Saira ExtraCondensed` with HTTP 400, so the family came out unresolved and a
 * fail-closed compile threw `FontFetchError: Unresolved fonts in fail-closed
 * mode`. To reproduce, compile such a document with `failClosedFontFetch: true`.
 *
 * An unresolved family whose spelling (case, spaces, hyphens, underscores)
 * uniquely matches a family the document declares must resolve to that family,
 * with faces emitted under the AUTHORED name so the authored CSS still matches.
 *
 * `fetchImpl` is injected (no network) and HYPERFRAMES_FONT_CACHE_DIR points
 * at a temp dir, so these tests are hermetic.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMBEDDED_FONT_DATA } from "./fontData.generated.js";
import {
  _clearGoogleFontCssCacheForTests,
  FONT_FETCH_FAILED,
  FontFetchError,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";

const FONT_CACHE_ENV = "HYPERFRAMES_FONT_CACHE_DIR";
const originalFontCache = process.env[FONT_CACHE_ENV];
const fontCache = mkdtempSync(join(tmpdir(), "hf-font-declared-alias-"));

beforeEach(() => {
  process.env[FONT_CACHE_ENV] = fontCache;
  _clearGoogleFontCssCacheForTests();
});

afterAll(() => {
  rmSync(fontCache, { recursive: true, force: true });
  if (originalFontCache !== undefined) process.env[FONT_CACHE_ENV] = originalFontCache;
  else delete process.env[FONT_CACHE_ENV];
});

// Families the fake Google Fonts serves, by exact `family=` name. Anything else
// answers HTTP 400, as the real API does for a name it does not know.
const SERVED_FAMILIES: ReadonlyMap<string, string> = new Map(
  ["Saira Extra Condensed", "Saira", "Open Sans"].map((family) => [
    family,
    `https://fonts.gstatic.com/s/test/v1/${family.toLowerCase().replace(/\s+/g, "-")}.woff2`,
  ]),
);

function fontBytes(family: string): string {
  return `${family.toUpperCase().replace(/\s+/g, "_")}_BYTES`;
}

function dataUriFor(family: string): string {
  return `data:font/woff2;base64,${Buffer.from(fontBytes(family)).toString("base64")}`;
}

function fakeGoogleFonts(queried: string[]): typeof fetch {
  const woff2Owners = new Map([...SERVED_FAMILIES].map(([family, url]) => [url, family]));
  const respond = (input: unknown): Response => {
    const requested = new URL(String(input));
    const owner = woff2Owners.get(requested.href);
    if (owner) return new Response(fontBytes(owner));
    if (requested.hostname !== "fonts.googleapis.com") return new Response("", { status: 404 });
    const families = requested.searchParams
      .getAll("family")
      .flatMap((value) => value.split("|"))
      .map((value) => value.split(":", 1)[0] ?? "");
    queried.push(families[0] ?? "");
    const rules = families.flatMap((family) => {
      const woff2 = SERVED_FAMILIES.get(family);
      return woff2
        ? [
            `@font-face { font-family: "${family}"; font-style: italic; font-weight: 800; src: url(${woff2}) format('woff2'); }`,
          ]
        : [];
    });
    if (rules.length === 0) return new Response("", { status: 400 });
    return new Response(rules.join("\n"));
  };
  return (async (input: unknown) => respond(input)) as unknown as typeof fetch;
}

function htmlWith(head: string, body = "<h1>x</h1>"): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

async function compile(
  html: string,
  failClosedFontFetch = true,
): Promise<{ result: string; queried: string[] }> {
  const queried: string[] = [];
  const result = await injectDeterministicFontFaces(html, {
    failClosedFontFetch,
    allowSystemFontCapture: false,
    fetchImpl: fakeGoogleFonts(queried),
  });
  return { result, queried };
}

async function compileFailure(html: string): Promise<{ error: FontFetchError; queried: string[] }> {
  const queried: string[] = [];
  try {
    await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      allowSystemFontCapture: false,
      fetchImpl: fakeGoogleFonts(queried),
    });
  } catch (error) {
    if (error instanceof FontFetchError) return { error, queried };
    throw error;
  }
  throw new Error("Expected the compile to fail closed");
}

/** The injected block's @font-face rules as { family, src } pairs, in order. */
function injectedFaces(html: string): Array<{ family: string; src: string }> {
  const block = /<style data-hyperframes-deterministic-fonts="true">([\s\S]*?)<\/style>/.exec(
    html,
  )?.[1];
  if (!block) return [];
  return [...block.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => {
    const rule = match[1] ?? "";
    return {
      family: /font-family:\s*"([^"]*)"/.exec(rule)?.[1] ?? "",
      src: /src:\s*url\("?([^")]+)"?\)/.exec(rule)?.[1] ?? "",
    };
  });
}

// Trimmed from the failing composition: the css2 import names the family
// correctly, the scene CSS does not.
const SAIRA_TYPO_HTML = htmlWith(
  `<style>
    @import url('https://fonts.googleapis.com/css2?family=Saira+Extra+Condensed:ital,wght@1,800&family=Inter:wght@400;700&display=swap');
    .title { font-family: "Saira ExtraCondensed", sans-serif; font-style: italic; font-weight: 800; }
  </style>`,
  `<h1 class="title">TREINO</h1>`,
);

describe("declared-family alias resolution", () => {
  it('resolves "Saira ExtraCondensed" to the imported "Saira Extra Condensed" in fail-closed mode', async () => {
    const { result, queried } = await compile(SAIRA_TYPO_HTML);

    // The authored spelling is tried first (400), then the declared family.
    expect(queried).toEqual(["Saira ExtraCondensed", "Saira Extra Condensed"]);

    // Faces carry the AUTHORED name, so `.title` actually matches them — and
    // their bytes are the declared family's.
    const faces = injectedFaces(result);
    expect(faces).toEqual([
      { family: "Saira ExtraCondensed", src: dataUriFor("Saira Extra Condensed") },
    ]);

    // The authored usage is untouched and still names a family with a face.
    expect(result).toContain('font-family: "Saira ExtraCondensed", sans-serif');
    expect(faces.map((face) => face.family)).toContain("Saira ExtraCondensed");
  });

  it("resolves through a legacy css <link> with several families in one param", async () => {
    const { result, queried } = await compile(
      htmlWith(
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Saira+Extra+Condensed:400,800|Roboto+Slab&amp;display=swap">
         <style>h1 { font-family: 'saira-extra_condensed'; }</style>`,
      ),
    );

    expect(queried).toEqual(["saira-extra_condensed", "Saira Extra Condensed"]);
    expect(injectedFaces(result)).toEqual([
      { family: "saira-extra_condensed", src: dataUriFor("Saira Extra Condensed") },
    ]);
  });

  it("re-emits the document's own @font-face under the authored name instead of fetching", async () => {
    const ownSrc = "data:font/woff2;base64,QlJBTkRfU0FOU19PV04=";
    const { result, queried } = await compile(
      htmlWith(`<style>
        @font-face { font-family: "Brand Sans"; src: url("${ownSrc}") format("woff2"); font-weight: 700; }
        h1 { font-family: "BrandSans"; }
      </style>`),
    );

    // Only the authored spelling is looked up; the declared face is reused.
    expect(queried).toEqual(["BrandSans"]);
    const block = /data-hyperframes-deterministic-fonts="true">([\s\S]*?)<\/style>/.exec(
      result,
    )?.[1];
    expect(block).toContain('font-family: "BrandSans"');
    expect(block).toContain(ownSrc);
    expect(block).toContain("font-weight: 700");
    // The original face is left as authored.
    expect(result).toContain('@font-face { font-family: "Brand Sans";');
  });

  it("composes with FONT_ALIASES: a declared bundled family resolves to the bundle", async () => {
    const { result, queried } = await compile(
      htmlWith(`<style>
        @import url("https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700");
        h1 { font-family: "OpenSans"; }
      </style>`),
    );

    // "Open Sans" is a FONT_ALIASES family: bundled faces + canonical supplement.
    expect(queried).toEqual(["OpenSans", "Open Sans"]);
    const bundled = new Set(
      [...EMBEDDED_FONT_DATA]
        .filter(([key]) => key.startsWith("@fontsource/open-sans:"))
        .map(([, uri]) => uri),
    );
    const faces = injectedFaces(result);
    expect(faces.every((face) => face.family === "OpenSans")).toBe(true);
    expect(faces.filter((face) => bundled.has(face.src)).length).toBe(bundled.size);
  });

  it("keeps two different declared families apart", async () => {
    const { result, queried } = await compile(
      htmlWith(
        `<style>
          @import url('https://fonts.googleapis.com/css2?family=Saira:wght@400&family=Saira+Extra+Condensed:ital,wght@1,800');
          h1 { font-family: "Saira ExtraCondensed"; }
          p { font-family: "Saira"; }
        </style>`,
        "<h1>x</h1><p>y</p>",
      ),
    );

    // The authored Google stylesheet serves both declared names in one request.
    expect(queried).toEqual(["Saira ExtraCondensed", "Saira"]);
    expect(injectedFaces(result)).toEqual([
      { family: "Saira ExtraCondensed", src: dataUriFor("Saira Extra Condensed") },
      { family: "Saira", src: dataUriFor("Saira") },
    ]);
  });

  it("leaves a document whose families already resolve unchanged by the alias pass", async () => {
    const { result, queried } = await compile(
      htmlWith(`<style>
        @import url('https://fonts.googleapis.com/css2?family=Saira+Extra+Condensed');
        h1 { font-family: "Saira Extra Condensed"; }
      </style>`),
    );

    expect(queried).toEqual(["Saira Extra Condensed"]);
    expect(injectedFaces(result)).toEqual([
      { family: "Saira Extra Condensed", src: dataUriFor("Saira Extra Condensed") },
    ]);
  });

  it("resolves the typo in fail-open mode too", async () => {
    const { result } = await compile(SAIRA_TYPO_HTML, false);

    expect(injectedFaces(result).map((face) => face.family)).toContain("Saira ExtraCondensed");
  });

  it.each([
    ["an optional var() fallback", true],
    ["a required family", false],
  ])("keeps %s transient-failure policy after alias lookup", async (_case, optional) => {
    const html = htmlWith(`<style>
      @import url("https://fonts.googleapis.com/css2?family=Saira+Extra+Condensed");
      h1 { font-family: ${optional ? 'var(--brand, "Saira ExtraCondensed")' : '"Saira ExtraCondensed"'}; }
    </style>`);
    const requests: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      requests.push(url);
      return new Response("", { status: url.includes("Saira%20ExtraCondensed") ? 400 : 503 });
    }) as unknown as typeof fetch;
    const localize = () =>
      injectDeterministicFontFaces(html, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl,
        fontFetchRetryPolicy: { baseDelayMs: 0, maxAttempts: 3 },
      });

    if (optional) {
      expect(await localize()).toBe(html);
      expect(requests).toHaveLength(3);
    } else {
      await expect(localize()).rejects.toMatchObject({ code: "FONT_FETCH_UNAVAILABLE" });
      expect(requests).toHaveLength(4);
    }
  });
});

describe("declared-family alias resolution — still unresolved", () => {
  it.each([
    [
      "a truly unknown family",
      `@import url('https://fonts.googleapis.com/css2?family=Saira+Extra+Condensed');
       h1 { font-family: "Totally Unknown Face", sans-serif; }`,
      "Totally Unknown Face",
    ],
    [
      // Both declared names collapse to "sairaextracondensed".
      "an ambiguous spelling",
      `@import url('https://fonts.googleapis.com/css2?family=Saira+Extra+Condensed&family=Saira+ExtraCondensed');
       h1 { font-family: "SairaExtraCondensed"; }`,
      "SairaExtraCondensed",
    ],
    [
      // Declared as written (Google has no such family), so the near-spelling
      // "Saira Extra Condensed" must not be substituted.
      "a family the document declares verbatim",
      `@import url('https://fonts.googleapis.com/css2?family=Saira+ExtraCondensed');
       @import url('https://fonts.googleapis.com/css2?family=Saira+Extra+Condensed');
       h1 { font-family: "Saira ExtraCondensed"; }`,
      "Saira ExtraCondensed",
    ],
    [
      "a declaration from a stylesheet that is not Google Fonts",
      `@import url('https://cdn.example.com/css2?family=Saira+Extra+Condensed');
       @import url('/css2?family=Saira+Extra+Condensed');
       h1 { font-family: "Saira ExtraCondensed"; }`,
      "Saira ExtraCondensed",
    ],
  ])("fails closed for %s", async (_case, css, authored) => {
    const { error, queried } = await compileFailure(htmlWith(`<style>${css}</style>`));

    expect(error.code).toBe(FONT_FETCH_FAILED);
    expect(error.familyName).toBe(authored);
    expect(error.unresolvedFamilies).toEqual([authored]);
    // Nothing but the authored spelling was ever looked up.
    expect(new Set(queried)).toEqual(new Set([authored]));
  });
});

describe("declared-family aliases preserve stylesheet conditions", () => {
  const googleUrl = "https://fonts.googleapis.com/css2?family=Saira+Extra+Condensed";
  it.each([
    [
      "style media on a face",
      '<style media="print">@font-face { font-family: "Saira Extra Condensed"; src: url("data:font/woff2;base64,QlJBTkQ="); }</style>',
    ],
    ["style media on an import", `<style media="print">@import url("${googleUrl}");</style>`],
    [
      "nested media face",
      '<style>@media print { @font-face { font-family: "Saira Extra Condensed"; src: url("data:font/woff2;base64,QlJBTkQ="); } }</style>',
    ],
    [
      "nested supports import",
      `<style>@supports (display: grid) { @import url("${googleUrl}"); }</style>`,
    ],
    ["import media", `<style>@import url("${googleUrl}") print;</style>`],
    ["quoted import media", `<style>@import "${googleUrl}" print;</style>`],
    ["import supports", `<style>@import url("${googleUrl}") supports(display: grid);</style>`],
    ["import layer", `<style>@import url("${googleUrl}") layer(brand);</style>`],
    ["link media", `<link rel="stylesheet" media="print" href="${googleUrl}">`],
    ["alternate link", `<link rel="alternate stylesheet" title="Brand" href="${googleUrl}">`],
    ["disabled link", `<link rel="stylesheet" disabled href="${googleUrl}">`],
    ["non-stylesheet link", `<link rel="preload" href="${googleUrl}">`],
    ["non-CSS style", `<style type="text/plain">@import url("${googleUrl}");</style>`],
    ["non-CSS link", `<link rel="stylesheet" type="text/plain" href="${googleUrl}">`],
    ["titled style", `<style title="Brand">@import url("${googleUrl}");</style>`],
    ["titled link", `<link rel="stylesheet" title="Brand" href="${googleUrl}">`],
  ])("ignores %s as an unconditional alias source", async (_case, declaration) => {
    const html = htmlWith(
      `${declaration}<style>h1 { font-family: "Saira ExtraCondensed"; }</style>`,
    );
    const { error, queried } = await compileFailure(html);
    expect(error.unresolvedFamilies).toEqual(["Saira ExtraCondensed"]);
    expect(queried).toEqual(["Saira ExtraCondensed"]);
    const { result } = await compile(html, false);
    expect(injectedFaces(result)).toEqual([]);
  });

  it.each([
    `<style media="all" type="text/css">@import url("${googleUrl}");</style>`,
    `<link rel="stylesheet" media="all" type="text/css" href="${googleUrl}">`,
    `<style>@import "${googleUrl}" all;</style>`,
  ])("accepts an unconditional stylesheet: %s", async (declaration) => {
    const { result } = await compile(
      htmlWith(`${declaration}<style>h1 { font-family: "Saira ExtraCondensed"; }</style>`),
    );
    expect(injectedFaces(result)).toEqual([
      { family: "Saira ExtraCondensed", src: dataUriFor("Saira Extra Condensed") },
    ]);
  });
});
