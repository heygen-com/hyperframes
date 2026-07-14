/**
 * @vitest-environment node
 * AUDIT: HTML-native authoring contract — compiler.
 * Validates that compileHtml preserves timing attributes and determinism.
 */
import { describe, it, expect } from "vitest";
import { compileHtml } from "@hyperframes/core/compiler";

const GOOD_COMPOSITION = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Product Launch</title></head>
<body>
  <div id="stage" data-composition-id="launch" data-start="0" data-width="1920" data-height="1080">
    <h1 class="clip" data-start="0.5" data-duration="3.5" data-track-index="1">Big Idea</h1>
    <p  class="clip" data-start="2.0" data-duration="2.0" data-track-index="2">Subtitle line</p>
    <img class="clip" data-start="0" data-duration="6" data-track-index="0"
         src="https://example.com/logo.png" alt="logo">
  </div>
</body></html>
`;

describe("compiler preserves composition timing", () => {
  it("preserves timing attributes during compilation", async () => {
    const result = await compileHtml(GOOD_COMPOSITION, undefined, false);
    expect(result).toContain('data-start="0.5"');
    expect(result).toContain('data-composition-id="launch"');
    expect(result).toContain('data-track-index="1"');
  });

  it("returns identical output for identical input", async () => {
    const a = await compileHtml(GOOD_COMPOSITION, undefined, false);
    const b = await compileHtml(GOOD_COMPOSITION, undefined, false);
    expect(a).toBe(b);
  });
});
