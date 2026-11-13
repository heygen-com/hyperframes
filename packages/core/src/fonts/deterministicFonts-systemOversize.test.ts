// @vitest-environment node
import { closeSync, ftruncateSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureFontDir, makeSfnt } from "./sfntFixture.js";
import { CHROME_WEB_FONT_DECODE_LIMIT } from "./systemFontLocator.js";

const fonts = fixtureFontDir();

/** One byte past what Chrome decodes. Sparse, so it takes no disk, and capture never reads it. */
function writeOversizeFont(fileName: string): void {
  const fd = openSync(join(fonts, fileName), "w");
  ftruncateSync(fd, CHROME_WEB_FONT_DECODE_LIMIT + 1);
  closeSync(fd);
}

writeOversizeFont("Huge Emoji.ttf");
writeFileSync(join(fonts, "Mixed Sizes-Regular.ttf"), makeSfnt({ families: ["Mixed Sizes"] }));
writeOversizeFont("Mixed Sizes-Bold.ttf");

const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");

function capture(family: string, failClosedFontFetch = false) {
  const warnings: string[] = [];
  const html = `<!doctype html><html><head><style>h1{font-family:"${family}"}</style></head><body><h1>x</h1></body></html>`;
  const out = injectDeterministicFontFaces(html, {
    failClosedFontFetch,
    allowSystemFontCapture: true,
    logger: { warn: (message) => warnings.push(message), info() {} },
    fetchImpl: (async () => new Response("", { status: 400 })) as unknown as typeof fetch,
  });
  return { out, warnings };
}

describe("system font capture of a face too large for Chrome to decode", () => {
  it("embeds nothing and says why", async () => {
    const { out, warnings } = capture("Huge Emoji");
    expect(await out).not.toContain("base64,");
    expect(warnings.join("\n")).toMatch(/System font "Huge Emoji" has a 128\.0 MB face.*128 MB/);
  });

  it("still embeds the family's faces that fit", async () => {
    const { out, warnings } = capture("Mixed Sizes");
    const embedded = [...(await out).matchAll(/base64,([A-Za-z0-9+/=]+)/g)].map((m) =>
      Buffer.from(m[1]!, "base64").toString("latin1"),
    );
    expect(embedded).toHaveLength(1);
    expect(embedded[0]).toContain("glyph-data-Mixed Sizes");
    expect(await out).toContain("font-weight: 400;");
    expect(await out).not.toContain("font-weight: 700;");
    expect(warnings.join("\n")).toContain('System font "Mixed Sizes" has a 128.0 MB face');
  });

  it("leaves the family unresolved, which a fail-closed render rejects", async () => {
    await expect(capture("Huge Emoji", true).out).rejects.toThrow(
      "Unresolved fonts in fail-closed mode: Huge Emoji",
    );
  });
});
