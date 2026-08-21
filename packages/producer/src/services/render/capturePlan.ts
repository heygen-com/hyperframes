/**
 * Immutable routing decision for the capture phase.
 *
 * The orchestrator used to carry the same decision in several mutable booleans
 * (`useStreamingEncode`, `useLayeredComposite`, `forceScreenshot`) plus worker
 * routing state. Keeping those values independently mutable made invalid
 * combinations representable during fallback. A CapturePlan is the single
 * value consumed by capture stages, and `replanAfterFailure` is the only
 * transition between variants.
 */

export type CapturePlanTarget = Readonly<{
  kind: "sdr_streaming" | "sdr_disk";
  workerCount: number;
  forceParallelStream: boolean;
}>;

export type CaptureRouting =
  | Readonly<{ kind: "default" }>
  | Readonly<{
      kind: "worker_inversion" | "parallel_router";
      state: "active" | "reverted";
      fallback: CapturePlanTarget;
      memoryExhaustionFallback: CapturePlanTarget;
    }>;

interface CapturePlanBase {
  readonly workerCount: number;
  readonly forceScreenshot: boolean;
  readonly forceParallelStream: boolean;
  readonly usePageSideCompositing: boolean;
  readonly hasHdrContent: boolean;
  readonly needsAlpha: boolean;
  readonly routing: CaptureRouting;
}

export interface SdrStreamingCapturePlan extends CapturePlanBase {
  readonly kind: "sdr_streaming";
}

export interface SdrDiskCapturePlan extends CapturePlanBase {
  readonly kind: "sdr_disk";
  readonly forceParallelStream: false;
}

export interface HdrLayeredCapturePlan extends CapturePlanBase {
  readonly kind: "hdr_layered";
  readonly forceScreenshot: true;
  readonly forceParallelStream: false;
}

export type CapturePlan = SdrStreamingCapturePlan | SdrDiskCapturePlan | HdrLayeredCapturePlan;

export interface CreateCapturePlanInput {
  workerCount: number;
  forceScreenshot: boolean;
  forceParallelStream?: boolean;
  useStreamingEncode: boolean;
  useLayeredComposite: boolean;
  usePageSideCompositing: boolean;
  hasHdrContent: boolean;
  needsAlpha: boolean;
  routing?: CaptureRouting;
}

export type CapturePlanFailure =
  | Readonly<{ kind: "streaming_unavailable" }>
  | Readonly<{ kind: "draw_element_verification" }>
  | Readonly<{ kind: "capture_failure"; memoryExhaustion: boolean }>;

function assertWorkerCount(workerCount: number): void {
  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new Error(`CapturePlan workerCount must be a positive integer; got ${workerCount}`);
  }
}

function freezeTarget(target: CapturePlanTarget): CapturePlanTarget {
  assertWorkerCount(target.workerCount);
  if (target.kind === "sdr_disk" && target.forceParallelStream) {
    throw new Error("CapturePlan disk fallback cannot force parallel streaming");
  }
  return Object.freeze({ ...target });
}

function freezeRouting(routing: CaptureRouting | undefined): CaptureRouting {
  if (!routing || routing.kind === "default") return Object.freeze({ kind: "default" });
  return Object.freeze({
    ...routing,
    fallback: freezeTarget(routing.fallback),
    memoryExhaustionFallback: freezeTarget(routing.memoryExhaustionFallback),
  });
}

export function createCapturePlan(input: CreateCapturePlanInput): CapturePlan {
  assertWorkerCount(input.workerCount);
  const base = {
    workerCount: input.workerCount,
    forceScreenshot: input.forceScreenshot || input.usePageSideCompositing,
    forceParallelStream: input.useStreamingEncode ? (input.forceParallelStream ?? false) : false,
    usePageSideCompositing: input.usePageSideCompositing,
    hasHdrContent: input.hasHdrContent,
    needsAlpha: input.needsAlpha,
    routing: freezeRouting(input.routing),
  };

  if (input.useLayeredComposite) {
    return Object.freeze({
      ...base,
      kind: "hdr_layered",
      forceScreenshot: true,
      forceParallelStream: false,
    });
  }
  if (input.useStreamingEncode) {
    return Object.freeze({ ...base, kind: "sdr_streaming" });
  }
  return Object.freeze({ ...base, kind: "sdr_disk", forceParallelStream: false });
}

function revertedRouting(routing: CaptureRouting): CaptureRouting {
  if (routing.kind === "default") return routing;
  return freezeRouting({ ...routing, state: "reverted" });
}

/** Pure, exhaustive capture fallback transition. The input plan is never mutated. */
export function replanAfterFailure(plan: CapturePlan, failure: CapturePlanFailure): CapturePlan {
  // Disk-path drawElement self-verification (parallel disk workers under the
  // explicit fast-capture opt-in) can also trip — the retry stays on the disk
  // path but forces the screenshot baseline.
  if (plan.kind === "sdr_disk" && failure.kind === "draw_element_verification") {
    return createCapturePlan({
      ...plan,
      forceScreenshot: true,
      useStreamingEncode: false,
      useLayeredComposite: false,
      forceParallelStream: false,
    });
  }
  if (plan.kind !== "sdr_streaming") {
    throw new Error(`Cannot apply ${failure.kind} to ${plan.kind} capture plan`);
  }

  if (failure.kind === "streaming_unavailable") {
    return createCapturePlan({
      ...plan,
      useStreamingEncode: false,
      useLayeredComposite: false,
      forceParallelStream: false,
    });
  }

  const isMemoryExhaustion = failure.kind === "capture_failure" && failure.memoryExhaustion;
  const fallback =
    plan.routing.kind === "default"
      ? {
          kind: plan.kind,
          workerCount: isMemoryExhaustion ? 1 : plan.workerCount,
          forceParallelStream: false,
        }
      : isMemoryExhaustion
        ? plan.routing.memoryExhaustionFallback
        : plan.routing.fallback;
  return createCapturePlan({
    ...plan,
    workerCount: fallback.workerCount,
    forceScreenshot: true,
    forceParallelStream: fallback.forceParallelStream,
    useStreamingEncode: fallback.kind === "sdr_streaming",
    useLayeredComposite: false,
    routing: revertedRouting(plan.routing),
  });
}
