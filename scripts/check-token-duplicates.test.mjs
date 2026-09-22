// guards: packages/studio/src/styles/**
import assert from "node:assert/strict";
import test from "node:test";
import { duplicateTokens, ratchet } from "./check-token-duplicates.mjs";
const theme = "packages/studio/src/styles/theme.css";
const baseline = (pairs = {}) => ({
  total: Object.keys(pairs).length,
  files: { [theme]: Object.keys(pairs).length },
  pairs,
});

test("a planted duplicate fails and replacing it with an alias passes", () => {
  assert.match(
    ratchet(duplicateTokens("--a: #fff; --b: #fff;"), baseline()).join("\n"),
    /duplicate value/,
  );
  assert.deepEqual(ratchet(duplicateTokens("--a: #fff; --b: var(--a);"), baseline()), []);
});

test("multiline values normalize whitespace and comments do not declare tokens", () => {
  const css = "/* --fake: red; */ --a: 0  1px\nred; --b: 0 1px red;";
  assert.deepEqual(duplicateTokens(css), [
    { tokens: ["--a", "--b"], value: "0 1px red", key: "--a + --b" },
  ]);
});

test("multiple aliases may share a referenced token", () => {
  assert.deepEqual(duplicateTokens("--a: red; --b: var(--a); --c: var(--a);"), []);
});

test("allowances bind both names and value and require a reason", () => {
  const allow = [{ tokens: ["--b", "--a"], value: "red", reason: "Separate semantic roles" }];
  assert.deepEqual(duplicateTokens("--a: red; --b: red;", allow), []);
  assert.equal(duplicateTokens("--a: blue; --b: blue;", allow).length, 1);
  assert.equal(duplicateTokens("--a: red; --b: red;", [{ ...allow[0], reason: "" }]).length, 1);
});

test("a third token creates new pairs instead of spending an existing budget", () => {
  const old = baseline({ "--a + --b": "red" });
  assert.deepEqual(ratchet(duplicateTokens("--a:red;--b:red;"), old), []);
  assert.equal(ratchet(duplicateTokens("--a:red;--b:red;--c:red;"), old).length, 2);
});

test("baselines only shrink and cannot substitute new pairs", () => {
  const old = baseline({ "--a + --b": "red" });
  const next = baseline({ "--a + --c": "red" });
  assert.match(ratchet(duplicateTokens("--a:red;--c:red;"), next, old).join("\n"), /only shrink/);
  assert.match(ratchet([], old).join("\n"), /stale/);
  assert.deepEqual(ratchet([], baseline(), old), []);
});

test("repeated definitions are ambiguous and fail closed", () => {
  assert.throws(() => duplicateTokens("--a: red; --a: blue;"), /Ambiguous/);
});
