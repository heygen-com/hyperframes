import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockTelemetry } from "./cliDispatchTestUtils.js";

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = [...originalArgv];
  process.exitCode = originalExitCode;
  for (const path of MOCKED_MODULES) vi.doUnmock(path);
  vi.resetModules();
});

describe("CLI lifecycle", () => {
  it("queues a command failure before exit, without waiting on a network flush", async () => {
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
      // Never settles: a finalize that awaited it would hang this test.
      flush: () => new Promise<void>(() => {}),
      flushSync: () => order.push("flushSync"),
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
    process.emit("exit", 0);

    expect(order).toEqual(["cli_error", "flushSync"]);
  });

  describe("reports each failure once, by its real error", () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });
    const outsideProject = () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-cli-once-"));
      dirs.push(dir);
      return dir;
    };

    it("when the failure reaches the top-level handler", async () => {
      const dir = outsideProject();
      mockInitCommand(async () => {
        const { resolveProject } = await import("./utils/project.js");
        resolveProject(dir);
      });
      const sent = await runCli(["init", "--json"]);

      expect(sent).toEqual([expect.objectContaining({ error_name: "InvalidProjectError" })]);
    });

    it("when the command catches the failure itself", async () => {
      const sent = await runCli(["lint", outsideProject(), "--json"]);

      expect(sent).toEqual([
        expect.objectContaining({ error_name: "InvalidProjectError", command: "lint" }),
      ]);
    });

    it("when the command rethrows the failure as its own", async () => {
      const sent = await runCli([
        "normalize-audio",
        outsideProject(),
        "--reference",
        "a",
        "--target",
        "b",
        "--json",
      ]);

      expect(sent).toEqual([expect.objectContaining({ error_name: "InvalidProjectError" })]);
    });

    it("when a figma command reports its error code", async () => {
      mockInitCommand(async () => {
        const { withFigmaErrors } = await import("./commands/figma/cliError.js");
        const { FigmaClientError } = await import("@hyperframes/core/figma");
        await withFigmaErrors("figma:asset", async () => {
          throw new FigmaClientError("NO_TOKEN", "No Figma token");
        });
      });
      const sent = await runCli(["init", "--json"]);

      expect(sent).toEqual([
        expect.objectContaining({ error_name: "NO_TOKEN", command: "figma:asset" }),
      ]);
    });
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

  it("starts the background checks in a child and reads only the caches itself", async () => {
    const launchBackgroundChecks = vi.fn();
    const checkForUpdate = vi.fn();
    mockInitCommand(vi.fn());
    mockTelemetry();
    vi.doMock("./utils/autoUpdate.js", () => ({
      reportCompletedUpdate: vi.fn(),
      scheduleBackgroundInstall: vi.fn(),
    }));
    vi.doMock("./utils/updateCheck.js", () => ({
      cachedUpdateCheck: () => ({ current: "1.0.0", latest: "1.0.0", updateAvailable: false }),
      checkForUpdate,
      printUpdateNotice: vi.fn(),
      printStalePinNotice: vi.fn(),
    }));
    vi.doMock("./utils/skillsUpdateCheck.js", () => ({ printSkillsUpdateNotice: vi.fn() }));
    vi.doMock("./utils/backgroundChecks.js", () => ({ launchBackgroundChecks }));

    process.argv = ["node", "cli.ts", "init"];
    await import("./cli.js");

    await vi.waitFor(() => expect(launchBackgroundChecks).toHaveBeenCalledTimes(1));
    expect(checkForUpdate).not.toHaveBeenCalled();
  });
});

const MOCKED_MODULES = [
  "./commands/init.js",
  "./telemetry/events.js",
  "./telemetry/index.js",
  "./telemetry/client.js",
  "./utils/autoUpdate.js",
  "./utils/updateCheck.js",
  "./utils/skillsUpdateCheck.js",
  "./utils/backgroundChecks.js",
];

/** Runs the CLI with the real failure reporting and returns the cli_error events it sent. */
async function runCli(args: string[]): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  mockTelemetry();
  vi.doUnmock("./telemetry/events.js");
  vi.doMock("./telemetry/client.js", async () => ({
    ...(await vi.importActual<typeof import("./telemetry/client.js")>("./telemetry/client.js")),
    trackEvent: (event: string, props: Record<string, unknown>) => {
      if (event === "cli_error") sent.push(props);
    },
  }));
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    process.argv = ["node", "cli.ts", ...args];
    await import("./cli.js");
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
  return sent;
}

function mockInitCommand(run: () => void | Promise<void>): void {
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
