/**
 * compileStage — pure compile pass of `executeRenderJob`.
 *
 * Runs `compileForRender` on the entry HTML, folds the alpha-output and
 * render-mode-hint signals into a single `forceScreenshot` decision,
 * writes compiled artifacts to `workDir/compiled/`, builds the
 * `CompositionMetadata` view of the result, and resolves the
 * `deviceScaleFactor` for supersampling.
 *
 * The probe sub-stage (browser launch, duration discovery, recompile,
 * media reconciliation) lives in a sibling stage. This stage stops at
 * the point where the in-process renderer enters the `if (needsBrowser)`
 * branch.
 *
 * `forceScreenshot` is the only field on `cfg` that this stage writes,
 * and it is written exactly once: at the end of the stage, after
 * `compileForRender` has reported the composition's `renderModeHints`
 * and the orchestrator has told us whether the output format demands an
 * alpha channel. The resolved boolean is also returned on the stage's
 * result so downstream stages can consume the value as an explicit
 * parameter instead of reading `cfg.forceScreenshot` directly. The
 * resolved value also flows into `LockedRenderConfig.forceScreenshot`
 * for distributed renders, where it must be frozen at plan time.
 *
 * Hard constraints preserved verbatim from the in-process renderer:
 *   - `perfStages.compileOnlyMs` is set to wall-clock ms around the
 *     `compileForRender` call only.
 *   - The `log.info("Compiled composition metadata", ...)` line is emitted
 *     after writing artifacts, with the same payload shape as before.
 *   - The `log.info("Supersampling composition via deviceScaleFactor", ...)`
 *     line is emitted only when `deviceScaleFactor > 1`.
 *   - `applyRenderModeHints` short-circuits when the caller-supplied
 *     `alreadyForced` boolean is `true`, so the auto-select warn log
 *     fires only when the composition hint is the deciding factor —
 *     same behavior as before this PR.
 */

import { join } from "node:path";
import type { EngineConfig } from "@hyperframes/engine";
import type { CompiledComposition } from "../../htmlCompiler.js";
import { compileForRender } from "../../htmlCompiler.js";
import type { ProducerLogger } from "../../../logger.js";
import {
  applyRenderModeHints,
  resolveDeviceScaleFactor,
  writeCompiledArtifacts,
  type CompositionMetadata,
} from "../shared.js";
import type { RenderJob } from "../../renderOrchestrator.js";

export interface CompileStageInput {
  projectDir: string;
  workDir: string;
  /** Absolute path to the entry HTML (already resolved to standalone-entry if needed). */
  htmlPath: string;
  /** The relative `entryFile` string, used only for log payloads. */
  entryFile: string;
  job: RenderJob;
  /**
   * EngineConfig used by the compile pass. `cfg.forceScreenshot` is
   * written exactly once near the end of the stage (after
   * `applyRenderModeHints`); no other field on `cfg` is mutated. The
   * resolved value is also returned on `CompileStageResult.forceScreenshot`
   * so callers can thread the value explicitly without reading from
   * `cfg`.
   */
  cfg: EngineConfig;
  /** True when the output format requires an alpha channel (webm/mov/png-sequence). */
  needsAlpha: boolean;
  log: ProducerLogger;
  /** Cooperative-cancellation probe; throws `RenderCancelledError` when aborted. */
  assertNotAborted: () => void;
  /**
   * When `true`, `compileForRender` threads through to
   * `injectDeterministicFontFaces` and any external font fetch failure
   * throws `FontFetchError` instead of silently falling back to system
   * fonts. Distributed `plan()` passes `true`; the in-process renderer
   * leaves it `undefined` to preserve current behavior.
   */
  failClosedFontFetch?: boolean;
  /**
   * When `true`, fonts not resolved by aliases or Google Fonts are located
   * on the local filesystem and embedded. Distributed renders pass `false`.
   */
  allowSystemFontCapture?: boolean;
}

export interface CompileStageResult {
  compiled: CompiledComposition;
  composition: CompositionMetadata;
  deviceScaleFactor: number;
  outputWidth: number;
  outputHeight: number;
  /** Wall-clock ms for the pure `compileForRender` call only (excludes artifact writes). */
  compileOnlyMs: number;
  /**
   * Capture-mode decision computed from `cfg.forceScreenshot` (caller
   * default), `needsAlpha` (alpha output requires screenshot capture
   * because BeginFrame doesn't preserve alpha on headless-shell), and
   * the composition's `renderModeHints`. Locked at compile time; the
   * sequencer threads this value through downstream capture stages
   * instead of relying on `cfg.forceScreenshot` mutations.
   */
  forceScreenshot: boolean;
}

export async function runCompileStage(input: CompileStageInput): Promise<CompileStageResult> {
  const {
    projectDir,
    workDir,
    htmlPath,
    entryFile,
    job,
    cfg,
    needsAlpha,
    log,
    assertNotAborted,
    failClosedFontFetch,
    allowSystemFontCapture,
  } = input;

  const compileStart = Date.now();
  const compiled = await compileForRender(projectDir, htmlPath, join(workDir, "downloads"), {
    failClosedFontFetch: failClosedFontFetch === true,
    allowSystemFontCapture,
  });
  assertNotAborted();
  const compileOnlyMs = Date.now() - compileStart;
  // Fold three signals into a single capture-mode decision: caller's
  // initial `cfg.forceScreenshot`, alpha-output (webm / mov / png-sequence —
  // BeginFrame doesn't preserve alpha on Linux headless-shell), and the
  // composition's `renderModeHints.recommendScreenshot`. The single
  // write to `cfg.forceScreenshot` happens at the end of this block so
  // the contract is enforceable by inspection.
  const callerForced = cfg.forceScreenshot || needsAlpha;
  const { forceScreenshot } = applyRenderModeHints(callerForced, compiled, log);
  cfg.forceScreenshot = forceScreenshot;
  writeCompiledArtifacts(compiled, workDir, Boolean(job.config.debug));

  log.info("Compiled composition metadata", {
    entryFile,
    staticDuration: compiled.staticDuration,
    width: compiled.width,
    height: compiled.height,
    videoCount: compiled.videos.length,
    audioCount: compiled.audios.length,
    renderModeHints: compiled.renderModeHints,
  });

  const composition: CompositionMetadata = {
    duration: compiled.staticDuration,
    videos: compiled.videos,
    audios: compiled.audios,
    images: compiled.images,
    width: compiled.width,
    height: compiled.height,
  };
  const { width, height } = composition;
  const deviceScaleFactor = resolveDeviceScaleFactor({
    compositionWidth: width,
    compositionHeight: height,
    outputResolution: job.config.outputResolution,
    hdrRequested: job.config.hdrMode === "force-hdr",
    alphaRequested: needsAlpha,
  });
  const outputWidth = width * deviceScaleFactor;
  const outputHeight = height * deviceScaleFactor;
  if (deviceScaleFactor > 1) {
    log.info("Supersampling composition via deviceScaleFactor", {
      compositionWidth: width,
      compositionHeight: height,
      outputResolution: job.config.outputResolution,
      outputWidth,
      outputHeight,
      deviceScaleFactor,
    });
  }

  return {
    compiled,
    composition,
    deviceScaleFactor,
    outputWidth,
    outputHeight,
    compileOnlyMs,
    forceScreenshot,
  };
}
