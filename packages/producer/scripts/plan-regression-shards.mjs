// Computes the regression workflow's shard matrix instead of hand-maintaining
// it in .github/workflows/regression.yml.
//
// Two problems this fixes:
//
// 1. Staleness. The hand-written matrix was bin-packed once against a specific
//    CI run and then drifted. By the time it was measured again, shard work
//    ranged from 17.2 to 36.8 minutes against a comment claiming "within ~40s
//    of the others" — and CI wall-clock is set by the worst shard.
//
// 2. Silent drift. A fixture only ran if someone remembered to paste its name
//    into the YAML. 25 fixtures that the harness can run were in no shard at
//    all, some for months, and 3 more were rejected at load time for invalid
//    meta.json with nothing louder than a console warning. The default
//    outcome for a new fixture was that it never ran.
//
// Fixtures are now discovered from disk. Every one must be either scheduled
// (with a timing) or explicitly excluded with a reason, or this script fails.
// Drift becomes a build error instead of silent absence.
//
// Usage:
//   node scripts/plan-regression-shards.mjs [--shards N] [--pretty]

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TESTS_DIR = join(PRODUCER_ROOT, "tests");
const SCHEDULE_FILE = join(TESTS_DIR, "shard-schedule.json");

export const DEFAULT_SHARD_COUNT = 8;

/**
 * A fixture with no recorded timing still has to land somewhere. Assume it is
 * on the expensive side so an unmeasured newcomer cannot quietly overload the
 * shard it lands in; the next timing refresh corrects it.
 */
export const UNKNOWN_FIXTURE_SECONDS = 300;

/**
 * Mirrors `discoverTestSuites()` in src/regression-harness.ts: a fixture is a
 * directory holding both `src/index.html` and `meta.json`, found either at
 * `tests/<name>/` or one level down under `tests/distributed/<name>/`.
 *
 * The two implementations are pinned together by a test
 * (regression-shard-plan.test.ts). If they ever diverge, this script's
 * unaccounted/stale checks fail the build rather than silently mis-scheduling.
 */
const isFixtureDir = (dir) =>
  existsSync(join(dir, "meta.json")) && existsSync(join(dir, "src", "index.html"));

const childDirNames = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."));

export function discoverFixtures(testsDir = TESTS_DIR) {
  return childDirNames(testsDir)
    .flatMap((name) =>
      // tests/distributed/<name>/ fixtures are surfaced by bare name, same as
      // top-level ones, so the harness CLI can target them without a prefix.
      name === "distributed"
        ? childDirNames(join(testsDir, name)).map((sub) => [sub, join(testsDir, name, sub)])
        : [[name, join(testsDir, name)]],
    )
    .filter(([, dir]) => isFixtureDir(dir))
    .map(([name]) => name)
    .sort();
}

/**
 * Longest-processing-time-first bin packing. Optimal enough for tens of items
 * and, unlike the hand-packed list, it re-derives from current timings every
 * run. Returns shards ordered heaviest-first.
 */
export function packShards(fixtures, timings, shardCount) {
  const bins = Array.from({ length: shardCount }, () => ({ fixtures: [], seconds: 0 }));
  const weighted = fixtures
    .map((name) => ({ name, seconds: timings[name] ?? UNKNOWN_FIXTURE_SECONDS }))
    .sort((left, right) => right.seconds - left.seconds || left.name.localeCompare(right.name));

  for (const { name, seconds } of weighted) {
    const lightest = bins.reduce((min, bin) => (bin.seconds < min.seconds ? bin : min), bins[0]);
    lightest.fixtures.push(name);
    lightest.seconds += seconds;
  }

  return bins
    .filter((bin) => bin.fixtures.length > 0)
    .sort((left, right) => right.seconds - left.seconds);
}

export function planShards({
  testsDir = TESTS_DIR,
  scheduleFile = SCHEDULE_FILE,
  shardCount,
} = {}) {
  const schedule = JSON.parse(readFileSync(scheduleFile, "utf-8"));
  const timings = schedule.timings ?? {};
  const excluded = schedule.excluded ?? {};
  const resolvedShardCount = shardCount ?? schedule.shardCount ?? DEFAULT_SHARD_COUNT;

  const onDisk = discoverFixtures(testsDir);
  const onDiskSet = new Set(onDisk);

  // "Exactly one of the two maps" has to be enforced, not just "at least one".
  // `excluded` wins when a name is in both, so a fixture listed in both would
  // drop out of CI while every other check here still passed — the precise
  // failure mode this file exists to prevent.
  const inBoth = Object.keys(timings).filter((name) => name in excluded);
  if (inBoth.length > 0) {
    throw new Error(
      `Fixtures are both scheduled and excluded: ${inBoth.join(", ")}.\n` +
        `Remove each from one of "timings" or "excluded" in ${scheduleFile}.`,
    );
  }

  // A fixture that is neither timed nor excluded is the drift this script
  // exists to catch. Fail loudly rather than silently skipping it.
  const unaccounted = onDisk.filter((name) => !(name in timings) && !(name in excluded));
  if (unaccounted.length > 0) {
    throw new Error(
      `Fixtures are neither scheduled nor excluded: ${unaccounted.join(", ")}.\n` +
        `Add each to "timings" in ${scheduleFile} to run it in CI, or to "excluded" with a reason.`,
    );
  }

  // Catch the opposite drift: entries left behind after a fixture is deleted
  // or renamed, which would schedule a shard arg that matches nothing.
  const stale = [...Object.keys(timings), ...Object.keys(excluded)].filter(
    (name) => !onDiskSet.has(name),
  );
  if (stale.length > 0) {
    throw new Error(
      `Schedule references fixtures that no longer exist: ${stale.join(", ")}.\n` +
        `Remove them from ${scheduleFile}.`,
    );
  }

  const scheduled = onDisk.filter((name) => !(name in excluded));
  const bins = packShards(scheduled, timings, resolvedShardCount);

  return {
    include: bins.map((bin, index) => ({
      shard: `shard-${index + 1}`,
      args: bin.fixtures.join(" "),
    })),
    // Diagnostics for the workflow log — not consumed by the matrix.
    plan: bins.map((bin, index) => ({
      shard: `shard-${index + 1}`,
      fixtures: bin.fixtures.length,
      estimatedMinutes: Math.round((bin.seconds / 60) * 10) / 10,
    })),
    excludedCount: Object.keys(excluded).length,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const shardFlag = argv.indexOf("--shards");
  const shardCount = shardFlag === -1 ? undefined : Number(argv[shardFlag + 1]);
  if (shardCount !== undefined && (!Number.isInteger(shardCount) || shardCount < 1)) {
    throw new Error("--shards must be a positive integer");
  }

  const { include, plan, excludedCount } = planShards({ shardCount });

  if (argv.includes("--pretty")) {
    const worst = Math.max(...plan.map((row) => row.estimatedMinutes));
    const best = Math.min(...plan.map((row) => row.estimatedMinutes));
    for (const row of plan) {
      console.log(`${row.shard}\t${row.fixtures} fixtures\t~${row.estimatedMinutes}m`);
    }
    console.log(
      `\nworst shard ~${worst}m, lightest ~${best}m, spread ~${
        Math.round((worst - best) * 10) / 10
      }m`,
    );
    console.log(`${excludedCount} fixture(s) explicitly excluded`);
    return;
  }

  // Single-line JSON for `echo "matrix=$(...)" >> $GITHUB_OUTPUT`.
  console.log(JSON.stringify({ include }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
