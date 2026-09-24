import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("../browser/ffmpeg.js", () => ({
  findFFmpeg: () => "/fake/bin/ffmpeg",
  findFFprobe: () => "/fake/bin/ffprobe",
  getFFmpegInstallHint: () => "install ffmpeg",
}));

import { transcodeToMp4 } from "./init.js";

describe("transcodeToMp4 child-process options", () => {
  it("hides the ffmpeg console window on Windows", async () => {
    const proc = new EventEmitter();
    spawnMock.mockReturnValue(proc);

    const result = transcodeToMp4("/fake/in.webm", "/fake/out.mp4");
    proc.emit("close", 0);
    await result;

    expect(spawnMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
