import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const BLOCKS = join(import.meta.dirname, "..", "registry", "blocks");

interface ManifestFile {
  path: string;
  target: string;
  type: string;
  url?: string;
}

function readBlock(name: string): { dir: string; files: ManifestFile[]; skill: string } {
  const dir = join(BLOCKS, name);
  const manifest: { files: ManifestFile[] } = JSON.parse(
    readFileSync(join(dir, "registry-item.json"), "utf-8"),
  );
  return { dir, files: manifest.files, skill: readFileSync(join(dir, "SKILL.md"), "utf-8") };
}

function filesTable(skill: string): string[] {
  const section = skill.split("## Files")[1]?.split(/\n## /)[0] ?? "";
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1] ?? "");
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1];
}

const blocks = readdirSync(BLOCKS).filter((name) => existsSync(join(BLOCKS, name, "SKILL.md")));

for (const name of blocks) {
  test(`${name}: SKILL.md lists exactly the manifest files, and they exist`, () => {
    const { dir, files, skill } = readBlock(name);
    const installed = files.filter((file) => file.path !== "SKILL.md");
    assert.deepEqual(filesTable(skill).sort(), installed.map((file) => file.path).sort());
    for (const file of installed.filter((entry) => !entry.url)) {
      assert.ok(existsSync(join(dir, file.path)), `${name}: ${file.path} is not in the tree`);
    }
  });

  test(`${name}: its mount and render paths are the composition file the manifest installs`, () => {
    const { files, skill } = readBlock(name);
    const target = files.find((file) => file.type === "hyperframes:composition")?.target;
    assert.equal(firstMatch(skill, /data-composition-src="([^"]+)"/), target);
    assert.equal(firstMatch(skill, / render '([^']+)'/), target);
  });
}
