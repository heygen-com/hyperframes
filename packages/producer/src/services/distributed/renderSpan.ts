import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChunkSliceJson } from "../render/stages/freezePlan.js";
import { writeStitchedMp4 } from "./mp4Stitch.js";
import { plan, type DistributedRenderConfig } from "./plan.js";
import { renderChunk } from "./renderChunk.js";
import { RenderCancelledError } from "../renderOrchestrator.js";

export interface RenderSpanResult {
  startFrame: number;
  endFrame: number;
  framesEncoded: number;
}

export class RenderSpanUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderSpanUnsupportedError";
  }
}

/** The frames `[startFrame, endFrame)` of a `totalFrames` timeline that `[startSeconds, endSeconds)` covers. */
export function spanFrameRange(
  startSeconds: number,
  endSeconds: number | undefined,
  fps: number,
  totalFrames: number,
): { startFrame: number; endFrame: number } {
  const startFrame = Math.round(startSeconds * fps);
  const endFrame = Math.min(
    endSeconds === undefined ? totalFrames : Math.round(endSeconds * fps),
    totalFrames,
  );
  if (!(endFrame > startFrame)) {
    throw new RenderSpanUnsupportedError(
      `The range ${startSeconds}s to ${endSeconds ?? "the end"}s holds no frame: the composition has ${totalFrames} frames at ${fps} fps (${totalFrames / fps}s).`,
    );
  }
  return { startFrame, endFrame };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RenderCancelledError("render_cancelled", "user_cancelled");
}

/** Renders `[startSeconds, endSeconds)` as a standalone mp4 from 0, with that span's audio, by chunk sub-ranges. */
export async function renderSpan(
  projectDir: string,
  config: DistributedRenderConfig,
  span: { startSeconds: number; endSeconds?: number },
  outputPath: string,
): Promise<RenderSpanResult> {
  if (config.format !== "mp4") {
    throw new RenderSpanUnsupportedError(
      `--start/--end render mp4 only; ${config.format} is not supported for a range.`,
    );
  }
  if (config.cfr === true) {
    throw new RenderSpanUnsupportedError("--start/--end cannot be combined with a cfr re-encode.");
  }
  const workDir = mkdtempSync(join(tmpdir(), "hf-render-span-"));
  try {
    const planDir = join(workDir, "plan");
    const partsDir = join(workDir, "parts");
    mkdirSync(partsDir, { recursive: true });
    // The span captures here in the browser a full render uses, so the container-only font guards do not apply.
    const planned = await plan(
      projectDir,
      { ...config, rejectOnSystemFonts: false, failClosedFontFetch: false },
      planDir,
      { chunksCarryAudio: true },
    );
    const { startFrame, endFrame } = spanFrameRange(
      span.startSeconds,
      span.endSeconds,
      config.fps,
      planned.totalFrames,
    );
    const slices = JSON.parse(
      readFileSync(join(planDir, "meta", "chunks.json"), "utf-8"),
    ) as ChunkSliceJson[];
    const parts: string[] = [];
    for (const slice of slices) {
      const range = {
        startFrame: Math.max(slice.startFrame, startFrame),
        endFrame: Math.min(slice.endFrame, endFrame),
      };
      if (range.endFrame <= range.startFrame) continue;
      throwIfAborted(config.abortSignal);
      const part = join(partsDir, `part-${String(parts.length).padStart(4, "0")}.mp4`);
      await renderChunk(planDir, slice.index, part, { frameRange: range });
      parts.push(part);
    }
    throwIfAborted(config.abortSignal);
    await writeStitchedMp4(parts, outputPath);
    return { startFrame, endFrame, framesEncoded: endFrame - startFrame };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
