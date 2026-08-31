import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { runFfmpegOnce } from "./captureCompositionFrame.js";

describe("runFfmpegOnce child-process options", () => {
  it("hides the FFmpeg console window", async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    spawnMock.mockReturnValue(proc);

    const result = runFfmpegOnce("/fake/bin/ffmpeg", ["-version"], 1000);
    proc.emit("close", 0);
    await result;

    expect(spawnMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
