import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const LINT = join(dirname(fileURLToPath(import.meta.url)), "..", "lint_source.py");
const python = ["python3", "python"].find(
  (name) => spawnSync(name, ["-c", "import sys; assert sys.version_info >= (3, 9)"]).status === 0,
);

/** The rule ids `lint_source.py --json` reports for one component whose effect body is `body`. */
function rulesFor(body, deps = "[frame]") {
  const dir = mkdtempSync(join(tmpdir(), "r2hf-lint-"));
  try {
    const file = join(dir, "Scene.tsx");
    writeFileSync(
      file,
      `import { useEffect } from "react";
import { useCurrentFrame } from "remotion";

export const Scene = () => {
  const frame = useCurrentFrame();
  useEffect(() => {
${body}
  }, ${deps});
  return null;
};
`,
    );
    const run = spawnSync(python, [LINT, file, "--json"], { encoding: "utf8" });
    return JSON.parse(run.stdout).findings.map((finding) => finding.rule);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const body = (comment) => `    ${comment}\n    document.title = String(frame);`;

test(
  "an apostrophe in a comment inside the effect does not hide its deps",
  { skip: !python },
  () => {
    assert.ok(rulesFor(body("// do not touch layout here")).includes("r2hf/use-effect-deps"));
    assert.ok(rulesFor(body("// don't touch layout here")).includes("r2hf/use-effect-deps"));
    assert.ok(rulesFor(body("/* don't touch layout */")).includes("r2hf/use-effect-deps"));
    assert.ok(rulesFor(body("// a stray ) in a comment")).includes("r2hf/use-effect-deps"));
  },
);

test("comment markers inside strings are still strings", { skip: !python }, () => {
  assert.ok(rulesFor(`    fetch("https://example.com/a(b");`).includes("r2hf/use-effect-deps"));
  assert.ok(rulesFor(`    const s = "it's /* not a comment";`).includes("r2hf/use-effect-deps"));
});

test(
  "an effect with empty deps stays allowed when its body has a comment",
  { skip: !python },
  () => {
    assert.ok(!rulesFor(body("// don't run twice"), "[]").includes("r2hf/use-effect-deps"));
  },
);
