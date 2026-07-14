import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findForbiddenTrackedPaths, isForbiddenTrackedPath } from "./check-tracked-artifacts.mjs";

describe("tracked artifact check", () => {
  it("rejects node_modules at any directory depth", () => {
    assert.equal(isForbiddenTrackedPath("node_modules/pkg/index.js"), true);
    assert.equal(isForbiddenTrackedPath("packages/producer/node_modules/pkg"), true);
    assert.equal(isForbiddenTrackedPath("packages\\producer\\node_modules\\pkg"), true);
  });

  it("rejects platform metadata by basename", () => {
    assert.equal(isForbiddenTrackedPath(".DS_Store"), true);
    assert.equal(isForbiddenTrackedPath("packages/producer/tests/.DS_Store"), true);
  });

  it("does not reject similarly named source paths", () => {
    assert.equal(isForbiddenTrackedPath("docs/node_modules-policy.md"), false);
    assert.equal(isForbiddenTrackedPath("packages/producer/src/DS_Store.ts"), false);
  });

  it("returns a deterministic sorted list", () => {
    assert.deepEqual(
      findForbiddenTrackedPaths([
        "packages/z/.DS_Store",
        "packages/producer/src/index.ts",
        "packages/a/node_modules/pkg",
      ]),
      ["packages/a/node_modules/pkg", "packages/z/.DS_Store"],
    );
  });
});
