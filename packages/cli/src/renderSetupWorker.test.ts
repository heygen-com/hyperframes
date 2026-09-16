import { describe, expect, it, vi } from "vitest";
import { installRenderSetupSignalHandlers } from "./renderSetupWorkerLifecycle.js";

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
