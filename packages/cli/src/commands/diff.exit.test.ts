import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { clipFolder, loadOpenCvFirst, noTools, REF_ARGS } from "../measure/diff.test-helpers.js";
import { scheduleCliExit } from "../utils/commandResult.js";
import diffCommand from "./diff.js";

vi.mock("../utils/commandResult.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/commandResult.js")>()),
  scheduleCliExit: vi.fn(),
}));

const { dir, clip } = clipFolder("hf-diff-exit-");

const run = (reference: string, yours: string) =>
  diffCommand.run?.({
    args: { reference, yours, json: true, out: join(dir, "out"), worst: "0" },
    rawArgs: [],
  } as never);

describe("diff ends the process once its result is out", () => {
  it("asks for exit code 1 when it fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(run(join(dir, "missing.mp4"), join(dir, "missing.mp4"))).rejects.toThrow();
    expect(scheduleCliExit).toHaveBeenLastCalledWith(1);
  });

  it("prints ok: false with a fix for an --offset that is not a number", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const missing = join(dir, "missing.mp4");
    await expect(
      diffCommand.run?.({
        args: { reference: missing, yours: missing, json: true, offset: "soon" },
        rawArgs: [],
      } as never),
    ).rejects.toThrow();
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
      ok: false,
      error: '--offset must be a number of seconds, got "soon"',
      fix: expect.stringContaining("--offset 0.5"),
    });
    expect(scheduleCliExit).toHaveBeenLastCalledWith(1);
  });

  it.each([
    { kind: "video", yours: join(dir, "missing.mp4"), offset: "1e309" },
    { kind: "project folder", yours: dir, offset: "+1e309" },
  ])(
    "refuses a non-finite --offset for a $kind before reading media",
    async ({ yours, offset }) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      await expect(
        diffCommand.run?.({
          args: { reference: join(dir, "missing.mp4"), yours, json: true, offset },
          rawArgs: [],
        } as never),
      ).rejects.toThrow();
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        ok: false,
        error: `--offset must be a number of seconds, got "${offset}"`,
        fix: expect.stringContaining("--offset 0.5"),
      });
      expect(scheduleCliExit).toHaveBeenLastCalledWith(1);
    },
  );

  describe.skipIf(noTools)("with a clip", () => {
    loadOpenCvFirst();

    it("asks for exit code 0 when the videos match", async () => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const ref = clip("ref.mp4", REF_ARGS);
      await run(ref, ref);
      expect(scheduleCliExit).toHaveBeenLastCalledWith(0);
    });
  });
});
