// A branch cut before a Comments script existed has no copy of it; the job must then run every
// script from the base, or it crashes before grading (seen on branches older than #4444, #4445).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const job = parse(
  readFileSync(new URL("../.github/workflows/comments.yml", import.meta.url), "utf8"),
).jobs.comments;
const SCRIPTS = job.env.COMMENT_SCRIPTS.trim().split(/\s+/);
const pick = job.steps.find((s) => s.name === "Pick the checks");
const base = job.steps.find((s) => s.with?.ref === "${{ github.event.pull_request.base.sha }}");

function picked(present) {
  const workspace = mkdtempSync(path.join(tmpdir(), "comments-workflow-"));
  try {
    for (const script of present) {
      mkdirSync(path.dirname(path.join(workspace, "pr", script)), { recursive: true });
      writeFileSync(path.join(workspace, "pr", script), "");
    }
    const envFile = path.join(workspace, "env");
    execFileSync("bash", ["-c", pick.run], {
      cwd: workspace,
      env: { ...process.env, COMMENT_SCRIPTS: SCRIPTS.join(" "), GITHUB_ENV: envFile },
    });
    return readFileSync(envFile, "utf8").match(/^CHECKS_DIR=(.*)$/m)[1];
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

test("every repo script the job runs is in COMMENT_SCRIPTS", () => {
  const run = job.steps.map((s) => s.run ?? "").join("\n");
  for (const script of run.match(/scripts\/[\w.-]+\.mjs/g)) {
    assert.ok(SCRIPTS.includes(script), `${script} is missing from COMMENT_SCRIPTS`);
  }
});

test("a branch with every script runs its own copies", () => {
  assert.equal(picked(SCRIPTS), "pr");
});

test("a branch missing any one script runs all of them from the base", () => {
  assert.equal(base.if, `env.CHECKS_DIR == '${base.with.path}'`);
  for (const missing of SCRIPTS) {
    assert.equal(picked(SCRIPTS.filter((s) => s !== missing)), base.with.path, missing);
  }
});

test("every step that runs a script runs the picked copy", () => {
  for (const step of job.steps.filter((s) => SCRIPTS.some((x) => (s.run ?? "").includes(x)))) {
    const where = `${step["working-directory"] ?? ""} ${step.run}`;
    assert.match(where, /CHECKS_DIR/, step.name ?? step.run);
  }
});
