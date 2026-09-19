import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  declaresWebgpu,
  itemsFromDiff,
  withoutAbortedMedia,
  withoutWebgpuRuntimeErrors,
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

describe("declaresWebgpu", () => {
  it("reads the webgpu tag from the item's own manifest", () => {
    assert.equal(declaresWebgpu("blocks", "liquid-glass-widgets"), true);
    assert.equal(declaresWebgpu("blocks", "glass-shard-title"), false);
    assert.equal(declaresWebgpu("blocks", "no-such-item"), false);
  });
});

describe("withoutWebgpuRuntimeErrors", () => {
  const network = "404 GET http://localhost/public/catalog/x.png";
  const wordings = [
    "pageerror: Frost: no WebGPU adapter",
    "console.error: Failed to request adapter",
    "pageerror: Cannot read properties of null (reading 'createShaderModule')",
  ];

  it("passes a declared item whatever wording its page and console errors use", () => {
    assert.deepEqual(withoutWebgpuRuntimeErrors(true, [...wordings, network]), [network]);
  });

  it("fails an undeclared item with the same wording", () => {
    assert.deepEqual(withoutWebgpuRuntimeErrors(false, wordings), wordings);
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
