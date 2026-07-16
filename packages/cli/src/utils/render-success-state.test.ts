import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetRenderSuccessForTests,
  isRenderSucceeded,
  markRenderSucceeded,
  runPostRenderStep,
  runPostRenderStepAsync,
} from "./render-success-state.js";

describe("render-success-state flag", () => {
  afterEach(() => {
    _resetRenderSuccessForTests();
  });

  it("starts unset", () => {
    expect(isRenderSucceeded()).toBe(false);
  });

  it("flips true after markRenderSucceeded()", () => {
    markRenderSucceeded();
    expect(isRenderSucceeded()).toBe(true);
  });

  it("stays true across repeated calls (idempotent)", () => {
    markRenderSucceeded();
    markRenderSucceeded();
    markRenderSucceeded();
    expect(isRenderSucceeded()).toBe(true);
  });

  it("reset restores the initial state", () => {
    markRenderSucceeded();
    _resetRenderSuccessForTests();
    expect(isRenderSucceeded()).toBe(false);
  });
});

describe("runPostRenderStep", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    _resetRenderSuccessForTests();
  });

  it("runs the step and returns normally on success", () => {
    const sink = vi.fn();
    const step = vi.fn();
    runPostRenderStep("noop", step, sink);
    expect(step).toHaveBeenCalledTimes(1);
    expect(sink).not.toHaveBeenCalled();
  });

  it("swallows a thrown error and reports it to the sink", () => {
    const sink = vi.fn();
    const err = new Error("teardown blew up");
    runPostRenderStep(
      "trackRenderMetrics",
      () => {
        throw err;
      },
      sink,
    );
    expect(sink).toHaveBeenCalledTimes(1);
    const msg = sink.mock.calls[0]?.[0] as string;
    expect(msg).toContain("trackRenderMetrics");
    expect(msg).toContain("teardown blew up");
    expect(msg).toContain("render already succeeded");
  });

  it("sanitizes a stray non-zero process.exitCode back to 0", () => {
    // Regression: a cleanup step that sets process.exitCode=1 (or a helper it
    // calls that does) must not leave the CLI exiting 1 after a successful
    // render. Field signal ts=1784169760 / ts=1784171150 / ts=1784172467.
    process.exitCode = 1;
    runPostRenderStep(
      "printRenderComplete",
      () => {
        throw new Error("stat threw");
      },
      vi.fn(),
    );
    expect(process.exitCode).toBe(0);
  });

  it("does not touch process.exitCode when the step succeeds", () => {
    process.exitCode = 1;
    runPostRenderStep("ok", () => undefined, vi.fn());
    expect(process.exitCode).toBe(1);
  });

  it("does not touch process.exitCode when it was already 0", () => {
    process.exitCode = 0;
    runPostRenderStep(
      "warnIfWebmAlphaDropped",
      () => {
        throw new Error("stat missing");
      },
      vi.fn(),
    );
    expect(process.exitCode).toBe(0);
  });

  it("stringifies a non-Error throw value", () => {
    const sink = vi.fn();
    runPostRenderStep(
      "misc",
      () => {
        throw "just a string";
      },
      sink,
    );
    const msg = sink.mock.calls[0]?.[0] as string;
    expect(msg).toContain("just a string");
  });
});

describe("runPostRenderStepAsync", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    _resetRenderSuccessForTests();
  });

  it("awaits the async step and returns normally on success", async () => {
    const sink = vi.fn();
    const step = vi.fn(() => Promise.resolve());
    await runPostRenderStepAsync("feedback", step, sink);
    expect(step).toHaveBeenCalledTimes(1);
    expect(sink).not.toHaveBeenCalled();
  });

  it("swallows a rejected promise and reports it to the sink", async () => {
    const sink = vi.fn();
    const err = new Error("feedback prompt crashed");
    await runPostRenderStepAsync("maybePromptRenderFeedback", () => Promise.reject(err), sink);
    expect(sink).toHaveBeenCalledTimes(1);
    const msg = sink.mock.calls[0]?.[0] as string;
    expect(msg).toContain("maybePromptRenderFeedback");
    expect(msg).toContain("feedback prompt crashed");
  });

  it("sanitizes process.exitCode back to 0 on async failure", async () => {
    process.exitCode = 1;
    await runPostRenderStepAsync(
      "maybePromptRenderFeedback",
      () => Promise.reject(new Error("stdin closed")),
      vi.fn(),
    );
    expect(process.exitCode).toBe(0);
  });
});
