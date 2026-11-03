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
