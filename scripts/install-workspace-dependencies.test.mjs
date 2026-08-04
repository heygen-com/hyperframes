import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const installScript = new URL("./ci/install-workspace-dependencies.sh", import.meta.url);

function runInstall({ succeedOnAttempt }) {
  const root = mkdtempSync(join(tmpdir(), "hyperframes-bun-install-test-"));
  const binDir = join(root, "bin");
  const countFile = join(root, "attempts");
  const argsFile = join(root, "args");

  try {
    spawnSync("mkdir", ["-p", binDir], { stdio: "pipe" });
    const bunStub = join(binDir, "bun");
    writeFileSync(
      bunStub,
      `#!/usr/bin/env bash
set -u
count=0
if [[ -f "$COUNT_FILE" ]]; then count="$(cat "$COUNT_FILE")"; fi
count=$((count + 1))
printf '%s' "$count" > "$COUNT_FILE"
printf '%s\\n' "$*" >> "$ARGS_FILE"
if (( count < SUCCEED_ON_ATTEMPT )); then exit 23; fi
`,
    );
    chmodSync(bunStub, 0o755);

    const result = spawnSync("bash", [installScript.pathname, "--ignore-scripts"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ARGS_FILE: argsFile,
        COUNT_FILE: countFile,
        HF_BUN_INSTALL_RETRY_DELAY_SECONDS: "0",
        PATH: `${binDir}:${process.env.PATH}`,
        SUCCEED_ON_ATTEMPT: String(succeedOnAttempt),
      },
      timeout: 5_000,
    });

    return {
      ...result,
      args: existsSync(argsFile) ? readFileSync(argsFile, "utf8").trim().split("\n") : [],
      attempts: existsSync(countFile) ? Number(readFileSync(countFile, "utf8")) : 0,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("retries a transient Bun install failure with the same frozen-lockfile arguments", () => {
  const result = runInstall({ succeedOnAttempt: 2 });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.args, [
    "install --frozen-lockfile --ignore-scripts",
    "install --frozen-lockfile --ignore-scripts",
  ]);
  assert.match(result.stdout, /retrying dependency install \(attempt 2\/3\)/);
});

test("stops after three failed Bun install attempts", () => {
  const result = runInstall({ succeedOnAttempt: 4 });

  assert.equal(result.status, 23, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.attempts, 3);
  assert.match(result.stdout, /failed after 3 attempts/);
});
