import { describe, expect, it } from "vitest";
import { CliRuntimeError, CliUsageError } from "./commandResult.js";
import { failureMessage, jsonErrorBody, jsonFailure, recordFailure } from "./jsonError.js";

const runtime = { exitCode: 1, kind: "runtime_error" } as const;

describe("jsonFailure", () => {
  it("builds the shared envelope, with a hint only when there is one", () => {
    expect(jsonFailure("refused", "no")).toEqual({
      ok: false,
      error: { code: "refused", message: "no" },
    });
    expect(jsonFailure("refused", "no", "try")).toEqual({
      ok: false,
      error: { code: "refused", message: "no", hint: "try" },
    });
  });
});

describe("failureMessage", () => {
  it("unwraps a presented failure to its cause", () => {
    const failed = new CliRuntimeError("Command failed", {
      presented: true,
      cause: new Error("No composition found in /x"),
    });
    expect(failureMessage(failed)).toBe("No composition found in /x");
  });

  it("falls back to what the command reported", () => {
    recordFailure("Could not fetch render", "No credentials");
    expect(failureMessage(new CliRuntimeError("Command failed", { presented: true }))).toBe(
      "Could not fetch render",
    );
  });
});

describe("jsonErrorBody", () => {
  it("keeps a usage error's own code, message and hint", () => {
    const error = new CliUsageError("Unknown flag: --out", {
      code: "unknown_flag",
      hint: "Did you mean --output?",
    });
    expect(jsonErrorBody(error, { exitCode: 2, kind: "usage_error" }, "noise")).toEqual({
      code: "unknown_flag",
      message: "Unknown flag: --out",
      hint: "Did you mean --output?",
    });
  });

  it("uses the reported failure, with its hint, for a generic presented error", () => {
    recordFailure("No composition found", "Run npx hyperframes init");
    expect(
      jsonErrorBody(new CliRuntimeError("Command failed", { presented: true }), runtime, "x"),
    ).toEqual({
      code: "runtime_error",
      message: "No composition found",
      hint: "Run npx hyperframes init",
    });
  });
});
