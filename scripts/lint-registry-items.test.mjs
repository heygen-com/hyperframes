import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(here, "..");
const script = join(repoRoot, "scripts", "lint-registry-items.mjs");

// #7279 — these two items ship assets their manifest declares; before the fix
// the script mounted only `<name>.html`, so the lint failed on files the item
// itself provides.
const ITEMS_WITH_ASSETS = ["yt-lower-third", "texture-mask-text"];

for (const name of ITEMS_WITH_ASSETS) {
  test(`${name}: every asset its manifest declares exists in the item directory`, () => {
    const kind = existsSync(join(repoRoot, "registry", "blocks", name)) ? "blocks" : "components";
    const dir = join(repoRoot, "registry", kind, name);
    const manifest = JSON.parse(readFileSync(join(dir, "registry-item.json"), "utf8"));
    const assets = (manifest.files ?? []).filter((f) => f.type === "hyperframes:asset");
    assert.ok(assets.length > 0, `expected ${name} to declare assets`);
    for (const asset of assets) {
      assert.ok(existsSync(join(dir, asset.path)), `missing on disk: ${asset.path}`);
    }
  });
}

test("items that ship assets lint clean once the mount installs them (#7279)", () => {
  // Runs the real script (bun + the CLI lint) for the ticket's named items.
  const res = spawnSync(process.execPath, [script, ...ITEMS_WITH_ASSETS], {
    encoding: "utf-8",
    cwd: repoRoot,
    timeout: 10 * 60 * 1000,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  assert.equal(
    res.status,
    0,
    `expected the registry lint to pass, got:\n${out.slice(-2000)}`,
  );
  assert.match(out, /Registry item lint passed — 2 item\(s\), 0 errors\./);
});
