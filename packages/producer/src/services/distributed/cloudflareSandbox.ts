/**
 * Thin Cloudflare Sandbox adapter for the distributed render pipeline.
 *
 * Orchestration only: `plan` → `renderChunk` × N → `assemble`. Capture
 * inside each sandbox is software/SwiftShader (`renderChunk` asserts that).
 * Parallelism is across sandboxes (≤10), not inside one Chrome.
 */

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble, type AssembleResult } from "./assemble.js";
import { type DistributedRenderConfig, type PlanResult, plan, resolveChunkPlan } from "./plan.js";
import { type ChunkResult, renderChunk } from "./renderChunk.js";
import { resolvePlanAudioPath } from "./shared.js";

/** Cloudflare account the sandbox fleet is pinned to. */
export const CLOUDFLARE_ACCOUNT_ID = "86bb57b655af7915f42b29dfc2d8807d";

/** Hard cap on live sandboxes — matches wrangler `max_instances`. */
export const SANDBOX_MAX_INSTANCES = 10;

/** First-bet instance type; bump to standard-3 only if Chrome OOMs. */
export const SANDBOX_INSTANCE_TYPE = "standard-3";

const SANDBOX_ID_PREFIX = "hf-chunk-";

export const HEYGEN_PROMO_TOTAL_FRAMES = 480;
const HEYGEN_PROMO_FPS = 30;
const HEYGEN_PROMO_WIDTH = 1920;
const HEYGEN_PROMO_HEIGHT = 1080;

export interface SandboxFanout {
  chunkCount: number;
  effectiveChunkSize: number;
  sandboxIds: string[];
  maxSandboxes: number;
}

export interface DistributedPrimitives {
  plan: typeof plan;
  renderChunk: typeof renderChunk;
  assemble: typeof assemble;
}

/**
 * One remote (or test-double) place that can run `renderChunk` against a
 * planDir. The adapter never talks to Cloudflare APIs itself — the bench
 * / Worker injects this.
 */
export interface ChunkExecutor {
  (args: {
    chunkIndex: number;
    sandboxId: string;
    planDir: string;
    outputChunkPath: string;
    renderChunk: typeof renderChunk;
  }): Promise<ChunkResult>;
}

export interface SandboxRenderInput {
  projectDir: string;
  outputPath: string;
  planDir?: string;
  workDir?: string;
  maxSandboxes?: number;
  primitives?: Partial<DistributedPrimitives>;
  executeChunk?: ChunkExecutor;
  config?: Partial<DistributedRenderConfig>;
}

export interface SandboxRenderResult {
  plan: PlanResult;
  assemble: AssembleResult;
  chunks: ChunkResult[];
  sandboxIds: string[];
  instanceType: typeof SANDBOX_INSTANCE_TYPE;
  accountId: typeof CLOUDFLARE_ACCOUNT_ID;
  totalElapsedMs: number;
  stages: {
    planMs: number;
    captureMs: number;
    assembleMs: number;
  };
}

function capSandboxes(requested: number | undefined): number {
  const n = requested ?? SANDBOX_MAX_INSTANCES;
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `[cloudflareSandbox] maxSandboxes must be a positive integer (received ${String(n)})`,
    );
  }
  return Math.min(n, SANDBOX_MAX_INSTANCES);
}

export function sandboxIdForChunk(chunkIndex: number): string {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= SANDBOX_MAX_INSTANCES) {
    throw new Error(
      `[cloudflareSandbox] chunkIndex must be in 0..${SANDBOX_MAX_INSTANCES - 1} (received ${String(chunkIndex)})`,
    );
  }
  return `${SANDBOX_ID_PREFIX}${chunkIndex}`;
}

/**
 * Fan-out for a known frame count. Delegates sizing to the shipped
 * `resolveChunkPlan` so adapters cannot drift from plan() math.
 */
export function resolveSandboxFanout(totalFrames: number, maxSandboxes?: number): SandboxFanout {
  const max = capSandboxes(maxSandboxes);
  const { chunkCount, effectiveChunkSize } = resolveChunkPlan(totalFrames, undefined, max);
  const sandboxIds = Array.from({ length: chunkCount }, (_, i) => sandboxIdForChunk(i));
  return { chunkCount, effectiveChunkSize, sandboxIds, maxSandboxes: max };
}

export function heygenPromoDistributedConfig(maxSandboxes?: number): DistributedRenderConfig {
  const maxParallelChunks = capSandboxes(maxSandboxes);
  return {
    fps: HEYGEN_PROMO_FPS,
    width: HEYGEN_PROMO_WIDTH,
    height: HEYGEN_PROMO_HEIGHT,
    format: "mp4",
    quality: "high",
    maxParallelChunks,
    runtimeCap: "cloudflare-sandbox",
    hdrMode: "force-sdr",
  };
}

function defaultExecuteChunk(): ChunkExecutor {
  return async ({ planDir, chunkIndex, outputChunkPath, renderChunk: run }) =>
    run(planDir, chunkIndex, outputChunkPath);
}

/**
 * Controller-side orchestration. `plan` and `assemble` run here;
 * `executeChunk` is how each sandbox (or a test double) runs `renderChunk`.
 */
export async function renderViaSandboxes(input: SandboxRenderInput): Promise<SandboxRenderResult> {
  const started = Date.now();
  const primitives: DistributedPrimitives = {
    plan,
    renderChunk,
    assemble,
    ...input.primitives,
  };
  const executeChunk = input.executeChunk ?? defaultExecuteChunk();
  const maxSandboxes = capSandboxes(input.maxSandboxes);
  const workDir = input.workDir ?? mkdtempSync(join(tmpdir(), "hf-cf-sandbox-"));
  const planDir = input.planDir ?? join(workDir, "plan");
  mkdirSync(planDir, { recursive: true });
  mkdirSync(join(workDir, "chunks"), { recursive: true });

  const config: DistributedRenderConfig = {
    ...heygenPromoDistributedConfig(maxSandboxes),
    ...input.config,
    maxParallelChunks: maxSandboxes,
    runtimeCap: "cloudflare-sandbox",
  };

  const planStarted = Date.now();
  const planResult = await primitives.plan(input.projectDir, config, planDir);
  const planMs = Date.now() - planStarted;

  if (planResult.chunkCount < 1 || planResult.chunkCount > SANDBOX_MAX_INSTANCES) {
    throw new Error(
      `[cloudflareSandbox] plan produced ${planResult.chunkCount} chunks; ` +
        `must be 1..${SANDBOX_MAX_INSTANCES}`,
    );
  }

  const sandboxIds = Array.from({ length: planResult.chunkCount }, (_, i) => sandboxIdForChunk(i));
  const chunkPaths = sandboxIds.map((_, i) => join(workDir, "chunks", `chunk-${i}.mp4`));

  const captureStarted = Date.now();
  const chunks = await Promise.all(
    sandboxIds.map((sandboxId, chunkIndex) =>
      executeChunk({
        chunkIndex,
        sandboxId,
        planDir,
        outputChunkPath: chunkPaths[chunkIndex]!,
        renderChunk: primitives.renderChunk,
      }),
    ),
  );
  const captureMs = Date.now() - captureStarted;

  const audioPath = resolvePlanAudioPath(planDir);
  const assembleStarted = Date.now();
  const assembleResult = await primitives.assemble(
    planDir,
    chunkPaths,
    audioPath,
    input.outputPath,
  );
  const assembleMs = Date.now() - assembleStarted;

  return {
    plan: planResult,
    assemble: assembleResult,
    chunks,
    sandboxIds,
    instanceType: SANDBOX_INSTANCE_TYPE,
    accountId: CLOUDFLARE_ACCOUNT_ID,
    totalElapsedMs: Date.now() - started,
    stages: { planMs, captureMs, assembleMs },
  };
}

export function sandboxRenderToPerfSummary(
  result: SandboxRenderResult,
  opts: { renderId: string; workers: number },
): {
  renderId: string;
  totalElapsedMs: number;
  fps: number;
  quality: "high";
  workers: number;
  chunkedEncode: boolean;
  chunkSizeFrames: number;
  compositionDurationSeconds: number;
  totalFrames: number;
  resolution: { width: number; height: number };
  videoCount: number;
  audioCount: number;
  stages: Record<string, number>;
  captureAvgMs: number;
} {
  const totalFrames = result.plan.totalFrames;
  return {
    renderId: opts.renderId,
    totalElapsedMs: result.totalElapsedMs,
    fps: result.plan.fps,
    quality: "high",
    workers: opts.workers,
    chunkedEncode: true,
    chunkSizeFrames: result.plan.totalFrames / result.plan.chunkCount,
    compositionDurationSeconds: totalFrames / result.plan.fps,
    totalFrames,
    resolution: { width: result.plan.width, height: result.plan.height },
    videoCount: 0,
    audioCount: 0,
    stages: {
      compileMs: result.stages.planMs,
      videoExtractMs: 0,
      audioProcessMs: 0,
      captureMs: result.stages.captureMs,
      encodeMs: result.chunks.reduce((sum, chunk) => sum + chunk.encodeStageMs, 0),
      assembleMs: result.stages.assembleMs,
    },
    captureAvgMs: totalFrames > 0 ? Math.round(result.stages.captureMs / totalFrames) : 0,
  };
}

/** Persist a one-line pin of the account + fleet for the verifier. */
export function formatCloudflareAccountPin(): string {
  return [
    `account_id=${CLOUDFLARE_ACCOUNT_ID}`,
    `max_instances=${SANDBOX_MAX_INSTANCES}`,
    `instance_type=${SANDBOX_INSTANCE_TYPE}`,
    `sandbox_id_prefix=${SANDBOX_ID_PREFIX}`,
  ].join("\n");
}
