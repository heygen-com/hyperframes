import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, statSync } from "node:fs";

export const examples: Example[] = [
  ["Run benchmarks with default settings (3 runs)", "hyperframes benchmark"],
  ["Run 5 iterations per config", "hyperframes benchmark --runs 5"],
  ["Output results as JSON", "hyperframes benchmark --json"],
];
import { resolve, join } from "node:path";
import { resolveProject } from "../utils/project.js";
import { loadProducer } from "../utils/producer.js";
import { c } from "../ui/colors.js";
import { formatBytes, formatDuration, errorBox } from "../ui/format.js";
import * as clack from "@clack/prompts";
import { withMeta } from "../utils/updateCheck.js";

interface BenchmarkConfig {
  label: string;
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  workers: number;
}

interface RunResult {
  elapsedMs: number;
  fileSize: number | null;
}

interface ConfigResult {
  config: BenchmarkConfig;
  runs: RunResult[];
  failures: number;
  avgTime: number | null;
  avgSize: number | null;
}

const DEFAULT_CONFIGS: BenchmarkConfig[] = [
  { label: "30fps \u00B7 draft \u00B7 2w", fps: 30, quality: "draft", workers: 2 },
  { label: "30fps \u00B7 standard \u00B7 2w", fps: 30, quality: "standard", workers: 2 },
  { label: "30fps \u00B7 high \u00B7 2w", fps: 30, quality: "high", workers: 2 },
  { label: "30fps \u00B7 standard \u00B7 4w", fps: 30, quality: "standard", workers: 4 },
  { label: "60fps \u00B7 standard \u00B7 4w", fps: 60, quality: "standard", workers: 4 },
];

export default defineCommand({
  meta: {
    name: "benchmark",
    description: "Render with preset fps/quality/worker configs and compare speed and file size",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    runs: { type: "string", description: "Number of runs per config", default: "3" },
    json: { type: "boolean", description: "Output results as JSON", default: false },
  },
  async run({ args }) {
    // ── Resolve project ──────────────────────────────────────────────────
    const project = resolveProject(args.dir);

    // ── Parse runs ───────────────────────────────────────────────────────
    const runsPerConfig = parseInt(args.runs ?? "3", 10);
    if (isNaN(runsPerConfig) || runsPerConfig < 1 || runsPerConfig > 20) {
      errorBox("Invalid runs", `Got "${args.runs ?? "3"}". Must be between 1 and 20.`);
      process.exit(1);
    }

    const jsonOutput = args.json ?? false;

    // ── Temp output for benchmark renders ────────────────────────────────
    const benchDir = resolve("renders", ".benchmark");

    // ── Load producer ────────────────────────────────────────────────────
    let producer: Awaited<ReturnType<typeof loadProducer>> | null = null;
    try {
      producer = await loadProducer();
    } catch {
      if (jsonOutput) {
        console.log(
          JSON.stringify({ error: "Producer module not available. Is the project built?" }),
        );
      } else {
        errorBox(
          "Producer module not available",
          "The rendering pipeline could not be loaded.",
          "Ensure @hyperframes/producer is built and linked.",
        );
      }
      process.exit(1);
    }

    // ── Print header ─────────────────────────────────────────────────────
    if (!jsonOutput) {
      console.log("");
      console.log(
        c.accent("\u25C6") +
          "  Benchmarking " +
          c.accent(project.name) +
          c.dim(` (${runsPerConfig} runs each)`),
      );
      console.log("");
    }

    // ── Run benchmarks ───────────────────────────────────────────────────
    const results: ConfigResult[] = [];

    for (const config of DEFAULT_CONFIGS) {
      const runs: RunResult[] = [];
      let failures = 0;

      const s = !jsonOutput ? clack.spinner() : undefined;
      s?.start(`Benchmarking ${config.label}...`);

      for (let i = 0; i < runsPerConfig; i++) {
        s?.message(`${config.label} — run ${i + 1}/${runsPerConfig}`);
        const outputPath = join(
          benchDir,
          `${config.label.replace(/[^a-zA-Z0-9]/g, "_")}_run${i}.mp4`,
        );

        try {
          const startTime = Date.now();
          const job = producer.createRenderJob({
            fps: config.fps,
            quality: config.quality,
            workers: config.workers,
          });
          await producer.executeRenderJob(job, project.dir, outputPath);
          const elapsedMs = Date.now() - startTime;

          let fileSize: number | null = null;
          if (existsSync(outputPath)) {
            const stat = statSync(outputPath);
            fileSize = stat.size;
          }

          runs.push({ elapsedMs, fileSize });
        } catch {
          failures++;
        }
      }

      s?.stop(`${config.label} — ${runs.length} runs${failures > 0 ? `, ${failures} failed` : ""}`);

      const successfulRuns = runs.filter((r) => r.elapsedMs > 0);
      const avgTime =
        successfulRuns.length > 0
          ? successfulRuns.reduce((sum, r) => sum + r.elapsedMs, 0) / successfulRuns.length
          : null;
      const sizesWithValues = runs.map((r) => r.fileSize).filter((s): s is number => s != null);
      const avgSize =
        sizesWithValues.length > 0
          ? sizesWithValues.reduce((sum, s) => sum + s, 0) / sizesWithValues.length
          : null;

      results.push({ config, runs, failures, avgTime, avgSize });
    }

    // ── Output results ───────────────────────────────────────────────────
    if (jsonOutput) {
      console.log(
        JSON.stringify(
          withMeta({
            results: results.map((r) => ({
              config: r.config.label,
              fps: r.config.fps,
              quality: r.config.quality,
              workers: r.config.workers,
              avgTimeMs: r.avgTime,
              avgSizeBytes: r.avgSize,
              failures: r.failures,
              runs: r.runs,
            })),
          }),
          null,
          2,
        ),
      );
      return;
    }

    // ── Table output ─────────────────────────────────────────────────────
    const configColWidth = 26;
    const timeColWidth = 10;
    const sizeColWidth = 10;

    const header =
      "   " +
      c.bold("Config".padEnd(configColWidth)) +
      c.bold("Time".padEnd(timeColWidth)) +
      c.bold("Size".padEnd(sizeColWidth));
    const separator = "   " + c.dim("\u2500".repeat(configColWidth + timeColWidth + sizeColWidth));

    console.log(header);
    console.log(separator);

    for (const result of results) {
      const timeStr = result.avgTime != null ? formatDuration(result.avgTime) : c.dim("failed");
      const sizeStr = result.avgSize != null ? formatBytes(result.avgSize) : c.dim("n/a");
      const failStr = result.failures > 0 ? c.warn(` (${result.failures} failed)`) : "";

      console.log(
        "   " +
          result.config.label.padEnd(configColWidth) +
          timeStr.padEnd(timeColWidth) +
          sizeStr.padEnd(sizeColWidth) +
          failStr,
      );
    }

    // ── Summary ──────────────────────────────────────────────────────────
    const successfulResults = results.filter((r) => r.avgTime != null);
    if (successfulResults.length > 0) {
      let fastest = successfulResults[0];
      for (const r of successfulResults) {
        if (fastest == null || r.avgTime == null) continue;
        if (fastest.avgTime == null || r.avgTime < fastest.avgTime) {
          fastest = r;
        }
      }

      if (fastest?.avgTime != null) {
        console.log("");
        console.log(
          c.success("\u25C7") +
            "  Fastest: " +
            c.accent(fastest.config.label) +
            c.dim(` (${formatDuration(fastest.avgTime)})`),
        );
      }
    } else {
      console.log("");
      console.log(
        c.error("\u2717") + "  All configurations failed. Ensure the rendering pipeline is set up.",
      );
    }

    console.log("");
  },
});
