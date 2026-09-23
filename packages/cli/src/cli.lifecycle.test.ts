import { afterEach, describe, expect, it, vi } from "vitest";
import { mockTelemetry } from "./cliDispatchTestUtils.js";

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = [...originalArgv];
  process.exitCode = originalExitCode;
  vi.doUnmock("./commands/init.js");
  vi.doUnmock("./telemetry/events.js");
  vi.doUnmock("./telemetry/index.js");
  vi.resetModules();
});

describe("CLI lifecycle", () => {
  it("finalizes without waiting on a slow network flush, and the exit handler still delivers the queued event", async () => {
    const flushSync = vi.fn();
    mockInitCommand(vi.fn());
    vi.doMock("./telemetry/index.js", () => ({
      // Never resolves — stands in for a slow/stalled network POST. Old
      // code awaited this and would hang finalizeCli until it settled.
      flush: () => new Promise<void>(() => {}),
      flushSync,
      incrementCommandCount: vi.fn(),
      showTelemetryNotice: vi.fn(),
      shouldTrack: () => false,
      trackCliError: vi.fn(),
      trackCommand: vi.fn(),
      trackCommandResult: vi.fn(),
    }));
    vi.doMock("./telemetry/events.js", () => ({ trackCommandFailure: vi.fn() }));

    process.argv = ["node", "cli.ts", "init", "--json"];
    // Hangs (test-timeout failure) on old code, which awaits flush() before
    // finalizeCli can return; resolves promptly on new code, which doesn't.
    await import("./cli.js");

    // finalizeCli already ran without the network flush ever settling; the
    // exit handler's flushSync() is what still hands the queue off.
    process.emit("exit", 0);
    expect(flushSync).toHaveBeenCalled();
  });

  it("hands queued events to flushSync even after finalizeCli has run", async () => {
    const flushSync = vi.fn();
    const trackCommandResult = vi.fn();
    mockInitCommand(vi.fn());
    mockTelemetry({ flushSync, trackCommandResult });

    process.argv = ["node", "cli.ts", "init", "--json"];
    await import("./cli.js");
    // Command finished → finalizeCli ran and tracked the result once.
    expect(trackCommandResult).toHaveBeenCalledTimes(1);

    // The process.exit() that follows fires the 'exit' handler. It must not
    // double-track, but it MUST still hand the queue to flushSync — this is
    // the fallback that re-delivers a render_complete whose eager flush()
    // was killed by an EPIPE process.exit(0) racing finalizeCli. Gating it
    // behind `finalized` was the 0.7.65 render_complete regression.
    process.emit("exit", 0);
    expect(trackCommandResult).toHaveBeenCalledTimes(1);
    expect(flushSync).toHaveBeenCalled();
  });

  it("keeps an EPIPE after a validated render scored as success", async () => {
    const trackCommandResult = vi.fn();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      mockInitCommand(() => emitStreamEpipe());
      mockTelemetry({ trackCommandResult });

      const successState = await import("./utils/render-success-state.js");
      successState.markRenderSucceeded();
      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      // The pipe closing after the artifact was validated is a normal agent
      // teardown: exit 0, and the run must NOT be scored as a failure.
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(trackCommandResult).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      successState._resetRenderSuccessForTests();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("does not let pre-artifact noise doom a run whose render later validates", async () => {
    const trackCommandResult = vi.fn();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const successState = await import("./utils/render-success-state.js");
      // Noise arrives BEFORE the artifact is validated (mid-render EPIPE /
      // stray rejection shape), then the render completes and validates.
      mockInitCommand(() => {
        emitStreamEpipe();
        successState.markRenderSucceeded();
      });
      mockTelemetry({ trackCommandResult });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      expect(trackCommandResult).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      successState._resetRenderSuccessForTests();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("does not let a pre-validation unhandledRejection doom a validated render", async () => {
    // The production-reachable producer of the stale-failure override: the
    // unhandledRejection handler deliberately does NOT exit, so a stray
    // rejection mid-render sets commandFailed (and exitCode 1), the render
    // then completes and validates, and finalizeCli writes exit code 0.
    const trackCommandResult = vi.fn();
    // Detach the test runner's own unhandledRejection listeners so the
    // synthetic emit reaches only the CLI's handler, then restore them.
    const priorListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    try {
      const successState = await import("./utils/render-success-state.js");
      mockInitCommand(() => {
        process.emit("unhandledRejection", new Error("stray teardown noise"), Promise.resolve());
        successState.markRenderSucceeded();
      });
      mockTelemetry({ trackCommandResult });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      expect(trackCommandResult).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, exitCode: 0 }),
      );
      successState._resetRenderSuccessForTests();
    } finally {
      process.removeAllListeners("unhandledRejection");
      for (const listener of priorListeners) process.on("unhandledRejection", listener);
    }
  });

  it("does not let a post-validation throw doom a render whose artifact is on disk", async () => {
    // The gap the field reports land in: a teardown step throws AFTER the
    // artifact validated, the command wrapper catches it, and the result
    // carries exitCode 1. The uncaughtException / unhandledRejection handlers
    // both consult isRenderSucceeded(), but a caught throw never reaches them,
    // so nothing sanitized the code and a valid MP4 was reported as a failure.
    const trackCommandResult = vi.fn();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const successState = await import("./utils/render-success-state.js");
      mockInitCommand(() => {
        successState.markRenderSucceeded();
        throw new Error("post-render teardown blew up");
      });
      mockTelemetry({ trackCommandResult });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      expect(process.exitCode).toBe(0);
      expect(trackCommandResult).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, exitCode: 0 }),
      );
      successState._resetRenderSuccessForTests();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("still exits non-zero when a command throws and no render ever validated", async () => {
    // The guard on the sanitizer above: it must key off a validated artifact,
    // not merely off the command having finished. Without this, every caught
    // throw would silently become exit 0.
    const trackCommandResult = vi.fn();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      mockInitCommand(() => {
        throw new Error("genuine failure");
      });
      mockTelemetry({ trackCommandResult });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      expect(process.exitCode).not.toBe(0);
      expect(trackCommandResult).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("still scores an EPIPE before the artifact is validated as a failure", async () => {
    const trackCommandResult = vi.fn();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      mockInitCommand(() => emitStreamEpipe());
      mockTelemetry({ trackCommandResult });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(trackCommandResult).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    } finally {
      exitSpy.mockRestore();
    }
  });
});

function mockInitCommand(run: () => void): void {
  vi.doMock("./commands/init.js", () => ({
    default: {
      meta: { name: "init" },
      args: { json: { type: "boolean" } },
      run,
    },
  }));
}

function emitStreamEpipe(): void {
  process.stdout.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
}
