import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const config = parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lefthook.yml"), "utf8"),
);
const jobs = config["pre-commit"].jobs ?? [];

test("the skills manifest is hashed after the formatter has rewritten the skills", () => {
  const group = jobs.find((job) => job.group?.jobs?.some((j) => j.name === "skills-manifest"));
  assert.ok(group, "skills-manifest must sit in a group, not run beside the formatter");
  assert.equal(group.group.piped, true, "the group must run its jobs in order");
  const names = group.group.jobs.map((j) => j.name);
  assert.ok(names.includes("format"), "the group must hold the formatter");
  assert.ok(names.indexOf("format") < names.indexOf("skills-manifest"));
});

function auditFixture(t, { fork = true, advanced = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "fallow hook "));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (args, input) => execFileSync("git", args, { cwd, input, encoding: "utf8" }).trim();
  git(["init", "--quiet", "--initial-branch=feature"]);
  const tree = git(["mktree"], "");
  let sequence = 0;
  // Synthetic graph objects need no changes to the contributor's Git identity.
  const commit = (parent) =>
    git(
      ["hash-object", "-t", "commit", "-w", "--stdin"],
      `tree ${tree}\n${parent ? `parent ${parent}\n` : ""}author Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\nfixture ${sequence++}\n`,
    );
  const forkBase = commit();
  const upstreamBase = commit(forkBase);
  const feature = commit(upstreamBase);
  const mainTip = advanced ? commit(upstreamBase) : upstreamBase;
  git(["update-ref", "refs/heads/feature", feature]);
  git(["update-ref", "refs/remotes/origin/main", fork ? forkBase : mainTip]);
  if (fork) git(["update-ref", "refs/remotes/upstream/main", mainTip]);

  const log = join(cwd, "fallow-calls.jsonl");
  const executable = join(cwd, "node_modules", ".bin", "fallow");
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(
    executable,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_FALLOW_LOG, JSON.stringify({
  args,
  gitEnvironment: ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"].filter(key => key in process.env),
}) + "\\n");
process.exit(Number(args[0] === "audit" ? process.env.TEST_AUDIT_EXIT : process.env.TEST_PRUNE_EXIT));
`,
    { mode: 0o755 },
  );
  return {
    git,
    upstreamBase,
    run(env = {}) {
      const result = spawnSync("sh", ["-c", jobs.find((job) => job.name === "fallow").run], {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          TEST_FALLOW_LOG: log,
          TEST_AUDIT_EXIT: "0",
          TEST_PRUNE_EXIT: "0",
          ...env,
        },
      });
      let calls = [];
      try {
        calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return { ...result, calls };
    },
  };
}

for (const options of [
  { name: "forks exclude history already on upstream main", fork: true, advanced: false },
  { name: "forks use the shared ancestor when upstream main advances", fork: true, advanced: true },
  { name: "non-fork checkouts retain origin main as their base", fork: false, advanced: false },
  { name: "non-fork checkouts exclude later origin main commits", fork: false, advanced: true },
]) {
  test(`the Fallow hook ${options.name}`, (t) => {
    const fixture = auditFixture(t, options);
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.calls.map((call) => call.args),
      [
        ["audit", "--base", fixture.upstreamBase, "--fail-on-issues"],
        ["audit-cache", "prune", "--max-age-days", "1"],
      ],
    );
  });
}

test("the Fallow hook refuses to audit without a resolvable base", (t) => {
  const fixture = auditFixture(t, { fork: false });
  fixture.git(["update-ref", "-d", "refs/remotes/origin/main"]);
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
});

test("the Fallow hook retains a failed audit status after pruning", (t) => {
  const result = auditFixture(t).run({ TEST_AUDIT_EXIT: "23" });
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(
    result.calls.map((call) => call.args[0]),
    ["audit", "audit-cache"],
  );
});

test("the Fallow hook does not replace a successful audit status with a prune failure", (t) => {
  const result = auditFixture(t).run({ TEST_PRUNE_EXIT: "7" });
  assert.equal(result.status, 0, result.stderr);
});

test("the Fallow hook resolves its base outside the parent hook Git environment", (t) => {
  const fixture = auditFixture(t);
  const result = fixture.run({
    GIT_DIR: "missing-parent-git-dir",
    GIT_INDEX_FILE: "missing-parent-index",
    GIT_WORK_TREE: "missing-parent-work-tree",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls[0].args[2], fixture.upstreamBase);
  assert.deepEqual(
    result.calls.map((call) => call.gitEnvironment),
    [[], []],
  );
});
