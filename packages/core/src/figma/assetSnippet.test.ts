// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAssetSnippet } from "./assetSnippet";
import type { FigmaManifestRecord } from "./types";

const record: FigmaManifestRecord = {
  id: "image_001",
  type: "image",
  path: ".media/images/image_001.png",
  source: "figma",
  description: 'Hero "banner"',
  width: 240,
  height: 57,
  provenance: { source: "figma", fileKey: "FK", nodeId: "92:573", format: "png" },
};

describe("buildAssetSnippet", () => {
  it("emits an img tag with src, dims, escaped alt, and data-figma-id", () => {
    const { path, html } = buildAssetSnippet(record);
    expect(path).toBe(".media/images/image_001.png");
    expect(html).toContain('src=".media/images/image_001.png"');
    expect(html).toContain('width="240"');
    expect(html).toContain('height="57"');
    expect(html).toContain('data-figma-id="92:573"');
    expect(html).toContain("&quot;banner&quot;");
    expect(html).not.toContain('"banner"');
  });
});
