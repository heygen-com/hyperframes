// Regression: `lint --json` used process.exit() right after console.log(JSON).
// process.exit() terminates before Node flushes an async (non-TTY / piped)
// stdout, so piping `hyperframes lint --json` on Windows silently lost the whole
// payload. The fix sets process.exitCode + returns so stdout drains first. These
// tests lock that in: run() must NEVER call process.exit(), and must set the
// right exitCode, for the success, error-findings, and thrown-error paths.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lintProjectMock = vi.fn();

vi.mock("../utils/project.js", () => ({
  resolveProject: (dir?: string) => ({ dir: dir ?? "/proj", name: "proj" }),
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
  const origExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // If run() ever calls process.exit, fail loudly (that's the bug).
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) called — truncates piped stdout`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = origExitCode;
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
    expect(process.exitCode).toBe(1);
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
    expect(process.exitCode).toBe(0);
  });

  it("--json on a thrown error sets exitCode 1 and does NOT call process.exit", async () => {
    lintProjectMock.mockRejectedValue(new Error("boom"));
    await run({ json: true, verbose: false });
    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
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
    expect(process.exitCode).toBe(1);
  });
});
