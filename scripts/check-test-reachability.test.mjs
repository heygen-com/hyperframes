import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { audit, digest, pinnedSource, verdict } from "./check-test-reachability.mjs";

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

test("planted guard-filter hole fails and adding its directory passes", () => {
  const tree = fixture();
  assert.match(verdict(check(tree))[0], /CI filters exclude skills\/lib/);
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

test("zero orphans passes and any orphan fails", () => {
  assert.deepEqual(verdict({}), []);
  assert.deepEqual(verdict({ "a.test.ts": ["orphan"] }), ["a.test.ts: orphan"]);
});

test("a baseline file is forbidden even with zero orphans", () => {
  assert.match(verdict({}, true)[0], /baseline is forbidden/);
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

test("single-line shell conditions cannot credit their guarded runner", () => {
  const tree = fixture("test -f dist/bundle.js && node --test scripts/parity.test.mjs", '"**"');
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("folded shell conditions cannot credit their guarded runner", () => {
  const tree = fixture(
    ">-\n          test -f dist/bundle.js &&\n          node --test scripts/parity.test.mjs",
    '"**"',
  );
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("directory changes cannot credit a runner at the original working directory", () => {
  const tree = fixture("cd elsewhere && node --test scripts/parity.test.mjs", '"**"');
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("fallback shell branches cannot credit conditional runners", () => {
  const tree = fixture("false || true && node --test scripts/parity.test.mjs", '"**"');
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("ordinary sequential runners remain reachable", () => {
  const tree = fixture("node --test scripts/parity.test.mjs && vitest run", '"**"');
  assert.deepEqual(check(tree), {});
});

test("known false commands cannot credit later runners", () => {
  const tree = fixture("false && node --test scripts/parity.test.mjs", '"**"');
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("negated shell commands cannot credit later runners", () => {
  const tree = fixture("! true && node --test scripts/parity.test.mjs", '"**"');
  assert.match(check(tree)["scripts/parity.test.mjs"][0], /no CI runner/);
});

test("a missing pinned package gives the runner mapping diagnostic", () => {
  assert.throws(
    () => pinnedSource("missing/package.json#script#test", () => undefined),
    /Runner mapping needs review: missing\/package.json#script#test/,
  );
});

test("report CLI prints diagnostics without applying the gate verdict", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "reachability-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const tree = fixture("node --test scripts/parity.test.mjs", '"**"');
  tree["scripts/test-reachability.json"] = JSON.stringify({ guards: {}, runners: [] });
  for (const [path, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  execFileSync("git", ["init", "--quiet"], { cwd });
  execFileSync("git", ["add", "."], { cwd });
  const script = fileURLToPath(new URL("./check-test-reachability.mjs", import.meta.url));
  const run = () => spawnSync(process.execPath, [script, "--report"], { cwd, encoding: "utf8" });
  const clean = run();
  assert.equal(clean.status, 0, clean.stderr);
  const baseline = join(cwd, "scripts/test-reachability-baseline.json");
  writeFileSync(baseline, '{"total":0,"files":{}}');
  const restored = run();
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(JSON.parse(restored.stdout), {});
  rmSync(baseline);
  writeFileSync(join(cwd, "scripts/orphan.test.mjs"), "");
  execFileSync("git", ["add", "."], { cwd });
  const orphan = run();
  assert.equal(orphan.status, 0, orphan.stderr);
  assert.match(orphan.stdout, /orphan.test.mjs/);
});
