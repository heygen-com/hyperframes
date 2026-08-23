import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

// Hoisted so the mock factory below can reach it without a top-level variable.
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("child_process", () => ({ spawn: spawnMock }));

/** Minimal stand-in for the ChildProcess runFfmpeg awaits. */
function fakeFfmpeg() {
  const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  proc.pid = 4242;
  queueMicrotask(() => proc.emit("close", 0, null));
  return proc;
}

describe("runFfmpeg spawn options", () => {
  it("hides the console window so Windows renders do not flash terminals", async () => {
    // Regression for the Windows popup report: ffmpeg is a console-subsystem
    // binary, and Node defaults `windowsHide` to false, so every spawn opened a
    // visible window. A render shells out dozens of times across parallel
    // workers, which produced a burst of windows on the user's desktop.
    // Asserted on the options actually handed to spawn rather than on the
    // source text, so a future call site that drops the flag is caught by
    // behaviour.
    spawnMock.mockImplementation(() => fakeFfmpeg());

    const { runFfmpeg } = await import("./runFfmpeg.js");
    await runFfmpeg(["-version"]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const options = spawnMock.mock.calls[0]?.[2] as { windowsHide?: boolean } | undefined;
    expect(options?.windowsHide).toBe(true);
  });
});
