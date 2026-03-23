import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type PerfBaseline = {
  parityFixtureMaxMs: number;
  allowedRegressionRatio: number;
};

function main(): void {
  const baselinePath = resolve(
    process.env.PRODUCER_PERF_BASELINE_PATH || "producer/tests/perf/baseline.json",
  );
  const measuredMs = Number(process.env.PRODUCER_PARITY_ELAPSED_MS || "");
  if (!Number.isFinite(measuredMs) || measuredMs <= 0) {
    throw new Error("Missing PRODUCER_PARITY_ELAPSED_MS for perf gate");
  }
  const baselineRaw = readFileSync(baselinePath, "utf-8");
  const baseline = JSON.parse(baselineRaw) as PerfBaseline;
  const maxMs = Math.round(baseline.parityFixtureMaxMs * (1 + baseline.allowedRegressionRatio));
  const payload = {
    baselinePath,
    measuredMs,
    parityFixtureMaxMs: baseline.parityFixtureMaxMs,
    maxMs,
  };
  console.log(`[PerfGate] ${JSON.stringify(payload)}`);
  if (measuredMs > maxMs) {
    throw new Error(`[PerfGate] Regression detected measured=${measuredMs}ms max=${maxMs}ms`);
  }
}

main();
