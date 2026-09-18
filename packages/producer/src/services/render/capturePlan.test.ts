import { describe, expect, it } from "vitest";
import {
  createCapturePlan,
  drawElementVerificationFailure,
  replanAfterFailure,
  streamingCaptureFailure,
  type CaptureRouting,
} from "./capturePlan.js";

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

  it("replans an ordinary one-worker capture failure onto a fresh screenshot stream", () => {
    expect(
      replanAfterFailure(streaming(), { kind: "capture_failure", memoryExhaustion: false }),
    ).toMatchObject({
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
    const next = replanAfterFailure(initial, {
      kind: "draw_element_verification",
      diskFallbackAvailable: true,
    });

    expect(next).toMatchObject({
      kind: "sdr_disk",
      workerCount: 5,
      forceScreenshot: true,
      routing: { kind: "worker_inversion", state: "reverted" },
    });
    expect(initial).toMatchObject({ workerCount: 1, routing: { state: "active" } });
    expect(Object.isFrozen(next.routing)).toBe(true);
  });

  it("keeps verification recovery streaming when the disk fallback lacks headroom", () => {
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
      kind: "draw_element_verification",
      diskFallbackAvailable: false,
    });

    expect(next).toMatchObject({
      kind: "sdr_streaming",
      workerCount: 1,
      forceScreenshot: true,
      routing: { kind: "worker_inversion", state: "reverted" },
    });
    expect(initial).toMatchObject({ workerCount: 1, routing: { state: "active" } });
    expect(Object.isFrozen(next.routing)).toBe(true);
  });

  it("keeps parallel-router verification recovery streaming when the disk fallback lacks headroom", () => {
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
      kind: "draw_element_verification",
      diskFallbackAvailable: false,
    });

    expect(next).toMatchObject({
      kind: "sdr_streaming",
      workerCount: 1,
      forceScreenshot: true,
      routing: { kind: "parallel_router", state: "reverted" },
    });
    expect(
      replanAfterFailure(initial, {
        kind: "draw_element_verification",
        diskFallbackAvailable: true,
      }),
    ).toMatchObject({ kind: "sdr_disk", workerCount: 5 });
  });

  describe("drawElementVerificationFailure", () => {
    const diskFallback = { kind: "sdr_disk", workerCount: 5, forceParallelStream: false } as const;
    const streamFallback = {
      kind: "sdr_streaming",
      workerCount: 1,
      forceParallelStream: false,
    } as const;

    it("consults disk headroom for every routing whose disk fallback has an off-disk escape", () => {
      for (const kind of ["worker_inversion", "parallel_router"] as const) {
        const plan = streaming({
          kind,
          state: "active",
          fallback: diskFallback,
          memoryExhaustionFallback: streamFallback,
        });
        for (const available of [false, true]) {
          let inspections = 0;
          const failure = drawElementVerificationFailure(plan, () => {
            inspections += 1;
            return available;
          });
          expect(failure).toEqual({
            kind: "draw_element_verification",
            diskFallbackAvailable: available,
          });
          expect(inspections).toBe(1);
        }
      }
    });

    it("skips the disk inspection when headroom cannot change the fallback", () => {
      const inspect = () => {
        throw new Error("disk must not be inspected");
      };
      const unchanged = { kind: "draw_element_verification", diskFallbackAvailable: undefined };

      expect(drawElementVerificationFailure(streaming(), inspect)).toEqual(unchanged);
      expect(
        drawElementVerificationFailure(
          streaming({
            kind: "parallel_router",
            state: "active",
            fallback: streamFallback,
            memoryExhaustionFallback: streamFallback,
          }),
          inspect,
        ),
      ).toEqual(unchanged);
      expect(
        drawElementVerificationFailure(
          streaming({
            kind: "worker_inversion",
            state: "active",
            fallback: diskFallback,
            memoryExhaustionFallback: { ...diskFallback, workerCount: 1 },
          }),
          inspect,
        ),
      ).toEqual(unchanged);
    });
  });

  describe("streamingCaptureFailure", () => {
    // The routing shape for which a verification failure DOES consult disk
    // headroom — so any inspector call below would be on that path alone.
    const routedPlan = streaming({
      kind: "worker_inversion",
      state: "active",
      fallback: { kind: "sdr_disk", workerCount: 5, forceParallelStream: false },
      memoryExhaustionFallback: {
        kind: "sdr_streaming",
        workerCount: 1,
        forceParallelStream: false,
      },
    });
    const inspect = () => {
      throw new Error("disk must not be inspected");
    };

    // A canvas / paint-record capture error, a renderer stall and an OOM are
    // not verification failures: each retries as a plain capture failure and
    // must not touch the disk.
    it.each([false, true])(
      "never inspects disk headroom for a non-verification failure (memoryExhaustion: %s)",
      (isMemoryExhaustion) => {
        expect(
          streamingCaptureFailure(
            routedPlan,
            { isVerifyError: false, isMemoryExhaustion },
            inspect,
          ),
        ).toEqual({ kind: "capture_failure", memoryExhaustion: isMemoryExhaustion });
      },
    );

    it("reverts to the preferred disk fallback on a drawElement capture failure", () => {
      // The streaming-side capture failure carries no headroom flag, so the
      // retry takes the routing's preferred fallback without steering.
      const failure = streamingCaptureFailure(
        routedPlan,
        { isVerifyError: false, isMemoryExhaustion: false },
        inspect,
      );
      expect(replanAfterFailure(routedPlan, failure)).toMatchObject({
        kind: "sdr_disk",
        workerCount: 5,
        forceScreenshot: true,
        routing: { kind: "worker_inversion", state: "reverted" },
      });
    });

    it("routes a verification failure through the headroom-aware builder", () => {
      let inspections = 0;
      const failure = streamingCaptureFailure(
        routedPlan,
        { isVerifyError: true, isMemoryExhaustion: false },
        () => {
          inspections += 1;
          return false;
        },
      );
      expect(failure).toEqual({ kind: "draw_element_verification", diskFallbackAvailable: false });
      expect(inspections).toBe(1);
    });
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

  it.each(["draw_element_verification", "draw_element_capture"] as const)(
    "forces screenshot on a disk-plan %s failure",
    (kind) => {
      // Parallel disk workers under the explicit fast-capture opt-in verify their
      // own captured samples; a breach must re-render the DISK plan on the
      // screenshot baseline (not throw, and not stay on drawElement).
      const disk = createCapturePlan({
        workerCount: 2,
        forceScreenshot: false,
        useStreamingEncode: false,
        useLayeredComposite: false,
        usePageSideCompositing: false,
        hasHdrContent: false,
        needsAlpha: false,
      });
      const next = replanAfterFailure(disk, { kind });
      expect(next).toMatchObject({
        kind: "sdr_disk",
        forceScreenshot: true,
        forceParallelStream: false,
        workerCount: 2,
      });
    },
  );

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
