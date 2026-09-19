import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  itemsFromDiff,
  withoutAbortedMedia,
  withoutMissingAdapter,
} from "./verify-catalog-payloads.ts";

describe("itemsFromDiff", () => {
  it("names the items whose block or component payload changed and ignores everything else", () => {
    const diff = [
      "docs/public/catalog/blocks/glass-shard-title.json",
      "docs/public/catalog/components/liquid-glass-widgets.json",
      "docs/public/catalog/items/glass-shard-title/assets/x.png",
      "docs/public/catalog/vendor/three.core.json",
      "docs/catalog/blocks/glass-shard-title.mdx",
      "",
    ].join("\n");
    assert.deepEqual([...itemsFromDiff(diff)].sort(), [
      "glass-shard-title",
      "liquid-glass-widgets",
    ]);
  });
});

describe("withoutMissingAdapter", () => {
  const adapterError = "pageerror: Frost: no WebGPU adapter";

  it("drops only the missing-adapter error for a WebGPU payload", () => {
    const failures = [adapterError, "404 GET http://localhost/public/catalog/x.png"];
    assert.deepEqual(withoutMissingAdapter("<script>navigator.gpu</script>", failures), [
      failures[1],
    ]);
  });

  it("keeps the error for a payload that does not use WebGPU", () => {
    assert.deepEqual(withoutMissingAdapter("<p>plain</p>", [adapterError]), [adapterError]);
  });
});

describe("withoutAbortedMedia", () => {
  it("drops an aborted media request and keeps a 404, an aborted script and any other failure", () => {
    const kept = [
      "404 GET http://localhost/a.mp4",
      "request failed: https://cdn.example/x.js (net::ERR_ABORTED)",
      "request failed: https://cdn.example/x.mp4 (net::ERR_NAME_NOT_RESOLVED)",
    ];
    const aborted = "request failed: https://cdn.example/x.mp4 (net::ERR_ABORTED)";
    assert.deepEqual(withoutAbortedMedia([aborted, ...kept]), kept);
  });
});
