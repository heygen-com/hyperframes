import { describe, expect, it, vi } from "vitest";
import type { ProducerLogger } from "../../logger.js";
import type { RenderJob } from "../renderOrchestrator.js";
import { RenderExecutionContext } from "./renderExecutionContext.js";

function logger(): ProducerLogger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function job(): RenderJob {
  return {
    id: "job-1",
    status: "queued",
    outcome: null,
    warnings: [],
    progress: 0,
    currentStage: "queued",
    config: { fps: { num: 30, den: 1 }, quality: "standard" },
    createdAt: new Date(),
  };
}

describe("RenderExecutionContext", () => {
  it("freezes request identity and scopes every log record", () => {
    const base = logger();
    const context = new RenderExecutionContext({
      request: { renderJobId: "job-1", projectDir: "/project", outputPath: "/out.mp4" },
      logger: base,
    });

    expect(Object.isFrozen(context.request)).toBe(true);
    context.logger.info("started", { phase: "compile" });
    expect(base.info).toHaveBeenCalledWith("started", {
      renderJobId: "job-1",
      phase: "compile",
    });
  });

  it("runs disposers once in reverse acquisition order and contains failures", async () => {
    const base = logger();
    const calls: string[] = [];
    const context = new RenderExecutionContext({
      request: { renderJobId: "job-1", projectDir: "/project", outputPath: "/out.mp4" },
      logger: base,
    });
    context.defer("first", () => calls.push("first"));
    context.defer("broken", () => {
      calls.push("broken");
      throw new Error("close failed");
    });
    context.defer("last", async () => calls.push("last"));

    await Promise.all([context.dispose(), context.dispose()]);

    expect(calls).toEqual(["last", "broken", "first"]);
    expect(base.debug).toHaveBeenCalledWith(
      "Cleanup failed (broken)",
      expect.objectContaining({ renderJobId: "job-1", error: "close failed" }),
    );
  });

  it("can release ownership after a resource is closed early", async () => {
    const dispose = vi.fn();
    const context = new RenderExecutionContext({
      request: { renderJobId: "job-1", projectDir: "/project", outputPath: "/out.mp4" },
      logger: logger(),
    });
    const release = context.defer("resource", dispose);
    release();

    await context.dispose();

    expect(dispose).not.toHaveBeenCalled();
  });

  it("serializes progress before disposal completes", async () => {
    const deliveries: string[] = [];
    const context = new RenderExecutionContext({
      request: { renderJobId: "job-1", projectDir: "/project", outputPath: "/out.mp4" },
      logger: logger(),
      progressSink: async (_job, message) => {
        await Promise.resolve();
        deliveries.push(message);
      },
    });
    context.defer("resource", () => deliveries.push("disposed"));
    const renderJob = job();
    context.onProgress?.(renderJob, "first");
    context.onProgress?.(renderJob, "second");

    await context.dispose();

    expect(deliveries).toEqual(["first", "second", "disposed"]);
  });

  it("does not let a broken cleanup logger reject disposal", async () => {
    const base = logger();
    vi.mocked(base.debug).mockImplementation(() => {
      throw new Error("logger unavailable");
    });
    const context = new RenderExecutionContext({
      request: { renderJobId: "job-1", projectDir: "/project", outputPath: "/out.mp4" },
      logger: base,
    });
    context.defer("broken", () => {
      throw new Error("close failed");
    });

    await expect(context.dispose()).resolves.toBeUndefined();
  });

  it("composes caller cancellation with a deadline", async () => {
    const controller = new AbortController();
    const context = new RenderExecutionContext({
      request: { renderJobId: "job-1", projectDir: "/project", outputPath: "/out.mp4" },
      logger: logger(),
      signal: controller.signal,
      deadlineAtMs: Date.now() + 60_000,
    });
    controller.abort();

    expect(() => context.assertActive()).toThrow("render_cancelled");
    await context.dispose();
  });

  it("is already aborted when its deadline has elapsed", async () => {
    const context = new RenderExecutionContext({
      request: { renderJobId: "job-1", projectDir: "/project", outputPath: "/out.mp4" },
      logger: logger(),
      deadlineAtMs: Date.now() - 1,
    });

    expect(context.signal?.aborted).toBe(true);
    expect(() => context.assertActive()).toThrow("render_cancelled");
    await context.dispose();
  });
});
