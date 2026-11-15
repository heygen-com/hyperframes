import { describe, expect, it } from "vitest";
import { localizeRemoteBackgroundImages } from "./htmlCompiler.js";

describe("remote background-image discovery", () => {
  it("scans 200 KB of unclosed background urls in well under a second", async () => {
    const html = "background:url(http://".repeat(Math.floor(200_000 / 22));
    const started = performance.now();
    const result = await localizeRemoteBackgroundImages(html, "/nonexistent-download-dir");
    expect(result.html).toBe(html);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
