#!/usr/bin/env tsx
/**
 * Render Benchmark
 *
 * Runs each test fixture multiple times and records per-stage timing
 * plus peak heap/RSS memory. Results are saved to
 * producer/tests/perf/benchmark-results.json.
 *
 * Usage:
 *   bun run benchmark                    # 3 runs per fixture (default)
 *   bun run benchmark -- --runs 5        # 5 runs per fixture
 *   bun run benchmark -- --only chat     # single fixture
 *   bun run benchmark -- --exclude-tags slow
 *   bun run benchmark -- --tags hdr      # only fixtures tagged "hdr"
 *   bun run bench:hdr                    # convenience: --tags hdr
 *
 * `--tags` and `--exclude-tags` may be passed together; a fixture must match
 * at least one positive tag (when `--tags` is provided) AND must not match
 * any excluded tag.
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  createRenderJob,
  executeRenderJob,
  type RenderPerfSummary,
} from "./services/renderOrchestrator.js";

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
    /** Average of per-run peak RSS in MiB. `null` if no run reported memory. */
    peakRssMb: number | null;
    /** Average of per-run peak heapUsed in MiB. `null` if no run reported memory. */
    peakHeapUsedMb: number | null;
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

interface BenchmarkArgs {
  runs: number;
  only: string | null;
  /** Positive tag filter — fixture must include at least one. Empty = no positive filter. */
  tags: string[];
  /** Negative tag filter — fixture must not include any. Applied after `tags`. */
  excludeTags: string[];
}

function parseArgs(): BenchmarkArgs {
  let runs = 3;
  let only: string | null = null;
  const tags: string[] = [];
  const excludeTags: string[] = [];

  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--runs" && process.argv[i + 1]) {
      i++;
      runs = parseInt(process.argv[i] ?? "", 10);
    } else if (process.argv[i] === "--only" && process.argv[i + 1]) {
      i++;
      only = process.argv[i] ?? null;
    } else if (process.argv[i] === "--tags" && process.argv[i + 1]) {
      i++;
      tags.push(...(process.argv[i] ?? "").split(",").filter(Boolean));
    } else if (process.argv[i] === "--exclude-tags" && process.argv[i + 1]) {
      i++;
      excludeTags.push(...(process.argv[i] ?? "").split(",").filter(Boolean));
    }
  }

  return { runs, only, tags, excludeTags };
}

function discoverFixtures(
  only: string | null,
  tags: string[],
  excludeTags: string[],
): Array<{ id: string; dir: string; meta: TestMeta }> {
  const fixtures: Array<{ id: string; dir: string; meta: TestMeta }> = [];

  for (const entry of readdirSync(testsDir)) {
    if (entry === "perf" || entry === "parity") continue;
    const dir = join(testsDir, entry);
    const metaPath = join(dir, "meta.json");
    const srcDir = join(dir, "src");
    if (!existsSync(metaPath) || !existsSync(join(srcDir, "index.html"))) continue;

    if (only && entry !== only) continue;

    const meta: TestMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const fixtureTags = meta.tags ?? [];
    // Positive filter (--tags): if provided, fixture must match at least one.
    if (tags.length > 0 && !fixtureTags.some((t) => tags.includes(t))) continue;
    // Negative filter (--exclude-tags): always wins.
    if (excludeTags.length > 0 && fixtureTags.some((t) => excludeTags.includes(t))) continue;

    fixtures.push({ id: entry, dir, meta });
  }

  return fixtures;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * Average a possibly-empty list of optional numbers. Returns `null` when no
 * defined samples exist so the JSON output stays consistent with the
 * `peakRssMb: number | null` shape the consumer (perf README, regression
 * checks) expects — silently coercing missing memory data to `0` would mask
 * older results regenerated against this harness.
 */
function avgOrNull(nums: Array<number | null | undefined>): number | null {
  const filtered = nums.filter((n): n is number => typeof n === "number");
  if (filtered.length === 0) return null;
  return avg(filtered);
}

async function runBenchmark(): Promise<void> {
  const { runs, only, tags, excludeTags } = parseArgs();
  const fixtures = discoverFixtures(only, tags, excludeTags);

  if (fixtures.length === 0) {
    console.error(
      `No fixtures found${tags.length ? ` matching tags=[${tags.join(",")}]` : ""}` +
        `${excludeTags.length ? ` excluding=[${excludeTags.join(",")}]` : ""}`,
    );
    process.exit(1);
  }

  const filterDesc =
    (tags.length ? ` tags=[${tags.join(",")}]` : "") +
    (excludeTags.length ? ` exclude=[${excludeTags.join(",")}]` : "");
  console.log(`\n🏁 Benchmark: ${fixtures.length} fixture(s) × ${runs} run(s)${filterDesc}\n`);

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
        try {
          rmSync(tmpRoot, { recursive: true, force: true });
        } catch {}
      }

      if (job.perfSummary) {
        fixtureRuns.push({ run: r + 1, perfSummary: job.perfSummary });
        const ps = job.perfSummary;
        const memDesc =
          ps.peakRssMb != null || ps.peakHeapUsedMb != null
            ? ` | peak RSS ${ps.peakRssMb ?? "?"}MiB heap ${ps.peakHeapUsedMb ?? "?"}MiB`
            : "";
        console.log(
          `  ✓ ${ps.totalElapsedMs}ms total | capture avg ${ps.captureAvgMs ?? "?"}ms/frame | ${ps.totalFrames} frames${memDesc}`,
        );
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
        captureAvgMs: avgOrNull(fixtureRuns.map((r) => r.perfSummary.captureAvgMs)),
        peakRssMb: avgOrNull(fixtureRuns.map((r) => r.perfSummary.peakRssMb)),
        peakHeapUsedMb: avgOrNull(fixtureRuns.map((r) => r.perfSummary.peakHeapUsedMb)),
        stages: avgStages,
      },
    };

    results.push(fixtureResult);

    const memLine =
      fixtureResult.averages.peakRssMb != null || fixtureResult.averages.peakHeapUsedMb != null
        ? ` | peak RSS ${fixtureResult.averages.peakRssMb ?? "?"}MiB heap ${fixtureResult.averages.peakHeapUsedMb ?? "?"}MiB`
        : "";
    console.log(`\n  Average: ${fixtureResult.averages.totalElapsedMs}ms total${memLine}`);
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
  console.log("═".repeat(95));
  console.log(
    "Fixture".padEnd(25) +
      "Total".padStart(10) +
      "Compile".padStart(10) +
      "Extract".padStart(10) +
      "Audio".padStart(10) +
      "Capture".padStart(10) +
      "Encode".padStart(10) +
      "PeakRSS".padStart(10) +
      "PeakHeap".padStart(10),
  );
  console.log("─".repeat(95));

  for (const f of results) {
    const s = f.averages.stages;
    console.log(
      f.fixture.padEnd(25) +
        `${f.averages.totalElapsedMs}ms`.padStart(10) +
        `${s.compileMs ?? "-"}ms`.padStart(10) +
        `${s.videoExtractMs ?? "-"}ms`.padStart(10) +
        `${s.audioProcessMs ?? "-"}ms`.padStart(10) +
        `${s.captureMs ?? "-"}ms`.padStart(10) +
        `${s.encodeMs ?? "-"}ms`.padStart(10) +
        `${f.averages.peakRssMb ?? "-"}MiB`.padStart(10) +
        `${f.averages.peakHeapUsedMb ?? "-"}MiB`.padStart(10),
    );
  }

  console.log("═".repeat(95));
  console.log(`\nResults saved to: ${outputPath}`);
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
