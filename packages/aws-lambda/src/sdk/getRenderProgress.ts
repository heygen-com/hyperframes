/**
 * `getRenderProgress` — read-only progress + cost snapshot for a single
 * render started by {@link renderToLambda}.
 *
 * Pulls one `DescribeExecution` + one `GetExecutionHistory` per call. The
 * history is paginated server-side; the helper loops until exhausted so a
 * 1,000-event Step Functions execution still produces a single
 * `RenderProgress` snapshot.
 *
 * Progress math:
 *   - 0  before Plan completes (no frame count is known yet)
 *   - 0.1 once Plan completes (we know `totalFrames`)
 *   - 0.1 + 0.8 × framesEncoded / totalFrames during chunk render
 *   - 1.0 after Assemble completes
 *
 * Frame counts come from the parsed Lambda result payloads on each
 * `TaskSucceeded` event — Plan reports `TotalFrames`, RenderChunk reports
 * `FramesEncoded`. The shape mirrors what the handler produces in
 * `events.ts`, so the parser doesn't need to know anything beyond
 * "JSON.parse this string and grab two fields."
 */

import {
  DescribeExecutionCommand,
  GetExecutionHistoryCommand,
  type HistoryEvent,
  SFNClient,
} from "@aws-sdk/client-sfn";
import {
  type BilledLambdaInvocation,
  computeRenderCost,
  type RenderCost,
} from "./costAccounting.js";

/** Options for {@link getRenderProgress}. */
export interface GetRenderProgressOptions {
  /** Execution ARN from a {@link renderToLambda} call. */
  executionArn: string;
  /**
   * Default memory size in MB to assume for Lambda invocations when the
   * history event payload doesn't carry it explicitly. Matches the
   * `LambdaMemoryMb` parameter the stack was deployed with.
   */
  defaultMemorySizeMb?: number;
  region?: string;
  /** Test injection seam. */
  sfn?: SFNClient;
}

/** Render-status discriminant; mirrors Step Functions execution states. */
export type RenderStatus =
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "ABORTED"
  | "PENDING_REDRIVE";

export interface RenderError {
  /** State name where the failure surfaced (`Plan`, `RenderChunk`, `Assemble`, or `<unknown>`). */
  state: string;
  /** Error class / type as Step Functions reports it. */
  error: string;
  /** Cause string Step Functions surfaces (often a stringified JSON payload from the handler). */
  cause: string;
}

/** Snapshot of a single render's progress + cost + errors at one point in time. */
export interface RenderProgress {
  status: RenderStatus;
  /** `[0, 1]`; see module doc for the math. */
  overallProgress: number;
  framesRendered: number;
  /** `null` until Plan completes. */
  totalFrames: number | null;
  /** Count of `LambdaFunctionScheduled` events seen in the history so far. */
  lambdasInvoked: number;
  costs: RenderCost;
  /** Final output object if Assemble succeeded; `null` otherwise. */
  outputFile: { s3Uri: string; bytes: number | null } | null;
  errors: RenderError[];
  /** `true` once the execution has terminated in a non-`SUCCEEDED` state. */
  fatalErrorEncountered: boolean;
  startedAt: string;
  endedAt: string | null;
}

const DEFAULT_MEMORY_MB = 10240;

/** Pull a current progress snapshot for one render. */
export async function getRenderProgress(opts: GetRenderProgressOptions): Promise<RenderProgress> {
  if (!opts.executionArn) {
    throw new Error("[getRenderProgress] executionArn is required");
  }
  const sfn = opts.sfn ?? new SFNClient({ region: opts.region });
  const memoryMb = opts.defaultMemorySizeMb ?? DEFAULT_MEMORY_MB;

  const describe = await sfn.send(
    new DescribeExecutionCommand({ executionArn: opts.executionArn }),
  );
  const status = (describe.status ?? "RUNNING") as RenderStatus;
  const startedAt = describe.startDate?.toISOString() ?? new Date(0).toISOString();
  const endedAt = describe.stopDate?.toISOString() ?? null;

  const history = await loadFullHistory(sfn, opts.executionArn);
  const summary = summarizeHistory(history, memoryMb);

  const costs = computeRenderCost(summary.lambdaInvocations, summary.stateTransitions);
  const overallProgress = computeOverallProgress({
    status,
    totalFrames: summary.totalFrames,
    framesRendered: summary.framesRendered,
    assembleComplete: summary.assembleComplete,
  });

  return {
    status,
    overallProgress,
    framesRendered: summary.framesRendered,
    totalFrames: summary.totalFrames,
    lambdasInvoked: summary.lambdasInvoked,
    costs,
    outputFile: summary.outputFile,
    errors: summary.errors,
    fatalErrorEncountered: isTerminalFailure(status),
    startedAt,
    endedAt,
  };
}

async function loadFullHistory(sfn: SFNClient, executionArn: string): Promise<HistoryEvent[]> {
  const events: HistoryEvent[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await sfn.send(
      new GetExecutionHistoryCommand({
        executionArn,
        maxResults: 1000,
        nextToken,
        reverseOrder: false,
      }),
    );
    if (res.events) events.push(...res.events);
    nextToken = res.nextToken;
    if (!nextToken) break;
  }
  return events;
}

interface HistorySummary {
  lambdaInvocations: BilledLambdaInvocation[];
  stateTransitions: number;
  framesRendered: number;
  totalFrames: number | null;
  lambdasInvoked: number;
  assembleComplete: boolean;
  outputFile: { s3Uri: string; bytes: number | null } | null;
  errors: RenderError[];
}

/**
 * One pass over the history events that pulls every number {@link getRenderProgress}
 * needs. State transitions = the count of events that advance the state
 * machine (entering/exiting states + map iteration completions). Lambda
 * invocations = `LambdaFunctionScheduled` count. Frame totals come from
 * the success-payload of each Lambda invocation.
 */
function summarizeHistory(events: HistoryEvent[], memoryMb: number): HistorySummary {
  let framesRendered = 0;
  let totalFrames: number | null = null;
  let lambdasInvoked = 0;
  let assembleComplete = false;
  let outputFile: HistorySummary["outputFile"] = null;
  let stateTransitions = 0;
  const errors: RenderError[] = [];
  const lambdaInvocations: BilledLambdaInvocation[] = [];

  // Track the state name we most recently entered, so we can:
  //   - attach the enclosing state to LambdaFunctionFailed errors, and
  //   - identify when the Assemble state finished (StateExited.Assemble)
  //     without relying on the inner Lambda payload's `Action` field.
  let currentLambdaState: string | null = null;

  for (const ev of events) {
    switch (ev.type) {
      case "TaskStateEntered":
      case "MapStateEntered":
      case "PassStateEntered":
      case "ChoiceStateEntered":
      case "SucceedStateEntered":
      case "FailStateEntered":
      case "WaitStateEntered":
      case "ParallelStateEntered":
        // Step Functions Standard Workflows bill per *state entry*, not per
        // history event. Lambda invocations produce ~5-7 history events
        // each (Scheduled / Started / Succeeded / TaskStateExited / …);
        // counting every event as a transition over-reports cost by 3-5×.
        stateTransitions++;
        currentLambdaState = ev.stateEnteredEventDetails?.name ?? currentLambdaState;
        break;
      case "LambdaFunctionScheduled":
        lambdasInvoked++;
        break;
      case "LambdaFunctionSucceeded": {
        const payload = parseJson(ev.lambdaFunctionSucceededEventDetails?.output);
        const billedDurationMs = inferBilledMs(payload);
        lambdaInvocations.push({
          billedDurationMs,
          memorySizeMb: memoryMb,
          estimated: billedDurationMs === 0,
        });
        if (payload && typeof payload === "object") {
          const obj = payload as Record<string, unknown>;
          if (typeof obj.TotalFrames === "number") totalFrames = obj.TotalFrames;
          if (typeof obj.FramesEncoded === "number") {
            // Plan and Assemble also return FramesEncoded; count framesRendered
            // only inside the RenderChunk state so we don't double-count
            // it on the Assemble pass. Keyed off the enclosing state name
            // (set by the matching StateEntered) rather than the payload's
            // `Action` field — `Action` is part of the Lambda event
            // contract and not load-bearing for state-machine identity.
            if (currentLambdaState === "RenderChunk") {
              framesRendered += obj.FramesEncoded;
            }
          }
        }
        break;
      }
      case "TaskStateExited":
      case "MapStateExited":
        // Mark the assemble step complete on its state-exit, independent
        // of the inner Lambda payload shape. The Assemble state's
        // ResultSelector pulls FileSize + OutputS3Uri from the Lambda
        // result, so we re-extract them here from the state exit's
        // own output rather than relying on the Lambda payload.
        if (ev.stateExitedEventDetails?.name === "Assemble") {
          assembleComplete = true;
          const exitPayload = parseJson(ev.stateExitedEventDetails?.output);
          if (exitPayload && typeof exitPayload === "object") {
            const obj = exitPayload as Record<string, unknown>;
            const out = obj.Output as Record<string, unknown> | undefined;
            const outputS3Uri = typeof out?.OutputS3Uri === "string" ? out.OutputS3Uri : null;
            const bytes = typeof out?.FileSize === "number" ? out.FileSize : null;
            outputFile = outputS3Uri ? { s3Uri: outputS3Uri, bytes } : outputFile;
          }
        }
        break;
      case "LambdaFunctionFailed":
        errors.push({
          state: currentLambdaState ?? "<unknown>",
          error: ev.lambdaFunctionFailedEventDetails?.error ?? "UNKNOWN",
          cause: ev.lambdaFunctionFailedEventDetails?.cause ?? "",
        });
        break;
      case "ExecutionFailed":
        errors.push({
          state: "<execution>",
          error: ev.executionFailedEventDetails?.error ?? "UNKNOWN",
          cause: ev.executionFailedEventDetails?.cause ?? "",
        });
        break;
      case "ExecutionAborted":
        errors.push({
          state: "<execution>",
          error: ev.executionAbortedEventDetails?.error ?? "ABORTED",
          cause: ev.executionAbortedEventDetails?.cause ?? "",
        });
        break;
      case "ExecutionTimedOut":
        errors.push({
          state: "<execution>",
          error: "TIMEOUT",
          cause: ev.executionTimedOutEventDetails?.cause ?? "",
        });
        break;
      default:
        break;
    }
  }

  return {
    lambdaInvocations,
    stateTransitions,
    framesRendered,
    totalFrames,
    lambdasInvoked,
    assembleComplete,
    outputFile,
    errors,
  };
}

function parseJson(s: string | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Lambda success payloads from our handler include `DurationMs` — the
 * wall-clock the handler observed. We use it as a best-effort proxy
 * for `BilledDuration` when SFN doesn't expose the latter directly
 * on `LambdaFunctionSucceeded` (the dedicated `BilledDuration` field
 * is in CloudWatch Metrics, not the SFN history payload).
 */
function inferBilledMs(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.DurationMs === "number") return obj.DurationMs;
  return 0;
}

interface ComputeProgressArgs {
  status: RenderStatus;
  totalFrames: number | null;
  framesRendered: number;
  assembleComplete: boolean;
}

function computeOverallProgress({
  status,
  totalFrames,
  framesRendered,
  assembleComplete,
}: ComputeProgressArgs): number {
  if (status === "SUCCEEDED") return 1;
  if (assembleComplete) return 1;
  if (totalFrames === null) return 0;
  // 10 % Plan + 80 % chunk render + 10 % Assemble.
  const chunkProgress = Math.min(1, framesRendered / totalFrames);
  return 0.1 + 0.8 * chunkProgress;
}

function isTerminalFailure(status: RenderStatus): boolean {
  return status === "FAILED" || status === "TIMED_OUT" || status === "ABORTED";
}
