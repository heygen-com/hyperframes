import { describe, expect, it, vi } from "vitest";

vi.mock("./processTree.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./processTree.js")>()),
  terminateProcessTree: () => Promise.reject(new Error("taskkill exited with status 128")),
}));

const { runCancellableProcess } = await import("./cancellableProcess.js");

describe("runCancellableProcess when the tree kill fails", () => {
  it("still rejects with the timeout, not the kill failure", async () => {
    const run = runCancellableProcess(process.execPath, ["-e", "setTimeout(() => {}, 400)"], {
      timeoutMs: 50,
    });

    await expect(run).rejects.toMatchObject({
      message: "Process timed out after 50 ms",
      code: "ETIMEDOUT",
    });
  });
});
