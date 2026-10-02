import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = join(import.meta.dirname, "base-file.sh");
const git = (cwd, ...args) =>
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      encoding: "utf8",
    },
  ).trim();

// A PR run checks out the merge commit shallowly; the base branch then moves before the gate reads its baseline.
function raceFixture(baseline) {
  const root = mkdtempSync(join(tmpdir(), "base-file-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  git(root, "init", "-q", "--bare", origin);
  git(root, "init", "-q", "-b", "main", work);
  git(work, "remote", "add", "origin", origin);
  if (baseline) writeFileSync(join(work, "baseline.json"), baseline);
  writeFileSync(join(work, "readme"), "base");
  git(work, "add", ".");
  git(work, "commit", "-qm", "base");
  const base = git(work, "rev-parse", "HEAD");
  git(work, "switch", "-qc", "pr");
  writeFileSync(join(work, "pr"), "change");
  git(work, "add", ".");
  git(work, "commit", "-qm", "pr");
  git(work, "switch", "-q", "main");
  git(work, "merge", "-q", "--no-ff", "-m", "merge", "pr");
  const merge = git(work, "rev-parse", "HEAD");
  git(work, "push", "-q", "origin", `${merge}:refs/pull/1/merge`);
  git(work, "reset", "-q", "--hard", base);
  writeFileSync(join(work, "baseline.json"), '{"total":852}');
  git(work, "add", ".");
  git(work, "commit", "-qm", "base moves on");
  git(work, "push", "-q", "origin", "HEAD:main");
  const checkout = join(root, "checkout");
  git(root, "init", "-q", checkout);
  git(checkout, "remote", "add", "origin", `file://${origin}`);
  git(checkout, "fetch", "-q", "--depth=1", "origin", "refs/pull/1/merge");
  git(checkout, "checkout", "-q", "FETCH_HEAD");
  return { checkout, base, out: join(root, "out.json") };
}

test("reads the base the run measured, not the base branch tip that moved since", () => {
  const { checkout, base, out } = raceFixture('{"total":846}');
  const log = execFileSync("bash", [script, "baseline.json", out], {
    cwd: checkout,
    encoding: "utf8",
  });
  assert.equal(readFileSync(out, "utf8"), '{"total":846}');
  assert.match(log, new RegExp(`measured: ${base}`));
});

test("a base without the file leaves no output", () => {
  const { checkout, out } = raceFixture(null);
  writeFileSync(out, "stale");
  execFileSync("bash", [script, "baseline.json", out], { cwd: checkout, encoding: "utf8" });
  assert.equal(existsSync(out), false);
});
