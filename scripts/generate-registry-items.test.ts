import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateRegistryManifest } from "./generate-registry-items.ts";

test("indexing preserves authored example manifests and indexes source-only additions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "registry-index-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["blocks", "components", "examples"])
    mkdirSync(join(root, "registry", dir), { recursive: true });
  const example = '{"name":"starter","type":"hyperframes:example","custom":"preserve me"}\n';
  mkdirSync(join(root, "registry/examples/starter"));
  writeFileSync(join(root, "registry/examples/starter/registry-item.json"), example);
  mkdirSync(join(root, "registry/components/new"));
  writeFileSync(
    join(root, "registry/components/new/registry-item.json"),
    '{"name":"new","type":"hyperframes:component"}',
  );
  generateRegistryManifest(root);
  assert.equal(
    readFileSync(join(root, "registry/examples/starter/registry-item.json"), "utf8"),
    example,
  );
  const manifest = JSON.parse(readFileSync(join(root, "registry/registry.json"), "utf8"));
  assert.deepEqual(manifest.items, [
    { name: "starter", type: "hyperframes:example" },
    { name: "new", type: "hyperframes:component" },
  ]);
});
