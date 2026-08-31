import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const { spawnMock, processFrameMock, closeSessionMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  processFrameMock: vi.fn(async () => ({ fg: Buffer.alloc(4) })),
  closeSessionMock: vi.fn(async () => undefined),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("../browser/ffmpeg.js", () => ({
  findFFmpeg: () => "/fake/bin/ffmpeg",
  findFFprobe: () => "/fake/bin/ffprobe",
  getFFmpegInstallHint: () => "install ffmpeg",
}));
vi.mock("./inference.js", () => ({
  createSession: async () => ({
    provider: "test",
    process: processFrameMock,
    close: closeSessionMock,
  }),
}));
vi.mock("@hyperframes/engine", () => ({
  DEFAULT_VP9_CPU_USED: 4,
  renderProvenanceArgs: () => [],
  extractMediaMetadata: async () => ({ width: 1, height: 1, fps: 1, durationSeconds: 1 }),
}));

import { render } from "./pipeline.js";

function fakeFfmpeg(stdout: Readable) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = stdout;
  proc.stderr = new EventEmitter();
  proc.stdin = Object.assign(new EventEmitter(), { write: vi.fn(() => true), end: vi.fn() });
  proc.kill = vi.fn();
  queueMicrotask(() => proc.emit("exit", 0, null));
  return proc;
}

describe("background-removal FFmpeg child-process options", () => {
  it("hides every FFmpeg console window", async () => {
    spawnMock
      .mockImplementationOnce(() => fakeFfmpeg(Readable.from([Buffer.alloc(3)])))
      .mockImplementationOnce(() => fakeFfmpeg(Readable.from([])));

    await render({ inputPath: "/tmp/input.mp4", outputPath: "/tmp/output.webm" });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    for (const call of spawnMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ windowsHide: true }));
    }
  });
});
