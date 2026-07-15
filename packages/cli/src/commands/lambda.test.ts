/**
 * Regression coverage for the VST-chain guard in `hyperframes lambda render`
 * (Task 8): plugins can't run in Lambda, so a composition with any
 * `data-vst-chain` audio track must be rejected up front — before the
 * dynamic import of `./lambda/render.js` (and everything that pulls in:
 * S3 upload, Step Functions, real AWS calls) ever runs. This guard shipped
 * with no automated test; this file closes that gap.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runRenderMock = vi.fn(async () => undefined);
vi.mock("./lambda/render.js", () => ({ runRender: runRenderMock }));
// The command dynamically imports `@hyperframes/aws-lambda/sdk` up front for
// every AWS-calling verb (a "is it installed" probe, not otherwise used by
// this guard) — stub it out so this test never pays for that package's real
// (heavier) module graph or its resolution cost under load, which is
// unrelated to what this test verifies.
vi.mock("@hyperframes/aws-lambda/sdk", () => ({}));

describe("lambda render VST guard", () => {
  let projectDir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    projectDir = undefined;
  });

  it("exits 1 naming the VST track before any AWS-calling code runs", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-lambda-vst-guard-"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html>
<html><body>
  <div data-composition-id="test" data-width="1920" data-height="1080" data-duration="2" data-fps="30"></div>
  <audio id="a1" src="tone.wav" data-start="0" data-end="2" data-vst-chain="fx/t.vstchain.json"></audio>
</body></html>`,
    );

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null): never => {
        throw new Error(`process.exit:${code ?? ""}`);
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const command = (await import("./lambda.js")).default;

    await expect(
      command.run?.({
        args: {
          subcommand: "render",
          target: projectDir,
          width: "1920",
          height: "1080",
        },
      } as never),
    ).rejects.toThrow("process.exit:1");

    // Exactly one exit, at code 1 — if the guard hadn't fired and execution
    // had instead reached `./lambda/render.js`'s real AWS calls, this would
    // either hang on network/credentials or throw an unrelated error instead
    // of this specific, synchronous rejection.
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);

    const loggedError = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(loggedError).toContain("Lambda rendering does not support VST audio chains");
    expect(loggedError).toContain("a1");
    expect(runRenderMock).not.toHaveBeenCalled();
  }, 20_000);

  it("does not fire for a composition with no VST chains", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-lambda-vst-guard-clean-"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html>
<html><body>
  <div data-composition-id="test" data-width="1920" data-height="1080" data-duration="2" data-fps="30"></div>
  <audio id="a1" src="tone.wav" data-start="0" data-end="2"></audio>
</body></html>`,
    );

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null): never => {
        throw new Error(`process.exit:${code ?? ""}`);
      });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    runRenderMock.mockClear();

    const command = (await import("./lambda.js")).default;

    await command.run?.({
      args: {
        subcommand: "render",
        target: projectDir,
        width: "1920",
        height: "1080",
      },
    } as never);

    // The guard didn't block this clean composition — execution reached the
    // (mocked) real render path instead of exiting for a VST reason.
    expect(exitSpy).not.toHaveBeenCalled();
    expect(runRenderMock).toHaveBeenCalledTimes(1);
  }, 20_000);
});
