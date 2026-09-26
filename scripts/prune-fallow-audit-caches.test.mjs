import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { staleAuditCaches } from "./prune-fallow-audit-caches.mjs";

const SCRIPT = join(import.meta.dirname, "prune-fallow-audit-caches.mjs");
const FALLOW = join(import.meta.dirname, "../node_modules/.bin/fallow");
const CAN_AUDIT = spawnSync("bun", ["--version"]).status === 0 && existsSync(FALLOW);

// Run from inside a git hook, these would point the temp repo's git at the outer checkout.
const ENV = { ...process.env };
for (const name of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]) delete ENV[name];

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, env: ENV, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commit(repo, message) {
  git(
    repo,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--no-verify",
    "-am",
    message,
  );
}

describe("staleAuditCaches", () => {
  it("picks this checkout's caches for other bases, nothing else", () => {
    const names = [
      "fallow-audit-base-cache-aaaaaaaaaaaaaaaa-1111111111111111",
      "fallow-audit-base-cache-aaaaaaaaaaaaaaaa-2222222222222222",
      "fallow-audit-base-cache-aaaaaaaaaaaaaaaa-1111111111111111.lock",
      "fallow-audit-base-cache-bbbbbbbbbbbbbbbb-1111111111111111",
      "fallow-audit-base-4242-99",
      "unrelated",
    ];

    assert.deepEqual(staleAuditCaches(names, "aaaaaaaaaaaaaaaa", "2222222222222222ffff"), [
      "fallow-audit-base-cache-aaaaaaaaaaaaaaaa-1111111111111111",
    ]);
  });
});

describe(
  "prune-fallow-audit-caches",
  { skip: !CAN_AUDIT && "bun or fallow is not installed" },
  () => {
    it("leaves one fallow cache for the checkout after audits against two bases", () => {
      const work = mkdtempSync(join(tmpdir(), "hf-fallow-prune-"));
      try {
        const repo = join(work, "repo");
        const temp = join(work, "tmp");
        mkdirSync(join(repo, "src"), { recursive: true });
        mkdirSync(temp);
        writeFileSync(
          join(repo, "package.json"),
          '{"name":"x","type":"module","main":"src/index.js"}',
        );
        writeFileSync(join(repo, "src/index.js"), "export const a = 1;\n");
        git(repo, "init", "-q");
        git(repo, "add", "-A");
        commit(repo, "a");
        const oldBase = git(repo, "rev-parse", "HEAD");
        appendFileSync(join(repo, "src/index.js"), "export const b = 2;\n");
        commit(repo, "b");
        const newBase = git(repo, "rev-parse", "HEAD");
        appendFileSync(join(repo, "src/index.js"), "export const c = 3;\n");
        const env = { ...ENV, TMPDIR: temp };
        for (const base of [oldBase, newBase]) {
          const audit = spawnSync(FALLOW, ["audit", "--base", base], {
            cwd: repo,
            env,
            encoding: "utf8",
          });
          assert.equal(audit.status, 0, audit.stderr);
        }
        const caches = () =>
          readdirSync(temp).filter((name) =>
            /^fallow-audit-base-cache-[0-9a-f]+-[0-9a-f]+$/.test(name),
          );
        assert.equal(caches().length, 2, "fallow left one cache per base");
        const foreign = join(
          temp,
          `fallow-audit-base-cache-0000000000000000-${oldBase.slice(0, 16)}`,
        );
        mkdirSync(foreign);

        const run = spawnSync("bun", [SCRIPT, newBase], { cwd: repo, env, encoding: "utf8" });

        assert.equal(run.status, 0, run.stderr);
        const left = caches().filter((name) => !foreign.endsWith(name));
        assert.equal(left.length, 1);
        assert.ok(left[0].endsWith(`-${newBase.slice(0, 16)}`), `kept ${left[0]}`);
        assert.ok(existsSync(foreign), "another checkout's cache is not touched");
        assert.doesNotMatch(git(repo, "worktree", "list"), new RegExp(oldBase.slice(0, 16)));
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });
  },
);
