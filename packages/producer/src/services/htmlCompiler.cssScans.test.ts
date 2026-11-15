import { describe, expect, it } from "vitest";
import { localizeRemoteBackgroundImages, localizeRemoteFontFaces } from "./htmlCompiler.js";

describe("remote CSS asset discovery", () => {
  it("scans 200 KB of unclosed background urls in well under a second", async () => {
    const html = "background:url(http://".repeat(Math.floor(200_000 / 22));
    const started = performance.now();
    const result = await localizeRemoteBackgroundImages(html, "/nonexistent-download-dir");
    expect(result.html).toBe(html);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("scans 400 KB of unclosed style tags for font faces in well under a second", async () => {
    const html = "<style".repeat(Math.floor(400_000 / 6));
    const started = performance.now();
    const result = await localizeRemoteFontFaces(html, "/nonexistent-download-dir");
    expect(result.html).toBe(html);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
