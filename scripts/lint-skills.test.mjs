// Positive / negative fixture tests for the SKILL.md frontmatter drift guard
// in scripts/lint-skills.ts. Runs the exported `lintFrontmatter` against known
// inputs and asserts the violation set matches expectation.
//
// Kept in .mjs (not .ts) so `node --test` can execute it via the same runner
// the rest of scripts/*.test.mjs use, without needing tsx. `bun scripts/…`
// runs .ts directly at lint-time; tests import the compiled export via tsx.

import test from "node:test";
import assert from "node:assert/strict";
import { lintFrontmatter } from "./lint-skills.ts";

const wrap = (frontmatter) => `---\n${frontmatter}\n---\n\n# body\n`;

// ---------------------------------------------------------------------------
// Positive fixtures — must pass with zero violations
// ---------------------------------------------------------------------------

test("valid: bare required keys", () => {
  const violations = lintFrontmatter(wrap("name: foo\ndescription: bar"));
  assert.deepEqual(violations, []);
});

test("valid: with license (optional string)", () => {
  const violations = lintFrontmatter(wrap("name: foo\ndescription: bar\nlicense: MIT"));
  assert.deepEqual(violations, []);
});

test("valid: allowed-tools as YAML sequence", () => {
  const violations = lintFrontmatter(
    wrap("name: foo\ndescription: bar\nallowed-tools:\n  - Bash\n  - Read"),
  );
  assert.deepEqual(violations, []);
});

test("valid: allowed-tools as single string", () => {
  const violations = lintFrontmatter(wrap('name: foo\ndescription: bar\nallowed-tools: "Bash"'));
  assert.deepEqual(violations, []);
});

test("valid: metadata as nested mapping", () => {
  const violations = lintFrontmatter(
    wrap("name: foo\ndescription: bar\nmetadata:\n  version: 1\n  tags:\n    - a\n    - b"),
  );
  assert.deepEqual(violations, []);
});

test("valid: multi-line description via block scalar", () => {
  const violations = lintFrontmatter(
    wrap("name: foo\ndescription: |\n  Multi\n  line\n  description"),
  );
  assert.deepEqual(violations, []);
});

test("valid: description with a colon inside a quoted string", () => {
  const violations = lintFrontmatter(wrap('name: foo\ndescription: "read: file, then: write"'));
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// Negative fixtures — must produce at least one matching violation
// ---------------------------------------------------------------------------

const has = (violations, needle) =>
  violations.some((v) => v.message.toLowerCase().includes(needle.toLowerCase()));

test("invalid: missing frontmatter block", () => {
  const violations = lintFrontmatter("# just a body, no dashes\n");
  assert.ok(has(violations, "Missing SKILL.md YAML frontmatter"));
});

test("invalid: missing name", () => {
  const violations = lintFrontmatter(wrap("description: bar"));
  assert.ok(has(violations, `Missing required frontmatter key "name"`));
});

test("invalid: missing description", () => {
  const violations = lintFrontmatter(wrap("name: foo"));
  assert.ok(has(violations, `Missing required frontmatter key "description"`));
});

test("invalid: unsupported key (the 'category' drift case)", () => {
  const violations = lintFrontmatter(wrap("name: foo\ndescription: bar\ncategory: motion"));
  assert.ok(has(violations, `Unsupported frontmatter key "category"`));
});

test("invalid: name as a list (was silently accepted by the pre-YAML version)", () => {
  const violations = lintFrontmatter(wrap("name: [a, b]\ndescription: bar"));
  assert.ok(has(violations, `"name" must be a string`));
});

test("invalid: description as a number", () => {
  const violations = lintFrontmatter(wrap("name: foo\ndescription: 42"));
  assert.ok(has(violations, `"description" must be a string`));
});

test("invalid: empty description string", () => {
  const violations = lintFrontmatter(wrap('name: foo\ndescription: ""'));
  assert.ok(has(violations, `"description" must not be empty`));
});

test("invalid: allowed-tools as a mapping (must be sequence or string)", () => {
  const violations = lintFrontmatter(
    wrap("name: foo\ndescription: bar\nallowed-tools:\n  Bash: true"),
  );
  assert.ok(has(violations, `"allowed-tools" must be a string or a list of strings`));
});

test("invalid: metadata as a scalar (must be a mapping)", () => {
  const violations = lintFrontmatter(
    wrap('name: foo\ndescription: bar\nmetadata: "just a string"'),
  );
  assert.ok(has(violations, `"metadata" must be a mapping`));
});

test("invalid: malformed YAML (unmatched brace)", () => {
  const violations = lintFrontmatter(wrap("name: foo\ndescription: {"));
  assert.ok(has(violations, `Malformed YAML frontmatter`));
});

test("invalid: top-level scalar (frontmatter is not a mapping)", () => {
  const violations = lintFrontmatter("---\njust-a-string\n---\n\nbody");
  // Either parse succeeds and the top-level check catches it, or the parser
  // errors — either is an acceptable rejection, but the violation list must
  // be non-empty.
  assert.ok(violations.length > 0);
});
