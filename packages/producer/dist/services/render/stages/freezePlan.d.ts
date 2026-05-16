/**
 * freezePlan — write the meta/{composition,encoder,chunks}.json + plan.json
 * manifest at the end of `plan()`, compute the planHash from the frozen
 * artifacts, and return the manifest path.
 *
 * Called from `services/distributed/plan.ts` after all earlier phases have
 * materialized their on-disk artifacts under `<planDir>/`. The function is
 * deliberately the last step so `planHash` is computed from the actual bytes
 * the chunk worker will read — not from intermediate values the controller
 * has in memory.
 */
import type { Fps } from "@hyperframes/core";
import { type PlanDimensions } from "./planHash.js";
/**
 * The encoder configuration locked in at plan time.
 */
export interface LockedRenderConfig {
    captureMode: "beginframe" | "screenshot";
    forceScreenshot: boolean;
    deviceScaleFactor: number;
    useLayeredHdrComposite: boolean;
    /** Hard-pinned to "software" in v1 distributed renders. */
    browserGpuMode: "software";
    warmupTicks: number;
    encoder: "libx264-software" | "libx265-software" | "prores-software" | "png-sequence";
    /**
     * Caller-supplied quality enum, persisted so chunk workers can rebuild
     * the matching `getEncoderPreset(quality, format, …)` instead of
     * inferring quality from the encoder discriminant (which loses
     * information when the encoder→quality table grows non-injective).
     */
    quality: "draft" | "standard" | "high";
    ffmpegVersion: string;
    preset: string;
    crf?: number;
    bitrate?: string;
    /** Equal to chunkSize for closed-GOP concat-copy. */
    gopSize: number;
    closedGop: true;
    forceKeyframes: "n=0";
    pixelFormat: string;
    chunkSize: number;
    chunkCount: number;
    /** Snapshot of `PRODUCER_RUNTIME_*` env vars at plan time. */
    runtimeEnv: Record<string, string>;
}
export interface CompositionMetadataJson {
    durationSeconds: number;
    width: number;
    height: number;
    fps: Fps;
    videoCount: number;
    audioCount: number;
    imageCount: number;
}
export interface ChunkSliceJson {
    index: number;
    startFrame: number;
    /** Exclusive upper bound — chunk workers iterate frames in `[startFrame, endFrame)`. */
    endFrame: number;
}
/**
 * Inputs to `freezePlan`. `planDir` already contains `compiled/`,
 * `video-frames/`, and (optionally) `audio.aac` by the time freezePlan
 * runs — those are materialized by the upstream compile/probe/extract/audio
 * stages composed in `services/distributed/plan.ts`.
 */
export interface FreezePlanInput {
    /** Absolute path to the plan directory being frozen. */
    planDir: string;
    composition: CompositionMetadataJson;
    encoder: LockedRenderConfig;
    chunks: readonly ChunkSliceJson[];
    dimensions: PlanDimensions;
    producerVersion: string;
    /** Hash of the deterministic-font snapshot baked into the plan. */
    fontSnapshotSha: string;
    /** Composition duration in seconds (mirrors `composition.durationSeconds`; carried separately for `plan.json`). */
    durationSeconds: number;
    /** Total frame count, separately materialized for callers that read `plan.json` without parsing chunks.json. */
    totalFrames: number;
    /** Whether `<planDir>/audio.aac` was produced. */
    hasAudio: boolean;
}
export interface FreezePlanResult {
    /** Absolute path to `plan.json`. */
    planJsonPath: string;
    /** Content-addressed planHash; see {@link computePlanHash}. */
    planHash: string;
}
/**
 * Re-export the runtime-env snapshot helper for backward compatibility with
 * earlier imports from `./freezePlan`. The implementation lives in
 * `../runtimeEnvSnapshot.ts` — chunk workers re-apply the snapshot during
 * boot, so it needs to be importable without dragging in the freeze pipeline.
 */
export { RUNTIME_ENV_PREFIXES, snapshotRuntimeEnv } from "../runtimeEnvSnapshot.js";
/**
 * Read a frozen plan directory back from disk and recompute its
 * content-addressed `planHash` over the actual on-disk bytes — including
 * the canonical encoder JSON, which is written via
 * {@link canonicalJsonStringify} so reading the file gives us the exact
 * string that fed the controller's hash.
 *
 * Distributed chunk workers call this at boot to verify their planDir is
 * the same one the controller wrote: any mismatch (corrupted artifact,
 * partial S3 download, manual tampering) trips a non-retryable
 * `PLAN_HASH_MISMATCH` before the chunk renders.
 *
 * Throws if `plan.json` or `meta/encoder.json` are missing/malformed —
 * callers should catch those as `MISSING_PLAN_ARTIFACT` rather than
 * lumping them with hash drift.
 */
export declare function recomputePlanHashFromPlanDir(planDir: string): string;
/**
 * Freeze a plan directory: write `meta/*.json` + top-level `plan.json`, then
 * compute `planHash` over the canonicalized contents.
 *
 * The encoder JSON is written via {@link canonicalJsonStringify} so the bytes
 * fed into {@link computePlanHash} match the bytes on disk exactly. Consumers
 * can re-validate a plan by hashing `meta/encoder.json` directly.
 */
export declare function freezePlan(input: FreezePlanInput): Promise<FreezePlanResult>;
//# sourceMappingURL=freezePlan.d.ts.map