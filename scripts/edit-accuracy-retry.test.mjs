import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

// A slow runner must not drop a PR from the merge queue: its shard is marked, re-run once on a fresh runner,
// and the re-run's evidence is what the gate reads.
const ci = parse(
  readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "ci.yml"), "utf8"),
);
const jobs = ci.jobs;
const step = (job, name) => jobs[job].steps.find((s) => s.name === name);

// Runs a step's shell with its fixed paths moved under root; returns what it wrote to GITHUB_OUTPUT.
function runStep(script, root, env = {}) {
  const output = join(root, "github-output");
  writeFileSync(output, "");
  execFileSync("bash", ["-euo", "pipefail", "-c", script.replaceAll("/tmp/", `${root}/`)], {
    env: { ...process.env, GITHUB_OUTPUT: output, ...env },
  });
  return readFileSync(output, "utf8");
}

function withTree(fn) {
  const root = mkdtempSync(join(tmpdir(), "edit-accuracy-retry-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const markScript = (status) =>
  step("studio-edit-accuracy", "Mark a slow or cancelled shard for a re-run").run.replaceAll(
    "${{ job.status }}",
    status,
  );

test("a shard is marked for a re-run when it timed out or its bench stopped on a slow runner", () => {
  withTree((root) => {
    runStep(markScript("cancelled"), root);
    assert.ok(existsSync(join(root, "edit-accuracy/retry")));
  });
  withTree((root) => {
    mkdirSync(join(root, "edit-accuracy/run1"), { recursive: true });
    writeFileSync(join(root, "edit-accuracy/run1/slow-runner.json"), "{}");
    runStep(markScript("failure"), root);
    assert.ok(existsSync(join(root, "edit-accuracy/retry")));
  });
  withTree((root) => {
    runStep(markScript("success"), root);
    assert.ok(!existsSync(join(root, "edit-accuracy/retry")));
  });
});

test("the retry plan lists exactly the marked shards", () => {
  const plan = step("studio-edit-accuracy-retry-plan", "List the shards marked for a re-run").run;
  withTree((root) => {
    for (let shard = 1; shard <= 12; shard++)
      mkdirSync(join(root, `edit-accuracy-shards/edit-accuracy-shard-${shard}`), {
        recursive: true,
      });
    writeFileSync(join(root, "edit-accuracy-shards/edit-accuracy-shard-7/retry"), "");
    writeFileSync(join(root, "edit-accuracy-shards/edit-accuracy-shard-12/retry"), "");
    assert.equal(runStep(plan, root, { EDIT_ACCURACY_SHARDS: "12" }), "shards=[7,12]\n");
  });
  withTree((root) => {
    mkdirSync(join(root, "edit-accuracy-shards/edit-accuracy-shard-1"), { recursive: true });
    assert.equal(runStep(plan, root, { EDIT_ACCURACY_SHARDS: "1" }), "shards=[]\n");
  });
});

test("the retry plan also re-runs a shard whose evidence never uploaded", () => {
  const plan = step("studio-edit-accuracy-retry-plan", "List the shards marked for a re-run").run;
  withTree((root) => {
    for (const shard of [1, 2, 4])
      mkdirSync(join(root, `edit-accuracy-shards/edit-accuracy-shard-${shard}`), {
        recursive: true,
      });
    writeFileSync(join(root, "edit-accuracy-shards/edit-accuracy-shard-2/retry"), "");
    assert.equal(runStep(plan, root, { EDIT_ACCURACY_SHARDS: "5" }), "shards=[2,3,5]\n");
  });
});

test("each marked shard re-runs once and replaces its evidence before the gate reads it", () => {
  const retry = jobs["studio-edit-accuracy-retry"];
  assert.match(retry.needs.join(" "), /studio-edit-accuracy-retry-plan/);
  assert.match(
    retry.strategy.matrix.shard,
    /needs\.studio-edit-accuracy-retry-plan\.outputs\.shards/,
  );
  const shardRun = retry.steps.find((s) => s.run?.includes("edit-accuracy-shard.sh"));
  assert.ok(shardRun, "the retry runs the same shard script as the shard job");
  assert.ok(
    jobs["studio-edit-accuracy"].steps.some((s) =>
      s.run?.includes("scripts/ci/edit-accuracy-shard.sh"),
    ),
  );
  const upload = retry.steps.find((s) => s.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload.with.name, "edit-accuracy-shard-${{ matrix.shard }}");
  assert.equal(upload.with.overwrite, true);
  assert.ok(jobs["studio-edit-accuracy-gate"].needs.includes("studio-edit-accuracy-retry"));
  assert.match(jobs["studio-edit-accuracy-gate"].if, /!cancelled\(\)/);
});

test("the shard matrix runs exactly the shards the count names, for the merge queue and for pull requests", () => {
  const [, queue, pr] = ci.env.EDIT_ACCURACY_SHARDS.match(/&& (\d+) \|\| (\d+)/);
  const lists = [...jobs["studio-edit-accuracy"].strategy.matrix.shard.matchAll(/'(\[[^']*\])'/g)];
  assert.deepEqual(
    lists.map((m) => JSON.parse(m[1])),
    [Number(queue), Number(pr)].map((n) => Array.from({ length: n }, (_, k) => k + 1)),
  );
});

test("a cancelled shard and its re-run both fit in the merge queue's 60 minute check wait", () => {
  const shard = jobs["studio-edit-accuracy"]["timeout-minutes"];
  const plan = jobs["studio-edit-accuracy-retry-plan"]["timeout-minutes"];
  const retry = jobs["studio-edit-accuracy-retry"]["timeout-minutes"];
  const gate = jobs["studio-edit-accuracy-gate"]["timeout-minutes"];
  assert.ok(shard + plan + retry + gate <= 60, `${shard}+${plan}+${retry}+${gate} min`);
});
