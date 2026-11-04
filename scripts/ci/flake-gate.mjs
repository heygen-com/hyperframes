#!/usr/bin/env node
// flake-gate.mjs --base <sha> [--list]: re-runs every package test file the PR adds or changes under CPU
// contention and fails on any failed run. --list only prints the files and sets the `any` step output.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";

const TEST_FILE = /^packages\/[^/]+\/.+\.(test|spec)\.(ts|tsx|mjs)$/;
const RETRY_ADDED =
  /^\+(?!\+\+).*(\bretry\s*:\s*(?:[1-9]|true)|\.retry\(\s*[1-9]|vi\.retryOnce|--retry\b)/m;

export function selectTestFiles(nameStatus) {
  const files = [];
  for (const line of nameStatus.split("\n").filter(Boolean)) {
    const [status, ...paths] = line.split("\t");
    if (status.startsWith("D")) continue;
    const file = paths.at(-1);
    if (TEST_FILE.test(file) && !file.includes("/node_modules/")) files.push(file);
  }
  return files;
}

export function addsRetry(patch) {
  return RETRY_ADDED.test(patch);
}

export function runnerFor(source) {
  if (/\bfrom\s+["']bun:test["']/.test(source)) return "bun";
  return /\bfrom\s+["']node:test["']/.test(source) ? "node" : "vitest";
}

// Fixed by file count, never by elapsed time: about 60 runs in total, between 2 and 10 per file.
export function runsFor(fileCount) {
  return Math.min(10, Math.max(2, Math.floor(60 / fileCount)));
}

// A run that hangs is a failing run, not a reason to wait for the job limit.
const RUN_TIMEOUT_MS = 120_000;

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

const MEDIA_USE = "packages/cli/src/media-use/";

function command(file) {
  const [, pkg, rel] = file.match(/^(packages\/[^/]+)\/(.+)$/);
  const runner = runnerFor(readFileSync(file, "utf8"));
  if (runner === "bun") return { cwd: pkg, cmd: "bun", args: ["test", rel], env: {} };
  if (runner === "node") return nodeCommand(file);
  return {
    cwd: pkg,
    cmd: "bun",
    args: ["x", "vitest", "run", "--maxWorkers=2", rel],
    env: {},
    vitest: true,
  };
}

// Same flags as the lanes that own these files: `test:skills` for media-use, `test:scripts` otherwise.
function nodeCommand(file) {
  const mediaUse = file.startsWith(MEDIA_USE);
  const env = mediaUse ? { HYPERFRAMES_MEDIA_HOME_REQUIRED: "1" } : {};
  const loader = mediaUse ? "./packages/cli/scripts/test-home.mjs" : "tsx";
  return { cwd: ".", cmd: "node", args: ["--import", loader, "--test", file], env };
}

// A vitest file outside the package's `include` has no lane that runs it, so there is nothing to re-run.
function isCollected(file) {
  const [, pkg, rel] = file.match(/^(packages\/[^/]+)\/(.+)$/);
  const list = spawnSync("bun", ["x", "vitest", "list", "--filesOnly", rel], {
    cwd: pkg,
    encoding: "utf8",
  });
  return list.stdout.includes(rel);
}

function startBurners() {
  return Array.from({ length: cpus().length }, () =>
    spawn(process.execPath, ["-e", "for(;;);"], { stdio: "ignore" }),
  );
}

function runOnce({ cwd, cmd, args, env }) {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 1 << 28,
    timeout: RUN_TIMEOUT_MS,
  });
  const timedOut =
    r.error?.code === "ETIMEDOUT" ? `timed out after ${RUN_TIMEOUT_MS / 1000}s\n` : "";
  return { ok: r.status === 0, output: `${timedOut}${r.stdout}${r.stderr}` };
}

export function verdictFor(failed, runs) {
  if (failed === 0) return "ok";
  return failed === runs ? "fails in the gate" : "flaky";
}

const CONFIG_AND_TESTS = [
  "packages/**/*.test.*",
  "packages/**/*.spec.*",
  "packages/**/vitest.config.*",
  "vitest.config.*",
  "vitest.workspace.*",
];

function runFile(file, runs) {
  const spec = command(file);
  if (spec.vitest && !isCollected(file)) {
    console.log(`skipped: ${file}: not collected by the package's vitest config`);
    return [];
  }
  let failed = 0;
  for (let i = 1; i <= runs; i++) {
    const { ok, output } = runOnce(spec);
    if (ok) continue;
    failed++;
    console.log(`::group::${file} run ${i}/${runs} failed\n${output}\n::endgroup::`);
  }
  const verdict = verdictFor(failed, runs);
  console.log(`${verdict}: ${file}: ${runs - failed}/${runs} passed`);
  return failed === 0 ? [] : [`${file} (${verdict}, ${failed}/${runs} failed)`];
}

function rerun(files) {
  const runs = runsFor(files.length);
  console.log(`Re-running ${files.length} test file(s) ${runs} times each under CPU contention`);
  const burners = startBurners();
  try {
    return files.flatMap((file) => runFile(file, runs));
  } finally {
    for (const b of burners) b.kill();
  }
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function rejectRetries(base) {
  if (!addsRetry(git("diff", "-M", "-U0", base, "HEAD", "--", ...CONFIG_AND_TESTS))) return;
  fail("This change adds a test retry. Retries hide flaky tests; fix the flake instead.");
}

function printList(files) {
  console.log(files.join("\n"));
  appendFileSync(process.env.GITHUB_OUTPUT ?? "/dev/null", `any=${files.length > 0}\n`);
}

function main() {
  const base = process.argv[process.argv.indexOf("--base") + 1];
  const files = selectTestFiles(git("diff", "-M", "--name-status", base, "HEAD", "--", "packages"));
  rejectRetries(base);
  if (process.argv.includes("--list")) return printList(files);
  const failures = rerun(files);
  if (failures.length > 0) fail(`Failing tests: ${failures.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
