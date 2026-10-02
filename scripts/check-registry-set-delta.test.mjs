import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeRegistrySetDelta,
  formatRegistrySetDeltaResult,
  registryItemNamesFromPaths,
  runRegistrySetDeltaCheck,
} from "./check-registry-set-delta.mjs";

describe("registryItemNamesFromPaths", () => {
  it("extracts the item name from a registry-item.json path", () => {
    assert.deepEqual(
      registryItemNamesFromPaths([
        "registry/components/text-match-cut/registry-item.json",
        "registry/blocks/week-in-merges/registry-item.json",
      ]),
      new Set(["text-match-cut", "week-in-merges"]),
    );
  });

  it("ignores paths that are not a top-level registry-item.json", () => {
    assert.deepEqual(
      registryItemNamesFromPaths([
        "registry/components/text-match-cut/text-match-cut.html",
        "registry/registry.json",
        "docs/catalog/components/text-match-cut.mdx",
      ]),
      new Set(),
    );
  });
});

describe("computeRegistrySetDelta", () => {
  it("passes a real addition backed by a new registry-item.json", () => {
    const { missing, unexpected } = computeRegistrySetDelta({
      baseNames: new Set(["existing"]),
      headNames: new Set(["existing", "text-match-cut"]),
      removed: new Set(),
      added: new Set(["text-match-cut"]),
    });
    assert.deepEqual(missing, []);
    assert.deepEqual(unexpected, []);
  });

  it("passes a real removal backed by a deleted registry-item.json", () => {
    const { missing, unexpected } = computeRegistrySetDelta({
      baseNames: new Set(["existing", "old-item"]),
      headNames: new Set(["existing"]),
      removed: new Set(["old-item"]),
      added: new Set(),
    });
    assert.deepEqual(missing, []);
    assert.deepEqual(unexpected, []);
  });

  it("fails a registry.json entry added with no matching registry-item.json file", () => {
    const { missing, unexpected } = computeRegistrySetDelta({
      baseNames: new Set(["existing"]),
      headNames: new Set(["existing", "fake-item"]),
      removed: new Set(),
      added: new Set(),
    });
    assert.deepEqual(missing, []);
    assert.deepEqual(unexpected, ["fake-item"]);
  });

  it("fails a registry.json entry deleted with no matching file deletion", () => {
    const { missing, unexpected } = computeRegistrySetDelta({
      baseNames: new Set(["existing", "still-on-disk"]),
      headNames: new Set(["existing"]),
      removed: new Set(),
      added: new Set(),
    });
    assert.deepEqual(missing, ["still-on-disk"]);
    assert.deepEqual(unexpected, []);
  });
});

describe("runRegistrySetDeltaCheck", () => {
  it("wires a fake git/fs boundary through to a clean addition result", () => {
    const run = (args) => {
      if (args[0] === "show") {
        return JSON.stringify({ items: [{ name: "existing" }] });
      }
      // diff --name-only --diff-filter=A|D base...HEAD
      const filter = args[2];
      if (filter === "--diff-filter=A") {
        return "registry/components/text-match-cut/registry-item.json\n";
      }
      return "";
    };
    const readRegistryJson = () =>
      JSON.stringify({ items: [{ name: "existing" }, { name: "text-match-cut" }] });
    const result = runRegistrySetDeltaCheck("origin/main", { run, readRegistryJson });
    assert.deepEqual(result, {
      missing: [],
      unexpected: [],
      removedCount: 0,
      addedCount: 1,
    });
  });
});

describe("formatRegistrySetDeltaResult", () => {
  it("reports ok with the removal/addition counts when the delta is clean", () => {
    const result = formatRegistrySetDeltaResult({
      base: "origin/main",
      missing: [],
      unexpected: [],
      removedCount: 0,
      addedCount: 1,
    });
    assert.equal(result.ok, true);
    assert.equal(
      result.text,
      "Registry item-set delta matches 0 removal(s) and 1 addition(s) against origin/main.",
    );
  });

  it("reports both missing and unexpected names on a mismatch", () => {
    const result = formatRegistrySetDeltaResult({
      base: "origin/main",
      missing: ["still-on-disk"],
      unexpected: ["fake-item"],
      removedCount: 0,
      addedCount: 0,
    });
    assert.equal(result.ok, false);
    assert.equal(
      result.text,
      [
        "Registry item-set delta mismatch against origin/main:",
        "  missing from registry.json: still-on-disk",
        "  unexpected in registry.json: fake-item",
      ].join("\n"),
    );
  });
});
