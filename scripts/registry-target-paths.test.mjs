import { strict as assert } from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

import { isContainedIn, resolveContainedCopies } from "./registry-target-paths.mjs";

// Real fixtures rather than string cases: the second escape this guards is a
// symlink, which only exists on a filesystem. A purely lexical test suite is
// exactly what stayed green through the first version of this check.
let sandbox;
let project;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "hf-registry-paths-"));
  project = join(sandbox, "project");
  mkdirSync(join(project, "nested"), { recursive: true });
  mkdirSync(join(sandbox, "outside"), { recursive: true });
  writeFileSync(join(project, "demo.html"), "<html>\n");
  writeFileSync(join(sandbox, "secret.txt"), "runner secret\n");
  symlinkSync(join(sandbox, "outside"), join(project, "escape"));
  symlinkSync(join(sandbox, "secret.txt"), join(project, "leak.txt"));
  symlinkSync(join(project, "nested"), join(project, "inward"));
});

after(() => rmSync(sandbox, { recursive: true, force: true }));

const allow = (files) => resolveContainedCopies(project, files, existsSync);

test("an ordinary manifest entry is copied", () => {
  // Compared against the real path: the helper resolves the project root, which
  // matters on macOS where the temp directory is itself a symlink.
  const real = realpathSync(project);
  assert.deepEqual(allow([{ path: "demo.html", target: "compositions/demo.html" }]), [
    [resolve(real, "demo.html"), resolve(real, "compositions/demo.html")],
  ]);
});

test("traversal that returns inside the project is allowed", () => {
  assert.equal(allow([{ path: "nested/../demo.html", target: "out/demo.html" }]).length, 1);
});

// Lexical escapes.

test("a traversing path cannot read outside the project", () => {
  assert.deepEqual(allow([{ path: "../secret.txt", target: "stolen.txt" }]), []);
});

test("a traversing target cannot write outside the project", () => {
  assert.deepEqual(allow([{ path: "demo.html", target: "../pwned.txt" }]), []);
});

test("an absolute path or target is refused on either side", () => {
  assert.deepEqual(allow([{ path: "/etc/passwd", target: "stolen.txt" }]), []);
  assert.deepEqual(allow([{ path: "demo.html", target: "/tmp/pwned.txt" }]), []);
});

test("a sibling directory sharing the project's prefix is still outside", () => {
  assert.equal(isContainedIn(project, "../project-evil/x"), false);
});

// Symbolic escapes. resolve()/relative() do not follow links, so every case
// below passed the first, lexical-only version of this check.

test("a symlinked target directory cannot be written through", () => {
  assert.deepEqual(allow([{ path: "demo.html", target: "escape/pwned.txt" }]), []);
});

test("a symlinked source file cannot be read through", () => {
  assert.deepEqual(allow([{ path: "leak.txt", target: "stolen.txt" }]), []);
});

test("a symlink is refused even when it points back inside the project", () => {
  // Rejected rather than followed: nothing in the registry needs a symlink, and
  // allowing one means trusting its target not to change before the copy.
  assert.deepEqual(allow([{ path: "demo.html", target: "inward/a.txt" }]), []);
});

test("a deeper path through a symlinked component is refused", () => {
  assert.deepEqual(allow([{ path: "demo.html", target: "escape/a/b/c.txt" }]), []);
});

test("incomplete entries are skipped rather than resolved", () => {
  assert.deepEqual(allow([{ path: "demo.html" }, { target: "x" }, {}]), []);
});

test("containment does not depend on the candidate existing", () => {
  assert.equal(isContainedIn(project, "../../etc/passwd"), false);
  assert.equal(isContainedIn(project, "not-created-yet/file.txt"), true);
});
