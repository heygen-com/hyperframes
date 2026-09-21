import { afterEach, describe, expect, it, vi } from "vitest";
import { mockTelemetry } from "./cliDispatchTestUtils.js";

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = [...originalArgv];
  process.exitCode = originalExitCode;
  vi.doUnmock("./commands/preview.js");
  vi.doUnmock("./utils/env.js");
  vi.doUnmock("./utils/workspaceBuildCheck.js");
  vi.doUnmock("./telemetry/index.js");
  vi.doUnmock("./telemetry/events.js");
  vi.resetModules();
});

function mockPreviewGate(problems: Array<Record<string, string>>): () => boolean {
  let previewImported = false;
  vi.doMock("./commands/preview.js", () => {
    previewImported = true;
    return { default: { meta: { name: "preview" }, args: {}, run: vi.fn() } };
  });
  vi.doMock("./utils/env.js", () => ({ isDevMode: () => true }));
  vi.doMock("./utils/workspaceBuildCheck.js", () => ({
    checkStudioWorkspaceBuild: () => problems,
    formatWorkspaceBuildProblems: () =>
      problems.map((p) => `  - ${p.package}: ${p.detail}`).join("\n"),
  }));
  mockTelemetry();
  return () => previewImported;
}

describe("CLI preview workspace build gate", () => {
  it("blocks the preview command before its module loads, without printing the raw error twice", async () => {
    const wasPreviewImported = mockPreviewGate([
      {
        package: "core",
        kind: "missing",
        detail: "dist/ is missing or empty",
        fix: "bun run build",
      },
    ]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    process.argv = ["node", "cli.ts", "preview", "--json"];
    await import("./cli.js");

    expect(wasPreviewImported()).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("dist/ is missing or empty"));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    errorSpy.mockRestore();
  });

  it("imports the preview module once the workspace build check reports no problems", async () => {
    const wasPreviewImported = mockPreviewGate([]);

    process.argv = ["node", "cli.ts", "preview", "--json"];
    await import("./cli.js");

    expect(wasPreviewImported()).toBe(true);
  });
});
