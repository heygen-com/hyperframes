// fallow-ignore-file code-duplication
import { mkdirSync, readFileSync } from "node:fs";
import type { CanvasResolution, OutputResolutionIssueKind } from "@hyperframes/core";
import { c } from "../../ui/colors.js";
import { errorBox, formatBytes } from "../../ui/format.js";
import { formatLintStartupMessage } from "../../utils/lintFormat.js";
import {
  hasDefinitiveEntryMismatch,
  lintProject,
  shouldBlockRender,
  type ProjectLintResult,
} from "../../utils/lintProject.js";
import { normalizeErrorMessage } from "../../utils/errorMessage.js";
import { failCommand, setCommandExitCode } from "../../utils/commandResult.js";
import {
  reportVariableIssues,
  resolveVariablesArg,
  validateVariablesAgainstProject,
} from "../../utils/variables.js";
import { trackRenderPreflightRejected } from "../../telemetry/events.js";
import { applyRenderEnvironment, renderOutputDirectory, type RenderPlan } from "./plan.js";
import type { RenderOptions, SingleRenderResult } from "../render.js";
import type { RenderCancellationScope } from "../../utils/renderCancellation.js";
import { runRenderSetupWorker } from "../../utils/cancellableProcess.js";

type RenderExecutor = (
  projectDir: string,
  outputPath: string,
  options: RenderOptions,
  cancellation?: RenderCancellationScope,
) => Promise<SingleRenderResult>;

type ResolutionPreflight = (
  compositionHtml: string,
  outputResolution: CanvasResolution | undefined,
  modes: { alphaRequested: boolean; hdrRequested: boolean; aspectAgnostic?: boolean },
) => Promise<{ message: string; kind: OutputResolutionIssueKind } | undefined>;

export interface RenderExecutionDependencies {
  renderDocker: RenderExecutor;
  renderLocal: RenderExecutor;
  checkResolution: ResolutionPreflight;
}

// Exported only through render.ts so command tests can lock the user-facing guidance.
export function renderLintContinuationHint(strictErrors: boolean): string {
  return strictErrors
    ? "  Continuing render despite lint warnings. Use --strict-all to block warnings."
    : "  Continuing render despite lint issues. Use --strict to block errors.";
}

function renderLintShouldAbort(
  strictErrors: boolean,
  strictAll: boolean,
  lintResult: ProjectLintResult,
  definitiveEntryMismatch: boolean,
): boolean {
  return (
    definitiveEntryMismatch ||
    shouldBlockRender(strictErrors, strictAll, lintResult.totalErrors, lintResult.totalWarnings)
  );
}

/** Execute a validated plan. Output and process lifecycle stay outside parsing. */
export async function executeRenderPlan(
  plan: RenderPlan,
  dependencies: RenderExecutionDependencies,
  cancellation?: RenderCancellationScope,
): Promise<void> {
  assertRenderActive(cancellation);
  applyRenderEnvironment(plan);
  if (!plan.batchPath) mkdirSync(renderOutputDirectory(plan), { recursive: true });

  let batchModule: typeof import("../batchRender.js") | undefined;
  let preparedBatch: import("../batchRender.js").PreparedBatchRender | undefined;
  if (plan.batchPath) {
    batchModule = await import("../batchRender.js");
    try {
      preparedBatch = batchModule.prepareBatchRender({
        batchPath: plan.batchPath,
        outputTemplate: plan.batchOutputTemplate,
        indexPath: plan.renderTarget,
        strictVariables: plan.strictVariables,
        quiet: plan.quiet || plan.batchJson,
        json: plan.batchJson,
      });
    } catch (error: unknown) {
      batchModule.exitBatchRenderInputError(error);
    }
  }

  const browserPath = plan.useDocker
    ? undefined
    : await ensureRenderBrowser(plan, cancellation?.signal);
  assertRenderActive(cancellation);
  await runRenderLint(plan, lintProject, cancellation?.signal);
  assertRenderActive(cancellation);
  await runResolutionPreflight(plan, dependencies.checkResolution);
  assertRenderActive(cancellation);

  if (plan.batchPath && batchModule && preparedBatch) {
    await executeBatchRender(
      plan,
      browserPath,
      batchModule,
      preparedBatch,
      dependencies,
      cancellation,
    );
    return;
  }

  const variables = resolveVariablesArg(plan.variablesArg, plan.variablesFileArg);
  if (variables && Object.keys(variables).length > 0) {
    const issues = validateVariablesAgainstProject(plan.renderTarget, variables);
    reportVariableIssues(issues, { strict: plan.strictVariables, quiet: plan.quiet });
  }

  const options: RenderOptions = {
    fps: plan.fps,
    quality: plan.quality,
    authoringSkill: plan.authoringSkill,
    authoringSkillSource: plan.authoringSkillSource,
    authoringSkillInvalid: plan.invalidAuthoringSkill,
    hfEnvOverrides: plan.hfEnvOverrides,
    catalogUsage: plan.catalogUsage,
    format: plan.format,
    gifLoop: plan.gifLoop,
    gifFpsCapped: plan.gifFpsCapped,
    hlsSegmentSeconds: plan.hlsSegmentSeconds,
    motionBlur: plan.motionBlur,
    motionBlurOff: plan.motionBlurOff,
    workers: plan.workers,
    gpu: plan.useGpu,
    browserGpuMode: plan.browserGpuMode,
    hdrMode: plan.hdrMode,
    crf: plan.crf,
    vp9CpuUsed: plan.vp9CpuUsed,
    videoBitrate: plan.videoBitrate,
    videoFrameFormat: plan.videoFrameFormat,
    quiet: plan.quiet,
    browserPath,
    debug: plan.debug,
    bestEffort: plan.bestEffort,
    variables,
    entryFile: plan.entryFile,
    outputResolution: plan.outputResolution,
    outputResolutionAspectAgnostic: plan.outputResolutionAspectAgnostic,
    outputResolutionRaw: plan.outputResolutionRaw,
    pageNavigationTimeoutMs: plan.pageNavigationTimeoutMs,
    protocolTimeout: plan.protocolTimeout,
    playerReadyTimeout: plan.playerReadyTimeout,
    exitAfterComplete: true,
    manageDeParallelRouterBreaker: true,
  };
  if (plan.useDocker) {
    options.pageSideCompositing = plan.pageSideCompositing;
    options.experimentalFastCapture = plan.experimentalFastCapture;
  }
  const execute = plan.useDocker ? dependencies.renderDocker : dependencies.renderLocal;
  await execute(plan.project.dir, plan.outputPath, options, cancellation);
}

function assertRenderActive(cancellation?: RenderCancellationScope): void {
  cancellation?.checkAncestors();
  cancellation?.signal.throwIfAborted();
}

async function ensureRenderBrowser(plan: RenderPlan, signal?: AbortSignal): Promise<string> {
  const { ensureBrowser } = await import("../../browser/manager.js");
  let browserSpinner:
    | {
        start: (message?: string) => void;
        message: (message: string) => void;
        stop: (message?: string) => void;
      }
    | undefined;
  try {
    if (plan.effectiveQuiet) {
      return (await ensureBrowser({ preferManagedChrome: true, signal })).executablePath;
    }
    const clack = await import("@clack/prompts");
    browserSpinner = clack.spinner();
    browserSpinner.start("Checking browser...");
    const info = await ensureBrowser({
      preferManagedChrome: true,
      signal,
      onProgress: (downloaded, total) => {
        if (total <= 0) return;
        const pct = Math.floor((downloaded / total) * 100);
        browserSpinner?.message(
          `Downloading Chrome... ${c.progress(pct + "%")} ${c.dim("(" + formatBytes(downloaded) + " / " + formatBytes(total) + ")")}`,
        );
      },
    });
    browserSpinner.stop(c.dim(`Browser: ${info.source}`));
    return info.executablePath;
  } catch (error: unknown) {
    browserSpinner?.stop(c.error("Browser not available"));
    if (signal?.aborted) signal.throwIfAborted();
    errorBox(
      "Chrome not found",
      normalizeErrorMessage(error),
      "Run: npx hyperframes browser ensure",
    );
    failCommand();
  }
}

// fallow-ignore-next-line complexity
export async function runRenderLint(
  plan: RenderPlan,
  runLint: (projectDir: string, entryFile?: string) => Promise<ProjectLintResult> = lintProject,
  signal?: AbortSignal,
): Promise<void> {
  // lintProject's explicit-entry contract is an absolute source path;
  // entryFile remains project-relative for the producer.
  const explicitEntry = plan.entryFile ? plan.renderTarget : undefined;
  const lintResult =
    signal && runLint === lintProject
      ? await runRenderLintInOwnedProcess(plan.project.dir, explicitEntry, signal)
      : await runLint(plan.project.dir, explicitEntry);
  if (lintResult.totalErrors === 0 && lintResult.totalWarnings === 0) return;
  const definitiveEntryMismatch = hasDefinitiveEntryMismatch(lintResult);
  const willAbort = renderLintShouldAbort(
    plan.strictErrors,
    plan.strictAll,
    lintResult,
    definitiveEntryMismatch,
  );
  presentRenderLintFindings(lintResult, plan.effectiveQuiet, plan.lintVerbose || willAbort);
  if (willAbort) {
    presentRenderLintAbort(plan, definitiveEntryMismatch);
    failCommand();
  }
  presentRenderLintContinuation(plan);
}

async function runRenderLintInOwnedProcess(
  projectDir: string,
  entryFile: string | undefined,
  signal: AbortSignal,
): Promise<ProjectLintResult> {
  return runRenderSetupWorker<ProjectLintResult>(
    "lint",
    { projectDir, entryFile },
    {
      signal,
      maxBufferBytes: 8 * 1024 * 1024,
    },
  );
}

function presentRenderLintFindings(
  lintResult: Awaited<ReturnType<typeof lintProject>>,
  quiet: boolean,
  lintVerbose: boolean,
): void {
  if (quiet) return;
  console.log("");
  for (const line of formatLintStartupMessage(
    lintResult,
    lintVerbose ? { kind: "verbose", options: { errorsFirst: true } } : { kind: "summary" },
  ))
    console.log(line);
}

function presentRenderLintAbort(plan: RenderPlan, definitiveEntryMismatch: boolean): void {
  if (plan.effectiveQuiet) return;
  console.log("");
  console.log(
    c.error(
      definitiveEntryMismatch
        ? "  Aborting render because the default index.html entry is blank."
        : `  Aborting render due to lint issues (${plan.strictAll ? "--strict-all" : "--strict"} mode).`,
    ),
  );
  console.log("");
}

function presentRenderLintContinuation(plan: RenderPlan): void {
  if (plan.effectiveQuiet) return;
  console.log(c.dim(renderLintContinuationHint(plan.strictErrors)));
  console.log("");
}

async function runResolutionPreflight(
  plan: RenderPlan,
  checkResolution: ResolutionPreflight,
): Promise<void> {
  if (!plan.outputResolution) return;
  let issue: { message: string; kind: OutputResolutionIssueKind } | undefined;
  try {
    issue = await checkResolution(readFileSync(plan.renderTarget, "utf8"), plan.outputResolution, {
      alphaRequested:
        plan.format === "webm" || plan.format === "mov" || plan.format === "png-sequence",
      hdrRequested: plan.hdrMode === "force-hdr",
      aspectAgnostic: plan.outputResolutionAspectAgnostic,
    });
  } catch {
    // Unreadable input is surfaced by the render pipeline with full context.
  }
  if (!issue) return;
  trackRenderPreflightRejected({ kind: issue.kind });
  errorBox("Output resolution incompatible", issue.message);
  failCommand();
}

async function executeBatchRender(
  plan: RenderPlan,
  browserPath: string | undefined,
  batchModule: typeof import("../batchRender.js"),
  preparedBatch: import("../batchRender.js").PreparedBatchRender,
  dependencies: RenderExecutionDependencies,
  cancellation?: RenderCancellationScope,
): Promise<void> {
  const batchQuiet = plan.quiet || plan.batchJson;
  const renderOptionsBase: RenderOptions = {
    fps: plan.fps,
    quality: plan.quality,
    authoringSkill: plan.authoringSkill,
    authoringSkillSource: plan.authoringSkillSource,
    authoringSkillInvalid: plan.invalidAuthoringSkill,
    hfEnvOverrides: plan.hfEnvOverrides,
    catalogUsage: plan.catalogUsage,
    format: plan.format,
    gifLoop: plan.gifLoop,
    gifFpsCapped: plan.gifFpsCapped,
    hlsSegmentSeconds: plan.hlsSegmentSeconds,
    motionBlur: plan.motionBlur,
    motionBlurOff: plan.motionBlurOff,
    workers: plan.workers,
    gpu: plan.useGpu,
    browserGpuMode: plan.browserGpuMode,
    hdrMode: plan.hdrMode,
    crf: plan.crf,
    vp9CpuUsed: plan.vp9CpuUsed,
    videoBitrate: plan.videoBitrate,
    videoFrameFormat: plan.videoFrameFormat,
    quiet: batchQuiet,
    browserPath,
    entryFile: plan.entryFile,
    outputResolution: plan.outputResolution,
    outputResolutionAspectAgnostic: plan.outputResolutionAspectAgnostic,
    outputResolutionRaw: plan.outputResolutionRaw,
    pageNavigationTimeoutMs: plan.pageNavigationTimeoutMs,
    protocolTimeout: plan.protocolTimeout,
    playerReadyTimeout: plan.playerReadyTimeout,
    debug: plan.debug,
    bestEffort: plan.bestEffort,
    exitAfterComplete: false,
    throwOnError: true,
    skipFeedback: true,
    manageDeParallelRouterBreaker: plan.batchConcurrency <= 1,
  };
  const manifest = await batchModule.runBatchRender({
    prepared: preparedBatch,
    concurrency: plan.batchConcurrency,
    failFast: plan.batchFailFast,
    quiet: batchQuiet,
    json: plan.batchJson,
    renderOne: (row) => {
      assertRenderActive(cancellation);
      const options: RenderOptions = { ...renderOptionsBase, variables: row.variables };
      if (plan.useDocker) options.pageSideCompositing = plan.pageSideCompositing;
      const execute = plan.useDocker ? dependencies.renderDocker : dependencies.renderLocal;
      return execute(plan.project.dir, row.outputPath, options, cancellation);
    },
  });
  if (manifest.failed > 0) setCommandExitCode(1);
}
