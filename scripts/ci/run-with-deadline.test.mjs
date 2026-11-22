import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = join(import.meta.dirname, "run-with-deadline.ps1");
const onWindows = { skip: process.platform !== "win32" && "Get-NetTCPConnection is Windows-only" };

function runStep(command) {
  const runnerTemp = mkdtempSync(join(tmpdir(), "deadline-"));
  return spawnSync("pwsh", ["-NoProfile", "-File", script, "-Minutes", "1", "-Command", command], {
    encoding: "utf8",
    env: { ...process.env, RUNNER_TEMP: runnerTemp },
  });
}

const DUMP = "ran out of socket buffers";
const STATE_LINE = /^\s*\d+ (Listen|Established|TimeWait|CloseWait|Bound|SynSent|FinWait2)\s*$/m;

test(
  "a step whose output says ENOBUFS gets the runner's TCP counts once and keeps its exit code",
  onWindows,
  () => {
    const step = runStep(
      "Write-Output 'connect ENOBUFS 127.0.0.1:1'; Start-Sleep -Seconds 3; Write-Output 'net::ERR_NO_BUFFER_SPACE'; exit 3",
    );
    assert.equal(step.status, 3, step.stderr);
    assert.equal(step.stdout.split(DUMP).length - 1, 1, step.stdout);
    assert.match(step.stdout, STATE_LINE);
  },
);

test("a step that never says so gets no socket counts", onWindows, () => {
  const step = runStep("Write-Output 'all fine'");
  assert.equal(step.status, 0, step.stderr);
  assert.ok(!step.stdout.includes(DUMP), step.stdout);
});
