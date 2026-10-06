import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { missingBlockPreview } from "./backfill-block-previews.js";

describe("backfill block previews", () => {
  it("fills a block that declares no preview with the catalog CDN pattern", () => {
    assert.deepEqual(missingBlockPreview("app-showcase", undefined), {
      video: "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/app-showcase.mp4",
      poster:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/app-showcase.png",
    });
  });

  it("keeps a declared preview that points somewhere else", () => {
    const promoted = {
      video: "https://static.heygen.ai/hyperframes/templates/promoted/abc/notes-reveal/preview.mp4",
      poster: "https://static.heygen.ai/hyperframes/templates/promoted/abc/notes-reveal/poster.jpg",
    };
    assert.equal(missingBlockPreview("notes-reveal", promoted), null);
  });
});
