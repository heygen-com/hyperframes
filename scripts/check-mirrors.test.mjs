// guards: **
import assert from "node:assert/strict";
import test from "node:test";
import { mirrorIssues, ratchet } from "./check-mirrors.mjs";
const pair = { left: "source/a.mjs", right: "copy/a.mjs" };
const empty = { total: 0, files: {} };
const manifest = { pairs: [pair], allowlist: [] };
const check = (tree, config = manifest) => mirrorIssues(Object.keys(tree), (file) => Buffer.from(tree[file]), config);

test("a planted drift on either side fails and synchronizing passes", () => {
  for (const side of [pair.left, pair.right]) {
    const tree = { [pair.left]: "same", [pair.right]: "same" };
    tree[side] = "different";
    assert.match(ratchet(check(tree), empty).join("\n"), /new mirror violation/);
    tree[pair.left] = tree[pair.right];
    assert.deepEqual(ratchet(check(tree), empty), []);
  }
});
test("missing mirrors fail even with an intentional divergence allowance", () => {
  const config = { ...manifest, allowlist: [{ ...pair, reason: "Standalone adapter" }] };
  assert.equal(check({ [pair.left]: "x" }, config)[0].file, pair.right);
});
test("only exact reasoned pair allowances permit divergent bytes", () => {
  const tree = { [pair.left]: "a", [pair.right]: "b" };
  assert.deepEqual(check(tree, { ...manifest, allowlist: [{ ...pair, reason: "Standalone adapter" }] }), []);
  assert.throws(() => check(tree, { ...manifest, allowlist: [{ ...pair, reason: "" }] }), /unexplained/);
  assert.throws(() => check(tree, { ...manifest, allowlist: [{ ...pair, right: "copy/b.mjs", reason: "stale" }] }), /Stale/);
});
test("duplicate reversed pairs and self pairs fail", () => {
  assert.throws(() => check({}, { pairs: [pair, { left: pair.right, right: pair.left }], allowlist: [] }), /duplicate/);
  assert.throws(() => check({}, { pairs: [{ left: pair.left, right: pair.left }], allowlist: [] }), /different files/);
});
test("baseline debt only shrinks and cannot move between files", () => {
  const old = { total: 1, files: { "source/a.mjs": 1 } };
  assert.deepEqual(ratchet([{ file: "source/a.mjs" }], old), []);
  assert.match(ratchet([{ file: "copy/a.mjs" }], old).join("\n"), /new mirror violation/);
  assert.match(ratchet([], old).join("\n"), /lower baseline/);
  assert.match(ratchet([{ file: "source/a.mjs" }], old, empty).join("\n"), /only shrink/);
  assert.deepEqual(ratchet([], empty, old), []);
});
