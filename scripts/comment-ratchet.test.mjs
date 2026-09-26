// fallow-ignore-file complexity
// Each rule gets a test that fails when that rule alone is removed.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { changedPaths, isSource, judge, measure } from "./comment-ratchet.mjs";

const RATCHET = fileURLToPath(new URL("./comment-ratchet.mjs", import.meta.url));
const wall = (lines) => Array.from({ length: lines }, (_, i) => `// line ${i + 1}`).join("\n");
const PACKAGE = 0.4;

test("a 13-line comment block counts as over-long, a 12-line one does not", () => {
  assert.equal(measure(`${wall(13)}\nconst a = 1;\n`, ".ts").long, 1);
  assert.equal(measure(`${wall(12)}\nconst a = 1;\n`, ".ts").long, 0);
});

test("the comment-length marker exempts an over-long block", () => {
  const marked = `// comment-length: a protocol table\n${wall(20)}\nconst a = 1;\n`;
  assert.equal(measure(marked, ".ts").long, 0);
  const bare = `// comment-length:\n${wall(20)}\nconst a = 1;\n`;
  assert.equal(measure(bare, ".ts").long, 1, "no reason, no exemption");
});

test("a JSX comment counts as comment, and code does not", () => {
  const jsx = "export const A = () => (\n  <div>\n    {/* why */}\n  </div>\n);\n";
  assert.equal(measure(jsx, ".tsx").comment, 1);
  assert.equal(measure("const a = 1;\n", ".ts").comment, 0);
});

// 14 physical lines: a bare opener, 12 of prose, a bare closer.
test("a docblock is measured from its opener to its closer", () => {
  const body = Array.from({ length: 12 }, (_, i) => ` * line ${i + 1}`).join("\n");
  const doc = `/**\n${body}\n */\nconst a = 1;\n`;
  assert.equal(doc.split("\n").indexOf(" */"), 13, "the closer is the 14th line");
  assert.equal(measure(doc, ".ts").long, 1);
});

test("volume counts lines carrying prose, not a block span", () => {
  const doc = "/**\n * one\n *\n * two\n */\nconst a = 1;\n";
  assert.equal(measure(doc, ".ts").comment, 2);
});

test("adding a comment line to a file fails", () => {
  const base = { lines: 100, comment: 20, long: 0 };
  const head = { lines: 100, comment: 25, long: 0 };
  const problems = judge("src/a.ts", head, base, PACKAGE);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /^RAISED comment share: src\/a\.ts is 25\.0% \(25\/100\), at the base 20\.0% \(20\/100\)/,
  );
  assert.match(problems[0], /5 comment line\(s\) added/);
});

test("adding code passes", () => {
  const problems = judge(
    "src/a.ts",
    { lines: 130, comment: 20, long: 0 },
    { lines: 100, comment: 20, long: 0 },
    PACKAGE,
  );
  assert.deepEqual(problems, []);
});

// 20/60 is 33% against 20/100 at 20%: the share rose and no comment line was written.
test("deleting code passes, though it lifts the share", () => {
  const problems = judge(
    "src/a.ts",
    { lines: 60, comment: 20, long: 0 },
    { lines: 100, comment: 20, long: 0 },
    PACKAGE,
  );
  assert.deepEqual(problems, []);
});

test("deleting comments passes silently", () => {
  const problems = judge(
    "src/a.ts",
    { lines: 100, comment: 5, long: 0 },
    { lines: 100, comment: 20, long: 1 },
    PACKAGE,
  );
  assert.deepEqual(problems, []);
});

test("a new over-long block fails even when the share falls", () => {
  const problems = judge(
    "src/a.ts",
    { lines: 400, comment: 40, long: 2 },
    { lines: 100, comment: 20, long: 1 },
    PACKAGE,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^NEW comment block over 12 lines: src\/a\.ts has 2, the base has 1/);
});

test("a new file may not open above its package's share, nor carry a wall", () => {
  const problems = judge("src/new.ts", { lines: 100, comment: 60, long: 1 }, null, PACKAGE);
  assert.equal(problems.length, 2);
  assert.match(
    problems[0],
    /^NEW file over its package's comment share: src\/new\.ts is 60\.0% \(60\/100\), the package is 40\.0%/,
  );
  assert.match(problems[1], /^NEW comment block over 12 lines: src\/new\.ts has 1/);
});

test("a new file at or under its package's share passes", () => {
  assert.deepEqual(judge("src/new.ts", { lines: 100, comment: 40, long: 0 }, null, PACKAGE), []);
});

test("a rename names both of its paths; everything else names one twice", () => {
  const status = "R100\tpkg/src/old.ts\tpkg/src/new.ts\nM\tpkg/src/kept.ts\nA\tpkg/src/added.ts";
  assert.deepEqual(changedPaths(status), [
    { status: "R", from: "pkg/src/old.ts", to: "pkg/src/new.ts" },
    { status: "M", from: "pkg/src/kept.ts", to: "pkg/src/kept.ts" },
    { status: "A", from: "pkg/src/added.ts", to: "pkg/src/added.ts" },
  ]);
});

test("a pure rename passes, and a rename that adds comments still fails", () => {
  const before = "/**\n * why this exists\n */\nexport const a = 1;\n";
  const after = `// and three\n// more lines\n// of prose\n${before}`;
  const base = measure(before, ".ts");
  assert.deepEqual(judge("src/new.ts", measure(before, ".ts"), base, PACKAGE), []);
  const problems = judge("src/new.ts", measure(after, ".ts"), base, PACKAGE);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^RAISED comment share: src\/new\.ts is /);
  assert.match(problems[0], /3 comment line\(s\) added/);
});

test("a trailing newline counts as a line", () => {
  assert.equal(measure("// a\n", ".ts").lines, 2);
  assert.equal(measure("// a", ".ts").lines, 1);
});

test("only package source is graded, never tests or declarations", () => {
  assert.equal(isSource("packages/studio/src/App.tsx"), true);
  assert.equal(isSource("packages/core/src/runtime/init.ts"), true);
  assert.equal(isSource("packages/core/src/runtime/init.test.ts"), false);
  assert.equal(isSource("packages/core/src/types.d.ts"), false);
  assert.equal(isSource("packages/core/scripts/build.ts"), false);
  assert.equal(isSource("scripts/contrast.ts"), false);
});

// Drives the entry point on a real two-commit repo, so the merge-base and diff wiring are tested.
function runCli(t, base, head) {
  const root = mkdtempSync(path.join(tmpdir(), "comment-ratchet-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (entries) => {
    for (const [rel, body] of Object.entries(entries)) {
      mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
      writeFileSync(path.join(root, rel), body);
    }
  };
  const identity = ["-c", "user.email=t@example.com", "-c", "user.name=Test"];
  const run = (...argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" });
  run("init", "-q");
  write(base);
  run("add", "-A");
  run(...identity, "commit", "-qm", "base", "--no-gpg-sign");
  const baseSha = run("rev-parse", "HEAD").trim();
  for (const rel of Object.keys(base)) if (!(rel in head)) rmSync(path.join(root, rel));
  write(head);
  run("add", "-A");
  run(...identity, "commit", "-qm", "head", "--no-gpg-sign");
  const env = { ...process.env, COMMENT_CHECK_BASE: baseSha };
  const cli = spawnSync(process.execPath, [RATCHET], { cwd: root, encoding: "utf8", env });
  return { status: cli.status, output: `${cli.stdout}${cli.stderr}` };
}

const FILE = "packages/web/src/a.ts";
const code = "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n";

test("the CLI fails a diff that adds comment lines to a package source file", (t) => {
  const { status, output } = runCli(t, { [FILE]: code }, { [FILE]: `// why b is two\n${code}` });
  assert.equal(status, 1, output);
  assert.match(output, /RAISED comment share: packages\/web\/src\/a\.ts/);
});

test("the CLI passes a diff that adds code, deletes a file, or edits a test", (t) => {
  const other = "packages/web/src/gone.ts";
  const spec = "packages/web/src/a.test.ts";
  const { status, output } = runCli(
    t,
    { [FILE]: code, [other]: code, [spec]: code },
    { [FILE]: `${code}export const d = 4;\n`, [spec]: `// a note\n${code}` },
  );
  assert.equal(status, 0, output);
  assert.match(output, /1 changed source file\(s\) at or under their share/);
});

test("the CLI holds a new file to its own package's share", (t) => {
  const quiet = "packages/quiet/src/a.ts";
  const loud = "packages/quiet/src/b.ts";
  const { status, output } = runCli(
    t,
    { [quiet]: code },
    { [quiet]: code, [loud]: `// hi\n${code}` },
  );
  assert.equal(status, 1, output);
  assert.match(output, /NEW file over its package's comment share: packages\/quiet\/src\/b\.ts/);
});

// New files must not set their own bar: a whole new package is held to the other packages.
test("the CLI fails a new package whose files are all heavy with comments", (t) => {
  const fresh = (name) => `packages/fresh/src/${name}.ts`;
  const heavy = `// one\n// two\n// three\n${code}`;
  const { status, output } = runCli(
    t,
    { [FILE]: code },
    { [FILE]: code, [fresh("a")]: heavy, [fresh("b")]: heavy },
  );
  assert.equal(status, 1, output);
  assert.match(output, /NEW file over its package's comment share: packages\/fresh\/src\/a\.ts/);
});
