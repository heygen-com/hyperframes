/**
 * probeStage — browser probe + recompile + media reconciliation.
 *
 * Runs only when `needsBrowser` is true (root duration unknown OR there are
 * unresolved nested compositions). Owns the `FileServerHandle` and the
 * `CaptureSession` it creates and returns them so the sequencer can both
 * reuse them downstream (the capture stage reuses the probe session) and
 * clean them up in its `finally` block.
 *
 * Hard constraints preserved verbatim from the in-process renderer:
 *   - `recompileWithResolutions` runs inside this stage because it depends
 *     on browser-resolved durations, even though §2.1 of the distributed
 *     plan lists recompile as a sibling phase.
 *   - `composition` (videos/audios/duration) is mutated in place — callers
 *     downstream see the reconciled view through the same object reference.
 *   - The stage computes the final composition `duration` and `totalFrames`
 *     and returns them. Assigning those values onto the `RenderJob` is the
 *     sequencer's responsibility — a future chunk worker can't mutate the
 *     orchestrator's `job` object, and keeping the assignment in one place
 *     prevents the same value living in two writers.
 *   - The "Composition duration is 0" diagnostic builds the same hint
 *     string from the same console-buffer regex and `__timelines` probe.
 *   - The post-probe "failed network requests" warning fires with the same
 *     regex, the same first-10/first-5 slicing, and the same `console.warn`
 *     prefix.
 */
import { type CaptureSession, type EngineConfig } from "@hyperframes/engine";
import type { CompiledComposition } from "../../htmlCompiler.js";
import { type FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import { type CompositionMetadata } from "../shared.js";
import type { RenderJob } from "../../renderOrchestrator.js";
export interface ProbeStageInput {
    projectDir: string;
    workDir: string;
    job: RenderJob;
    cfg: EngineConfig;
    log: ProducerLogger;
    assertNotAborted: () => void;
    /** From compileStage. May be replaced via `recompileWithResolutions`. */
    compiled: CompiledComposition;
    /** From compileStage. Mutated in place (videos/audios pushed, duration set). */
    composition: CompositionMetadata;
    width: number;
    height: number;
    needsAlpha: boolean;
    deviceScaleFactor: number;
}
export interface ProbeStageResult {
    /** May be reassigned from `recompileWithResolutions`. */
    compiled: CompiledComposition;
    /** Created when `needsBrowser` was true; `null` otherwise. */
    fileServer: FileServerHandle | null;
    /** Created when `needsBrowser` was true; `null` otherwise. */
    probeSession: CaptureSession | null;
    /** The probeSession's `browserConsoleBuffer`, or `[]` if no probe ran. */
    lastBrowserConsole: string[];
    /** Composition duration (post-probe). Guaranteed > 0 — the stage throws on <= 0. */
    duration: number;
    totalFrames: number;
    /** Wall-clock ms for the entire probe phase (near-zero when `needsBrowser` was false). */
    browserProbeMs: number;
}
export declare function runProbeStage(input: ProbeStageInput): Promise<ProbeStageResult>;
//# sourceMappingURL=probeStage.d.ts.map