import { describe, expect, it } from "vitest";
import { duplicateElementInHtml } from "./duplicateElement.js";

describe("duplicateElementInHtml", () => {
  it("duplicates a target inside a nested template", () => {
    const source = `<!doctype html><html><body>
      <template data-composition-id="outer"><template data-composition-id="inner">
        <div data-hf-id="hf-deep" data-start="0" data-duration="1" data-track-index="0">clip</div>
      </template></template>
    </body></html>`;

    const result = duplicateElementInHtml(source, { hfId: "hf-deep" }, "clip-copy", 1);

    expect(result.matched).toBe(true);
    expect(result.newId).toBe("clip-copy");
    expect(result.html).toContain('id="clip-copy"');
    expect(result.html).toContain('data-start="1"');
  });

  it("deduplicates a composition id on the clone", () => {
    const source = `<div data-composition-id="main"><div id="scene" data-composition-id="scene" data-start="0" data-duration="1">clip</div></div>`;

    const result = duplicateElementInHtml(source, { id: "scene" }, "scene-copy", 1);

    expect(result.matched).toBe(true);
    expect(result.html).toContain('id="scene-copy" data-composition-id="scene-split"');
    expect(result.html.match(/data-composition-id="scene"/g)).toHaveLength(1);
  });
});
