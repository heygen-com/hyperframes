import { describe, expect, it, vi } from "vitest";
import {
  installRenderSetupSignalHandlers,
  runRenderSetupStep,
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

describe("render setup worker result", () => {
  function capture() {
    const written = { stdout: "", stderr: "" };
    const output = {
      stdout: { write: (text: string) => (written.stdout += text) },
      stderr: { write: (text: string) => (written.stderr += text) },
    };
    return { written, output };
  }

  it("writes the step's result for the parent to parse", async () => {
    const { written, output } = capture();

    await expect(runRenderSetupStep(async () => ({ source: "cache" }), output)).resolves.toBe(0);

    expect(written.stdout).toBe('HYPERFRAMES_RENDER_SETUP_RESULT:{"source":"cache"}\n');
    expect(written.stderr).toBe("");
  });

  it("fails with only the error's message, which the parent shows as the reason", async () => {
    const { written, output } = capture();
    const failure = new Error("chrome-headless-shell is missing after unzipping", {
      cause: new Error("tar.exe extraction failed"),
    });

    await expect(runRenderSetupStep(() => Promise.reject(failure), output)).resolves.toBe(1);

    expect(written.stderr).toBe("chrome-headless-shell is missing after unzipping\n");
    expect(written.stdout).toBe("");
  });
});
