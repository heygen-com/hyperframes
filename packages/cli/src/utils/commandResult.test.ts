import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CliResultSignal,
  CliRuntimeError,
  CliUsageError,
  consumeCommandResult,
  drainToExit,
  endProcess,
  failCommand,
  failUsage,
  finishCommand,
  requestCliExit,
  setCommandResult,
} from "./commandResult.js";

afterEach(() => {
  consumeCommandResult();
});

describe("command result contract", () => {
  it("keeps a failure from being overwritten by a later success", () => {
    setCommandResult({ exitCode: 1, kind: "runtime_error", presented: true });
    setCommandResult({ exitCode: 0, kind: "success" });
    expect(consumeCommandResult().exitCode).toBe(1);
  });

  it("represents fatal and early-success control flow without process.exit", () => {
    expect(() => failCommand(2)).toThrow(CliRuntimeError);
    expect(() => failUsage(2)).toThrow(CliUsageError);
    expect(() => finishCommand()).toThrow(CliResultSignal);
  });

  it("records a requested exit when no root handler is registered", () => {
    requestCliExit(1);
    expect(consumeCommandResult()).toMatchObject({ exitCode: 1, kind: "runtime_error" });
  });
});

describe("ending the process", () => {
  const host = () => {
    const pending: (() => void)[] = [];
    const calls = { exit: vi.fn(), setExitCode: vi.fn() };
    const later = ((run: () => void) => {
      pending.push(run);
      return { unref: () => undefined };
    }) as unknown as typeof setTimeout;
    return { pending, calls, ...calls, later };
  };

  it("exits at once when nothing native needs tearing down", async () => {
    vi.resetModules();
    const fresh = await import("./commandResult.js");
    const ending = host();

    fresh.endProcess(143, ending);

    expect(ending.exit).toHaveBeenCalledWith(143);
    expect(ending.pending).toHaveLength(0);
  });

  it("after CoreML ran, leaves the exit to Node's own teardown and forces it only after a grace", () => {
    const ending = host();
    drainToExit();

    endProcess(143, ending);

    expect(ending.exit).not.toHaveBeenCalled();
    expect(ending.setExitCode).toHaveBeenCalledWith(143);
    expect(ending.pending).toHaveLength(1);
    ending.pending[0]!();
    expect(ending.exit).toHaveBeenCalledWith(143);
  });
});
