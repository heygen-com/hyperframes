import assert from "node:assert/strict";
import { test } from "node:test";
import { findTokenParityIssues, normalizeColor, parityVerdict } from "./check-token-parity.mjs";

const diff = (old, next) =>
  `--- a/packages/a.ts\n+++ b/packages/a.ts\n@@ -1 +1 @@\n-${old}\n+${next}\n`;
const empty = { total: 0, files: {} };

test("planted wrong token fails and matching token passes", () => {
  const change = diff('color: "#fff"', 'color: "var(--text)"');
  assert.equal(parityVerdict(findTokenParityIssues(change, "--text: #0f0;"), empty).length, 1);
  assert.deepEqual(findTokenParityIssues(change, "--text: #ffffff;"), []);
});

test("normalizes colour notation and alpha precision", () => {
  assert.equal(normalizeColor("#fff"), normalizeColor("rgb(255 255 255)"));
  assert.equal(normalizeColor("#ffffff33"), normalizeColor("rgba(255,255,255,0.20)"));
  assert.equal(normalizeColor("hsl(120 100% 50% / 50%)"), normalizeColor("rgba(0,255,0,0.5)"));
});

test("checks Tailwind slash opacity swaps", () => {
  const change = diff('className="border-white/20"', 'className="border-[var(--border)]"');
  assert.equal(findTokenParityIssues(change, "--border: rgba(60,230,172,0.2);").length, 1);
  assert.deepEqual(findTokenParityIssues(change, "--border: rgba(255,255,255,0.2);"), []);
});

test("compares a whole shorthand rather than its colour alone", () => {
  const change = diff('boxShadow: "0 1px 2px rgba(0,0,0,0.85)"', 'boxShadow: "var(--shadow)"');
  assert.deepEqual(findTokenParityIssues(change, "--shadow: 0 1px 2px rgba(0,0,0,0.85);"), []);
  assert.equal(findTokenParityIssues(change, "--shadow: 0 4px 2px rgba(0,0,0,0.85);").length, 1);
});

test("aliases resolve and undocumented tokens fail", () => {
  const change = diff('color: "#fff"', 'color: "var(--alias)"');
  assert.deepEqual(findTokenParityIssues(change, "--alias: var(--white); --white: #fff;"), []);
  assert.equal(findTokenParityIssues(change, "").length, 1);
  assert.throws(() => findTokenParityIssues(change, "--alias: var(--alias);"), /Cyclic/);
});

test("allowlist requires an exact replacement and a reason", () => {
  const before = 'color: "#fff"',
    after = 'color: "var(--text)"';
  const rule = { file: "packages/a.ts", before, after, reason: "Intentional contrast change" };
  assert.deepEqual(findTokenParityIssues(diff(before, after), "--text: #000;", [rule]), []);
  assert.equal(
    findTokenParityIssues(diff(before, after), "--text: #000;", [{ ...rule, reason: "" }]).length,
    1,
  );
});

test("baseline cannot be raised to hide a migration", () => {
  const issues = findTokenParityIssues(diff('color: "#fff"', 'color: "var(--x)"'), "--x: #000;");
  assert.equal(parityVerdict(issues, { total: 1, files: { "packages/a.ts": 1 } }, empty).length, 1);
});

test("reordered properties still compare the colour slot", () => {
  const change =
    '--- a/packages/a.ts\n+++ b/packages/a.ts\n@@ -1,2 +1,2 @@\n-color: "#fff"\n-width: 1\n+width: 2\n+color: "var(--x)"';
  assert.equal(findTokenParityIssues(change, "--x: #000;").length, 1);
});

test("unrelated variable changes beside a colour are not migrations", () => {
  assert.deepEqual(
    findTokenParityIssues(
      diff('color: "#fff", width: 1', 'color: "#fff", width: "var(--size)"'),
      "--size: 1px;",
    ),
    [],
  );
});

test("defined tokens override fallbacks and fractional alpha stays distinct", () => {
  assert.equal(
    findTokenParityIssues(diff('color: "#fff"', 'color: "var(--x, #fff)"'), "--x: #000;").length,
    1,
  );
  assert.notEqual(normalizeColor("rgba(0,0,0,.100)"), normalizeColor("rgba(0,0,0,.101)"));
});

test("duplicate additions cannot hide a second wrong replacement", () => {
  const change =
    '--- a/packages/a.ts\n+++ b/packages/a.ts\n@@ -1,2 +1,2 @@\n-color: "#fff"\n-color: "#000"\n+color: "var(--x)"\n+color: "var(--x)"';
  assert.equal(findTokenParityIssues(change, "--x: #f00;").length, 2);
});

test("arbitrary Tailwind literals are colour migrations", () => {
  assert.equal(
    findTokenParityIssues(diff('className="bg-[#fff]"', 'className="bg-[var(--x)]"'), "--x: #000;")
      .length,
    1,
  );
});

test("class utilities do not hide inline colour slots", () => {
  const old = '<div className="bg-black" style={{color: "#fff"}} />';
  const next = '<div className="bg-black" style={{color: "var(--x)"}} />';
  assert.equal(findTokenParityIssues(diff(old, next), "--x: #000;").length, 1);
});

test("swapping opposite token values between declarations fails", () => {
  const change =
    "--- a/packages/a.css\n+++ b/packages/a.css\n@@ -1,2 +1,2 @@\n-.a { color: #fff; }\n-.b { color: #000; }\n+.a { color: var(--black); }\n+.b { color: var(--white); }";
  assert.equal(findTokenParityIssues(change, "--black: #000; --white: #fff;").length, 2);
});

test("unchanged colours consume their declaration before later migrations", () => {
  const change =
    "--- a/a.css\n+++ b/a.css\n@@ -1,2 +1,2 @@\n-.a { color: #fff; width: 1; }\n-.b { color: #000; }\n+.a { color: #fff; width: 2; }\n+.b { color: var(--white); }";
  assert.equal(findTokenParityIssues(change, "--white: #fff;").length, 1);
});

test("a deleted declaration cannot supply another selector's old colour", () => {
  const change =
    "--- a/a.css\n+++ b/a.css\n@@ -1,2 +1 @@\n-.a { color: #fff; }\n-.b { color: #000; }\n+.b { color: var(--white); }";
  assert.equal(findTokenParityIssues(change, "--white: #fff;").length, 1);
});

test("a deleted nonliteral declaration cannot hide an ambiguous colour migration", () => {
  const change =
    "--- a/a.css\n+++ b/a.css\n@@ -1,6 +1,3 @@\n-.a {\n- color: inherit;\n-}\n-.b {\n- color: #000;\n-}\n+.b {\n+ color: var(--white);\n+}";
  assert.equal(findTokenParityIssues(change, "--white: #fff;").length, 1);
});
