// Shared scaffolding for the U5 deprecation tests in inspect.test.ts,
// layout.test.ts, and validate.test.ts: those commands all fail fast (via a
// mocked dynamic import) so the tests can assert the shared deprecation
// envelope (stderr notice, JSON `_meta.deprecated`) without needing a real
// project or headless Chrome.
//
// vi.mock factories are hoisted above imports, so each test file keeps its
// own thin `vi.mock("<path>", () => someFactory())` call (mocking a module
// path can't itself be shared across files) but delegates the factory body
// here.
import type { ArgsDef, CommandDef } from "citty";
import { runCommand } from "citty";
import { expect, vi } from "vitest";
import { CliRuntimeError } from "../utils/commandResult.js";

const FAKE_PROJECT = {
  dir: "/fake-project",
  name: "fake-project",
  indexPath: "/fake-project/index.html",
};

export function resolveProjectMock() {
  return { resolveProject: vi.fn(() => FAKE_PROJECT) };
}

export function bundleToSingleHtmlFailureMock() {
  return {
    bundleToSingleHtml: vi.fn(async () => {
      throw new Error("bundling failed (test double)");
    }),
  };
}

export function lintProjectFailureMock() {
  return {
    lintProject: vi.fn(async () => {
      throw new Error("lint failed (test double)");
    }),
  };
}

/**
 * citty's `meta` is `Resolvable<CommandMeta>` (object | promise | thunk).
 * These test files always define it as a synchronous object literal, so
 * narrow to that shape instead of asserting it with `as`.
 */
export function metaDescription<T extends ArgsDef = ArgsDef>(command: CommandDef<T>): string {
  const meta = command.meta;
  if (meta && typeof meta === "object" && "description" in meta) {
    return String(meta.description ?? "");
  }
  throw new Error("expected a synchronous meta object");
}

async function runExpectedFailure<T extends ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[],
): Promise<void> {
  try {
    await runCommand(command, { rawArgs });
  } catch (error) {
    if (error instanceof CliRuntimeError && error.result.presented) return;
    throw error;
  }
}

/**
 * Run a command with stdout/stderr writes captured (and process.exit /
 * console.log stubbed so the run stays silent and non-terminating), and
 * return the captured text for the caller to assert on.
 */
export async function runAndCaptureStdio<T extends ArgsDef = ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[] = ["--json"],
): Promise<{ stderrText: string; stdoutText: string }> {
  const stderrWrites: string[] = [];
  const stdoutWrites: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrWrites.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdoutWrites.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.spyOn(console, "log").mockImplementation(() => {});

  await runExpectedFailure(command, rawArgs);

  return { stderrText: stderrWrites.join(""), stdoutText: stdoutWrites.join("") };
}

/**
 * Run a command with process.exit stubbed and console.log spied, returning
 * the first console.log call that looks like a JSON object (the `--json`
 * failure envelope). Callers assert on definedness/shape themselves, since
 * that differs slightly per call site.
 */
export async function runAndFindJsonLogCall<T extends ArgsDef = ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[] = ["--json"],
): Promise<unknown[] | undefined> {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await runExpectedFailure(command, rawArgs);

  return logSpy.mock.calls.find(([arg]) => typeof arg === "string" && arg.trim().startsWith("{"));
}

/**
 * Convenience wrapper: parse the JSON envelope found by runAndFindJsonLogCall.
 * `parsed` is intentionally left as JSON.parse's inferred `any` (matching
 * every call site's prior inline `JSON.parse(...)` usage) rather than
 * annotated `unknown`, since callers assert directly into its shape
 * (`.ok`, `._meta.deprecated`) the same way the original inline tests did.
 */
export async function runAndParseJsonEnvelope<T extends ArgsDef = ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[] = ["--json"],
) {
  const jsonCall = await runAndFindJsonLogCall(command, rawArgs);
  expect(jsonCall).toBeDefined();
  const parsed = JSON.parse(String(jsonCall?.[0]));
  return { jsonCall, parsed };
}
