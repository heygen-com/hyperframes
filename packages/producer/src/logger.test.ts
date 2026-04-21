import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createConsoleLogger, defaultLogger } from "./logger.js";
import type { LogLevel, ProducerLogger } from "./logger.js";

describe("createConsoleLogger", () => {
  // We capture calls to console.{log,warn,error} via `mock` so we can
  // assert what would have been printed without polluting test output.
  let logSpy: ReturnType<typeof mock>;
  let warnSpy: ReturnType<typeof mock>;
  let errorSpy: ReturnType<typeof mock>;
  let origLog: typeof console.log;
  let origWarn: typeof console.warn;
  let origError: typeof console.error;

  beforeEach(() => {
    origLog = console.log;
    origWarn = console.warn;
    origError = console.error;
    logSpy = mock(() => {});
    warnSpy = mock(() => {});
    errorSpy = mock(() => {});
    console.log = logSpy as unknown as typeof console.log;
    console.warn = warnSpy as unknown as typeof console.warn;
    console.error = errorSpy as unknown as typeof console.error;
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  });

  describe("level filtering", () => {
    it("level=info drops debug, keeps info/warn/error", () => {
      const log = createConsoleLogger("info");
      log.debug("debug-msg");
      log.info("info-msg");
      log.warn("warn-msg");
      log.error("error-msg");

      expect(logSpy.mock.calls.length).toBe(1);
      expect(logSpy.mock.calls[0]?.[0]).toBe("[INFO] info-msg");
      expect(warnSpy.mock.calls.length).toBe(1);
      expect(warnSpy.mock.calls[0]?.[0]).toBe("[WARN] warn-msg");
      expect(errorSpy.mock.calls.length).toBe(1);
      expect(errorSpy.mock.calls[0]?.[0]).toBe("[ERROR] error-msg");
    });

    it("level=debug keeps all four levels", () => {
      const log = createConsoleLogger("debug");
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");

      // info + debug both go to console.log
      expect(logSpy.mock.calls.length).toBe(2);
      expect(logSpy.mock.calls[0]?.[0]).toBe("[DEBUG] d");
      expect(logSpy.mock.calls[1]?.[0]).toBe("[INFO] i");
      expect(warnSpy.mock.calls.length).toBe(1);
      expect(errorSpy.mock.calls.length).toBe(1);
    });

    it("level=warn drops info and debug, keeps warn/error", () => {
      const log = createConsoleLogger("warn");
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");

      expect(logSpy.mock.calls.length).toBe(0);
      expect(warnSpy.mock.calls.length).toBe(1);
      expect(errorSpy.mock.calls.length).toBe(1);
    });

    it("level=error drops everything except error", () => {
      const log = createConsoleLogger("error");
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");

      expect(logSpy.mock.calls.length).toBe(0);
      expect(warnSpy.mock.calls.length).toBe(0);
      expect(errorSpy.mock.calls.length).toBe(1);
    });

    it("default level is info", () => {
      const log = createConsoleLogger();
      log.debug("d");
      log.info("i");

      expect(logSpy.mock.calls.length).toBe(1);
      expect(logSpy.mock.calls[0]?.[0]).toBe("[INFO] i");
    });
  });

  describe("meta formatting", () => {
    it("appends JSON-stringified meta when provided", () => {
      const log = createConsoleLogger("info");
      log.info("hello", { a: 1, b: "two" });

      expect(logSpy.mock.calls[0]?.[0]).toBe('[INFO] hello {"a":1,"b":"two"}');
    });

    it("emits message only when meta is omitted", () => {
      const log = createConsoleLogger("info");
      log.info("plain");

      expect(logSpy.mock.calls[0]?.[0]).toBe("[INFO] plain");
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
      expect(logSpy.mock.calls.length).toBe(0);
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
        for (const lvl of enabled) {
          expect(log.isLevelEnabled?.(lvl)).toBe(true);
        }
        for (const lvl of disabled) {
          expect(log.isLevelEnabled?.(lvl)).toBe(false);
        }
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

      for (let i = 0; i < 100; i++) {
        if (log.isLevelEnabled?.("debug") ?? true) {
          log.debug("hot-loop", buildMeta());
        }
      }

      expect(buildCount).toBe(0);
      expect(logSpy.mock.calls.length).toBe(0);
    });

    it("call-site gate runs the meta builder when debug is enabled", () => {
      const log = createConsoleLogger("debug");
      let buildCount = 0;
      const buildMeta = (): Record<string, unknown> => {
        buildCount += 1;
        return { iter: buildCount };
      };

      for (let i = 0; i < 5; i++) {
        if (log.isLevelEnabled?.("debug") ?? true) {
          log.debug("loop", buildMeta());
        }
      }

      expect(buildCount).toBe(5);
      expect(logSpy.mock.calls.length).toBe(5);
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

      for (let i = 0; i < 3; i++) {
        if (customLog.isLevelEnabled?.("debug") ?? true) {
          customLog.debug("evt", buildMeta());
        }
      }

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

      expect(logSpy.mock.calls.length).toBe(1);
      expect(logSpy.mock.calls[0]?.[0]).toBe("[INFO] default-info");
    });

    it("exposes isLevelEnabled gating debug at info threshold", () => {
      expect(defaultLogger.isLevelEnabled?.("info")).toBe(true);
      expect(defaultLogger.isLevelEnabled?.("debug")).toBe(false);
    });
  });
});
