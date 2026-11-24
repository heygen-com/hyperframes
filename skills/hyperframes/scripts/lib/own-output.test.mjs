import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ownFolder, replaceFile, replaceOutput } from "./own-output.mjs";

function inProject(t) {
  const base = mkdtempSync(join(tmpdir(), "own-output-"));
  const project = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(project);
  mkdirSync(outside);
  writeFileSync(join(outside, "victim.txt"), "KEEP");
  const cwd = process.cwd();
  process.chdir(project);
  t.after(() => {
    process.chdir(cwd);
    rmSync(base, { recursive: true, force: true });
  });
  return { project, outside };
}

test("replaceFile replaces a link at the output name and leaves its target alone", (t) => {
  const { project, outside } = inProject(t);
  symlinkSync(join(outside, "victim.txt"), join(project, "out.json"));
  replaceFile(join(project, "out.json"), "{}");
  assert.equal(readFileSync(join(outside, "victim.txt"), "utf8"), "KEEP");
  assert.ok(lstatSync(join(project, "out.json")).isFile());
  assert.equal(readFileSync(join(project, "out.json"), "utf8"), "{}");
  assert.deepEqual(readdirSync(project), ["out.json"]);
});

test("replaceOutput leaves no temporary file and no output when the build fails", (t) => {
  const { project } = inProject(t);
  assert.throws(
    () =>
      replaceOutput(join(project, "out.mp4"), (temp) => {
        writeFileSync(temp, "half");
        throw new Error("encoder failed");
      }),
    /encoder failed/,
  );
  assert.deepEqual(readdirSync(project), []);
});

test("ownFolder refuses a linked folder, or one under a linked folder in the project", (t) => {
  const { project, outside } = inProject(t);
  symlinkSync(outside, join(project, "frames-map"));
  assert.throws(() => ownFolder("frames-map"), /frames-map: it is a link/);
  assert.throws(() => ownFolder(join("frames-map", "inner")), /frames-map: it is a link/);
  assert.throws(() => replaceFile(join("frames-map", "f0000.png"), "x"), /it is a link/);
  assert.deepEqual(readdirSync(outside), ["victim.txt"]);
  assert.equal(ownFolder("frames-new"), join(process.cwd(), "frames-new"));
  assert.ok(lstatSync(join(project, "frames-new")).isDirectory());
});

test("bake-basemap writes its frames, video and coords only through own-output", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../bake-basemap.mjs", import.meta.url)),
    "utf8",
  );
  assert.match(source, /from "\.\/lib\/own-output\.mjs"/);
  assert.doesNotMatch(source, /\b(writeFileSync|mkdirSync|createWriteStream)\b/);
  assert.doesNotMatch(source, /screenshot\(\{[^}]*\bpath:/s);
  assert.match(source, /ownFolder\(join\(OUT, "frames-"/);
  assert.match(source, /replaceOutput\(mp4,/);
  assert.match(source, /replaceFile\(join\(OUT, NAME \+ "-coords\.json"\)/);
});
