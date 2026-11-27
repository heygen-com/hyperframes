import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cancellationState = vi.hoisted(() => ({
  reason: "render_cancelled_by_sigint",
}));

vi.mock("../utils/renderCancellation.js", () => ({
  createRenderCancellationScope: () => {
    const controller = new AbortController();
    controller.abort(new Error(cancellationState.reason));
    return {
      signal: controller.signal,
      checkAncestors: () => undefined,
      dispose: () => undefined,
    };
  },
}));

describe("the render command's cancel output", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-render-cancel-json-"));
    writeFileSync(
      join(projectDir, "index.html"),
      '<main data-composition-id="main" data-width="1920" data-height="1080"></main>',
    );
    cancellationState.reason = "render_cancelled_by_sigint";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const { consumeCommandResult } = await import("../utils/commandResult.js");
    consumeCommandResult();
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function cancelledRun(json: boolean): Promise<{ stdout: string; stderr: string }> {
    let stdout = "";
    let stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    const command = (await import("./render.js")).default;
    await expect(
      command.run?.({
        args: {
          dir: projectDir,
          output: join(projectDir, "out.mp4"),
          quiet: true,
          json,
        },
      } as never),
    ).rejects.toThrow("render_cancelled_by_sigint");
    return { stdout, stderr };
  }

  it("prints one cancel object for a signal cancellation and still exits 1", async () => {
    const { stdout, stderr } = await cancelledRun(true);
    const lines = stdout.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      ok: false,
      error: {
        code: "cancelled",
        signal: "SIGINT",
        message: "Render cancelled: render_cancelled_by_sigint",
      },
    });
    expect(stderr).toContain("Render cancelled: render_cancelled_by_sigint\n");
    const { consumeCommandResult } = await import("../utils/commandResult.js");
    expect(consumeCommandResult()).toMatchObject({ exitCode: 1, kind: "runtime_error" });
  }, 60_000);

  it("keeps stdout empty on a signal cancellation without --json", async () => {
    const { stdout, stderr } = await cancelledRun(false);
    expect(stdout).toBe("");
    expect(stderr).toContain("Render cancelled: render_cancelled_by_sigint\n");
  }, 60_000);
});
