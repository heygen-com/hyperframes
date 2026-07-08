#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareVideos, DEFAULT_CHECKPOINT_COUNT } from "./compare.ts";
import { findSuccessfulEntry, loadOrCreateManifest } from "./manifest.ts";
import { DEFAULT_BASELINE_DIR, FORK_SHA, renderItemToVideo, type EvalLogger } from "./renderer.ts";
import { findRegistryItem, safeItemPathSegment } from "./registry.ts";

type CompareOptions = {
  itemName: string | null;
  baselineVideo: string | null;
  candidateVideo: string | null;
  baselineDir: string;
  forkSha: string;
  checkpointCount: number;
  fps: number | undefined;
  secondBaselineVideo: string | undefined;
  renderSecondBaseline: boolean;
};

export async function main(argv: string[] = process.argv): Promise<void> {
  const options = parseArgs(argv);
  if (!options.candidateVideo) {
    throw new Error("--candidate is required");
  }

  const baselineVideo = resolveBaselineVideo(options);
  const renderSecondBaseline =
    options.renderSecondBaseline && options.secondBaselineVideo === undefined && options.itemName
      ? async () => renderSecondBaselineVideo(options)
      : undefined;

  const verdict = await compareVideos({
    itemName: options.itemName ?? "video-pair",
    baselineVideo,
    candidateVideo: resolve(options.candidateVideo),
    checkpointCount: options.checkpointCount,
    fps: options.fps,
    secondBaselineVideo: options.secondBaselineVideo
      ? resolve(options.secondBaselineVideo)
      : undefined,
    renderSecondBaseline,
  });

  console.log(JSON.stringify(verdict, jsonNumberReplacer, 2));
  if (verdict.verdict === "damaged") {
    process.exitCode = 1;
  }
}

function resolveBaselineVideo(options: CompareOptions): string {
  if (options.baselineVideo) return resolve(options.baselineVideo);
  if (!options.itemName) {
    throw new Error("Provide --baseline or --item for manifest baseline lookup");
  }
  const manifest = loadOrCreateManifest({
    baselineDir: options.baselineDir,
    forkSha: options.forkSha,
    now: new Date().toISOString(),
  });
  const entry = findSuccessfulEntry(manifest, options.itemName, options.forkSha);
  if (!entry) {
    throw new Error(`No successful baseline manifest entry found for ${options.itemName}`);
  }
  return resolve(options.baselineDir, entry.baseline_video_path);
}

async function renderSecondBaselineVideo(options: CompareOptions): Promise<string> {
  if (!options.itemName) {
    throw new Error("Cannot render second baseline without --item");
  }
  const item = findRegistryItem(options.itemName);
  if (!item) {
    throw new Error(`No registry item found for ${options.itemName}`);
  }
  const outputDir = join(options.baselineDir, "second-baselines", options.forkSha.slice(0, 12));
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${safeItemPathSegment(item)}-${Date.now()}.mp4`);
  await renderItemToVideo({
    item,
    outputPath,
    logger: stderrLogger,
  });
  return outputPath;
}

function parseArgs(argv: string[]): CompareOptions {
  let itemName: string | null = null;
  let baselineVideo: string | null = null;
  let candidateVideo: string | null = null;
  let baselineDir = process.env.HYPERFRAMES_GSAP_BASELINE_DIR ?? DEFAULT_BASELINE_DIR;
  let forkSha = process.env.HYPERFRAMES_GSAP_BASELINE_SHA ?? FORK_SHA;
  let checkpointCount = DEFAULT_CHECKPOINT_COUNT;
  let fps: number | undefined;
  let secondBaselineVideo: string | undefined;
  let renderSecondBaseline = true;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--item" && argv[index + 1]) {
      index += 1;
      itemName = argv[index] ?? null;
    } else if (token === "--baseline" && argv[index + 1]) {
      index += 1;
      baselineVideo = argv[index] ?? null;
    } else if (token === "--candidate" && argv[index + 1]) {
      index += 1;
      candidateVideo = argv[index] ?? null;
    } else if (token === "--baseline-dir" && argv[index + 1]) {
      index += 1;
      baselineDir = argv[index] ?? baselineDir;
    } else if (token === "--fork-sha" && argv[index + 1]) {
      index += 1;
      forkSha = argv[index] ?? forkSha;
    } else if (token === "--checkpoint-count" && argv[index + 1]) {
      index += 1;
      checkpointCount = parsePositiveInteger(argv[index], "--checkpoint-count");
    } else if (token === "--fps" && argv[index + 1]) {
      index += 1;
      fps = parsePositiveNumber(argv[index], "--fps");
    } else if (token === "--second-baseline" && argv[index + 1]) {
      index += 1;
      secondBaselineVideo = argv[index] ? resolve(argv[index]) : undefined;
    } else if (token === "--no-render-second-baseline") {
      renderSecondBaseline = false;
    } else if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token ?? ""}`);
    }
  }

  return {
    itemName,
    baselineVideo,
    candidateVideo,
    baselineDir: resolve(baselineDir),
    forkSha,
    checkpointCount,
    fps,
    secondBaselineVideo,
    renderSecondBaseline,
  };
}

function parsePositiveInteger(raw: string | undefined, label: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parsePositiveNumber(raw: string | undefined, label: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return parsed;
}

function jsonNumberReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (value === Number.POSITIVE_INFINITY) return "Infinity";
    if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
    return "NaN";
  }
  return value;
}

const stderrLogger: EvalLogger = {
  log(message: string): void {
    console.error(`[${new Date().toISOString()}] ${message}`);
  },
  chunk(message: string): void {
    process.stderr.write(message);
  },
};

function printHelp(): void {
  console.log(`Usage:
  node --import tsx scripts/eval-gsap-vs-anime/compare-item.ts --baseline base.mp4 --candidate candidate.mp4
  node --import tsx scripts/eval-gsap-vs-anime/compare-item.ts --item block/data-chart --candidate candidate.mp4

Options:
  --baseline <mp4>              Explicit GSAP baseline video.
  --candidate <mp4>             Candidate video to compare.
  --item <kind/name|name>       Registry item for manifest lookup and lazy second-baseline render.
  --baseline-dir <dir>          Baseline directory; defaults to ${DEFAULT_BASELINE_DIR}
  --checkpoint-count <n>        Number of PSNR checkpoints; defaults to ${DEFAULT_CHECKPOINT_COUNT}.
  --fps <n>                     Override fps used to map times to frame indexes.
  --second-baseline <mp4>       Existing second GSAP baseline for low-band waiver checks.
  --no-render-second-baseline   Do not lazily render a second baseline when --item is present.
`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
