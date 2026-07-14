import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const generatedClientSource = readFileSync(new URL("./_gen/client.ts", import.meta.url), "utf8");

describe("generated cloud client source contract", () => {
  it("documents SRT subtitles on the uploadAsset endpoint", () => {
    const uploadAssetDocs = generatedClientSource.match(
      /\/\*\*\s*\*\s*Upload Asset[\s\S]*?\*\/\s+async uploadAsset/,
    )?.[0];

    expect(uploadAssetDocs).toContain("SRT subtitle");
    expect(uploadAssetDocs).toMatch(/Supported types:[^\n]*\bsrt\b/);
  });
});
