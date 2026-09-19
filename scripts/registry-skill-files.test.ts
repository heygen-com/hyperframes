import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const BLOCKS = join(import.meta.dirname, "..", "registry", "blocks");

interface ManifestFile {
  path: string;
  url?: string;
}

function skillFilesTable(skill: string): string[] {
  const section = skill.split("## Files")[1]?.split(/\n## /)[0] ?? "";
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1] ?? "");
}

const blocks = readdirSync(BLOCKS).filter((name) => existsSync(join(BLOCKS, name, "SKILL.md")));

for (const name of blocks) {
  test(`${name}: every path its SKILL.md names is a manifest file that exists`, () => {
    const dir = join(BLOCKS, name);
    const manifest: { files: ManifestFile[] } = JSON.parse(
      readFileSync(join(dir, "registry-item.json"), "utf-8"),
    );
    const named = skillFilesTable(readFileSync(join(dir, "SKILL.md"), "utf-8"));
    const installed = manifest.files.filter((file) => file.path !== "SKILL.md");
    assert.deepEqual([...named].sort(), installed.map((file) => file.path).sort());
    for (const file of installed.filter((entry) => !entry.url)) {
      assert.ok(existsSync(join(dir, file.path)), `${name}: ${file.path} is not in the tree`);
    }
  });
}

for (const name of blocks) {
  test(`${name}: its mount and render paths are the composition file the manifest installs`, () => {
    const dir = join(BLOCKS, name);
    const manifest: { files: (ManifestFile & { target: string; type: string })[] } = JSON.parse(
      readFileSync(join(dir, "registry-item.json"), "utf-8"),
    );
    const composition = manifest.files.find((file) => file.type === "hyperframes:composition");
    const skill = readFileSync(join(dir, "SKILL.md"), "utf-8");
    const mounted = skill.match(/data-composition-src="([^"]+)"/)?.[1];
    const rendered = skill.match(/ render '([^']+)'/)?.[1];
    assert.equal(mounted, composition?.target);
    assert.equal(rendered, composition?.target);
  });
}
