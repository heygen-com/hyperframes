#!/usr/bin/env bun
/**
 * Player Performance Test Runner
 *
 * Boots a static server, launches puppeteer-core against locally-served fixtures,
 * runs the configured scenarios, then evaluates the collected metrics against
 * baseline.json via perf-gate.
 *
 * Usage:
 *   bun run packages/player/tests/perf/index.ts
 *   bun run packages/player/tests/perf/index.ts --mode enforce
 *   bun run packages/player/tests/perf/index.ts --scenarios load
 *   bun run packages/player/tests/perf/index.ts --runs 5 --headful
 *
 * Flags:
 *   --mode <measure|enforce>   default: PLAYER_PERF_MODE env or "measure"
 *   --scenarios <list>         comma-separated scenario ids; default: all enabled
 *   --runs <n>                 override per-scenario run count
 *   --fixture <name>           single fixture (default: every fixture in fixtures/)
 *   --headful                  show the browser; default: headless
 *
 * Exit codes:
 *   0  all pass (or measure mode)
 *   1  scenario crashed
 *   2  perf gate failed in enforce mode
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runFps } from "./scenarios/02-fps.ts";
import { runLoad } from "./scenarios/03-load.ts";
import { runScrub } from "./scenarios/04-scrub.ts";
import { runDrift } from "./scenarios/05-drift.ts";
import { runParity } from "./scenarios/06-parity.ts";
import { reportAndGate, type GateMode, type GateResult, type Metric } from "./perf-gate.ts";
import { launchBrowser } from "./runner.ts";
import { startServer } from "./server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(HERE, "results");
const RESULTS_FILE = resolve(RESULTS_DIR, "metrics.json");

type ScenarioId = "load" | "fps" | "scrub" | "drift" | "parity";

/**
 * Per-scenario default `runs` value when the caller didn't pass `--runs`.
 *
 * Why `load` gets 5 runs and the others get 3:
 *
 *   - `load` reports a single p95 over `runs` measurements, so each `run` is
 *     one sample. p95 over n=3 is mostly noise (the 95th percentile of three
 *     numbers is just `max`), so we bump it to 5. We considered 10 — but cold
 *     load is the slowest scenario in the shard (~2s × 5 runs × 2 fixtures =
 *     ~20s with disk cache cleared), and going to 10 would push the load shard
 *     past 30s of pure-measurement wall time per CI invocation.
 *   - `fps` aggregates as `min(ratio)` over runs — 3 runs gives us a worst-
 *     of-three signal, which is what we want for a floor metric. Adding more
 *     runs would only make the ratio strictly smaller (more chances to catch
 *     a stall) and shift the threshold toward false positives from runner
 *     contention rather than real regressions.
 *   - `scrub` and `drift` *pool* their per-run samples (10 seeks/run for
 *     scrub, ~1500 RVFC frames/run for drift) and compute the percentile over
 *     the pooled set. Their effective sample count for the percentile is
 *     `runs × samples_per_run`, not `runs`, so 3 runs already gives 30+ scrub
 *     samples and 4500+ drift samples per shard — well above the n≈30 rule of
 *     thumb for a stable p95.
 *
 * TODO(player-perf): revisit `fps: 3` once we have ~2 weeks of CI baseline
 * data — if `min(ratio)` shows >5% inter-run variance attributable to runner
 * jitter (not real player regressions), bump to 5 and tighten the
 * `compositionTimeAdvancementRatioMin` baseline accordingly.
 */
const DEFAULT_RUNS: Record<ScenarioId, number> = {
  load: 5,
  fps: 3,
  scrub: 3,
  drift: 3,
  parity: 3,
};

type ResultsFile = {
  schemaVersion: 1;
  timestamp: string;
  gitSha: string | null;
  mode: GateMode;
  scenarios: ScenarioId[];
  runs: number | null;
  fixture: string | null;
  crashed: boolean;
  passed: boolean;
  metrics: Metric[];
  gate: GateResult[];
};

function readGitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function writeResults(file: ResultsFile): void {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }
  writeFileSync(RESULTS_FILE, JSON.stringify(file, null, 2) + "\n");
  console.log(`[player-perf] wrote results to ${RESULTS_FILE}`);
}

type ParsedArgs = {
  mode: GateMode;
  scenarios: ScenarioId[];
  runs: number | null;
  fixture: string | null;
  headful: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    // TODO(player-perf): once baselines have settled on CI for ~1–2 weeks and we
    // are confident there are no false positives from runner jitter, flip this
    // default from "measure" to "enforce" — that single line + bumping the
    // workflow's `--mode=measure` flag in .github/workflows/player-perf.yml is
    // the entire opt-in. See packages/player/tests/perf/perf-gate.ts for how
    // `mode` is consumed (measure logs regressions but never fails; enforce
    // exits non-zero on regression).
    mode: (process.env.PLAYER_PERF_MODE as GateMode) === "enforce" ? "enforce" : "measure",
    scenarios: ["load", "fps", "scrub", "drift", "parity"],
    runs: null,
    fixture: null,
    headful: false,
  };
  // Normalize `--key=value` into `[--key, value]` so the rest of the loop
  // only has to handle the space-separated form.
  const tokens: string[] = [];
  for (const raw of argv.slice(2)) {
    if (raw.startsWith("--") && raw.includes("=")) {
      const eq = raw.indexOf("=");
      tokens.push(raw.slice(0, eq), raw.slice(eq + 1));
    } else {
      tokens.push(raw);
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    const next = tokens[i + 1];
    if (arg === "--mode" && next) {
      if (next !== "measure" && next !== "enforce") {
        throw new Error(`--mode must be measure|enforce, got ${next}`);
      }
      result.mode = next;
      i++;
    } else if (arg === "--scenarios" && next) {
      result.scenarios = next.split(",").map((s) => s.trim()) as ScenarioId[];
      i++;
    } else if (arg === "--runs" && next) {
      result.runs = parseInt(next, 10);
      i++;
    } else if (arg === "--fixture" && next) {
      result.fixture = next;
      i++;
    } else if (arg === "--headful") {
      result.headful = true;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  console.log(
    `[player-perf] starting: mode=${args.mode} scenarios=${args.scenarios.join(",")} runs=${args.runs ?? "default"} fixture=${args.fixture ?? "all"}`,
  );

  const server = startServer();
  console.log(`[player-perf] server listening at ${server.origin}`);

  const browser = await launchBrowser({ headless: !args.headful });
  console.log("[player-perf] browser launched");

  const metrics: Metric[] = [];
  let crashed = false;

  try {
    for (const scenario of args.scenarios) {
      if (scenario === "load") {
        const m = await runLoad({
          browser,
          origin: server.origin,
          runs: args.runs ?? DEFAULT_RUNS.load,
          fixture: args.fixture,
        });
        metrics.push(...m);
      } else if (scenario === "fps") {
        const m = await runFps({
          browser,
          origin: server.origin,
          runs: args.runs ?? DEFAULT_RUNS.fps,
          fixture: args.fixture,
        });
        metrics.push(...m);
      } else if (scenario === "scrub") {
        const m = await runScrub({
          browser,
          origin: server.origin,
          runs: args.runs ?? DEFAULT_RUNS.scrub,
          fixture: args.fixture,
        });
        metrics.push(...m);
      } else if (scenario === "drift") {
        const m = await runDrift({
          browser,
          origin: server.origin,
          runs: args.runs ?? DEFAULT_RUNS.drift,
          fixture: args.fixture,
        });
        metrics.push(...m);
      } else if (scenario === "parity") {
        const m = await runParity({
          browser,
          origin: server.origin,
          runs: args.runs ?? DEFAULT_RUNS.parity,
          fixture: args.fixture,
        });
        metrics.push(...m);
      } else {
        console.warn(`[player-perf] unknown scenario: ${scenario}`);
      }
    }
  } catch (err) {
    crashed = true;
    console.error("[player-perf] scenario crashed:", err);
  } finally {
    await browser.close();
    await server.stop();
  }

  let report: { passed: boolean; rows: GateResult[] } = { passed: !crashed, rows: [] };
  if (!crashed && metrics.length > 0) {
    report = reportAndGate(metrics, args.mode);
  }

  writeResults({
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    gitSha: readGitSha(),
    mode: args.mode,
    scenarios: args.scenarios,
    runs: args.runs,
    fixture: args.fixture,
    crashed,
    passed: report.passed && !crashed,
    metrics,
    gate: report.rows,
  });

  if (crashed) {
    process.exit(1);
  }
  if (!report.passed) {
    process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[player-perf] fatal:", err);
  process.exit(1);
});
