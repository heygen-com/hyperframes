#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  baselineVideoPath,
  baselineVideoRelativePath,
  createFileLogger,
  DEFAULT_BASELINE_DIR,
  FORK_SHA,
  renderItemToVideo,
  runCleanBuild,
} from "./renderer.ts";
import { discoverRegistryItems } from "./registry.ts";
import {
  ensurePendingManifestEntries,
  findManifestEntry,
  loadOrCreateManifest,
  manifestPathForBaselineDir,
  recordManifestEntry,
  writeManifest,
} from "./manifest.ts";
import type { BaselineManifest, RegistryItem } from "./types.ts";

type RenderBaselineOptions = {
  baselineDir: string;
  forkSha: string;
  skipBuild: boolean;
  only: string | null;
};

type Summary = {
  succeeded: number;
  failed: number;
  pending: number;
};

export async function main(argv: string[] = process.argv): Promise<void> {
  const options = parseArgs(argv);
  mkdirSync(options.baselineDir, { recursive: true });
  const logger = createFileLogger(join(options.baselineDir, "render-baseline.log"));
  try {
    logger.log(`baseline dir: ${options.baselineDir}`);
    logger.log(`fork sha: ${options.forkSha}`);
    if (options.skipBuild) {
      logger.log("clean build skipped by flag/env");
    } else {
      runCleanBuild(logger);
    }

    const allItems = discoverRegistryItems();
    const selectedItems = options.only
      ? allItems.filter((item) => item.key === options.only || item.name === options.only)
      : allItems;
    if (options.only && selectedItems.length === 0) {
      throw new Error(`No registry item matched --only ${options.only}`);
    }

    const manifestPath = manifestPathForBaselineDir(options.baselineDir);
    let manifest = loadOrCreateManifest({
      baselineDir: options.baselineDir,
      forkSha: options.forkSha,
      now: new Date().toISOString(),
    });
    manifest = ensurePendingManifestEntries({
      manifest,
      items: allItems,
      forkSha: options.forkSha,
      now: new Date().toISOString(),
      relativeVideoPathForItem: (item) => baselineVideoRelativePath(item, options.forkSha),
    });
    writeManifest(manifestPath, manifest);

    logger.log(`discovered ${allItems.length} registry items; rendering ${selectedItems.length}`);
    for (const item of selectedItems) {
      manifest = await renderOneItem({
        item,
        manifest,
        manifestPath,
        options,
        logger,
      });
    }

    const summary = summarize(manifest, allItems, options.forkSha);
    logger.log(
      `summary succeeded=${summary.succeeded} failed=${summary.failed} pending=${summary.pending}`,
    );
    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await logger.close();
  }
}

async function renderOneItem(input: {
  item: RegistryItem;
  manifest: BaselineManifest;
  manifestPath: string;
  options: RenderBaselineOptions;
  logger: ReturnType<typeof createFileLogger>;
}): Promise<BaselineManifest> {
  const outputPath = baselineVideoPath(
    input.options.baselineDir,
    input.item,
    input.options.forkSha,
  );
  const relativeVideoPath = baselineVideoRelativePath(input.item, input.options.forkSha);
  const existing = findManifestEntry(input.manifest, input.item.key, input.options.forkSha);
  if (existing?.status === "success" && existsSync(outputPath)) {
    input.logger.log(`skip ${input.item.key}: already rendered`);
    return input.manifest;
  }

  const started = Date.now();
  input.logger.log(`start ${input.item.key} -> ${outputPath}`);
  try {
    await renderItemToVideo({
      item: input.item,
      outputPath,
      logger: input.logger,
    });
    const manifest = recordManifestEntry(input.manifest, {
      item: input.item,
      forkSha: input.options.forkSha,
      relativeVideoPath,
      status: "success",
      renderedAt: new Date().toISOString(),
      renderDurationMs: Date.now() - started,
    });
    writeManifest(input.manifestPath, manifest);
    input.logger.log(`done ${input.item.key} in ${Date.now() - started}ms`);
    return manifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const manifest = recordManifestEntry(input.manifest, {
      item: input.item,
      forkSha: input.options.forkSha,
      relativeVideoPath,
      status: "failed",
      renderedAt: new Date().toISOString(),
      renderDurationMs: Date.now() - started,
      errorMessage: message,
    });
    writeManifest(input.manifestPath, manifest);
    input.logger.log(`failed ${input.item.key} in ${Date.now() - started}ms: ${message}`);
    return manifest;
  }
}

function summarize(manifest: BaselineManifest, items: RegistryItem[], forkSha: string): Summary {
  let succeeded = 0;
  let failed = 0;
  for (const item of items) {
    const entry = findManifestEntry(manifest, item.key, forkSha);
    if (entry?.status === "success") succeeded += 1;
    if (entry?.status === "failed") failed += 1;
  }
  const pending = Math.max(0, items.length - succeeded - failed);
  return { succeeded, failed, pending };
}

function parseArgs(argv: string[]): RenderBaselineOptions {
  let baselineDir = process.env.HYPERFRAMES_GSAP_BASELINE_DIR ?? DEFAULT_BASELINE_DIR;
  let forkSha = process.env.HYPERFRAMES_GSAP_BASELINE_SHA ?? FORK_SHA;
  let skipBuild = process.env.HF_EVAL_SKIP_BUILD === "1";
  let only: string | null = null;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--baseline-dir" && argv[index + 1]) {
      index += 1;
      baselineDir = argv[index] ?? baselineDir;
    } else if (token === "--fork-sha" && argv[index + 1]) {
      index += 1;
      forkSha = argv[index] ?? forkSha;
    } else if (token === "--skip-build" || token === "--no-build") {
      skipBuild = true;
    } else if (token === "--only" && argv[index + 1]) {
      index += 1;
      only = argv[index] ?? null;
    } else if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token ?? ""}`);
    }
  }

  return {
    baselineDir: resolve(baselineDir),
    forkSha,
    skipBuild,
    only,
  };
}

function printHelp(): void {
  console.log(`Usage: node --import tsx scripts/eval-gsap-vs-anime/render-baseline.ts [options]

Options:
  --baseline-dir <dir>  Baseline output directory.
  --fork-sha <sha>      Fork-point SHA segment for output isolation.
  --skip-build          Skip bun install && bun run build.
  --only <key|name>     Render one registry item, e.g. block/data-chart.

Env:
  HYPERFRAMES_GSAP_BASELINE_DIR  Overrides the baseline directory.
  HYPERFRAMES_GSAP_BASELINE_SHA  Overrides the fork SHA.
  HF_EVAL_SKIP_BUILD=1           Skips the clean build.
`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
