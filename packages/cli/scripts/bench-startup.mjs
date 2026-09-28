#!/usr/bin/env node
// Times whole CLI runs (spawn to exit) and prints a markdown table of median and p90.
// Usage: node scripts/bench-startup.mjs <project-dir> [--runs 10] [--cli bin/hyperframes.mjs] [--no-telemetry]
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const project = resolve(args.find((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? ".");
const runs = Number(flag("--runs", "10"));
const cli = resolve(flag("--cli", fileURLToPath(new URL("../bin/hyperframes.mjs", import.meta.url))));
const env = { ...process.env, CI: "1" };
if (args.includes("--no-telemetry")) env.HYPERFRAMES_NO_TELEMETRY = "1";

const commands = [["--help"], ["lint", "--help"], ["lint"], ["compositions"], ["info"]];
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

console.log(`| command | median (s) | p90 (s) |\n|---|---|---|`);
for (const command of commands) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint();
    const result = spawnSync(process.execPath, [cli, ...command], { cwd: project, env, stdio: "ignore" });
    times.push(Number(process.hrtime.bigint() - start) / 1e9);
    if (result.error || result.status === null) throw result.error ?? new Error(`${command} was killed`);
    if (result.status !== 0) console.error(`${command.join(" ")} exited ${result.status}`);
  }
  times.sort((a, b) => a - b);
  console.log(`| ${command.join(" ")} | ${percentile(times, 0.5).toFixed(2)} | ${percentile(times, 0.9).toFixed(2)} |`);
}
