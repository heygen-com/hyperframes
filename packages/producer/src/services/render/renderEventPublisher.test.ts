// fallow-ignore-file code-duplication
import { describe, expect, it, vi } from "vitest";
import {
  RenderQualityError,
  applyRenderWarningPolicy,
  createRenderJob,
} from "../renderOrchestrator.js";
import { updateJobStatus } from "./shared.js";
import { OrderedRenderEventPublisher, publishRenderFailure } from "./renderEventPublisher.js";

describe("OrderedRenderEventPublisher", () => {
  it("delivers immutable snapshots in order and waits for async sinks", async () => {
    const delivered: Array<{ progress: number; message: string }> = [];
    const publisher = new OrderedRenderEventPublisher(
      async (job, message) => {
        await Promise.resolve();
        delivered.push({ progress: job.progress, message });
      },
      { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    );
    const job = createRenderJob({ fps: 30, quality: "high" });
    const publish = (nextJob: typeof job, message: string) => publisher.publish(nextJob, message);

    updateJobStatus(job, "preprocessing", "first", 5, publish);
    updateJobStatus(job, "rendering", "second", 25, publish);
    updateJobStatus(job, "complete", "done", 100, publish);
    await publisher.flush();

    expect(delivered).toEqual([
      { progress: 5, message: "first" },
      { progress: 25, message: "second" },
      { progress: 100, message: "done" },
    ]);
  });

  it("deep-clones typed warning arrays across the progress sink boundary", async () => {
    const deliveredReasons: string[][] = [];
    const publisher = new OrderedRenderEventPublisher(
      async (snapshot) => {
        const reasons = snapshot.warnings[0]?.details?.failureReasons;
        if (reasons) {
          deliveredReasons.push([...reasons]);
          reasons.push("sink_mutation");
        }
      },
      { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    );
    const job = createRenderJob({ fps: 30, quality: "high" });
    job.warnings.push({
      code: "audio_processing_failed",
      message: "audio failed",
      stage: "capture-readiness",
      details: {
        mediaType: "audio",
        failureReasons: ["ffmpeg_timeout"],
        failureStages: ["prepare"],
      },
    });

    publisher.publish(job, "warning");
    job.warnings[0]!.details!.failureReasons!.push("source_mutation");
    await publisher.flush();

    expect(deliveredReasons).toEqual([["ffmpeg_timeout"]]);
    expect(job.warnings[0]?.details?.failureReasons).toEqual(["ffmpeg_timeout", "source_mutation"]);
  });

  it("contains sink rejection and still delivers the terminal event", async () => {
    const delivered: number[] = [];
    const warn = vi.fn();
    const publisher = new OrderedRenderEventPublisher(
      async (job) => {
        if (job.progress === 5) throw new Error("sink down");
        delivered.push(job.progress);
      },
      { error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() },
    );
    const job = createRenderJob({ fps: 30, quality: "high" });
    const publish = (nextJob: typeof job, message: string) => publisher.publish(nextJob, message);

    updateJobStatus(job, "preprocessing", "first", 5, publish);
    updateJobStatus(job, "complete", "done", 100, publish);
    await publisher.flush();

    expect(delivered).toEqual([100]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("publishes the complete structured failure in the terminal snapshot", async () => {
    const delivered: Array<ReturnType<typeof createRenderJob>> = [];
    const publisher = new OrderedRenderEventPublisher(
      async (job) => {
        delivered.push(job);
      },
      { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    );
    const job = createRenderJob({ fps: 30, quality: "high" });
    job.currentStage = "Capturing frames";
    const publish = (nextJob: typeof job, message: string) => publisher.publish(nextJob, message);
    const errorDetails = {
      message: "capture failed",
      elapsedMs: 125,
      freeMemoryMB: 512,
    };

    publishRenderFailure(
      job,
      {
        error: "capture failed",
        failedStage: job.currentStage,
        errorDetails,
      },
      publish,
    );
    await publisher.flush();

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      status: "failed",
      currentStage: "Failed: capture failed",
      outcome: "failed",
      error: "capture failed",
      failedStage: "Capturing frames",
      errorDetails,
    });
  });
});

describe("updateJobStatus", () => {
  it("keeps one bounded monotonic integer-percent representation", () => {
    const job = createRenderJob({ fps: 30, quality: "high" });
    updateJobStatus(job, "rendering", "advance", 25.6);
    updateJobStatus(job, "rendering", "stale", 20);
    updateJobStatus(job, "rendering", "overflow", 120);
    expect(job.progress).toBe(100);
  });

  it("timestamps every terminal outcome, including cancellation", () => {
    const job = createRenderJob({ fps: 30, quality: "high" });
    updateJobStatus(job, "cancelled", "cancelled", 42);
    expect(job.completedAt).toBeInstanceOf(Date);
    expect(job.outcome).toBe("cancelled");
  });

  it("qualifies best-effort completion when correctness warnings exist", () => {
    const job = createRenderJob({ fps: 30, quality: "high", strictness: "best-effort" });
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    applyRenderWarningPolicy(
      job,
      [
        {
          code: "media_load_failed",
          message: "video failed",
          details: { mediaType: "video", sources: ["missing.mp4"] },
        },
      ],
      log,
    );
    updateJobStatus(job, "complete", "done", 100);
    expect(job.outcome).toBe("completed_with_warnings");
    expect(job.warnings).toHaveLength(1);
  });

  it("blocks audio processing failures when strictness is omitted", () => {
    const job = createRenderJob({ fps: 30, quality: "high" });
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    expect(() =>
      applyRenderWarningPolicy(
        job,
        [
          {
            code: "audio_processing_failed",
            message: "audio mix failed",
            details: { mediaType: "audio", sources: ["broken.mp3"] },
          },
        ],
        log,
      ),
    ).toThrow(RenderQualityError);
    expect(job.config.strictness).toBe("best-effort");
    expect(job.warnings).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      "Render completed capture with correctness warnings",
      expect.objectContaining({ warningRetryable: undefined }),
    );
  });

  it("logs bounded audio failure taxonomy without requiring raw stderr", () => {
    const job = createRenderJob({ fps: 30, quality: "high" });
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    expect(() =>
      applyRenderWarningPolicy(
        job,
        [
          {
            code: "audio_processing_failed",
            message: "raw diagnostic stays on the warning object",
            details: {
              mediaType: "audio",
              failureReasons: ["ffmpeg_timeout"],
              failureStages: ["prepare"],
              failureOwner: "system",
              retryable: true,
            },
          },
        ],
        log,
      ),
    ).toThrow(RenderQualityError);
    expect(log.warn).toHaveBeenCalledWith(
      "Render completed capture with correctness warnings",
      expect.objectContaining({
        warningCodes: ["audio_processing_failed"],
        warningReasons: ["ffmpeg_timeout"],
        warningStages: ["prepare"],
        warningOwners: ["system"],
        warningRetryable: true,
      }),
    );
  });

  it("only logs an aggregate warning as retryable when every typed warning is retryable", () => {
    const job = createRenderJob({ fps: 30, quality: "high" });
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    expect(() =>
      applyRenderWarningPolicy(
        job,
        [
          {
            code: "audio_processing_failed",
            message: "temporary audio failure",
            details: { mediaType: "audio", retryable: true },
          },
          {
            code: "media_load_failed",
            message: "terminal media failure",
            details: { mediaType: "video", retryable: false },
          },
        ],
        log,
      ),
    ).toThrow(RenderQualityError);
    expect(log.warn).toHaveBeenCalledWith(
      "Render completed capture with correctness warnings",
      expect.objectContaining({ warningRetryable: false }),
    );
  });

  it("blocks sub-timeline script failures in best-effort mode (#3352)", () => {
    const job = createRenderJob({ fps: 30, quality: "high" });
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    expect(() =>
      applyRenderWarningPolicy(
        job,
        [
          {
            code: "sub_timeline_script_failure",
            message: "A sub-composition script threw during execution",
            details: {
              timeoutMs: 45_000,
              sources: ["runtime-error:decision-tree-123"],
            },
          },
        ],
        log,
      ),
    ).toThrow(RenderQualityError);
    expect(job.warnings).toHaveLength(1);
  });

  it("allows sub-timeline readiness timeout in best-effort mode", () => {
    const job = createRenderJob({ fps: 30, quality: "high" });
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    applyRenderWarningPolicy(
      job,
      [
        {
          code: "sub_timeline_readiness_timeout",
          message: "Sub-composition timelines did not become ready within 45000ms",
          details: { timeoutMs: 45_000 },
        },
      ],
      log,
    );
    expect(job.warnings).toHaveLength(1);
  });

  it("fails explicitly strict renders on correctness warnings", () => {
    const job = createRenderJob({ fps: 30, quality: "high", strictness: "strict" });
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    expect(() =>
      applyRenderWarningPolicy(
        job,
        [
          {
            code: "audio_processing_failed",
            message: "audio mix failed",
            details: { mediaType: "audio", sources: ["broken.mp3"] },
          },
        ],
        log,
      ),
    ).toThrow(RenderQualityError);
  });
});
