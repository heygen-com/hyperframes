import { afterEach, describe, expect, it, vi } from "vitest";

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
  it("queues a command failure before finalizing telemetry", async () => {
    let resolveEvents!: (events: {
      trackCommandFailure: (command: string, error: unknown) => void;
    }) => void;
    const eventsModule = new Promise<{
      trackCommandFailure: (command: string, error: unknown) => void;
    }>((resolve) => {
      resolveEvents = resolve;
    });
    let markEventsImportStarted!: () => void;
    const eventsImportStarted = new Promise<void>((resolve) => {
      markEventsImportStarted = resolve;
    });
    const order: string[] = [];

    vi.doMock("./commands/init.js", () => ({
      default: {
        meta: { name: "init" },
        args: { json: { type: "boolean" } },
        run: vi.fn(),
      },
    }));
    vi.doMock("./telemetry/index.js", () => ({
      flush: async () => {
        order.push("flush");
      },
      flushSync: vi.fn(),
      incrementCommandCount: vi.fn(),
      showTelemetryNotice: vi.fn(),
      shouldTrack: () => false,
      trackCliError: vi.fn(),
      trackCommand: vi.fn(),
      trackCommandResult: vi.fn(),
    }));
    vi.doMock("./telemetry/events.js", async () => {
      markEventsImportStarted();
      return eventsModule;
    });

    process.argv = ["node", "cli.ts", "init", "--bogus", "--json"];
    const execution = import("./cli.js");

    await eventsImportStarted;
    expect(order).toEqual([]);

    resolveEvents({
      trackCommandFailure: () => {
        order.push("cli_error");
      },
    });
    await execution;

    expect(order).toEqual(["cli_error", "flush"]);
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

function mockTelemetry(overrides: {
  flushSync?: ReturnType<typeof vi.fn>;
  trackCommandResult?: ReturnType<typeof vi.fn>;
}): void {
  vi.doMock("./telemetry/index.js", () => ({
    flush: vi.fn(async () => {}),
    flushSync: overrides.flushSync ?? vi.fn(),
    incrementCommandCount: vi.fn(),
    showTelemetryNotice: vi.fn(),
    shouldTrack: () => false,
    trackCliError: vi.fn(),
    trackCommand: vi.fn(),
    trackCommandResult: overrides.trackCommandResult ?? vi.fn(),
  }));
}

function emitStreamEpipe(): void {
  process.stdout.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
}
