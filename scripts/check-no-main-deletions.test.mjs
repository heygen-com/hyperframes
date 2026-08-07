import { strict as assert } from "node:assert";
import { test } from "node:test";

import { classify, parseBase } from "./check-no-main-deletions.mjs";

test("a branch that only adds reports nothing", () => {
  const { deleted, renamed } = classify("A\tpackages/cli/src/new.ts\nM\tpackages/cli/src/old.ts\n");
  assert.deepEqual(deleted, []);
  assert.deepEqual(renamed, []);
});

test("a deleted file is named", () => {
  const { deleted } = classify("D\t.agents/skills/README.md\nA\tsrc/new.ts\n");
  assert.deepEqual(deleted, [".agents/skills/README.md"]);
});

test("a rename is not reported as a deletion", () => {
  // The false alarm worth avoiding: in a name-only diff a rename looks exactly
  // like loss, and a check that cried wolf on every move would be turned off.
  const { deleted, renamed } = classify("R096\tsrc/old/name.ts\tsrc/new/name.ts\n");
  assert.deepEqual(deleted, []);
  assert.deepEqual(renamed, [{ from: "src/old/name.ts", to: "src/new/name.ts" }]);
});

test("deletions and renames are separated in one diff", () => {
  const { deleted, renamed } = classify(
    "D\tdocs/gone.md\nR100\ta.ts\tb.ts\nM\tc.ts\nD\tdocs/also-gone.md\n",
  );
  assert.deepEqual(deleted, ["docs/gone.md", "docs/also-gone.md"]);
  assert.equal(renamed.length, 1);
});

test("the base ref defaults, and an explicit one is honoured", () => {
  assert.equal(parseBase([]), "origin/main");
  assert.equal(parseBase(["--base", "origin/release"]), "origin/release");
});

test("a --base with no value fails rather than silently defaulting", () => {
  // Silently falling back would diff against the wrong ref and report a pass.
  assert.throws(() => parseBase(["--base"]), /needs a ref/);
  assert.throws(() => parseBase(["--base", "--other"]), /needs a ref/);
});
