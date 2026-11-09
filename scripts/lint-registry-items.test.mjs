import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
  assert.equal(res.status, 0, `expected the registry lint to pass, got:\n${out.slice(-2000)}`);
  assert.match(out, /Registry item lint passed — 2 item\(s\), 0 errors\./);
});

for (const file of [
  { path: "../../../outside", target: "assets/test.txt" },
  { path: "sample.html", target: "../outside" },
]) {
  test(`rejects an escaping manifest entry ${file.path} → ${file.target}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "hf-registry-paths-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const scriptsDir = join(root, "scripts");
    const itemDir = join(root, "registry", "blocks", "sample");
    mkdirSync(scriptsDir);
    mkdirSync(itemDir, { recursive: true });
    for (const name of ["lint-registry-items.mjs", "registry-target-paths.mjs"]) {
      copyFileSync(join(here, name), join(scriptsDir, name));
    }
    const outside = join(root, "outside");
    writeFileSync(outside, "sentinel");
    writeFileSync(join(itemDir, "sample.html"), "<p>Fixture</p>");
    writeFileSync(join(itemDir, "registry-item.json"), JSON.stringify({ files: [file] }));
    const res = spawnSync(
      process.execPath,
      [join(scriptsDir, "lint-registry-items.mjs"), "sample"],
      {
        encoding: "utf-8",
        env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root },
        timeout: 10_000,
      },
    );
    assert.equal(res.status, 1);
    assert.match(res.stderr, /declares a path outside its allowed directory/);
    assert.equal(readFileSync(outside, "utf8"), "sentinel");
  });
}
