import { afterEach, describe, expect, it } from "vitest";
import {
  CliResultSignal,
  CliRuntimeError,
  CliUsageError,
  consumeCommandResult,
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
