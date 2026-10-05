import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(
    join(import.meta.dirname, "..", ".github", "workflows", "windows-render.yml"),
    "utf8",
  ),
);
const rollup = workflow.jobs["test-windows"].steps.find(
  (step) => step.name === "Require all Windows test lanes",
).run;

const REPO = "heygen-com/hyperframes";
const run = (id, sha, conclusion) => ({
  id,
  head_sha: sha,
  conclusion,
  head_repository: { full_name: REPO },
});

// Answers `gh api <path> ... --jq <filter>` from fixtures, the way gh applies --jq.
const GH_STUB = `#!/usr/bin/env bash
path="$2"; filter=""
while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && filter="$2"; shift; done
case "$path" in */workflows/*) file="$RUNS_FIXTURE" ;; *) file="$RUN_FIXTURE" ;; esac
jq -r "$filter" "$file"
`;

function rollupExit({ me, runs, lane = "cancelled" }) {
  const dir = mkdtempSync(join(tmpdir(), "windows-rollup-"));
  writeFileSync(join(dir, "gh"), GH_STUB);
  chmodSync(join(dir, "gh"), 0o755);
  writeFileSync(join(dir, "run.json"), JSON.stringify(runs.find((r) => r.id === me)));
  writeFileSync(join(dir, "runs.json"), JSON.stringify({ workflow_runs: runs }));
  const result = spawnSync("bash", ["-e", "-c", rollup], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REPOSITORY: REPO,
      GITHUB_RUN_ID: String(me),
      BRANCH: "fix/branch",
      LANE_RESULT: lane,
      RUN_FIXTURE: join(dir, "run.json"),
      RUNS_FIXTURE: join(dir, "runs.json"),
    },
  });
  return result.status;
}

const SHA = "b24b4cb42b747119f4351c8ca3f43a5ffcb27947";
const OLDER_SHA = "9787bf136f7c9523c2c8b0e5e47edd7e8d25c6bf";

test("a cancelled run passes when its same-commit twin is still running", () => {
  const runs = [run(37263265963, SHA, null), run(37263265713, SHA, null)];
  assert.equal(rollupExit({ me: 37263265963, runs }), 0);
});

test("a cancelled run passes when its same-commit twin succeeded", () => {
  const runs = [run(37261478961, OLDER_SHA, null), run(37261434662, OLDER_SHA, "success")];
  assert.equal(rollupExit({ me: 37261478961, runs }), 0);
});

test("a cancelled run passes when a newer run of the branch exists", () => {
  const runs = [run(2, "newer", null), run(1, SHA, null)];
  assert.equal(rollupExit({ me: 1, runs }), 0);
});

test("a cancelled run fails when its only same-commit twin was cancelled too", () => {
  const runs = [run(2, SHA, null), run(1, SHA, "cancelled")];
  assert.equal(rollupExit({ me: 2, runs }), 1);
});

test("a cancelled run fails when nothing else reports the result", () => {
  const runs = [run(2, SHA, null), run(1, OLDER_SHA, "success")];
  assert.equal(rollupExit({ me: 2, runs }), 1);
});

test("a failed lane fails even with a passing twin", () => {
  const runs = [run(2, SHA, null), run(1, SHA, "success")];
  assert.equal(rollupExit({ me: 2, runs, lane: "failure" }), 1);
});
