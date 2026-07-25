import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble, type AssembleResult } from "./assemble.js";
import { materializePlanV2Target } from "./planV2.js";
import { renderChunk, type ChunkResult } from "./renderChunk.js";

/**
 * Direct v2 chunk-role entry point. Storage adapters may instead download the
 * selected blobs themselves and call `materializePlanV2Target` + `renderChunk`.
 */
export async function renderChunkV2(
  planV2Dir: string,
  chunkIndex: number,
  outputChunkPath: string,
): Promise<ChunkResult> {
  const workRoot = mkdtempSync(join(tmpdir(), "hf-plan-v2-chunk-"));
  const materializedPlanDir = join(workRoot, "plan");
  try {
    materializePlanV2Target(planV2Dir, { role: "chunk", chunkIndex }, materializedPlanDir);
    return await renderChunk(materializedPlanDir, chunkIndex, outputChunkPath);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

/**
 * Direct v2 assembler-role entry point. Audio is resolved exclusively from
 * the assembler dependency set and never materialized by chunk workers.
 */
export async function assembleV2(
  planV2Dir: string,
  chunkPaths: readonly string[],
  outputPath: string,
  options?: Parameters<typeof assemble>[4],
): Promise<AssembleResult> {
  const workRoot = mkdtempSync(join(tmpdir(), "hf-plan-v2-assembler-"));
  const materializedPlanDir = join(workRoot, "plan");
  try {
    const materialized = materializePlanV2Target(
      planV2Dir,
      { role: "assembler" },
      materializedPlanDir,
    );
    return await assemble(
      materializedPlanDir,
      chunkPaths,
      materialized.audioPath,
      outputPath,
      options,
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}
