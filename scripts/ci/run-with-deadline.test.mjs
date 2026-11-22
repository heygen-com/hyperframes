import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = join(import.meta.dirname, "run-with-deadline.ps1");
const onWindows = { skip: process.platform !== "win32" && "Get-NetTCPConnection is Windows-only" };

// A step is one native command, as CI's are; the wrapper redirects that command's output into its log.
function runStep(lines, code, gapMs = 0) {
  const dir = mkdtempSync(join(tmpdir(), "deadline-"));
  const step = join(dir, "step.mjs");
  writeFileSync(
    step,
    `const lines = ${JSON.stringify(lines)};
console.log(lines[0]);
setTimeout(() => { for (const line of lines.slice(1)) console.log(line); process.exit(${code}); }, ${gapMs});`,
  );
  return spawnSync(
    "pwsh",
    ["-NoProfile", "-File", script, "-Minutes", "1", "-Command", `node '${step}'`],
    { encoding: "utf8", env: { ...process.env, RUNNER_TEMP: dir } },
  );
}

const DUMP = "ran out of socket buffers";
const STATE_LINE = /^\s*\d+ (Listen|Established|TimeWait|CloseWait|Bound|SynSent|FinWait2)\s*$/m;

test(
  "a step whose output says ENOBUFS gets the runner's TCP counts once and still fails",
  onWindows,
  () => {
    const step = runStep(["connect ENOBUFS 127.0.0.1:1", "net::ERR_NO_BUFFER_SPACE"], 3, 3000);
    assert.notEqual(step.status, 0, step.stderr);
    assert.equal(step.stdout.split(DUMP).length - 1, 1, step.stdout);
    assert.match(step.stdout, STATE_LINE);
  },
);

test("a step that never says so gets no socket counts", onWindows, () => {
  const step = runStep(["all fine"], 0);
  assert.equal(step.status, 0, step.stderr);
  assert.ok(!step.stdout.includes(DUMP), step.stdout);
});
