import { describe, expect, it } from "bun:test";
import { injectDeterministicFontFaces } from "./deterministicFonts.js";

describe("Google Fonts text subsetting", () => {
  it("sends the composition character set to the CSS API", async () => {
    let requestedUrl = "";
    const fetchImpl = (async (input: unknown) => {
      requestedUrl = String(input);
      return new Response("", { status: 400 });
    }) as unknown as typeof fetch;

    await injectDeterministicFontFaces(
      `<!doctype html><html><head><style>
        h1 { font-family: "Noto Performance Test", sans-serif; }
      </style></head><body><h1>旅行ランキング</h1></body></html>`,
      { fetchImpl, allowSystemFontCapture: false },
    );

    const url = new URL(requestedUrl);
    const text = url.searchParams.get("text") ?? "";
    for (const character of new Set("旅行ランキング")) {
      expect(text).toContain(character);
    }
  });

  it("includes decoded HTML entities from visible composition text", async () => {
    let requestedUrl = "";
    const fetchImpl = (async (input: unknown) => {
      requestedUrl = String(input);
      return new Response("", { status: 400 });
    }) as unknown as typeof fetch;

    await injectDeterministicFontFaces(
      `<!doctype html><html><head><style>
        h1 { font-family: "Noto Performance Test", sans-serif; }
      </style></head><body><h1>&#x65C5;&#34892;</h1></body></html>`,
      { fetchImpl, allowSystemFontCapture: false },
    );

    expect(new URL(requestedUrl).searchParams.get("text")).toContain("旅行");
  });
});
