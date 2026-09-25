import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, result.stderr || `${command} ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function git(directory, ...args) {
  return run("git", args, {
    cwd: directory,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
}

test("prepare installs hooks in clones and linked worktrees, but skips non-Git directories", () => {
  const root = mkdtempSync(join(tmpdir(), "hyperframes-prepare-worktree-"));
  try {
    const seed = join(root, "seed");
    const ordinary = join(root, "ordinary");
    const linked = join(root, "linked");
    const nonGit = join(root, "non-git");
    const stubBin = join(root, "bin");
    mkdirSync(seed);
    mkdirSync(nonGit);
    mkdirSync(stubBin);

    git(root, "init", "-q", seed);
    writeFileSync(join(seed, "README.md"), "fixture\n");
    git(seed, "add", "README.md");
    run(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-qm",
        "fixture",
      ],
      {
        cwd: seed,
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      },
    );
    git(root, "clone", "-q", seed, ordinary);
    git(ordinary, "worktree", "add", "-q", "--detach", linked, "HEAD");

    const stub = join(stubBin, "lefthook");
    writeFileSync(
      stub,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HF_HOOK_PROBE_LOG"\nexit "${HF_HOOK_PROBE_EXIT:-0}"\n',
    );
    chmodSync(stub, 0o755);

    const { scripts } = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
    const packageJson = JSON.stringify({ private: true, scripts: { prepare: scripts.prepare } });
    const cases = [
      ["ordinary clone", ordinary, ["install"]],
      ["linked worktree", linked, ["install"]],
      ["non-Git directory", nonGit, []],
    ];

    for (const [label, directory, expectedCalls] of cases) {
      writeFileSync(join(directory, "package.json"), packageJson);
      const log = join(root, `${label.replaceAll(" ", "-")}.log`);
      const env = {
        ...process.env,
        PATH: `${stubBin}${delimiter}${process.env.PATH}`,
        HF_HOOK_PROBE_LOG: log,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      };
      run("bun", ["run", "prepare"], { cwd: directory, env });
      const actualCalls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
      assert.deepEqual(actualCalls, expectedCalls, `${label} installer calls`);
    }

    const failedInstallLog = join(root, "failed-install.log");
    const failedInstall = spawnSync("bun", ["run", "prepare"], {
      cwd: ordinary,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${stubBin}${delimiter}${process.env.PATH}`,
        HF_HOOK_PROBE_LOG: failedInstallLog,
        HF_HOOK_PROBE_EXIT: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
    assert.notEqual(failedInstall.status, 0, "failed hook installation should fail preparation");
    assert.deepEqual(readFileSync(failedInstallLog, "utf8").trim().split("\n"), ["install"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
