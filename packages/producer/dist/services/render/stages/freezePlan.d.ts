/**
 * freezePlan — write the meta/{composition,encoder,chunks}.json + plan.json
 * manifest at the end of `plan()`, compute the planHash from the frozen
 * artifacts, and return the manifest path.
 *
 * Signature-only skeleton: there are no callers yet. The function body
 * lands when `services/distributed/plan.ts` is added and composes the
 * stage primitives.
 *
 * See DISTRIBUTED-RENDERING-PLAN.md §2.1 phase 6, §4.1 directory layout,
 * §4.3 LockedRenderConfig.
 */
import type { Fps } from "@hyperframes/core";
import type { PlanDimensions } from "./planHash.js";
/**
 * The encoder configuration locked in at plan time. Mirrors §4.3
 * LockedRenderConfig in the design doc.
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
    /** Inclusive end frame for the chunk. */
    endFrame: number;
}
/**
 * Inputs to `freezePlan`. `planDir` already contains `compiled/`,
 * `video-frames/`, and (optionally) `audio.aac` by the time freezePlan
 * runs — see §2.1 phases 1-5.
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
}
export interface FreezePlanResult {
    /** Absolute path to `plan.json`. */
    planJsonPath: string;
    /** Content-addressed planHash; see §4.2. */
    planHash: string;
}
/**
 * Freeze a plan directory: write `meta/*.json` + top-level `plan.json`, then
 * compute `planHash` over the canonicalized contents.
 *
 * Skeleton — body lands when the distributed-render primitives compose the
 * stage functions.
 */
export declare function freezePlan(_input: FreezePlanInput): Promise<FreezePlanResult>;
//# sourceMappingURL=freezePlan.d.ts.map