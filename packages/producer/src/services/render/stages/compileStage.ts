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
  /** Render-time variable overrides (`--variables`); see CompileForRenderOptions.variables. */
  variables?: Record<string, unknown>;
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
  /** Low-cardinality compile-time gate that disabled default drawElement:
   * `3d` | `mix_blend_mode` | `shader_transitions`. Undefined when none fired. */
  deCompileGate?: string;
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
    log,
    failClosedFontFetch: failClosedFontFetch === true,
    allowSystemFontCapture,
    variables: input.variables,
    animatedGifCacheDir: cfg.extractCacheDir
      ? join(cfg.extractCacheDir, "animated-gif")
      : undefined,
    ffmpegProcessTimeout: cfg.ffmpegProcessTimeout,
  });
  assertNotAborted();
  const compileOnlyMs = Date.now() - compileStart;
  // Fold three signals into a single capture-mode decision: caller's
  // initial `cfg.forceScreenshot`, alpha-output (webm / mov / png-sequence —
  // BeginFrame doesn't preserve alpha on Linux headless-shell), and the
  // composition's `renderModeHints.recommendScreenshot`. The single
  // write to `cfg.forceScreenshot` happens at the end of this block so
  // the contract is enforceable by inspection.
  // Alpha output forces screenshot because BeginFrame doesn't preserve alpha —
  // but drawElement fast capture self-manages alpha (screenshot-launched
  // browser + png drawElementImage, pixel-perfect; see createCaptureSession).
  // Folding needsAlpha here would make the engine's forceScreenshot guard
  // disable fast capture for every transparent render, so skip the fold when
  // fast capture is on. Render-mode hints (e.g. raw requestAnimationFrame)
  // still force screenshot below — those are correctness routings that
  // drawElement must honor.
  // The fast-capture video gate was REMOVED here once Chrome 151 fixed crbug
  // 521861819. It keyed on compiled.videos.length > 0 as a proxy for the
  // word-by-word caption opacity pattern (drawElementImage dropped the promoted
  // opacity layers mid-fade, ~12 dB). On the 151 pinned floor, video + nested-fade
  // comps render correctly on the drawElement path (verified PSNR=inf vs baseline);
  // see docs/fast-capture-limitations.md Lim 2.
  // Fast-capture 3D-transform gate, same shape as the video gate above.
  // drawElementImage paints CSS 3D rendering contexts incorrectly:
  // backface-visibility:hidden is ignored (mid-flip elements capture their
  // mirrored backface), siblings of the 3D context can drop out, and the
  // context's background is lost. Reproduced on macOS hardware GPU with
  // real-world flip-card / rotationX-entrance comps (full-stream PSNR
  // 27–46 dB avg, 17 dB min vs baseline). Routes to the platform's baseline
  // capture; HF_FAST_CAPTURE_3D=true bypasses for R&D.
  // Detection runs inside the compiler on PRE-CDN-inline HTML — GSAP's own
  // source contains `transformPerspective`, so scanning compiled.html here
  // would flag every composition that loads GSAP.
  let deCompileGate: string | undefined;
  if (
    cfg.useDrawElement &&
    process.env.HF_FAST_CAPTURE_3D !== "true" &&
    compiled.usesThreeDTransforms
  ) {
    cfg.useDrawElement = false;
    deCompileGate = "3d";
    log.info(
      "[Render] Fast capture: composition uses a CSS 3D rendering context " +
        "(perspective / preserve-3d / backface-visibility) — disabling drawElementImage " +
        "for this render. Capture uses the platform's baseline route.",
    );
  }
  // Fast-capture mix-blend-mode gate, same shape as the 3D gate above.
  // drawElementImage captures each element's paint records before the
  // compositor resolves blend equations — blended layers render as if
  // mix-blend-mode were absent, producing saturated/damaged composites
  // (measured: 42 dB min vs 53 dB floor on real blend+filter comps, macOS GPU).
  // HF_FAST_CAPTURE_BLEND=true bypasses for R&D.
  if (
    cfg.useDrawElement &&
    process.env.HF_FAST_CAPTURE_BLEND !== "true" &&
    compiled.usesMixBlendMode
  ) {
    cfg.useDrawElement = false;
    deCompileGate = "mix_blend_mode";
    log.info(
      "[Render] Fast capture: composition uses mix-blend-mode — disabling drawElementImage " +
        "for this render. Capture uses the platform's baseline route.",
    );
  }
  // Shader-transition comps: page-side compositing is the faster, purpose-built
  // path for them, and resolveConfig force-disables it whenever drawElement is
  // on. With drawElement default-on that trade is backwards — prefer page-side
  // compositing and route these comps to the baseline capture. An explicit
  // drawElement opt-in keeps the old preference.
  if (
    cfg.useDrawElement &&
    process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE !== "true" &&
    compiled.hasShaderTransitions
  ) {
    cfg.useDrawElement = false;
    deCompileGate = "shader_transitions";
    log.info(
      "[Render] Fast capture: composition uses shader transitions — disabling drawElementImage " +
        "so page-side compositing stays available.",
    );
  }
  // Whenever a compile-time gate cleared useDrawElement, restore page-side
  // compositing — but ONLY when resolveConfig auto-disabled it because
  // drawElement was going to run. An explicit enablePageSideCompositing:false
  // from the programmatic API or HF_PAGE_SIDE_COMPOSITING=false never had the
  // auto-disabled flag set and stays off.
  if (!cfg.useDrawElement && cfg.pageSideCompositingAutoDisabled) {
    cfg.enablePageSideCompositing = true;
    cfg.pageSideCompositingAutoDisabled = false;
  }
  const callerForced = cfg.forceScreenshot || (needsAlpha && !cfg.useDrawElement);
  const { forceScreenshot: hintForced } = applyRenderModeHints(callerForced, compiled, log);
  let forceScreenshot = hintForced;
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
    deCompileGate,
  };
}
