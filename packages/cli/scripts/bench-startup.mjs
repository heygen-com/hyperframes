#!/usr/bin/env node
// Times whole CLI runs (spawn to exit) and prints a markdown table of median and p90.
// Usage: node scripts/bench-startup.mjs <project-dir> [--runs 10] [--cli bin/hyperframes.mjs] [--no-telemetry]
// Runs with CI=1 (no update check); telemetry stays on unless --no-telemetry, so each run sends real events.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: "string", default: "10" },
    cli: { type: "string" },
    "no-telemetry": { type: "boolean", default: false },
  },
});
const project = resolve(positionals[0] ?? ".");
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
const cli = resolve(
  values.cli ?? fileURLToPath(new URL("../bin/hyperframes.mjs", import.meta.url)),
);
const env = { ...process.env, CI: "1" };
if (values["no-telemetry"]) env.HYPERFRAMES_NO_TELEMETRY = "1";

const commands = [["--help"], ["lint", "--help"], ["lint"], ["compositions"], ["info"]];
// Nearest rank: p90 of 10 runs is the 9th fastest, not the slowest.
const percentile = (sorted, p) => sorted[Math.ceil(p * sorted.length) - 1];

function timeRun(command) {
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [cli, ...command], {
    cwd: project,
    env,
    stdio: "ignore",
  });
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  if (result.error || result.status === null)
    throw result.error ?? new Error(`${command} was killed`);
  if (result.status !== 0) console.error(`${command.join(" ")} exited ${result.status}`);
  return seconds;
}

console.log(`| command | median (s) | p90 (s) |\n|---|---|---|`);
for (const command of commands) {
  timeRun(command); // warm-up: fills the OS file cache, not counted
  const times = Array.from({ length: runs }, () => timeRun(command)).sort((a, b) => a - b);
  console.log(
    `| ${command.join(" ")} | ${percentile(times, 0.5).toFixed(2)} | ${percentile(times, 0.9).toFixed(2)} |`,
  );
}
