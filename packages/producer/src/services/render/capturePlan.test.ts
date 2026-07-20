import { describe, expect, it } from "vitest";
import { createCapturePlan, replanAfterFailure, type CaptureRouting } from "./capturePlan.js";

function streaming(routing?: CaptureRouting) {
  return createCapturePlan({
    workerCount: 1,
    forceScreenshot: false,
    forceParallelStream: false,
    useStreamingEncode: true,
    useLayeredComposite: false,
    usePageSideCompositing: false,
    hasHdrContent: false,
    needsAlpha: false,
    routing,
  });
}

describe("CapturePlan", () => {
  it("makes layered capture dominant and enforces its screenshot invariant", () => {
    const plan = createCapturePlan({
      workerCount: 3,
      forceScreenshot: false,
      forceParallelStream: true,
      useStreamingEncode: true,
      useLayeredComposite: true,
      usePageSideCompositing: false,
      hasHdrContent: true,
      needsAlpha: false,
    });

    expect(plan).toMatchObject({
      kind: "hdr_layered",
      workerCount: 3,
      forceScreenshot: true,
      forceParallelStream: false,
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.routing)).toBe(true);
  });

  it("falls back from an unavailable streaming encoder to the same disk route", () => {
    const initial = streaming();
    const next = replanAfterFailure(initial, { kind: "streaming_unavailable" });

    expect(next).toMatchObject({ kind: "sdr_disk", workerCount: 1, forceScreenshot: false });
    expect(initial.kind).toBe("sdr_streaming");
  });

  it("makes page-side compositing force screenshot capture", () => {
    const plan = createCapturePlan({
      workerCount: 1,
      forceScreenshot: false,
      forceParallelStream: false,
      useStreamingEncode: true,
      useLayeredComposite: false,
      usePageSideCompositing: true,
      hasHdrContent: false,
      needsAlpha: false,
    });
    expect(plan).toMatchObject({ kind: "sdr_streaming", forceScreenshot: true });
  });

  it("retries an ordinary verification failure in streaming screenshot mode", () => {
    expect(replanAfterFailure(streaming(), { kind: "draw_element_verification" })).toMatchObject({
      kind: "sdr_streaming",
      workerCount: 1,
      forceScreenshot: true,
      routing: { kind: "default" },
    });
  });

  it("atomically restores the pre-inversion disk route after verification failure", () => {
    const initial = streaming({
      kind: "worker_inversion",
      state: "active",
      fallback: { kind: "sdr_disk", workerCount: 5, forceParallelStream: false },
      memoryExhaustionFallback: {
        kind: "sdr_streaming",
        workerCount: 1,
        forceParallelStream: false,
      },
    });
    const next = replanAfterFailure(initial, { kind: "draw_element_verification" });

    expect(next).toMatchObject({
      kind: "sdr_disk",
      workerCount: 5,
      forceScreenshot: true,
      routing: { kind: "worker_inversion", state: "reverted" },
    });
    expect(initial).toMatchObject({ workerCount: 1, routing: { state: "active" } });
    expect(Object.isFrozen(next.routing)).toBe(true);
  });

  it("retries an inversion OOM in single-worker screenshot streaming mode", () => {
    const initial = streaming({
      kind: "worker_inversion",
      state: "active",
      fallback: { kind: "sdr_disk", workerCount: 5, forceParallelStream: false },
      memoryExhaustionFallback: {
        kind: "sdr_streaming",
        workerCount: 1,
        forceParallelStream: false,
      },
    });
    const next = replanAfterFailure(initial, {
      kind: "capture_failure",
      memoryExhaustion: true,
    });

    expect(next).toMatchObject({
      kind: "sdr_streaming",
      workerCount: 1,
      forceScreenshot: true,
      routing: { kind: "worker_inversion", state: "reverted" },
    });
  });

  it("retries a parallel-router OOM in single-worker screenshot streaming mode", () => {
    const initial = streaming({
      kind: "parallel_router",
      state: "active",
      fallback: { kind: "sdr_disk", workerCount: 5, forceParallelStream: false },
      memoryExhaustionFallback: {
        kind: "sdr_streaming",
        workerCount: 1,
        forceParallelStream: false,
      },
    });
    const next = replanAfterFailure(initial, {
      kind: "capture_failure",
      memoryExhaustion: true,
    });

    expect(next).toMatchObject({
      kind: "sdr_streaming",
      workerCount: 1,
      forceScreenshot: true,
      routing: { kind: "parallel_router", state: "reverted" },
    });
  });

  it("rejects a streaming transition from a non-streaming plan", () => {
    const disk = createCapturePlan({
      workerCount: 2,
      forceScreenshot: true,
      useStreamingEncode: false,
      useLayeredComposite: false,
      usePageSideCompositing: false,
      hasHdrContent: false,
      needsAlpha: false,
    });
    expect(() => replanAfterFailure(disk, { kind: "streaming_unavailable" })).toThrow(
      "Cannot apply streaming_unavailable to sdr_disk",
    );
  });
});
