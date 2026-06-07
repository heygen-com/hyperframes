/**
 * `getRenderProgress` — read-only progress + cost snapshot for a single
 * render started by {@link renderToCloudRun}.
 *
 * Pulls one `GetExecution` per call. Cloud Workflows does not surface
 * per-step payloads through the basic Executions API the way Step Functions
 * exposes its history, so this reader takes a different tack than the AWS
 * adapter: the workflow definition **accumulates** each step's result body
 * (Plan + every RenderChunk + Assemble) and returns them as one structured
 * object. On success we parse that object for frame totals, the output
 * file, and per-step `DurationMs` (which the handler stamps into every
 * result), then compute cost against the service's configured vCPU/memory.
 *
 * Progress is therefore coarse while the execution is ACTIVE (we report
 * `running` with `overallProgress = 0`) and exact once it SUCCEEDS
 * (`overallProgress = 1`, real frame + cost numbers). Mid-flight per-chunk
 * progress would require the Workflows step-entries API; that's a tracked
 * follow-up, not part of the first version.
 */

import {
  type BilledCloudRunInvocation,
  computeRenderCost,
  type RenderCost,
} from "./costAccounting.js";

/** Normalised render status. Maps from Cloud Workflows execution states. */
export type RenderStatus = "running" | "succeeded" | "failed" | "cancelled" | "unknown";

/** One error surfaced by the execution. */
export interface RenderError {
  /** Step the failure surfaced in, when recoverable from the error context; else `<execution>`. */
  state: string;
  /** Error class / type. */
  error: string;
  /** Cause string (often a stringified JSON payload from the handler). */
  cause: string;
}

/** Snapshot of a single render's progress + cost + errors at one point in time. */
export interface RenderProgress {
  status: RenderStatus;
  /** `[0, 1]`; coarse while running, exact on success. */
  overallProgress: number;
  framesRendered: number;
  /** `null` until the execution succeeds and the accumulated plan result is read. */
  totalFrames: number | null;
  /** Cloud Run invocations the workflow scheduled (Plan + chunks + Assemble), when known. */
  invocationsObserved: number;
  costs: RenderCost;
  /** Final output object if Assemble succeeded; `null` otherwise. */
  outputFile: { gcsUri: string; bytes: number | null } | null;
  errors: RenderError[];
  /** `true` once the execution has terminated in a non-success state. */
  fatalErrorEncountered: boolean;
  startedAt: string;
  endedAt: string | null;
}

/** Protobuf Timestamp shape the gapic client returns for start/end times. */
interface ProtoTimestamp {
  seconds?: number | string | null;
  nanos?: number | null;
}

/** Subset of a Cloud Workflows Execution this reader consumes. */
export interface ExecutionRecord {
  name?: string | null;
  state?: string | null;
  result?: string | null;
  error?: { payload?: string | null; context?: string | null } | null;
  startTime?: ProtoTimestamp | string | null;
  endTime?: ProtoTimestamp | string | null;
}

/** Minimal surface of `@google-cloud/workflows`' `ExecutionsClient` for reads. */
export interface ExecutionsGetClientLike {
  getExecution(req: { name: string }): Promise<[ExecutionRecord, ...unknown[]]>;
}

/** Options for {@link getRenderProgress}. */
export interface GetRenderProgressOptions {
  /** Server-assigned execution resource name from a {@link renderToCloudRun} call. */
  executionName: string;
  /** vCPU the Cloud Run service is configured with (for cost). Default 4. */
  vcpu?: number;
  /** Memory in GiB the Cloud Run service is configured with (for cost). Default 16. */
  memoryGib?: number;
  /** Test injection seam — production callers leave unset. */
  executions?: ExecutionsGetClientLike;
}

const DEFAULT_VCPU = 4;
const DEFAULT_MEMORY_GIB = 16;

/** Result body the handler returns for each action; the workflow accumulates these. */
interface AccumulatedResult {
  Plan?: { TotalFrames?: number; DurationMs?: number } | null;
  Chunks?: Array<{ FramesEncoded?: number; DurationMs?: number } | null> | null;
  Assemble?: {
    OutputGcsUri?: string;
    FileSize?: number;
    FramesEncoded?: number;
    DurationMs?: number;
  } | null;
}

/** Pull a current progress snapshot for one render. */
// fallow-ignore-next-line complexity
export async function getRenderProgress(opts: GetRenderProgressOptions): Promise<RenderProgress> {
  if (!opts.executionName) {
    throw new Error("[getRenderProgress] executionName is required");
  }
  const executions = opts.executions ?? (await defaultExecutionsClient());
  const vcpu = opts.vcpu ?? DEFAULT_VCPU;
  const memoryGib = opts.memoryGib ?? DEFAULT_MEMORY_GIB;

  const [execution] = await executions.getExecution({ name: opts.executionName });
  const status = mapState(execution.state);
  const startedAt = toIso(execution.startTime) ?? new Date(0).toISOString();
  const endedAt = toIso(execution.endTime);

  const errors: RenderError[] = [];
  if (execution.error) {
    errors.push({
      state: execution.error.context ?? "<execution>",
      error: extractErrorName(execution.error.payload) ?? "ExecutionError",
      cause: execution.error.payload ?? "",
    });
  }

  // Default snapshot: running / unknown — no frame or cost data until the
  // accumulated result is available on success.
  if (status !== "succeeded") {
    return {
      status,
      overallProgress: 0,
      framesRendered: 0,
      totalFrames: null,
      invocationsObserved: 0,
      costs: computeRenderCost([], 0),
      outputFile: null,
      errors,
      fatalErrorEncountered: status === "failed" || status === "cancelled",
      startedAt,
      endedAt,
    };
  }

  const acc = parseAccumulated(execution.result);
  const chunks = acc.Chunks?.filter((c): c is NonNullable<typeof c> => c != null) ?? [];
  const framesRendered = chunks.reduce((sum, c) => sum + (c.FramesEncoded ?? 0), 0);
  const totalFrames = typeof acc.Plan?.TotalFrames === "number" ? acc.Plan.TotalFrames : null;

  const invocations: BilledCloudRunInvocation[] = [];
  const pushInv = (durationMs: number | undefined): void => {
    invocations.push({
      durationMs: typeof durationMs === "number" ? durationMs : 0,
      vcpu,
      memoryGib,
      estimated: typeof durationMs !== "number",
    });
  };
  if (acc.Plan) pushInv(acc.Plan.DurationMs);
  for (const c of chunks) pushInv(c.DurationMs);
  if (acc.Assemble) pushInv(acc.Assemble.DurationMs);

  // Workflow step count: Plan + N chunks + Assemble + a small constant of
  // control steps (BuildChunkList, AssertChunkCount, the map scaffold).
  const workflowSteps = invocations.length + 4;
  const costs = computeRenderCost(invocations, workflowSteps);

  const outputGcsUri = acc.Assemble?.OutputGcsUri;
  const outputFile = outputGcsUri
    ? {
        gcsUri: outputGcsUri,
        bytes: typeof acc.Assemble?.FileSize === "number" ? acc.Assemble.FileSize : null,
      }
    : null;

  return {
    status,
    overallProgress: 1,
    framesRendered,
    totalFrames,
    invocationsObserved: invocations.length,
    costs,
    outputFile,
    errors,
    fatalErrorEncountered: false,
    startedAt,
    endedAt,
  };
}

// fallow-ignore-next-line complexity
function mapState(state: string | null | undefined): RenderStatus {
  switch (state) {
    case "ACTIVE":
    case "QUEUED":
      return "running";
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
    case "UNAVAILABLE":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "unknown";
  }
}

// fallow-ignore-next-line complexity
function parseAccumulated(result: string | null | undefined): AccumulatedResult {
  if (!result) return {};
  try {
    const parsed = JSON.parse(result) as unknown;
    if (parsed && typeof parsed === "object") return parsed as AccumulatedResult;
  } catch {
    // Non-JSON result — treat as empty so cost/frames degrade to zero
    // rather than throwing on a snapshot read.
  }
  return {};
}

/**
 * Best-effort pull of the handler's error name out of a Workflows failure
 * payload. On an http step failure, Workflows wraps the response as
 * `{ code, message, body, ... }` where `body` is the handler's JSON
 * `{ error, message }`. We dig out `error` (the typed name like
 * `PLAN_HASH_MISMATCH`) so triage sees the real cause, not a generic label.
 * Returns undefined for any shape we don't recognise — never throws.
 */
// fallow-ignore-next-line complexity
function extractErrorName(payload: string | null | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const outer = JSON.parse(payload) as { error?: unknown; body?: unknown };
    if (typeof outer.error === "string") return outer.error;
    if (typeof outer.body === "string") {
      const inner = JSON.parse(outer.body) as { error?: unknown };
      if (typeof inner.error === "string") return inner.error;
    } else if (outer.body && typeof outer.body === "object") {
      const inner = outer.body as { error?: unknown };
      if (typeof inner.error === "string") return inner.error;
    }
  } catch {
    // Non-JSON / unexpected shape — fall through to the generic label.
  }
  return undefined;
}

// fallow-ignore-next-line complexity
function toIso(ts: ProtoTimestamp | string | null | undefined): string | null {
  if (ts == null) return null;
  if (typeof ts === "string") return ts;
  const seconds = ts.seconds == null ? null : Number(ts.seconds);
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const ms = seconds * 1000 + (ts.nanos ?? 0) / 1e6;
  return new Date(ms).toISOString();
}

async function defaultExecutionsClient(): Promise<ExecutionsGetClientLike> {
  const mod = await import("@google-cloud/workflows");
  const client = new mod.ExecutionsClient();
  return client as unknown as ExecutionsGetClientLike;
}
