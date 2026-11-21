// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _clearGoogleFontCssCacheForTests,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";

let cacheDir: string;
let prevCacheEnv: string | undefined;

beforeAll(() => {
  prevCacheEnv = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "hf-font-chunks-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
});

afterAll(() => {
  if (prevCacheEnv === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = prevCacheEnv;
  rmSync(cacheDir, { recursive: true, force: true });
});

beforeEach(() => _clearGoogleFontCssCacheForTests());

// 600 distinct CJK ideographs encode to ~5.4 KB, past one text= request's budget.
const CJK = Array.from({ length: 600 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join(
  "",
);
const PAGE = `<!doctype html><html><head><style>
  h1 { font-family: "Hf Chunk Test", serif; }
</style></head><body><h1>${CJK}</h1></body></html>`;

// Google answers a text= request with one face per weight and no unicode-range.
function googleFetch(): { fetchImpl: typeof fetch; cssUrls: URL[] } {
  const cssUrls: URL[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname === "/css2") {
      cssUrls.push(url);
      const id = cssUrls.length;
      return new Response(
        `@font-face { font-family: 'Hf Chunk Test'; font-style: normal; font-weight: 400;
  src: url(https://fonts.gstatic.com/l/font?kit=chunk${id}) format('woff2'); }`,
        { status: 200 },
      );
    }
    if (url.hostname === "fonts.gstatic.com") {
      return new Response(`BYTES-${url.searchParams.get("kit")}`, { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, cssUrls };
}

function codePointsOf(range: string): Set<number> {
  const points = new Set<number>();
  for (const part of range.split(",")) {
    const [start, end] = part.trim().replace(/^U\+/i, "").split("-");
    const from = Number.parseInt(start!, 16);
    const to = end === undefined ? from : Number.parseInt(end, 16);
    for (let point = from; point <= to; point += 1) points.add(point);
  }
  return points;
}

describe("Google Fonts text= past one request's budget", () => {
  it("never requests the whole family: every CSS request carries a bounded text=", async () => {
    const { fetchImpl, cssUrls } = googleFetch();
    await injectDeterministicFontFaces(PAGE, { fetchImpl, allowSystemFontCapture: false });

    expect(cssUrls.length).toBeGreaterThan(1);
    for (const url of cssUrls) {
      const text = url.searchParams.get("text");
      expect(text).not.toBeNull();
      expect(encodeURIComponent(text!).length).toBeLessThanOrEqual(1_700);
    }
    const requested = new Set(cssUrls.flatMap((url) => [...url.searchParams.get("text")!]));
    for (const character of CJK) expect(requested.has(character)).toBe(true);
  });

  it("gives each request's face the codepoints it was asked for, so faces never shadow each other", async () => {
    const { fetchImpl, cssUrls } = googleFetch();
    const html = await injectDeterministicFontFaces(PAGE, {
      fetchImpl,
      allowSystemFontCapture: false,
    });

    const faces = html
      .split("@font-face")
      .slice(1)
      .filter((block) => block.includes("Hf Chunk Test"));
    expect(faces.length).toBe(cssUrls.length);
    const owners = new Map<number, number>();
    faces.forEach((face) => {
      const range = /unicode-range:\s*([^;}]+)/.exec(face)?.[1];
      expect(range).toBeDefined();
      for (const point of codePointsOf(range!)) owners.set(point, (owners.get(point) ?? 0) + 1);
    });
    for (const character of CJK) expect(owners.get(character.codePointAt(0)!)).toBe(1);
  });

  function faceOwning(html: string, character: string): number {
    const faces = html
      .split("@font-face")
      .slice(1)
      .filter((block) => block.includes("Hf Chunk Test"));
    return faces.findIndex((face) => {
      const range = /unicode-range:\s*([^;}]+)/.exec(face)?.[1];
      return range !== undefined && codePointsOf(range).has(character.codePointAt(0)!);
    });
  }

  async function render(body: string, style = "") {
    const { fetchImpl, cssUrls } = googleFetch();
    const html = await injectDeterministicFontFaces(
      `<!doctype html><html><head><style>h1 { font-family: "Hf Chunk Test", serif;${style} }</style></head><body><h1>${body}</h1></body></html>`,
      { fetchImpl, allowSystemFontCapture: false },
    );
    return { html, cssUrls };
  }

  it("keeps characters that shape together in one face: Arabic lam-alef beside 600 CJK", async () => {
    const { html, cssUrls } = await render(`ل${CJK}ا`);

    expect(cssUrls.length).toBeGreaterThan(1);
    const lam = faceOwning(html, "ل");
    expect(lam).toBeGreaterThanOrEqual(0);
    expect(faceOwning(html, "ا")).toBe(lam);
    expect(faceOwning(html, "a")).toBe(lam);
  });

  it("keeps an ideograph with the variation selector that follows it", async () => {
    const { html } = await render(`${CJK}葛\u{E0100}`);

    const ideograph = faceOwning(html, "葛");
    expect(ideograph).toBeGreaterThanOrEqual(0);
    expect(faceOwning(html, "\u{E0100}")).toBe(ideograph);
  });

  it("asks for the whole family, as before, when characters that must share a face overflow one request", async () => {
    const cyrillic = Array.from({ length: 400 }, (_, index) =>
      String.fromCodePoint(0x0400 + index),
    ).join("");
    const { cssUrls } = await render(cyrillic);

    expect(cssUrls.map((url) => url.searchParams.has("text"))).toEqual([false]);
  });

  it.each([
    ["Hangul syllable + trailing jamo", "\uAC00\u11A8", "\uAC01"],
    ["Latin + combining acute", "a\u0301", "\u00E1"],
    ["kana + combining dakuten", "\u30AB\u3099", "\u30AC"],
    ["half-width kana + dakuten", "\uFF76\uFF9E", "\uFF76"],
  ])(
    "keeps a composing cluster and its composed form in one face: %s",
    async (_, cluster, composed) => {
      const { html } = await render(`${CJK}${cluster}`);

      const owner = faceOwning(html, [...cluster][0]!);
      expect(owner).toBeGreaterThanOrEqual(0);
      for (const character of [...cluster, composed])
        expect(faceOwning(html, character)).toBe(owner);
    },
  );

  it.each([
    ["uppercase", "a\u0301", "\u00C1"],
    ["lowercase", "A\u0301", "\u00E1"],
  ])(
    "keeps the %s composed form of a cluster in its face",
    async (transform, cluster, composed) => {
      const { html } = await render(`${CJK}${cluster}`, ` text-transform: ${transform};`);

      const owner = faceOwning(html, [...cluster][0]!);
      expect(owner).toBeGreaterThanOrEqual(0);
      expect(faceOwning(html, composed)).toBe(owner);
    },
  );

  it("asks for the whole family when a text-transform draws characters the page does not contain", async () => {
    const { cssUrls } = await render(CJK, " text-transform: full-width;");

    expect(cssUrls.map((url) => url.searchParams.has("text"))).toEqual([false]);
  });
});
