import assert from "node:assert/strict";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ownFolder, replaceFile, replaceFileWith } from "./link-safe-write.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "link-safe-write-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  mkdirSync(project);
  const victim = join(root, "victim.txt");
  writeFileSync(victim, "victim");
  return { root, project, victim };
}

for (const [kind, plant] of [
  ["symbolic link", (target, at) => symlinkSync(target, at)],
  ["hard link", (target, at) => linkSync(target, at)],
]) {
  test(`replaceFile and replaceFileWith replace a ${kind} at the name, never its target`, (t) => {
    const { project, victim } = fixture(t);
    for (const [name, write] of [
      ["a.json", (path) => replaceFile(path, "new")],
      ["b.png", (path) => replaceFileWith(path, (temp) => writeFileSync(temp, "new"))],
    ]) {
      const path = join(project, name);
      plant(victim, path);
      write(path);
      assert.equal(readFileSync(victim, "utf8"), "victim");
      assert.equal(readFileSync(path, "utf8"), "new");
      const entry = lstatSync(path);
      assert.equal(entry.isFile(), true);
      assert.equal(entry.nlink, 1);
    }
    assert.deepEqual(readdirSync(project).sort(), ["a.json", "b.png"]);
  });
}

test("replaceFileWith leaves the name as it was and no temp file when the write fails", (t) => {
  const { project } = fixture(t);
  const path = join(project, "out.mp4");
  writeFileSync(path, "old");
  assert.throws(
    () =>
      replaceFileWith(path, (temp) => {
        writeFileSync(temp, "half");
        throw new Error("encoder failed");
      }),
    /encoder failed/,
  );
  assert.equal(readFileSync(path, "utf8"), "old");
  assert.deepEqual(readdirSync(project), ["out.mp4"]);
});

test("ownFolder refuses a folder that is a link and makes nothing through it", (t) => {
  const { root, project } = fixture(t);
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(project, "frames-basemap"), "dir");
  assert.throws(() => ownFolder(project, "frames-basemap/sub"), /is a link/);
  assert.deepEqual(readdirSync(elsewhere), []);
  assert.equal(ownFolder(project, "frames-real"), join(project, "frames-real"));
  assert.equal(lstatSync(join(project, "frames-real")).isDirectory(), true);
});
