import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  changedItems,
  declaresWebgpu,
  itemsFromDiff,
  withoutAbortedMedia,
  parsePayload,
  remainingFailures,
  withoutWebgpuAbsence,
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

describe("withoutWebgpuAbsence", () => {
  const network = "404 GET http://localhost/public/catalog/x.png";
  const absent = [
    "pageerror: Frost: no WebGPU adapter",
    "console.error: LiquidGlass: WebGPU not available",
    "console.error: Failed to request adapter",
  ];
  const unrelated = "pageerror: ReferenceError: liquid is not defined";
  const otherAdapter = "console.error: Failed to request storage adapter";

  it("passes a declared item's WebGPU-absent errors and keeps everything else", () => {
    assert.deepEqual(withoutWebgpuAbsence(true, [...absent, unrelated, otherAdapter, network]), [
      unrelated,
      otherAdapter,
      network,
    ]);
  });

  it("fails an undeclared item with the same wording", () => {
    assert.deepEqual(withoutWebgpuAbsence(false, absent), absent);
  });
});

describe("remainingFailures", () => {
  const absent = "console.error: LiquidGlass: WebGPU not available";

  it("forgives by the item's own manifest tag in the right folder", () => {
    assert.deepEqual(remainingFailures("blocks", "liquid-glass-widgets", [absent]), []);
    assert.deepEqual(remainingFailures("blocks", "glass-shard-title", [absent]), [absent]);
    assert.deepEqual(remainingFailures("components", "liquid-glass-widgets", [absent]), [absent]);
  });
});

describe("parsePayload", () => {
  it("tells a live payload from a marker", () => {
    assert.deepEqual(parsePayload('{"html":"<p></p>"}'), { kind: "live", html: "<p></p>" });
    assert.deepEqual(parsePayload('{"unsupported":"canvas-draw-element"}'), {
      kind: "marker",
      reason: "canvas-draw-element",
    });
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

it("browser selection includes regenerated edits and new untracked payloads", (t) => {
  const root = mkdtempSync(join(tmpdir(), "catalog-selection-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  mkdirSync(join(root, "docs/public/catalog/blocks"), { recursive: true });
  const old = join(root, "docs/public/catalog/blocks/old.json");
  writeFileSync(old, "{}");
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  );
  writeFileSync(old, '{"html":"updated"}');
  writeFileSync(join(root, "docs/public/catalog/blocks/new.json"), "{}");
  assert.deepEqual([...changedItems("HEAD", root)].sort(), ["new", "old"]);
});
