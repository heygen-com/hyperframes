import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dirname, "..");

async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "hf-host-assets-")));
  const item = join(root, "registry/blocks/test-item");
  fs.mkdirSync(item, { recursive: true });
  fs.mkdirSync(join(root, "scripts"));
  for (const name of ["host-registry-assets.ts", "entrypoint.ts"]) {
    fs.copyFileSync(join(repoRoot, "scripts", name), join(root, "scripts", name));
  }
  for (const name of ["packages", "node_modules"]) {
    fs.symlinkSync(join(repoRoot, name), join(root, name), "junction");
  }
  const source = join(item, "asset.png");
  const manifestPath = join(item, "registry-item.json");
  const bytes = Buffer.from("original asset bytes");
  fs.writeFileSync(source, bytes);
  const manifest = JSON.stringify({ name: "test-item", files: [{ path: "asset.png" }] });
  fs.writeFileSync(manifestPath, manifest);
  const { main } = await import(pathToFileURL(join(root, "scripts/host-registry-assets.ts")).href);
  return { root, source, manifestPath, manifest, bytes, main };
}

test("staged bytes match their key, dry-run is unchanged, and no-upload preserves sources", async () => {
  const f = await fixture();
  try {
    await f.main(["test-item", "--dry-run"]);
    assert.equal(fs.readFileSync(f.manifestPath, "utf8"), f.manifest);
    assert.equal(fs.existsSync(join(f.root, ".registry-assets-staging")), false);
    await f.main(["test-item", "--no-upload"]);
    const key = `${createHash("sha256").update(f.bytes).digest("hex").slice(0, 16)}.png`;
    assert.deepEqual(fs.readFileSync(join(f.root, ".registry-assets-staging", key)), f.bytes);
    assert.deepEqual(fs.readFileSync(f.source), f.bytes);
    const manifest = JSON.parse(fs.readFileSync(f.manifestPath, "utf8"));
    assert.equal(
      manifest.files[0].url,
      `https://static.heygen.ai/hyperframes-oss/registry-assets/${key}`,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("source replacement between planning and staging aborts before manifest publication", async (t) => {
  const f = await fixture();
  const copy = fs.copyFileSync;
  t.mock.method(fs, "copyFileSync", (...args: Parameters<typeof copy>) => {
    if (args[0] === f.source) fs.writeFileSync(f.source, "replacement bytes");
    return copy(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.main(["test-item", "--no-upload"]), /Asset changed while staging/);
    assert.equal(fs.readFileSync(f.manifestPath, "utf8"), f.manifest);
    assert.equal(fs.readFileSync(f.source, "utf8"), "replacement bytes");
    assert.deepEqual(fs.readdirSync(join(f.root, ".registry-assets-staging")), []);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
