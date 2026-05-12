/**
 * compileStage — pure compile pass of `executeRenderJob`.
 *
 * Runs `compileForRender` on the entry HTML, applies render-mode hints
 * (which may flip `cfg.forceScreenshot` on for compositions that need it),
 * writes compiled artifacts to `workDir/compiled/`, builds the
 * `CompositionMetadata` view of the result, and resolves the
 * `deviceScaleFactor` for supersampling.
 *
 * The probe sub-stage (browser launch, duration discovery, recompile,
 * media reconciliation) lives in a sibling stage. This stage stops at
 * the point where the in-process renderer enters the `if (needsBrowser)`
 * branch.
 *
 * Hard constraints preserved verbatim from the in-process renderer:
 *   - `applyRenderModeHints(cfg, ...)` is allowed to mutate `cfg.forceScreenshot`.
 *   - `perfStages.compileOnlyMs` is set to wall-clock ms around the
 *     `compileForRender` call only.
 *   - The `log.info("Compiled composition metadata", ...)` line is emitted
 *     after writing artifacts, with the same payload shape as before.
 *   - The `log.info("Supersampling composition via deviceScaleFactor", ...)`
 *     line is emitted only when `deviceScaleFactor > 1`.
 */
import type { EngineConfig } from "@hyperframes/engine";
import type { CompiledComposition } from "../../htmlCompiler.js";
import type { ProducerLogger } from "../../../logger.js";
import { type CompositionMetadata } from "../shared.js";
import type { RenderJob } from "../../renderOrchestrator.js";
export interface CompileStageInput {
    projectDir: string;
    workDir: string;
    /** Absolute path to the entry HTML (already resolved to standalone-entry if needed). */
    htmlPath: string;
    /** The relative `entryFile` string, used only for log payloads. */
    entryFile: string;
    job: RenderJob;
    /** EngineConfig — may be mutated via `cfg.forceScreenshot = true`. */
    cfg: EngineConfig;
    /** True when the output format requires an alpha channel (webm/mov/png-sequence). */
    needsAlpha: boolean;
    log: ProducerLogger;
    /** Cooperative-cancellation probe; throws `RenderCancelledError` when aborted. */
    assertNotAborted: () => void;
}
export interface CompileStageResult {
    compiled: CompiledComposition;
    composition: CompositionMetadata;
    deviceScaleFactor: number;
    outputWidth: number;
    outputHeight: number;
    /** Wall-clock ms for the pure `compileForRender` call only (excludes artifact writes). */
    compileOnlyMs: number;
}
export declare function runCompileStage(input: CompileStageInput): Promise<CompileStageResult>;
//# sourceMappingURL=compileStage.d.ts.map