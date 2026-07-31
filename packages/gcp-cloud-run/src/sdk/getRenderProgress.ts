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
 * While the execution is ACTIVE, mid-flight progress comes from the
 * Workflows **step-entries API** (`executions.stepEntries.list`, REST — the
 * Node gapic client doesn't expose it yet): we count succeeded
 * `renderOneChunk` entries against the chunk-slot count and map them onto
 * the same 10 % Plan + 80 % chunks + 10 % Assemble split the AWS adapter
 * uses. Frame counts stay unknown mid-flight (step entries carry no
 * payloads), so `framesRendered` is 0 until success — `chunksCompleted` /
 * `totalChunks` are the live signals. The step-entries read is best-effort:
 * any API/permission failure degrades to the coarse `overallProgress = 0`
 * snapshot instead of throwing.
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
  /** `[0, 1]`; chunk-based while running (step entries), exact on success. */
  overallProgress: number;
  /** Exact on success; 0 while running (step entries carry no frame counts). */
  framesRendered: number;
  /** `null` until the execution succeeds and the accumulated plan result is read. */
  totalFrames: number | null;
  /** Chunks whose render step has succeeded so far (live while running). */
  chunksCompleted: number;
  /** Planned chunk count once the chunk list is built; `null` before that. */
  totalChunks: number | null;
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

/** One step entry from `executions.stepEntries.list` (REST). */
export interface StepEntryRecord {
  /** Step name from workflow.yaml (e.g. `renderOneChunk`). */
  step?: string | null;
  /** `STATE_SUCCEEDED` / `STATE_IN_PROGRESS` / `STATE_FAILED`. */
  state?: string | null;
}

/** Injection seam for the step-entries reader (REST; not in the gapic client). */
export interface StepEntriesListerLike {
  listStepEntries(executionName: string): Promise<StepEntryRecord[]>;
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
  /** Test injection seam for the step-entries reader — production callers leave unset. */
  stepEntries?: StepEntriesListerLike;
  /**
   * Set to false to skip the step-entries API while the execution is ACTIVE
   * (one extra authenticated REST call per poll). Default true.
   */
  midFlightProgress?: boolean;
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

  // Non-success snapshot: frame + cost data only exist in the accumulated
  // result on success, but a live execution still gets chunk-level progress
  // from the step-entries API.
  if (status !== "succeeded") {
    const midFlight =
      status === "running" && opts.midFlightProgress !== false
        ? await tryMidFlightSnapshot(opts)
        : null;
    return {
      status,
      overallProgress: midFlight?.overallProgress ?? 0,
      framesRendered: 0,
      totalFrames: null,
      chunksCompleted: midFlight?.chunksCompleted ?? 0,
      totalChunks: midFlight?.totalChunks ?? null,
      invocationsObserved: midFlight?.invocationsObserved ?? 0,
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
    chunksCompleted: chunks.length,
    totalChunks: chunks.length,
    invocationsObserved: invocations.length,
    costs,
    outputFile,
    errors,
    fatalErrorEncountered: false,
    startedAt,
    endedAt,
  };
}

// ── Mid-flight progress via the step-entries API ─────────────────────────────

// Step names from terraform/workflow.yaml. `appendSlots` runs once per chunk
// in the (fast, sequential) fillLists loop, so its succeeded-entry count IS
// the planned chunk count — available well before any chunk finishes.
const PLAN_STEP = "plan";
const CHUNK_SLOT_STEP = "appendSlots";
const CHUNK_STEP = "renderOneChunk";
const ASSEMBLE_STEP = "assemble";

interface MidFlightSnapshot {
  overallProgress: number;
  chunksCompleted: number;
  totalChunks: number | null;
  invocationsObserved: number;
}

function entrySucceeded(entry: StepEntryRecord): boolean {
  return entry.state === "STATE_SUCCEEDED" || entry.state === "SUCCEEDED";
}

// fallow-ignore-next-line complexity
function summarizeStepEntries(entries: readonly StepEntryRecord[]): MidFlightSnapshot {
  let planDone = false;
  let slots = 0;
  let chunksCompleted = 0;
  let assembleDone = false;
  let invocations = 0;
  for (const entry of entries) {
    if (!entrySucceeded(entry)) continue;
    switch (entry.step) {
      case PLAN_STEP:
        planDone = true;
        invocations += 1;
        break;
      case CHUNK_SLOT_STEP:
        slots += 1;
        break;
      case CHUNK_STEP:
        chunksCompleted += 1;
        invocations += 1;
        break;
      case ASSEMBLE_STEP:
        assembleDone = true;
        invocations += 1;
        break;
      default:
        break;
    }
  }
  const totalChunks = slots > 0 ? slots : null;
  return {
    overallProgress: midFlightProgress(planDone, chunksCompleted, totalChunks, assembleDone),
    chunksCompleted,
    totalChunks,
    invocationsObserved: invocations,
  };
}

// Same 10 % Plan + 80 % chunks + 10 % Assemble split as the AWS adapter,
// measured in chunks instead of frames. Never returns 1 — the execution
// itself reports success.
// fallow-ignore-next-line complexity
function midFlightProgress(
  planDone: boolean,
  chunksCompleted: number,
  totalChunks: number | null,
  assembleDone: boolean,
): number {
  if (assembleDone) return 0.99;
  if (!planDone) return 0;
  if (totalChunks == null || totalChunks <= 0) return 0.1;
  return 0.1 + 0.8 * Math.min(1, chunksCompleted / totalChunks);
}

async function tryMidFlightSnapshot(
  opts: GetRenderProgressOptions,
): Promise<MidFlightSnapshot | null> {
  try {
    const lister = opts.stepEntries ?? (await defaultStepEntriesLister());
    return summarizeStepEntries(await lister.listStepEntries(opts.executionName));
  } catch {
    // Missing permission (workflowexecutions.stepEntries.list), API not
    // enabled, or transient failure — degrade to the coarse snapshot.
    return null;
  }
}

const STEP_ENTRIES_PAGE_SIZE = 500;
const STEP_ENTRIES_MAX_PAGES = 20;

// The gapic ExecutionsClient (v4) has no stepEntries surface, so this hits
// the REST endpoint directly with ADC via google-auth-library.
async function defaultStepEntriesLister(): Promise<StepEntriesListerLike> {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: "https://www.googleapis.com/auth/cloud-platform",
  });
  const client = await auth.getClient();
  return {
    // fallow-ignore-next-line complexity
    async listStepEntries(executionName: string): Promise<StepEntryRecord[]> {
      const entries: StepEntryRecord[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < STEP_ENTRIES_MAX_PAGES; page += 1) {
        const token = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
        const url = `https://workflowexecutions.googleapis.com/v1/${executionName}/stepEntries?pageSize=${STEP_ENTRIES_PAGE_SIZE}${token}`;
        const res = await client.request<{
          stepEntries?: StepEntryRecord[];
          nextPageToken?: string;
        }>({ url });
        entries.push(...(res.data.stepEntries ?? []));
        pageToken = res.data.nextPageToken;
        if (!pageToken) break;
      }
      return entries;
    },
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
