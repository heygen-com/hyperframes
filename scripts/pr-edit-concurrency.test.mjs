import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflowsDir = join(import.meta.dirname, "..", ".github", "workflows");
const workflows = readdirSync(workflowsDir)
  .filter((file) => file.endsWith(".yml"))
  .map((file) => ({ file, config: parse(readFileSync(join(workflowsDir, file), "utf8")) }));

// A body or title edit must not cancel in-flight code checks: the cancelled run's
// fail-closed `Test` stays red on the PR. Only a push or a base change cancels.
const CANCEL_UNLESS_PLAIN_EDIT =
  "${{ github.event.action != 'edited' || github.event.changes.base != null }}";
// Reads the PR body itself, so the newest edit should replace an older run.
const BODY_WORKFLOWS = new Set(["pr-captures.yml"]);

const editedWorkflows = workflows.filter(({ config }) =>
  config.on?.pull_request?.types?.includes("edited"),
);

test("the workflows that re-run on a PR edit are known", () => {
  assert.deepEqual(editedWorkflows.map(({ file }) => file).sort(), [
    "ci.yml",
    "pr-captures.yml",
    "regression.yml",
    "windows-render.yml",
  ]);
});

for (const { file, config } of editedWorkflows) {
  if (BODY_WORKFLOWS.has(file)) continue;
  test(`${file}: a body or title edit does not cancel its running checks`, () => {
    assert.equal(config.concurrency?.["cancel-in-progress"], CANCEL_UNLESS_PLAIN_EDIT);
  });
}
