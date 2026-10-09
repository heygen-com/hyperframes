import { describe, expect, it, vi } from "vitest";
import {
  installRenderSetupSignalHandlers,
  renderSetupErrorFrom,
  renderSetupErrorLine,
} from "./renderSetupWorkerLifecycle.js";

describe("render setup worker signal lifecycle", () => {
  function collectHandlers(handleHangup = true) {
    const handlers = new Map<string, () => void>();
    const dispose = installRenderSetupSignalHandlers(
      {
        on: vi.fn((signal, handler) => handlers.set(signal, handler)),
        off: vi.fn((signal) => handlers.delete(signal)),
      },
      vi.fn(),
      vi.fn(),
      handleHangup,
    );
    return { handlers, dispose };
  }

  it("installs the complete interrupt set, including SIGHUP", () => {
    const { handlers, dispose } = collectHandlers();

    expect([...handlers.keys()]).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    dispose();
  });

  it("does not override inherited SIGHUP behavior for detached setup workers", () => {
    const { handlers, dispose } = collectHandlers(false);

    expect([...handlers.keys()]).toEqual(["SIGINT", "SIGTERM"]);
    dispose();
  });

  it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "releases the browser lock before forwarding %s",
    (signal) => {
      const calls: string[] = [];
      const handlers = new Map<string, () => void>();
      installRenderSetupSignalHandlers(
        {
          on: (_signal, handler) => handlers.set(_signal, handler),
          off: (_signal) => {
            calls.push(`off:${_signal}`);
            handlers.delete(_signal);
          },
        },
        () => calls.push("release-lock"),
        (forwardedSignal) => calls.push(`forward:${forwardedSignal}`),
      );

      handlers.get(signal)?.();

      expect(calls.slice(0, 3)).toEqual(["release-lock", `off:${signal}`, `forward:${signal}`]);
    },
  );
});

describe("render setup worker failure line", () => {
  it("carries the whole reason past the crash output around it", () => {
    const reason =
      "Failed to install chrome-headless-shell: missing.\n\n  export HYPERFRAMES_BROWSER_PATH=x";
    const failure = new Error(reason, { cause: new Error("tar.exe extraction failed") });
    const stderr = [
      "warning before",
      renderSetupErrorLine(failure).trimEnd(),
      "/worker.ts:20",
      "    throw error;",
      "Error: Failed to install chrome-headless-shell: missing.",
      "    at downloadBrowser (manager.ts:845:11)",
    ].join("\n");

    expect(renderSetupErrorFrom(stderr)).toBe(reason);
  });

  it("finds no reason in a worker that crashed without one", () => {
    expect(renderSetupErrorFrom("Error: boom\n    at x (y.ts:1:1)")).toBeUndefined();
  });
});
