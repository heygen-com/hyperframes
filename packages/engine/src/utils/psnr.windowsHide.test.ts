import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

describe("psnrDb", () => {
  it("runs ffmpeg with windowsHide so no console window flashes on Windows", async () => {
    const run = vi.fn(async (_file: string, _args: readonly string[], _options: unknown) => ({
      stdout: "",
      stderr: "average:30.5",
    }));
    // psnr.ts only ever calls `promisify(execFile)`, so the custom impl is the
    // whole contract: promisified without it, the mock would look like a
    // single-result callback and `{stderr}` would destructure to undefined.
    const execFile = Object.assign(
      () => {
        throw new Error("psnr.ts must call execFile through promisify");
      },
      { [promisify.custom]: run },
    );
    vi.resetModules();
    vi.doMock("node:child_process", () => ({ execFile }));

    const { psnrDb } = await import("./psnr.js");
    await psnrDb(Buffer.from("a"), Buffer.from("b"));

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ windowsHide: true }),
    );
  });
});
