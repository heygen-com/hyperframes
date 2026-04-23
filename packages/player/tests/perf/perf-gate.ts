import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compares measured perf metrics against baseline.json with an allowed regression ratio.
 *
 * Mirrors packages/producer/src/perf-gate.ts: each metric has a baseline value, the
 * gate computes `max = baseline * (1 + allowedRegressionRatio)`, and any measured
 * value above max counts as a regression. In "measure" mode the script logs but
 * never exits non-zero — useful for the first runs while we collect realistic
 * baselines on the CI runner. Flip to "enforce" once baselines are committed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE_PATH = resolve(HERE, "baseline.json");

export type Direction = "lower-is-better" | "higher-is-better";

export type Metric = {
  /** Display name, e.g. "comp_load_cold_p95_ms" */
  name: string;
  /** Key into baseline.json, e.g. "compLoadColdP95Ms" */
  baselineKey: keyof PerfBaseline;
  value: number;
  unit: string;
  direction: Direction;
  samples?: number[];
};

export type PerfBaseline = {
  compLoadColdP95Ms: number;
  compLoadWarmP95Ms: number;
  /**
   * Floor on `(compositionTime advanced) / (wallClock elapsed)` over a sustained
   * playback window — see packages/player/tests/perf/scenarios/02-fps.ts. A
   * healthy player keeps up with its intended speed and reads ~1.0; values
   * below 1.0 mean the composition clock fell behind real time, which is the
   * actual user-visible jank we want to gate against. Refresh-rate independent
   * by construction, so it does not saturate to display refresh on high-Hz
   * runners the way the previous `fpsMin` did. Direction: higher-is-better.
   */
  compositionTimeAdvancementRatioMin: number;
  scrubLatencyP95IsolatedMs: number;
  scrubLatencyP95InlineMs: number;
  driftMaxMs: number;
  driftP95Ms: number;
  paritySsimMin: number;
  allowedRegressionRatio: number;
};

export type GateMode = "measure" | "enforce";

export type GateResult = {
  metric: Metric;
  baseline: number;
  threshold: number;
  passed: boolean;
  ratio: number;
};

export function loadBaseline(path?: string): PerfBaseline {
  const baselinePath = path ?? process.env.PLAYER_PERF_BASELINE_PATH ?? DEFAULT_BASELINE_PATH;
  const raw = readFileSync(baselinePath, "utf-8");
  return JSON.parse(raw) as PerfBaseline;
}

export function evaluateMetric(metric: Metric, baseline: PerfBaseline): GateResult {
  const baselineValue = baseline[metric.baselineKey];
  if (typeof baselineValue !== "number") {
    throw new Error(`[player-perf] baseline missing numeric key: ${String(metric.baselineKey)}`);
  }
  const allowed = baseline.allowedRegressionRatio;
  const threshold =
    metric.direction === "lower-is-better"
      ? baselineValue * (1 + allowed)
      : baselineValue * (1 - allowed);
  const passed =
    metric.direction === "lower-is-better" ? metric.value <= threshold : metric.value >= threshold;
  const ratio = baselineValue === 0 ? 0 : metric.value / baselineValue;
  return { metric, baseline: baselineValue, threshold, passed, ratio };
}

export type GateReport = {
  passed: boolean;
  rows: GateResult[];
};

export function reportAndGate(
  metrics: Metric[],
  // `mode` is resolved upstream in packages/player/tests/perf/index.ts
  // (`parseArgs`): the default comes from PLAYER_PERF_MODE env or "measure", and
  // the CLI flag `--mode=measure|enforce` overrides it. The "flip to enforce"
  // TODO lives at that call site so it is a one-line change.
  mode: GateMode,
  baselinePath?: string,
): GateReport {
  const baseline = loadBaseline(baselinePath);
  const rows = metrics.map((m) => evaluateMetric(m, baseline));
  console.log("[PerfGate] mode=" + mode);
  for (const row of rows) {
    const status = row.passed ? "PASS" : "FAIL";
    const dir = row.metric.direction === "lower-is-better" ? "≤" : "≥";
    console.log(
      `[PerfGate] ${status} ${row.metric.name} = ${row.metric.value.toFixed(2)}${row.metric.unit} (baseline=${row.baseline}${row.metric.unit}, threshold ${dir} ${row.threshold.toFixed(2)}${row.metric.unit}, ratio=${row.ratio.toFixed(3)})`,
    );
  }
  const failed = rows.filter((r) => !r.passed);
  if (failed.length === 0) return { passed: true, rows };
  if (mode === "measure") {
    console.log(`[PerfGate] ${failed.length} regression(s) detected — measure mode, not failing`);
    return { passed: true, rows };
  }
  console.error(`[PerfGate] ${failed.length} regression(s) detected — enforce mode, failing`);
  return { passed: false, rows };
}
