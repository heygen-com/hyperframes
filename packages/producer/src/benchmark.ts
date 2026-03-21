#!/usr/bin/env tsx
/**
 * Render Benchmark
 *
 * Runs each test fixture multiple times and records per-stage timing.
 * Results are saved to producer/tests/perf/benchmark-results.json.
 *
 * Usage:
 *   pnpm benchmark                    # 3 runs per fixture (default)
 *   pnpm benchmark -- --runs 5        # 5 runs per fixture
 *   pnpm benchmark -- --only chat     # single fixture
 *   pnpm benchmark -- --exclude-tags slow
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRenderJob, executeRenderJob, type RenderPerfSummary } from "./services/renderOrchestrator.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const testsDir = resolve(scriptDir, "../tests");
const perfDir = resolve(testsDir, "perf");

interface TestMeta {
  name: string;
  tags?: string[];
  renderConfig: { fps: 24 | 30 | 60 };
}

interface BenchmarkRun {
  run: number;
  perfSummary: RenderPerfSummary;
}

interface FixtureResult {
  fixture: string;
  name: string;
  runs: BenchmarkRun[];
  averages: {
    totalElapsedMs: number;
    captureAvgMs: number | null;
    stages: Record<string, number>;
  };
}

interface BenchmarkResults {
  timestamp: string;
  platform: string;
  nodeVersion: string;
  runsPerFixture: number;
  fixtures: FixtureResult[];
}

function parseArgs(): { runs: number; only: string | null; excludeTags: string[] } {
  let runs = 3;
  let only: string | null = null;
  const excludeTags: string[] = [];

  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--runs" && process.argv[i + 1]) {
      i++;
      runs = parseInt(process.argv[i] ?? "", 10);
    } else if (process.argv[i] === "--only" && process.argv[i + 1]) {
      i++;
      only = process.argv[i] ?? null;
    } else if (process.argv[i] === "--exclude-tags" && process.argv[i + 1]) {
      i++;
      excludeTags.push(...(process.argv[i] ?? "").split(","));
    }
  }

  return { runs, only, excludeTags };
}

function discoverFixtures(only: string | null, excludeTags: string[]): Array<{ id: string; dir: string; meta: TestMeta }> {
  const fixtures: Array<{ id: string; dir: string; meta: TestMeta }> = [];

  for (const entry of readdirSync(testsDir)) {
    if (entry === "perf" || entry === "parity") continue;
    const dir = join(testsDir, entry);
    const metaPath = join(dir, "meta.json");
    const srcDir = join(dir, "src");
    if (!existsSync(metaPath) || !existsSync(join(srcDir, "index.html"))) continue;

    if (only && entry !== only) continue;

    const meta: TestMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
    if (excludeTags.length > 0 && meta.tags?.some((t) => excludeTags.includes(t))) continue;

    fixtures.push({ id: entry, dir, meta });
  }

  return fixtures;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

async function runBenchmark(): Promise<void> {
  const { runs, only, excludeTags } = parseArgs();
  const fixtures = discoverFixtures(only, excludeTags);

  if (fixtures.length === 0) {
    console.error("No fixtures found");
    process.exit(1);
  }

  console.log(`\n🏁 Benchmark: ${fixtures.length} fixture(s) × ${runs} run(s)\n`);

  const results: FixtureResult[] = [];

  for (const fixture of fixtures) {
    console.log(`\n━━━ ${fixture.meta.name} (${fixture.id}) ━━━`);
    const fixtureRuns: BenchmarkRun[] = [];

    for (let r = 0; r < runs; r++) {
      console.log(`  Run ${r + 1}/${runs}...`);

      // Copy src to temp dir for isolation
      const tmpRoot = join(tmpdir(), `benchmark-${fixture.id}-${Date.now()}`);
      mkdirSync(tmpRoot, { recursive: true });
      cpSync(join(fixture.dir, "src"), join(tmpRoot, "src"), { recursive: true });

      const projectDir = join(tmpRoot, "src");
      const outputPath = join(tmpRoot, "output.mp4");

      const job = createRenderJob({
        fps: fixture.meta.renderConfig.fps,
        quality: "high",
        debug: false,
      });

      try {
        await executeRenderJob(job, projectDir, outputPath);
      } catch (err) {
        console.error(`  ❌ Run ${r + 1} failed: ${err instanceof Error ? err.message : err}`);
        continue;
      } finally {
        try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
      }

      if (job.perfSummary) {
        fixtureRuns.push({ run: r + 1, perfSummary: job.perfSummary });
        const ps = job.perfSummary;
        console.log(`  ✓ ${ps.totalElapsedMs}ms total | capture avg ${ps.captureAvgMs ?? "?"}ms/frame | ${ps.totalFrames} frames`);
      }
    }

    if (fixtureRuns.length === 0) {
      console.log(`  ⚠ No successful runs`);
      continue;
    }

    // Compute averages
    const allStageKeys = new Set<string>();
    for (const run of fixtureRuns) {
      for (const key of Object.keys(run.perfSummary.stages)) {
        allStageKeys.add(key);
      }
    }

    const avgStages: Record<string, number> = {};
    for (const key of allStageKeys) {
      avgStages[key] = avg(fixtureRuns.map((r) => r.perfSummary.stages[key] ?? 0));
    }

    const fixtureResult: FixtureResult = {
      fixture: fixture.id,
      name: fixture.meta.name,
      runs: fixtureRuns,
      averages: {
        totalElapsedMs: avg(fixtureRuns.map((r) => r.perfSummary.totalElapsedMs)),
        captureAvgMs: avg(fixtureRuns.filter((r) => r.perfSummary.captureAvgMs != null).map((r) => r.perfSummary.captureAvgMs!)) || null,
        stages: avgStages,
      },
    };

    results.push(fixtureResult);

    console.log(`\n  Average: ${fixtureResult.averages.totalElapsedMs}ms total`);
    for (const [stage, ms] of Object.entries(fixtureResult.averages.stages)) {
      const pct = Math.round((ms / fixtureResult.averages.totalElapsedMs) * 100);
      console.log(`    ${stage}: ${ms}ms (${pct}%)`);
    }
  }

  // Save results
  const benchmarkResults: BenchmarkResults = {
    timestamp: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    runsPerFixture: runs,
    fixtures: results,
  };

  if (!existsSync(perfDir)) mkdirSync(perfDir, { recursive: true });
  const outputPath = join(perfDir, "benchmark-results.json");
  writeFileSync(outputPath, JSON.stringify(benchmarkResults, null, 2), "utf-8");

  // Print summary table
  console.log("\n\n📊 BENCHMARK SUMMARY");
  console.log("═".repeat(80));
  console.log(
    "Fixture".padEnd(25) +
    "Total".padStart(10) +
    "Compile".padStart(10) +
    "Extract".padStart(10) +
    "Audio".padStart(10) +
    "Capture".padStart(10) +
    "Encode".padStart(10)
  );
  console.log("─".repeat(80));

  for (const f of results) {
    const s = f.averages.stages;
    console.log(
      f.fixture.padEnd(25) +
      `${f.averages.totalElapsedMs}ms`.padStart(10) +
      `${s.compileMs ?? "-"}ms`.padStart(10) +
      `${s.videoExtractMs ?? "-"}ms`.padStart(10) +
      `${s.audioProcessMs ?? "-"}ms`.padStart(10) +
      `${s.captureMs ?? "-"}ms`.padStart(10) +
      `${s.encodeMs ?? "-"}ms`.padStart(10)
    );
  }

  console.log("═".repeat(80));
  console.log(`\nResults saved to: ${outputPath}`);
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
