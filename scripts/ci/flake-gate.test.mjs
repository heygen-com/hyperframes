import assert from "node:assert/strict";
import test from "node:test";
import { addsRetry, runnerFor, runsFor, selectTestFiles, verdictFor } from "./flake-gate.mjs";

test("selects added, modified and renamed package tests, not deleted or non-test files", () => {
  const out = [
    "A\tpackages/core/src/a.test.ts",
    "M\tpackages/studio/src/b.test.tsx",
    "R100\tpackages/cli/src/old.test.ts\tpackages/cli/src/new.test.ts",
    "D\tpackages/cli/src/gone.test.ts",
    "M\tpackages/core/src/a.ts",
    "M\tscripts/x.test.mjs",
  ].join("\n");
  assert.deepEqual(selectTestFiles(out), [
    "packages/core/src/a.test.ts",
    "packages/studio/src/b.test.tsx",
    "packages/cli/src/new.test.ts",
  ]);
});

test("flags added retries only", () => {
  assert.equal(addsRetry("+  retry: 2,"), true);
  assert.equal(addsRetry('+it("x", { retry: 3 }, () => {})'), true);
  assert.equal(addsRetry("-  retry: 2,"), false);
  assert.equal(addsRetry("+  retry: 0,"), false);
});

test("picks the runner from the import and bounds runs by file count", () => {
  assert.equal(runnerFor('import { test } from "bun:test";'), "bun");
  assert.equal(runnerFor('import { it } from "vitest";'), "vitest");
  assert.equal(runnerFor('import test from "node:test";'), "node");
  assert.equal(runsFor(3), 10);
  assert.equal(runsFor(20), 3);
  assert.equal(runsFor(100), 2);
});

test("names a file that fails every run differently from a partial failure", () => {
  assert.equal(verdictFor(0, 10), "ok");
  assert.equal(verdictFor(3, 10), "flaky");
  assert.equal(verdictFor(10, 10), "fails in the gate");
});
