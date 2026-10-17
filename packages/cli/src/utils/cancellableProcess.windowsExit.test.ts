import { ChildProcess, spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCancellableProcess } from "./cancellableProcess.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

describe("Windows cancellation after the child exits", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  let child: ChildProcess;
  let killer: ChildProcess;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 4321 });
    Object.defineProperty(child, "stdout", { value: new PassThrough() });
    killer = new ChildProcess();
    vi.spyOn(child, "kill").mockReturnValue(true);
    vi.mocked(spawn).mockImplementation((command) => (command === "taskkill" ? killer : child));
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    child.stdout?.destroy();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("retains the output-limit error when taskkill cannot find the exited child", async () => {
    const result = runCancellableProcess("ffprobe", [], { maxBufferBytes: 1 });
    child.stdout?.emit("data", Buffer.from("ab"));
    child.emit("close", 0);
    killer.emit("close", 128);

    await expect(result).rejects.toMatchObject({ code: "ENOBUFS", killed: true, stdout: "ab" });
  });

  it("retains the exact abort reason when taskkill cannot find the exited child", async () => {
    const controller = new AbortController();
    const reason = new Error("render cancelled");
    const result = runCancellableProcess("ffprobe", [], { signal: controller.signal });
    controller.abort(reason);
    child.emit("close", 0);
    killer.emit("close", 128);

    await expect(result).rejects.toBe(reason);
  });

  it("retains the timeout error when taskkill cannot find the exited child", async () => {
    vi.useFakeTimers();
    const result = runCancellableProcess("ffprobe", [], { timeoutMs: 1 });
    vi.advanceTimersByTime(1);
    child.emit("close", 0);
    killer.emit("close", 128);

    await expect(result).rejects.toMatchObject({ code: "ETIMEDOUT", killed: true });
  });
});
