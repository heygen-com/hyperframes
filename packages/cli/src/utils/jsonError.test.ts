import { describe, expect, it, vi } from "vitest";
import { CliRuntimeError, CliUsageError } from "./commandResult.js";
import {
  failCaught,
  failureMessage,
  jsonErrorBody,
  jsonFailure,
  recordFailure,
} from "./jsonError.js";

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

  it("keeps a runtime error's own code next to the failure the command reported", () => {
    recordFailure("FFmpeg not found", "Configured path does not exist");
    const error = new CliRuntimeError("Command failed", {
      presented: true,
      code: "ffmpeg_not_found",
    });
    expect(jsonErrorBody(error, runtime, "x")).toEqual({
      code: "ffmpeg_not_found",
      message: "FFmpeg not found",
      hint: "Configured path does not exist",
    });
  });

  it("keeps a runtime error's own code when the message comes from its cause", () => {
    const error = new CliRuntimeError("Command failed", {
      presented: true,
      cause: new Error("Another render is running (pid 7)"),
      code: "render_locked",
    });
    expect(jsonErrorBody(error, runtime, "x")).toEqual({
      code: "render_locked",
      message: "Another render is running (pid 7)",
    });
  });
});

describe("failCaught", () => {
  const controls = "\x1b[2J\x1b]0;title\x07 \u009b31m \x7f \r";
  const shown = "\\x1b[2J\\x1b]0;title\\x07 \\x9b31m \\x7f \\x0d";
  const caught = (run: () => never): unknown => {
    try {
      run();
    } catch (error) {
      return error;
    }
  };

  it("prints control characters in the message as text and keeps the formatter's own colour", () => {
    const written: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((text: string) => {
      written.push(text);
    });
    try {
      const error = caught(() =>
        failCaught(
          new Error(`Composition file "${controls}" is too large\nsecond line`),
          false,
          (message) => `\x1b[31m✗\x1b[39m Compare failed: ${message}`,
        ),
      );
      expect(error).toBeInstanceOf(CliRuntimeError);
    } finally {
      spy.mockRestore();
    }
    expect(written).toEqual([
      `\x1b[31m✗\x1b[39m Compare failed: Composition file "${shown}" is too large\nsecond line`,
    ]);
  });

  it("leaves the --json envelope's message as the error wrote it", () => {
    const printed: object[] = [];
    caught(() =>
      failCaught(
        new Error(`file "${controls}"`),
        true,
        (m) => m,
        (payload) => printed.push(payload),
      ),
    );
    expect(printed).toEqual([
      { ok: false, error: { code: "runtime_error", message: `file "${controls}"` } },
    ]);
  });
});

describe("printFailureLine", () => {
  // fails without the fix: a --json run's error message was built from the line as people see it.
  it("shows control characters as text and leaves the text as given for a --json envelope", async () => {
    const saved = {
      out: process.stdout.write,
      err: process.stderr.write,
      console: { ...console },
    };
    const shown: string[] = [];
    console.error = (...args: unknown[]) => void shown.push(args.map(String).join(" "));
    try {
      const { printFailureLine, watchOutput } = await import("./jsonError.js");
      const output = watchOutput();
      printFailureLine((show) => `File not found: ${show("mis\u0007s\ning.wav  ")}`);
      expect(shown).toEqual(["File not found: mis\\x07s\ning.wav  "]);
      expect(output.stderrText()).toBe("File not found: mis\\x07s ing.wav");
      const failed = new CliRuntimeError("Command failed", { presented: true });
      expect(jsonErrorBody(failed, runtime, output.stderrText()).message).toBe(
        "File not found: mis\u0007s\ning.wav  ",
      );
    } finally {
      process.stdout.write = saved.out;
      process.stderr.write = saved.err;
      Object.assign(console, saved.console);
    }
  });
});
