import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleLogger, defaultLogger } from "./logger.js";
import type { LogLevel, ProducerLogger } from "./logger.js";

// `isLevelEnabled` is optional on ProducerLogger, so every call site guards
// it with `?.`; pulled out once so the loops below stay single-branch.
function isLevelEnabledSafe(
  log: Pick<ProducerLogger, "isLevelEnabled">,
  level: LogLevel,
): boolean | undefined {
  return log.isLevelEnabled?.(level);
}

// Shared by the isLevelEnabled matrix cases below: assert a threshold's
// enabled levels report true and its disabled levels report false.
function assertLevelEnabledMatrix(
  log: Pick<ProducerLogger, "isLevelEnabled">,
  enabled: ReadonlyArray<LogLevel>,
  disabled: ReadonlyArray<LogLevel>,
): void {
  for (const lvl of enabled) {
    expect(isLevelEnabledSafe(log, lvl)).toBe(true);
  }
  for (const lvl of disabled) {
    expect(isLevelEnabledSafe(log, lvl)).toBe(false);
  }
}

// The `isLevelEnabled?.("debug") ?? true` call-site gate pattern itself,
// isolated so runGatedDebugLoop's own branch count stays at "loop + if".
function isDebugGated(log: Pick<ProducerLogger, "isLevelEnabled">): boolean {
  return log.isLevelEnabled?.("debug") ?? true;
}

// Shared by the call-site gate cases below: run the `isLevelEnabled?.("debug")
// ?? true` pattern callers use to skip expensive meta construction, the
// exact number of times the test needs, so each test asserts only the
// pattern's outcome (buildCount / logged calls) and not the loop mechanics.
function runGatedDebugLoop(
  log: Pick<ProducerLogger, "debug" | "isLevelEnabled">,
  iterations: number,
  buildMeta: () => Record<string, unknown>,
): void {
  for (let i = 0; i < iterations; i++) {
    if (isDebugGated(log)) {
      log.debug("evt", buildMeta());
    }
  }
}

describe("createConsoleLogger", () => {
  // We capture calls to console.{log,warn,error} via `vi.fn` so we can
  // assert what would have been printed without polluting test output.
  let logSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;
  let origLog: typeof console.log;
  let origWarn: typeof console.warn;
  let origError: typeof console.error;

  beforeEach(() => {
    origLog = console.log;
    origWarn = console.warn;
    origError = console.error;
    logSpy = vi.fn();
    warnSpy = vi.fn();
    errorSpy = vi.fn();
    console.log = logSpy as unknown as typeof console.log;
    console.warn = warnSpy as unknown as typeof console.warn;
    console.error = errorSpy as unknown as typeof console.error;
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  });

  // All four levels are stderr-bound (console.error/console.warn); console.log
  // (stdout) must never be touched, since producer runs inside CLI commands
  // whose stdout is a machine-readable contract (e.g. `validate --json`).
  describe("stdout/stderr routing", () => {
    it("info and debug write to console.error (stderr), never console.log (stdout)", () => {
      const log = createConsoleLogger("debug");
      log.info("info-msg");
      log.debug("debug-msg");

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls.map((c) => c[0])).toEqual([
        "[INFO] info-msg",
        "[DEBUG] debug-msg",
      ]);
    });

    it("warn and error keep their pre-existing channels (console.warn / console.error)", () => {
      const log = createConsoleLogger("debug");
      log.warn("warn-msg");
      log.error("error-msg");

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy.mock.calls[0]?.[0]).toBe("[WARN] warn-msg");
      expect(errorSpy.mock.calls[0]?.[0]).toBe("[ERROR] error-msg");
    });

    it("console.log is never called at any level", () => {
      const log = createConsoleLogger("debug");
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");

      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("level filtering", () => {
    it("level=info drops debug, keeps info/warn/error", () => {
      const log = createConsoleLogger("info");
      log.debug("debug-msg");
      log.info("info-msg");
      log.warn("warn-msg");
      log.error("error-msg");

      // info + error both route to console.error now (info: stderr routing, error: always stderr).
      expect(errorSpy.mock.calls.length).toBe(2);
      expect(errorSpy.mock.calls[0]?.[0]).toBe("[INFO] info-msg");
      expect(errorSpy.mock.calls[1]?.[0]).toBe("[ERROR] error-msg");
      expect(warnSpy.mock.calls.length).toBe(1);
      expect(warnSpy.mock.calls[0]?.[0]).toBe("[WARN] warn-msg");
    });

    it("level=debug keeps all four levels", () => {
      const log = createConsoleLogger("debug");
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");

      // debug + info + error all go to console.error
      expect(errorSpy.mock.calls.length).toBe(3);
      expect(errorSpy.mock.calls[0]?.[0]).toBe("[DEBUG] d");
      expect(errorSpy.mock.calls[1]?.[0]).toBe("[INFO] i");
      expect(errorSpy.mock.calls[2]?.[0]).toBe("[ERROR] e");
      expect(warnSpy.mock.calls.length).toBe(1);
    });

    it("level=warn drops info and debug, keeps warn/error", () => {
      const log = createConsoleLogger("warn");
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");

      expect(errorSpy.mock.calls.length).toBe(1);
      expect(errorSpy.mock.calls[0]?.[0]).toBe("[ERROR] e");
      expect(warnSpy.mock.calls.length).toBe(1);
    });

    it("level=error drops everything except error", () => {
      const log = createConsoleLogger("error");
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");

      expect(warnSpy.mock.calls.length).toBe(0);
      expect(errorSpy.mock.calls.length).toBe(1);
    });

    it("default level is info", () => {
      const log = createConsoleLogger();
      log.debug("d");
      log.info("i");

      expect(errorSpy.mock.calls.length).toBe(1);
      expect(errorSpy.mock.calls[0]?.[0]).toBe("[INFO] i");
    });
  });

  describe("meta formatting", () => {
    it("appends JSON-stringified meta when provided", () => {
      const log = createConsoleLogger("info");
      log.info("hello", { a: 1, b: "two" });

      expect(errorSpy.mock.calls[0]?.[0]).toBe('[INFO] hello {"a":1,"b":"two"}');
    });

    it("emits message only when meta is omitted", () => {
      const log = createConsoleLogger("info");
      log.info("plain");

      expect(errorSpy.mock.calls[0]?.[0]).toBe("[INFO] plain");
    });

    it("does not invoke JSON.stringify when level is filtered out", () => {
      const log = createConsoleLogger("info");
      // A getter that throws would be invoked by JSON.stringify if the
      // logger built the meta string before the level check. We rely on
      // the call-site `isLevelEnabled` gate plus the internal `shouldLog`
      // short-circuit to prevent that.
      const trap = {
        get problem() {
          throw new Error("meta should not be stringified when level is filtered");
        },
      };
      // Should not throw — debug is below the info threshold.
      log.debug("trap", trap as unknown as Record<string, unknown>);
      expect(errorSpy.mock.calls.length).toBe(0);
    });
  });

  describe("isLevelEnabled", () => {
    const cases: ReadonlyArray<{
      threshold: LogLevel;
      enabled: ReadonlyArray<LogLevel>;
      disabled: ReadonlyArray<LogLevel>;
    }> = [
      {
        threshold: "error",
        enabled: ["error"],
        disabled: ["warn", "info", "debug"],
      },
      {
        threshold: "warn",
        enabled: ["error", "warn"],
        disabled: ["info", "debug"],
      },
      {
        threshold: "info",
        enabled: ["error", "warn", "info"],
        disabled: ["debug"],
      },
      {
        threshold: "debug",
        enabled: ["error", "warn", "info", "debug"],
        disabled: [],
      },
    ];

    for (const { threshold, enabled, disabled } of cases) {
      it(`level=${threshold} reports enabled levels correctly`, () => {
        const log = createConsoleLogger(threshold);
        assertLevelEnabledMatrix(log, enabled, disabled);
      });
    }

    it("call-site gate using `?? true` short-circuits expensive meta build at info level", () => {
      // Mirrors the hot-path pattern used in renderOrchestrator: callers
      // wrap meta construction in `if (log.isLevelEnabled?.('debug') ?? true)`
      // so production (level=info) skips the work entirely.
      const log = createConsoleLogger("info");
      let buildCount = 0;
      const buildMeta = (): Record<string, unknown> => {
        buildCount += 1;
        return { expensive: true };
      };

      runGatedDebugLoop(log, 100, buildMeta);

      expect(buildCount).toBe(0);
      expect(errorSpy.mock.calls.length).toBe(0);
    });

    it("call-site gate runs the meta builder when debug is enabled", () => {
      const log = createConsoleLogger("debug");
      let buildCount = 0;
      const buildMeta = (): Record<string, unknown> => {
        buildCount += 1;
        return { iter: buildCount };
      };

      runGatedDebugLoop(log, 5, buildMeta);

      expect(buildCount).toBe(5);
      expect(errorSpy.mock.calls.length).toBe(5);
    });

    it("custom logger without isLevelEnabled falls back to running the meta builder (`?? true`)", () => {
      // A user-provided logger that doesn't implement isLevelEnabled — the
      // call-site fallback must preserve the prior behavior of always
      // building meta (so we don't silently drop diagnostics for them).
      const calls: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
      const customLog: ProducerLogger = {
        error: (msg, meta) => calls.push({ msg, meta }),
        warn: (msg, meta) => calls.push({ msg, meta }),
        info: (msg, meta) => calls.push({ msg, meta }),
        debug: (msg, meta) => calls.push({ msg, meta }),
      };

      let buildCount = 0;
      const buildMeta = (): Record<string, unknown> => {
        buildCount += 1;
        return { i: buildCount };
      };

      runGatedDebugLoop(customLog, 3, buildMeta);

      expect(buildCount).toBe(3);
      expect(calls).toHaveLength(3);
      expect(calls[0]?.msg).toBe("evt");
      expect(calls[0]?.meta).toEqual({ i: 1 });
    });
  });

  describe("defaultLogger", () => {
    it("is a singleton at level=info", () => {
      defaultLogger.info("default-info");
      defaultLogger.debug("default-debug");

      expect(errorSpy.mock.calls.length).toBe(1);
      expect(errorSpy.mock.calls[0]?.[0]).toBe("[INFO] default-info");
    });

    it("exposes isLevelEnabled gating debug at info threshold", () => {
      expect(defaultLogger.isLevelEnabled?.("info")).toBe(true);
      expect(defaultLogger.isLevelEnabled?.("debug")).toBe(false);
    });
  });
});
