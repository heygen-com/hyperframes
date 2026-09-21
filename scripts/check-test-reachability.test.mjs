import assert from "node:assert/strict";
import { test } from "node:test";
import { audit, digest, ratchet } from "./check-test-reachability.mjs";

function fixture(command = "bun run test:scripts", filter = '"scripts/**"') {
  return {
    ".github/workflows/ci.yml": `name: CI
jobs:
  changes:
    steps:
      - uses: dorny/paths-filter@v4
        with:
          filters: |
            code:
              - ${filter}
  test:
    needs: changes
    if: needs.changes.outputs.code == 'true'
    steps:
      - run: ${command}
`,
    "package.json": JSON.stringify({
      scripts: { "test:scripts": "node --test scripts/parity.test.mjs" },
    }),
    "scripts/parity.test.mjs": "// guards: skills/lib/**\n",
    "skills/lib/a.mjs": "",
  };
}
const check = (tree, manifest = { guards: {}, runners: [] }) =>
  audit(Object.keys(tree), (path) => tree[path], manifest);
const empty = { total: 0, files: {} };

test("planted guard-filter hole fails and adding its directory passes", () => {
  const tree = fixture();
  assert.match(ratchet(check(tree), empty)[0], /CI filters exclude skills\/lib/);
  tree[".github/workflows/ci.yml"] = tree[".github/workflows/ci.yml"].replace(
    '"scripts/**"',
    '"scripts/**"\n              - "skills/**"',
  );
  assert.deepEqual(check(tree), {});
});

test("removing a test from a package script makes it an orphan", () => {
  const tree = fixture("bun run test:scripts", '"**"');
  assert.deepEqual(check(tree), {});
  tree["package.json"] = JSON.stringify({
    scripts: { "test:scripts": "node --test scripts/other.test.mjs" },
  });
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("workspace scripts honor Vite include and exclude instead of package membership", () => {
  const tree = fixture("bun run --filter '*' test", '"**"');
  delete tree["scripts/parity.test.mjs"];
  tree["packages/a/package.json"] = JSON.stringify({
    name: "@scope/a",
    scripts: { test: "vitest run" },
  });
  tree["packages/a/src/a.test.ts"] = "";
  tree["packages/a/vite.config.ts"] =
    'export default { test: { include: ["src/**/*.test.ts"], exclude: ["src/a.test.ts"] } }';
  assert.match(check(tree)["packages/a/src/a.test.ts"][0], /no CI runner/);
  tree["packages/a/vite.config.ts"] =
    'export default { test: { include: ["src/**/*.test.ts"], coverage: { include: ["missing/**"] } } }';
  assert.deepEqual(check(tree), {});
});

test("job dependencies can prevent an otherwise unfiltered job from running", () => {
  const tree = fixture("node --test scripts/parity.test.mjs", '"**"');
  tree[".github/workflows/ci.yml"] =
    tree[".github/workflows/ci.yml"].replace("    needs: changes", "    needs: disabled") +
    "  disabled:\n    if: false\n    steps: []\n";
  assert.match(check(tree)["scripts/parity.test.mjs"].join("\n"), /CI filters exclude/);
});

test("folded commands select tests but conditional steps are not assumed to run", () => {
  const tree = fixture(">-\n          node --test\n          scripts/parity.test.mjs", '"**"');
  assert.deepEqual(check(tree), {});
  tree[".github/workflows/ci.yml"] += "        if: false\n";
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("workflow path restrictions cannot silently manufacture reachability", () => {
  const tree = fixture();
  tree[".github/workflows/ci.yml"] =
    "on:\n  pull_request:\n    paths: [docs/**]\n" + tree[".github/workflows/ci.yml"];
  assert.throws(() => check(tree), /trigger restrictions/);
});

test("unknown runner options and config formats fail closed", () => {
  const tree = fixture("vitest run --exclude scripts/parity.test.mjs", '"**"');
  assert.throws(() => check(tree), /Unsupported test option/);
  tree[".github/workflows/ci.yml"] = fixture("vitest run", '"**"')[".github/workflows/ci.yml"];
  tree["vitest.config.js"] = 'export default { test: { exclude: ["**"] } }';
  assert.throws(() => check(tree), /Unsupported runner config/);
});

test("custom runner mappings require matching commands and unchanged producer sources", () => {
  const tree = fixture("node custom.mjs", '"**"');
  tree["custom.mjs"] = "original runner";
  const manifest = {
    guards: {},
    runners: [
      {
        cwd: ".",
        command: "node custom.mjs",
        tests: ["scripts/*.test.mjs"],
        sources: { "custom.mjs": digest(tree["custom.mjs"]) },
        reason: "fixture",
      },
    ],
  };
  assert.deepEqual(check(tree, manifest), {});
  tree["custom.mjs"] = "changed selection";
  assert.throws(() => check(tree, manifest), /mapping needs review/);
});

test("baselines accept existing debt, reject new debt and cannot be raised", () => {
  const issues = { "a.test.ts": ["orphan"] };
  const baseline = { total: 1, files: { "a.test.ts": 1 } };
  assert.deepEqual(ratchet(issues, baseline), []);
  assert.match(ratchet({ ...issues, "new.test.ts": ["orphan"] }, baseline)[0], /new.test.ts/);
  assert.match(ratchet(issues, baseline, empty)[0], /only shrink/);
  assert.match(ratchet({}, baseline)[0], /lower baseline/);
});

test("conditions in the first step key are never credited", () => {
  const tree = fixture("node --test scripts/parity.test.mjs", '"**"');
  tree[".github/workflows/ci.yml"] = tree[".github/workflows/ci.yml"].replace(
    "      - run:",
    "      - if: false\n        run:",
  );
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("block dependency syntax fails closed instead of losing the dependency", () => {
  const tree = fixture();
  tree[".github/workflows/ci.yml"] = tree[".github/workflows/ci.yml"].replace(
    "needs: changes",
    "needs:\n      - disabled",
  );
  assert.throws(() => check(tree), /Block job/);
});

test("runner excludes after nested coverage options still apply", () => {
  const tree = fixture("vitest run", '"**"');
  tree["vitest.config.ts"] =
    'export default { test: { coverage: { include: ["**"] }, exclude: ["**"] } }';
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("a disabled change detector prevents dependent tests from running", () => {
  const tree = fixture("node --test scripts/parity.test.mjs", '"**"');
  tree[".github/workflows/ci.yml"] = tree[".github/workflows/ci.yml"].replace(
    "  changes:\n",
    "  changes:\n    if: false\n",
  );
  assert.match(check(tree)["scripts/parity.test.mjs"].join("\n"), /CI filters exclude/);
});

test("quoted runner selection keys cannot silently change collection", () => {
  const tree = fixture("vitest run", '"**"');
  tree["vitest.config.ts"] = 'export default { test: { "exclude": ["**"] } }';
  assert.throws(() => check(tree), /Quoted test selection/);
});

test("quoted comments do not widen path filters", () => {
  const tree = fixture("node --test scripts/parity.test.mjs", '"scripts/**" # "skills/**"');
  assert.match(check(tree)["scripts/parity.test.mjs"].join("\n"), /CI filters exclude skills/);
});

test("runner verbs must match exactly", () => {
  const tree = fixture("vitest run-anything", '"**"');
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("conditional shell blocks are not split into unconditional runners", () => {
  const tree = fixture(
    "|\n          if false; then\n            true && node --test scripts/parity.test.mjs && true\n          fi",
    '"**"',
  );
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});
