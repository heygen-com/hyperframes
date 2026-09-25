#!/usr/bin/env node
/**
 * Work-count ratchet: each gated counter has a ceiling in perf-ceilings.json
 * that may only go down. A journey fails when any gated counter rises above it.
 *
 *   node perf-ratchet.mjs check <ceilings.json> <journey> <evidence.json>
 *   node perf-ratchet.mjs lower <ceilings.json> <journey> <evidence.json>
 *   node perf-ratchet.mjs correlate <variant>=<evidence.json> ...
 *
 * Evidence is a journey's JSON output: `workCounts` (flat counter map) and `wallMs`.
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// A counter gates only if it tracks wall-clock across variants and repeats exactly within
// one: a ceiling on a counter that wobbles fails at random.
const MIN_CORRELATION = 0.7;
const MAX_SPREAD_RATIO = 0;

export function checkCeilings(ceilings, counts) {
  const rows = Object.entries(ceilings).map(([counter, ceiling]) => {
    const value = counts[counter];
    if (!Number.isFinite(value)) return { counter, ceiling, value: null, status: "missing" };
    if (value > ceiling) return { counter, ceiling, value, status: "rose" };
    return { counter, ceiling, value, status: value < ceiling ? "below" : "at" };
  });
  if (rows.length === 0)
    throw new Error("no gated counters: a ratchet that checks nothing passes nothing");
  return { passed: rows.every((row) => row.status === "at" || row.status === "below"), rows };
}

export function formatRow({ counter, ceiling, value, status }) {
  if (status === "missing") return `FAIL ${counter}: not measured (ceiling ${ceiling})`;
  const delta = value - ceiling;
  const percent =
    ceiling === 0 ? "" : `, ${delta > 0 ? "+" : ""}${Math.round((delta / ceiling) * 100)}%`;
  if (status === "rose")
    return `FAIL ${counter} rose ${ceiling} -> ${value} (+${round(delta)}${percent})`;
  if (status === "below") return `ok   ${counter} ${value}, below its ceiling ${ceiling}: lower it`;
  return `ok   ${counter} ${value}`;
}

/** New ceilings: each gated counter drops to what was measured, never rises. */
export function lowerCeilings(ceilings, counts) {
  return Object.fromEntries(
    Object.entries(ceilings).map(([counter, ceiling]) => [
      counter,
      Number.isFinite(counts[counter]) ? Math.min(ceiling, counts[counter]) : ceiling,
    ]),
  );
}

/**
 * For each counter over runs `{ variant, wallMs, counts }`: Pearson r against
 * wall-clock across all runs, and the worst spread between runs of one variant.
 */
export function correlate(runs) {
  const counters = [...new Set(runs.flatMap((run) => Object.keys(run.counts)))].sort();
  return counters.map((counter) => {
    const points = runs.filter((run) => Number.isFinite(run.counts[counter]));
    const r = pearson(
      points.map((run) => run.counts[counter]),
      points.map((run) => run.wallMs),
    );
    let spreadRatio = 0;
    for (const variant of new Set(points.map((run) => run.variant))) {
      const values = points
        .filter((run) => run.variant === variant)
        .map((run) => run.counts[counter]);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      spreadRatio = Math.max(
        spreadRatio,
        (Math.max(...values) - Math.min(...values)) / Math.max(1, mean),
      );
    }
    return {
      counter,
      r,
      spreadRatio,
      gateable: Number.isFinite(r) && r >= MIN_CORRELATION && spreadRatio <= MAX_SPREAD_RATIO,
    };
  });
}

function pearson(xs, ys) {
  const n = xs.length;
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / n;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? Number.NaN : sxy / Math.sqrt(sxx * syy);
}

const round = (value) => Math.round(value * 100) / 100;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function main([command, ...args]) {
  if (command === "check" || command === "lower") {
    const [ceilingsPath, journey, evidencePath] = args;
    const all = readJson(ceilingsPath);
    const ceilings = all[journey];
    if (!ceilings) throw new Error(`${ceilingsPath} has no journey "${journey}"`);
    const counts = readJson(evidencePath).workCounts ?? {};
    if (command === "lower") {
      all[journey] = lowerCeilings(ceilings, counts);
      writeFileSync(ceilingsPath, `${JSON.stringify(all, null, 2)}\n`);
      return 0;
    }
    const { passed, rows } = checkCeilings(ceilings, counts);
    console.log(`[perf-ratchet] ${journey}: ${passed ? "PASS" : "FAIL"}`);
    for (const row of rows) console.log(`[perf-ratchet]   ${formatRow(row)}`);
    return passed ? 0 : 1;
  }
  if (command === "correlate") {
    const runs = args.map((arg) => {
      const [variant, path] = arg.split("=");
      const evidence = readJson(path);
      return { variant, wallMs: evidence.wallMs, counts: evidence.workCounts };
    });
    console.log("counter\tr\tspread\tgate");
    for (const row of correlate(runs)) {
      console.log(
        `${row.counter}\t${round(row.r)}\t${round(row.spreadRatio * 100)}%\t${row.gateable ? "yes" : "no"}`,
      );
    }
    return 0;
  }
  console.error("usage: perf-ratchet.mjs check|lower <ceilings.json> <journey> <evidence.json>");
  console.error("       perf-ratchet.mjs correlate <variant>=<evidence.json> ...");
  return 2;
}

// Real paths on both sides: a symlinked path (macOS /var, /tmp) must still run the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
