import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mockTelemetry } from "./cliDispatchTestUtils.js";

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;

// The first import of the CLI's module graph is slow on a cold Windows runner; pay it here, not in a test.
beforeAll(async () => {
  await Promise.all([
    import("citty"),
    import("@hyperframes/core/figma"),
    import("./telemetry/client.js"),
    import("./utils/command-failure-tracking.js"),
    import("./utils/project.js"),
    import("./utils/render-success-state.js"),
  ]);
}, 120_000);

afterEach(async () => {
  process.argv = [...originalArgv];
  process.exitCode = originalExitCode;
  // The CLI starts background imports it never awaits; one still loading when the registry resets
  // splits a module in two, and the next test's error class no longer matches its own.
  await vi.dynamicImportSettled();
  for (const path of MOCKED_MODULES) vi.doUnmock(path);
  vi.resetModules();
});

const PLAIN = "(no --json)";

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

  it("runs `open` for a bare project folder, and keeps `render` a command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-cli-shortcut-"));
    const run = vi.fn();
    try {
      for (const [name, argv] of [
        ["open", [dir]],
        ["open", ["--verbose", dir]],
        ["render", ["render"]],
      ] as const) {
        vi.doMock(`./commands/${name}.js`, () => ({
          default: { meta: { name }, args: { dir: { type: "positional", required: false } }, run },
        }));
        mockTelemetry();
        process.argv = ["node", "cli.ts", ...argv];
        await import("./cli.js");
        await vi.dynamicImportSettled();
        vi.doUnmock(`./commands/${name}.js`);
        vi.resetModules();
      }
      expect(run.mock.calls.map(([ctx]) => ctx.rawArgs)).toEqual([[dir], [dir], []]);
      expect(process.argv.slice(2)).toEqual(["render"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("keeps exit 0 when a late rejection follows a command that already delivered", async () => {
    // check and snapshot close Chrome after printing; on Windows that teardown can reject.
    const trackCommandResult = vi.fn();
    const priorListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    try {
      mockInitCommand(() => {});
      mockTelemetry({ trackCommandResult });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");
      expect(process.exitCode).toBe(0);

      process.emit("unhandledRejection", new Error("late browser teardown"), Promise.resolve());

      expect(process.exitCode).toBe(0);
      expect(trackCommandResult).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, exitCode: 0 }),
      );
    } finally {
      process.removeAllListeners("unhandledRejection");
      for (const listener of priorListeners) process.on("unhandledRejection", listener);
    }
  });

  // fails without the fix: a program driving the CLI read exit 1 with no words, so its reports named a routine line
  // ("Browser: env") as the cause.
  it("says what crashed before the command delivered, then exits 1", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const priorListeners = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    try {
      mockInitCommand(() => {
        process.emit("uncaughtException", new Error("EBADF: bad file descriptor, read"));
      });
      mockTelemetry({ trackCommandResult: vi.fn() });
      process.argv = ["node", "cli.ts", "init"];
      await import("./cli.js");
      expect(saidOnStderr(said)).toContain("Error: EBADF: bad file descriptor, read");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      process.removeAllListeners("uncaughtException");
      for (const listener of priorListeners) process.on("uncaughtException", listener);
      said.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("says what an unhandled rejection was before the command delivered", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const priorListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    try {
      mockInitCommand(() => {
        process.emit(
          "unhandledRejection",
          new Error("browser process would not stop"),
          Promise.resolve(),
        );
      });
      mockTelemetry({ trackCommandResult: vi.fn() });
      process.argv = ["node", "cli.ts", "init"];
      await import("./cli.js");
      expect(saidOnStderr(said)).toContain("Error: browser process would not stop");
    } finally {
      process.removeAllListeners("unhandledRejection");
      for (const listener of priorListeners) process.on("unhandledRejection", listener);
      said.mockRestore();
    }
  });

  it("a render ending non-zero with no failure shown says so, and reports where the failure was set", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const trackCliError = vi.fn();
    try {
      mockRenderCommand(async () => {
        const { setCommandExitCode } = await import("./utils/commandResult.js");
        setCommandExitCode(1);
      });
      mockTelemetry({ trackCommandResult: vi.fn(), trackCliError });
      process.argv = ["node", "cli.ts", "render"];
      await import("./cli.js");
      expect(saidOnStderr(said)).toContain("The command ended with code 1 without saying why");
      expect(trackCliError).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "silent_exit",
          stack_trace: expect.stringContaining("cli.lifecycle.test.ts"),
        }),
      );
    } finally {
      said.mockRestore();
    }
  });

  it("a command that answers with a non-zero code is not called silent", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const trackCliError = vi.fn();
    try {
      mockInitCommand(async () => {
        const { setCommandExitCode } = await import("./utils/commandResult.js");
        setCommandExitCode(1);
      });
      mockTelemetry({ trackCommandResult: vi.fn(), trackCliError });
      process.argv = ["node", "cli.ts", "init"];
      await import("./cli.js");
      expect(saidOnStderr(said)).not.toContain("without saying why");
      expect(trackCliError).not.toHaveBeenCalled();
    } finally {
      said.mockRestore();
    }
  });

  it("exits 0 when a late uncaught exception follows a command that already delivered", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const priorListeners = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    try {
      mockInitCommand(() => {});
      mockTelemetry({ trackCommandResult: vi.fn() });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");
      exitSpy.mockClear();

      process.emit("uncaughtException", new Error("late child teardown"));

      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      process.removeAllListeners("uncaughtException");
      for (const listener of priorListeners) process.on("uncaughtException", listener);
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

  it("prints a thrown error's control characters as visible escapes and keeps its lines", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockInitCommand(() => {
        throw new Error("Install failed: a\u001b]52;c;eA==\u0007\n  b\u009b");
      });
      mockTelemetry();

      process.argv = ["node", "cli.ts", "init"];
      await import("./cli.js");

      const said = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(said).toContain("Install failed: a\\x1b]52;c;eA==\\x07\n  b\\x9b");
      for (const control of ["\u001b]", "\u0007", "\u009b"]) expect(said).not.toContain(control);
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  // fails without the fix: the envelope's message was the line as people see it, escapes included.
  it("answers a --json run for a missing file with the file's name as given", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let answered = "";
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      answered += String(chunk);
      return true;
    }) as never);
    const missing = join(tmpdir(), "hf-mis\u0007sing.wav");
    try {
      mockTelemetry();
      process.argv = ["node", "cli.ts", "transcribe", missing, "--json"];
      await import("./cli.js");

      const said = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(said).toContain("hf-mis\\x07sing.wav");
      expect(said).not.toContain("\u0007");
      const body = JSON.parse(answered.trim().split("\n").at(-1) ?? "") as {
        ok: boolean;
        error: { message: string };
      };
      expect(body.ok).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(body.error.message).toBe(`File not found: ${missing}`);
      expect(body.error.message).not.toContain("\\x07");
    } finally {
      outSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  // fails without the fix: the envelope's message was the line as people see it, escapes included.
  it.each([
    [
      "a capture URL that does not parse",
      ["capture", "ht tp\u0007"],
      "Invalid URL: ht tp\u0007",
      2,
    ],
    [
      "a capture --video folder with no manifest",
      ["capture", "--video", join(tmpdir(), "hf-no\u0007ne")],
      `no video-manifest.json at ${join(tmpdir(), "hf-no\u0007ne", "extracted")}`,
      1,
    ],
    [
      "a refused remove-background device",
      ["remove-background", "in.mp4", "-o", "out.webm", "--device", "g\u0007pu"],
      "Invalid --device 'g\u0007pu'.",
      2,
    ],
    [
      "a refused remove-background quality",
      ["remove-background", "in.mp4", "-o", "out.webm", "--quality", "be\u0007st"],
      "Invalid --quality 'be\u0007st'.",
      2,
    ],
    // The rows below run without --json: with it these commands refuse or answer in their own JSON.
    ["an unknown docs topic", [PLAIN, "docs", "to\u0007pic"], "Unknown topic: to\u0007pic", 2],
    [
      "an unknown telemetry subcommand",
      [PLAIN, "telemetry", "fo\u0007o"],
      "Unknown subcommand: fo\u0007o",
      2,
    ],
    [
      "a telemetry preference that cannot be saved",
      [PLAIN, "telemetry", "disable"],
      "Reason: EACCES /ho\u0007me",
      1,
      () =>
        vi.doMock("./telemetry/config.js", async () => ({
          ...(await vi.importActual<typeof import("./telemetry/config.js")>(
            "./telemetry/config.js",
          )),
          readConfigFresh: () => ({}),
          writeConfigWithResult: () => ({ ok: false, error: "EACCES /ho\u0007me" }),
        })),
    ],
    [
      "a catalog query with no searchable words",
      [PLAIN, "catalog", "--query", "!!\u0007"],
      'No searchable words in query "!!\u0007".',
      1,
      () => mockCatalogRegistry(),
    ],
    [
      "a catalog whose registry cannot be read",
      ["catalog"],
      "The registry could not be read: no route to ho\u0007st",
      1,
      () => mockCatalogRegistry("The registry could not be read: no route to ho\u0007st"),
    ],
    [
      "speech that cannot be generated",
      [PLAIN, "tts", "hello", "--voice", "af_\u0007x"],
      "no model at /mo\u0007dels",
      1,
      () =>
        vi.doMock("./tts/synthesize.js", () => ({
          synthesize: async () => {
            throw new Error("no model at /mo\u0007dels");
          },
        })),
    ],
  ] as [string, string[], string, number, (() => void)?][])(
    "shows %s as text, and answers a --json run with the value as given",
    async (_name, argv, given, exit, mock) => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let answered = "";
      const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
        answered += String(chunk);
        return true;
      }) as never);
      // A spinner's lines go straight to the stream when nobody is watching.
      let written = "";
      const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
        written += String(chunk);
        return true;
      }) as never);
      try {
        mockTelemetry();
        mock?.();
        const plain = argv[0] === PLAIN;
        process.argv = ["node", "cli.ts", ...(plain ? argv.slice(1) : [...argv, "--json"])];
        await import("./cli.js");

        const said =
          errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n") + written;
        expect(said).toContain(given.replace("\u0007", "\\x07"));
        expect(said).not.toContain("\u0007");
        expect(process.exitCode).toBe(exit);
        if (plain) return;
        const body = JSON.parse(answered.trim().split("\n").at(-1) ?? "") as {
          ok: boolean;
          error: { message: string };
        };
        expect(body.ok).toBe(false);
        expect(body.error.message).toContain(given);
        expect(body.error.message).not.toContain("\\x07");
      } finally {
        errSpy.mockRestore();
        outSpy.mockRestore();
        errorSpy.mockRestore();
        exitSpy.mockRestore();
      }
    },
  );

  it("exits 1 and scores a failure when the pipe closes before the run delivered", async () => {
    const trackCommandResult = vi.fn();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      mockInitCommand(() => emitStreamEpipe());
      mockTelemetry({ trackCommandResult });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      // `hyperframes render … | head -1` on a refused render exited 0 (CLI 0.9.11)
      expect(exitSpy).toHaveBeenCalledWith(1);
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

describe("stale-skills notice under --json", () => {
  it("suppresses unrelated notices on a --json run", async () => {
    const printSkillsUpdateNotice = vi.fn();
    const printUpdateNotice = vi.fn();
    mockInitCommand(vi.fn());
    mockTelemetry();
    vi.doMock("./utils/autoUpdate.js", () => ({
      reportCompletedUpdate: vi.fn(),
      scheduleBackgroundInstall: vi.fn(),
    }));
    vi.doMock("./utils/updateCheck.js", () => ({
      cachedUpdateCheck: () => ({ current: "1.0.0", latest: "1.0.0", updateAvailable: false }),
      printUpdateNotice,
      printStalePinNotice: vi.fn(),
    }));
    vi.doMock("./utils/skillsUpdateCheck.js", () => ({ printSkillsUpdateNotice }));
    vi.doMock("./utils/backgroundChecks.js", () => ({ launchBackgroundChecks: vi.fn() }));

    process.argv = ["node", "cli.ts", "init", "--json"];
    await import("./cli.js");

    expect(printSkillsUpdateNotice).not.toHaveBeenCalled();
    expect(printUpdateNotice).not.toHaveBeenCalled();
  });
});

const MOCKED_MODULES = [
  "./telemetry/config.js",
  "./tts/synthesize.js",
  "./registry/remote.js",
  "./registry/resolver.js",
  "./registry/localModel.js",
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

/** A one-item registry searched by words, or one that cannot be read for the given reason. */
function mockCatalogRegistry(unreadable?: string): void {
  vi.doMock("./registry/remote.js", async () => ({
    ...(await vi.importActual<typeof import("./registry/remote.js")>("./registry/remote.js")),
    readRegistryManifest: async () => {
      if (unreadable) throw new Error(unreadable);
      return { items: [{ name: "fade", type: "hyperframes:block" }] };
    },
  }));
  vi.doMock("./registry/resolver.js", () => ({
    loadAllItems: async () => [
      { name: "fade", type: "hyperframes:block", title: "Fade", description: "A fade", tags: [] },
    ],
  }));
  vi.doMock("./registry/localModel.js", async () => ({
    ...(await vi.importActual<typeof import("./registry/localModel.js")>(
      "./registry/localModel.js",
    )),
    localModelStatus: () => ({ status: "declined" }),
  }));
}

function mockRenderCommand(run: () => void | Promise<void>): void {
  vi.doMock("./commands/render.js", () => ({
    default: { meta: { name: "render" }, args: {}, run },
  }));
}

/** Everything the run wrote through console.error, colors and all, as one text. */
function saidOnStderr(said: ReturnType<typeof vi.spyOn>): string {
  return said.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
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
