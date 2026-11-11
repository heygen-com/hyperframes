// fallow-ignore-file code-duplication
// Regression: `lint --json` used process.exit() right after console.log(JSON).
// process.exit() terminates before Node flushes an async (non-TTY / piped)
// stdout, so piping `hyperframes lint --json` on Windows silently lost the whole
// payload. The fix sets process.exitCode + returns so stdout drains first. These
// tests lock that in: run() must NEVER call process.exit(), and must set the
// right exitCode, for the success, error-findings, and thrown-error paths.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const lintProjectMock = vi.fn();

vi.mock("../utils/project.js", () => ({
  resolveLintTarget: (dir?: string) => ({ project: { dir: dir ?? "/proj", name: "proj" } }),
}));
vi.mock("../utils/lintProject.js", () => ({
  lintProject: (...args: unknown[]) => lintProjectMock(...args),
}));
// withMeta just annotates the object; identity keeps the assertions simple.
vi.mock("../utils/updateCheck.js", () => ({ withMeta: (o: unknown) => o }));

import lintCommand from "./lint.js";

function run(args: Record<string, unknown>): Promise<unknown> {
  // citty's CommandDef.run receives a context whose `args` we control.
  return (lintCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>)({
    args,
  });
}

describe("lint command exit handling", () => {
  beforeEach(() => {
    consumeCommandResult();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // If run() ever calls process.exit, fail loudly (that's the bug).
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) called — truncates piped stdout`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    consumeCommandResult();
  });

  it("--json with errors sets exitCode 1 and does NOT call process.exit", async () => {
    lintProjectMock.mockResolvedValue({
      results: [{ result: { findings: [{ severity: "error" }] }, file: "index.html" }],
      totalErrors: 1,
      totalWarnings: 0,
      totalInfos: 0,
    });
    await run({ json: true, verbose: false });
    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
    expect(consumeCommandResult().exitCode).toBe(1);
  });

  it("--json when clean sets exitCode 0 and does NOT call process.exit", async () => {
    lintProjectMock.mockResolvedValue({
      results: [{ result: { findings: [] }, file: "index.html" }],
      totalErrors: 0,
      totalWarnings: 0,
      totalInfos: 0,
    });
    await run({ json: true, verbose: false });
    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
    expect(consumeCommandResult().exitCode).toBe(0);
  });

  it("--json on a thrown error sets exitCode 1 and does NOT call process.exit", async () => {
    lintProjectMock.mockRejectedValue(new Error("boom"));
    await run({ json: true, verbose: false });
    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
    expect(consumeCommandResult().exitCode).toBe(1);
  });

  it("human-readable path with errors sets exitCode 1 without process.exit", async () => {
    lintProjectMock.mockResolvedValue({
      results: [{ result: { findings: [{ severity: "error" }] }, file: "index.html" }],
      totalErrors: 1,
      totalWarnings: 0,
      totalInfos: 0,
    });
    await run({ json: false, verbose: false });
    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
    expect(consumeCommandResult().exitCode).toBe(1);
  });
});

describe("lint --lint-verbose", () => {
  beforeEach(() => {
    consumeCommandResult();
    lintProjectMock.mockResolvedValue({
      results: [
        {
          result: {
            findings: [
              { severity: "warning", code: "warn" },
              { severity: "info", code: "note" },
            ],
          },
          file: "index.html",
        },
      ],
      totalErrors: 0,
      totalWarnings: 1,
      totalInfos: 1,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    consumeCommandResult();
  });

  const codes = async (args: Record<string, unknown>) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run({ json: true, ...args });
    return (JSON.parse(String(log.mock.calls.at(-1)?.[0])).findings as { code: string }[]).map(
      (f) => f.code,
    );
  };

  it("shows info findings like --verbose, which render, preview and publish spell --lint-verbose", async () => {
    expect(await codes({})).toEqual(["warn"]);
    expect(await codes({ verbose: true })).toEqual(["warn", "note"]);
    expect(await codes({ "lint-verbose": true })).toEqual(["warn", "note"]);
  });
});

describe("lint and compositions the project never mounts", () => {
  beforeEach(() => {
    consumeCommandResult();
    lintProjectMock.mockReset();
    lintProjectMock.mockResolvedValue({
      results: [{ file: "index.html", result: { findings: [] } }],
      totalErrors: 0,
      totalWarnings: 0,
      totalInfos: 0,
      unmountedCompositions: ["compositions/a.html", "compositions/b.html"],
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("says once how many it left out, and lints them with --include-unmounted", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run({ _: [] });
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line.includes("not mounted from index.html"))).toEqual([
      expect.stringContaining(
        "2 files in compositions/ are not mounted from index.html, so not checked; --include-unmounted adds them.",
      ),
    ]);
    expect(lintProjectMock.mock.calls[0]?.[3]).toEqual({ includeUnmounted: false });

    await run({ _: [], "include-unmounted": true });
    expect(lintProjectMock.mock.calls[1]?.[3]).toEqual({ includeUnmounted: true });
  });

  it("names them in the JSON report", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run({ _: [], json: true });
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).unmountedCompositions).toEqual([
      "compositions/a.html",
      "compositions/b.html",
    ]);
  });
});
