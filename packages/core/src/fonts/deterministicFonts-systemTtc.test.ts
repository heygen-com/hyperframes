// @vitest-environment node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureFontDir, makeTtc } from "./sfntFixture.js";

const fonts = fixtureFontDir();
writeFileSync(
  join(fonts, "PingFang.ttc"),
  makeTtc([{ families: ["PingFang SC"] }, { families: ["PingFang TC"] }]).file,
);

const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");

describe("system font capture of a family inside a .ttc collection", () => {
  it("embeds that face alone, found by the name inside the file", async () => {
    const html = `<!doctype html><html><head><style>h1{font-family:"PingFang SC"}</style></head><body><h1>x</h1></body></html>`;
    const out = await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      allowSystemFontCapture: true,
      systemFontsByInnerName: true,
      logger: { warn() {}, info() {} },
      fetchImpl: (async () => new Response("", { status: 400 })) as unknown as typeof fetch,
    });
    const embedded = [...out.matchAll(/base64,([A-Za-z0-9+/=]+)/g)].map((m) =>
      Buffer.from(m[1]!, "base64").toString("latin1"),
    );
    expect(embedded).toHaveLength(1);
    expect(embedded[0]).toContain("glyph-data-PingFang SC");
    expect(embedded[0]).not.toContain("glyph-data-PingFang TC");
  });

  it("embeds nothing from inside a collection unless asked", async () => {
    const html = `<!doctype html><html><head><style>h1{font-family:"PingFang SC"}</style></head><body><h1>x</h1></body></html>`;
    const out = await injectDeterministicFontFaces(html, {
      allowSystemFontCapture: true,
      logger: { warn() {}, info() {} },
      fetchImpl: (async () => new Response("", { status: 400 })) as unknown as typeof fetch,
    });
    expect(out).not.toContain("base64,");
  });
});
