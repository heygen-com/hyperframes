import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      if (args[0] === "ls-tree") {
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

it("permits a tracked-source repair while refusing invented entries and unbacked deletion", (t) => {
  const root = mkdtempSync(join(tmpdir(), "registry-repair-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  run(["init", "--quiet"]);
  for (const name of ["existing", "omitted"]) {
    const dir = join(root, "registry", "blocks", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "registry-item.json"), JSON.stringify({ name }));
  }
  const index = join(root, "registry/registry.json");
  const putIndex = (names) =>
    writeFileSync(index, JSON.stringify({ items: names.map((name) => ({ name })) }));
  putIndex(["existing"]);
  run(["add", "."]);
  run([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  const base = run(["rev-parse", "HEAD"]);
  const check = () =>
    runRegistrySetDeltaCheck(base, { run, readRegistryJson: () => readFileSync(index, "utf8") });
  putIndex(["existing", "omitted"]);
  assert.deepEqual(check(), { missing: [], unexpected: [], removedCount: 0, addedCount: 1 });
  putIndex(["existing", "omitted", "invented"]);
  assert.deepEqual(check().unexpected, ["invented"]);
  putIndex(["omitted"]);
  assert.deepEqual(check().missing, ["existing"]);
});
