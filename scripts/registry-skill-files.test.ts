import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { test } from "node:test";

const REGISTRY = join(import.meta.dirname, "..", "registry");
const BLOCKS = join(REGISTRY, "blocks");

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

function usesProjectPackageManager(markdown: string): boolean {
  const commands = markdown
    .replace(/\\\r?\n/g, "")
    .matchAll(/\b(npx|npm|bunx)[ \t]+([-@\w./"']+)/g);
  return Array.from(commands).some(
    ([, runner, argument]) => runner !== "npx" || argument !== "hyperframes",
  );
}

function registryCommandViolations(root: string): string[] {
  const violations: string[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const name = relative(root, path);
    const contents = readFileSync(path);
    // Commands also appear in manifest strings, templates and source comments.
    if (
      contents.includes("hyperframes@") &&
      /\b(?:npx|npm|bunx|dlx)\b[^\r\n`]*?\bhyperframes@|\bhyperframes@[^\s`]+[ \t]+[\w-]+/.test(
        contents.toString("utf8"),
      )
    ) {
      violations.push(name);
      continue;
    }
    // Source READMEs document maintainer builds in a trusted checkout.
    if (
      /\.mdx?$/i.test(entry.name) &&
      !(entry.name === "README.md" && basename(dirname(path)) === "source") &&
      usesProjectPackageManager(contents.toString("utf8"))
    ) {
      violations.push(name);
    }
  }
  return violations.sort();
}

test("only the launcher shorthand is a registry package-runner example", () => {
  assert.equal(usesProjectPackageManager("Run `npx hyperframes add orbit-card`."), false);
  for (const command of [
    "npx --yes hyperframes render",
    "npm exec hyperframes",
    "bunx hyperframes render",
  ]) {
    assert.equal(usesProjectPackageManager(command), true, command);
  }
});

test("registry instructions use the installed HyperFrames launcher", () => {
  assert.deepEqual(registryCommandViolations(REGISTRY), []);
});

test("the registry check rejects a skill with a pinned render command", () => {
  assert.deepEqual(
    registryCommandViolations(join(import.meta.dirname, "fixtures", "registry-pinned-command")),
    ["SKILL.md"],
  );
});

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

  test(`${name}: the variable count in SKILL.md matches its Variables table`, () => {
    const { skill } = readBlock(name);
    const declared = Number(firstMatch(skill, /(\d+) variables/));
    const rows = skill.split("## Variables")[1]?.split(/\n## /)[0]?.match(/^\| `/gm)?.length;
    assert.equal(rows, declared);
  });

  test(`${name}: its mount and render paths are the composition file the manifest installs`, () => {
    const { files, skill } = readBlock(name);
    const target = files.find((file) => file.type === "hyperframes:composition")?.target;
    assert.equal(firstMatch(skill, /data-composition-src="([^"]+)"/), target);
    assert.ok(skill.includes('node "<SKILLS>/hyperframes/scripts/plugin-cli.mjs"'));
    assert.equal(firstMatch(skill, /^npx hyperframes render '([^']+)'/m), target);
  });
}
