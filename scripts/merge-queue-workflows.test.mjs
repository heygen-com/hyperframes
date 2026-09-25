import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflowsDir = join(import.meta.dirname, "..", ".github", "workflows");
const events = (on) =>
  typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});

// The queue waits only for required checks and deletes a group's ref when it merges,
// so any other workflow on merge_group races that deletion and fails at random.
test("only the workflows that report required checks run on merge queue groups", () => {
  const queued = readdirSync(workflowsDir).filter(
    (file) =>
      /\.ya?ml$/.test(file) &&
      events(parse(readFileSync(join(workflowsDir, file), "utf8")).on).includes("merge_group"),
  );
  assert.deepEqual(queued.sort(), [
    "ci.yml",
    "pr-captures.yml",
    "regression.yml",
    "windows-render.yml",
  ]);
});
