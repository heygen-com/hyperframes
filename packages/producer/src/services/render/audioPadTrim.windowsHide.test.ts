import { EventEmitter } from "node:events";
import { describe, expect, it, mock } from "bun:test";

const spawnMock = mock(() => {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => true;
  queueMicrotask(() => {
    proc.emit("spawn");
    proc.stdout.emit("data", Buffer.from('{"streams":[]}'));
    proc.emit("close", 0, null);
  });
  return proc;
});

const realChildProcess = await import("node:child_process");
mock.module("node:child_process", () => ({ ...realChildProcess, spawn: spawnMock }));

const { padOrTrimAudioToVideoFrameCount } = await import("./audioPadTrim.js");

describe("runFfprobeJson child-process options", () => {
  it("hides the ffprobe console window when probing the video", async () => {
    // The audio probe is stubbed out, so every spawn here comes from the
    // real video probe running through runFfprobeJson.
    await padOrTrimAudioToVideoFrameCount({
      videoPath: "/fake/video.mp4",
      audioPath: "/fake/audio.m4a",
      outputPath: "/fake/out.m4a",
      probeAudioInfo: async () => ({ durationSeconds: 1 }),
    }).catch(() => undefined);

    expect(spawnMock).toHaveBeenCalled();
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
