import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const guard = fileURLToPath(new URL("./check-catalog-source-pr.mjs", import.meta.url));
const old = { name: "old", type: "hyperframes:component" };
const kept = { name: "kept", type: "hyperframes:block" };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "catalog-source-pr-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const write = (path, contents) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  const item = (directory, entry) => {
    write(`registry/${directory}/${entry.name}/registry-item.json`, JSON.stringify(entry));
    write(`registry/${directory}/${entry.name}/index.html`, "<div>item</div>");
  };
  const index = (items, revision = "published") =>
    write(
      "registry/registry.json",
      JSON.stringify({ name: "catalog", items, vectorRevision: revision }),
    );
  const commit = () => {
    git("add", "-A");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      "fixture",
    );
  };
  git("init", "-q");
  item("components", old);
  write("registry/components/old/assets/registry-item.json", "asset metadata");
  item("blocks", kept);
  index([old, kept]);
  commit();
  const base = git("rev-parse", "HEAD");
  return {
    root,
    item,
    index,
    removeOld: () => rmSync(join(root, "registry/components/old"), { recursive: true }),
    check: () => {
      commit();
      return spawnSync(process.execPath, [guard, base], { cwd: root, encoding: "utf8" });
    },
  };
}

test("a deletion removes its index entry in the same source PR", (t) => {
  const repo = fixture(t);
  repo.removeOld();
  repo.index([kept]);
  const result = repo.check();
  assert.equal(result.status, 0, result.stderr);
});

test("a rename unpublishes the old name and leaves the new name for automation", (t) => {
  const repo = fixture(t);
  repo.removeOld();
  repo.item("components", { ...old, name: "renamed" });
  repo.index([kept]);
  const result = repo.check();
  assert.equal(result.status, 0, result.stderr);
});

test("an add-plus-delete PR carries only the old entry removal", (t) => {
  const repo = fixture(t);
  repo.removeOld();
  repo.item("blocks", { name: "new", type: "hyperframes:block" });
  repo.index([kept]);
  const result = repo.check();
  assert.equal(result.status, 0, result.stderr);
});

test("a deletion cannot leave a dangling index entry", (t) => {
  const repo = fixture(t);
  repo.removeOld();
  const result = repo.check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must remove deleted items/);
});

test("the removal exception cannot publish an added entry", (t) => {
  const repo = fixture(t);
  repo.removeOld();
  const added = { name: "new", type: "hyperframes:block" };
  repo.item("blocks", added);
  repo.index([kept, added]);
  const result = repo.check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Do not add entries/);
});

test("the removal exception cannot unpublish a directory that still exists", (t) => {
  const repo = fixture(t);
  repo.item("blocks", { name: "new", type: "hyperframes:block" });
  repo.index([kept]);
  const result = repo.check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must remove deleted items/);
});

test("the removal exception preserves index metadata", (t) => {
  const repo = fixture(t);
  repo.removeOld();
  repo.index([kept], "changed");
  const result = repo.check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /change index metadata/);
});

test("deleting only the manifest does not qualify as deleting an item directory", (t) => {
  const repo = fixture(t);
  rmSync(join(repo.root, "registry/components/old/registry-item.json"));
  repo.index([kept]);
  const result = repo.check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /complete item directory/);
});

test("deleting nested asset metadata does not unpublish its item", (t) => {
  const repo = fixture(t);
  rmSync(join(repo.root, "registry/components/old/assets/registry-item.json"));
  const result = repo.check();
  assert.equal(result.status, 0, result.stderr);
});
