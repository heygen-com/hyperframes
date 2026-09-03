import { describe, expect, it } from "bun:test";
import { injectDeterministicFontFaces } from "./deterministicFonts.js";

async function requestedGoogleFontUrl(html: string): Promise<URL> {
  let requestedUrl = "";
  const fetchImpl = (async (input: unknown) => {
    requestedUrl = String(input);
    return new Response("", { status: 400 });
  }) as unknown as typeof fetch;

  await injectDeterministicFontFaces(html, {
    fetchImpl,
    allowSystemFontCapture: false,
  });
  return new URL(requestedUrl);
}

async function subsetTextFor(html: string): Promise<string> {
  const url = await requestedGoogleFontUrl(html);
  return url.searchParams.get("text") ?? "";
}

describe("Google Fonts text subsetting", () => {
  it("sends the composition character set to the CSS API", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html><head><style>
        h1 { font-family: "Noto Performance Test", sans-serif; }
      </style></head><body><h1>旅行ランキング</h1></body></html>`,
    );

    for (const character of new Set("旅行ランキング")) {
      expect(text).toContain(character);
    }
  });

  it("includes decoded HTML entities from visible composition text", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html><head><style>
        h1 { font-family: "Noto Performance Test", sans-serif; }
      </style></head><body><h1>&#x65C5;&#34892;</h1></body></html>`,
    );

    expect(text).toContain("旅行");
  });

  it("includes case variants for transformed supplemental alias weights", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html><head><style>
        h1 { font-family: "Inter", sans-serif; font-weight: 800; text-transform: uppercase; }
      </style></head><body><h1>Your Kidney Transplant:<br/>What Happens Next</h1></body></html>`,
    );

    expect(encodeURIComponent(text).length).toBeLessThan(700);
    for (const character of new Set("YOUR KIDNEY TRANSPLANT:WHAT HAPPENS NEXT")) {
      expect(text).toContain(character);
    }
  });

  it("covers capitalized words through the same case closure", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html><head><style>
        h1 { font-family: "Inter", sans-serif; font-weight: 800; text-transform: capitalize; }
      </style></head><body><h1>hello world</h1></body></html>`,
    );

    expect(text).toContain("H");
    expect(text).toContain("W");
  });

  it("falls back to the full font when case closure exceeds the text URL budget", async () => {
    const caseChangingCharacters = Array.from({ length: 0x500 }, (_, index) =>
      String.fromCodePoint(index),
    )
      .filter((character) => character.toUpperCase() !== character.toLowerCase())
      .slice(0, 300)
      .join("");

    const url = await requestedGoogleFontUrl(
      `<!doctype html><html><head><style>
        p { font-family: "Inter", sans-serif; font-weight: 800; text-transform: uppercase; }
      </style></head><body><p>${caseChangingCharacters}</p></body></html>`,
    );

    expect(url.searchParams.has("text")).toBe(false);
  });

  it("includes Turkish İ and ı when lang=tr is present", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html lang="tr"><head><style>
        h1 { font-family: "Inter", sans-serif; text-transform: uppercase; }
      </style></head><body><h1>istanbul</h1></body></html>`,
    );

    expect(text).toContain("İ");
    expect(text).toContain("ı");
  });

  it("does not include Turkish İ/ı without a Turkish lang attribute", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html lang="en"><head><style>
        h1 { font-family: "Inter", sans-serif; text-transform: uppercase; }
      </style></head><body><h1>istanbul</h1></body></html>`,
    );

    expect(text).not.toContain("İ");
    expect(text).not.toContain("ı");
  });

  it("includes Azeri locale variants when lang=az is present", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html lang="az"><head><style>
        p { font-family: "Inter", sans-serif; }
      </style></head><body><p>iyi</p></body></html>`,
    );

    expect(text).toContain("İ");
    expect(text).toContain("ı");
  });

  it("maps ASCII to fullwidth equivalents when full-width appears in the source", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html><head><style>
        p { font-family: "Noto Performance Test", sans-serif; text-transform: full-width; }
      </style></head><body><p>ABC</p></body></html>`,
    );

    expect(text).toContain("Ａ");
    expect(text).toContain("Ｂ");
    expect(text).toContain("Ｃ");
  });

  it("does not add fullwidth variants without full-width in the source", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html><head><style>
        p { font-family: "Noto Performance Test", sans-serif; }
      </style></head><body><p>ABC</p></body></html>`,
    );

    expect(text).not.toContain("Ａ");
  });

  it("maps small kana to full-size equivalents when full-size-kana appears in the source", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html><head><style>
        p { font-family: "Noto Performance Test", sans-serif; text-transform: full-size-kana; }
      </style></head><body><p>ぁっょ</p></body></html>`,
    );

    expect(text).toContain("あ");
    expect(text).toContain("つ");
    expect(text).toContain("よ");
  });

  it("maps small katakana to full-size when full-size-kana appears in the source", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html><head><style>
        p { font-family: "Noto Performance Test", sans-serif; text-transform: full-size-kana; }
      </style></head><body><p>ァヵ</p></body></html>`,
    );

    expect(text).toContain("ア");
    expect(text).toContain("カ");
  });

  it("stays within the URL budget for a realistic mixed-script composition with all transforms", async () => {
    const latin =
      "The Quick Brown Fox Jumps Over The Lazy Dog — Your Kidney Transplant: What Happens Next";
    const cjk = "旅行ランキング東京大阪京都名古屋福岡";
    const kana = "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ";

    const withTransforms = await subsetTextFor(
      `<!doctype html><html lang="tr"><head><style>
        h1 { font-family: "Noto Performance Test", sans-serif; text-transform: full-width; }
        p { font-family: "Noto Performance Test", sans-serif; text-transform: full-size-kana; }
      </style></head><body><h1>${latin}</h1><p>${cjk}${kana}</p></body></html>`,
    );

    const withoutTransforms = await subsetTextFor(
      `<!doctype html><html lang="tr"><head><style>
        h1 { font-family: "Noto Performance Test", sans-serif; }
        p { font-family: "Noto Performance Test", sans-serif; }
      </style></head><body><h1>${latin}</h1><p>${cjk}${kana}</p></body></html>`,
    );

    const transformCost =
      encodeURIComponent(withTransforms).length - encodeURIComponent(withoutTransforms).length;
    expect(transformCost).toBeLessThan(900);
    expect(encodeURIComponent(withTransforms).length).toBeLessThanOrEqual(1700);
  });

  it("collects lang from nested elements, not just the root", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html lang="en"><head><style>
        p { font-family: "Inter", sans-serif; }
      </style></head><body><p>hello</p><p lang="tr">istanbul</p></body></html>`,
    );

    expect(text).toContain("İ");
    expect(text).toContain("ı");
  });

  it("skips invalid lang attributes without crashing", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html lang="en_US"><head><style>
        p { font-family: "Inter", sans-serif; }
      </style></head><body><p lang="x">hello</p><p lang="123">world</p></body></html>`,
    );

    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("h");
  });

  it("does not trigger fullwidth expansion from a CSS class named full-width", async () => {
    const text = await subsetTextFor(
      `<!doctype html><html><head><style>
        .full-width { font-family: "Noto Performance Test", sans-serif; width: 100%; }
      </style></head><body><div class="full-width">ABC</div></body></html>`,
    );

    expect(text).not.toContain("Ａ");
  });
});
