import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const mocked = { execFile: execFileMock, spawn: spawnMock };
  return { ...mocked, default: mocked };
});
vi.mock("@hyperframes/parsers/ff-binaries", () => ({
  findFfBinary: (name: string) => `/fake/bin/${name}`,
}));

import { probeMediaMetadata } from "./mediaMetadata.js";
import { decodeAudioPeaks } from "./waveform.js";

describe("Studio child-process options", () => {
  it("hides the ffprobe console window", async () => {
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        callback(
          null,
          JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264" }] }),
          "",
        );
      },
    );

    await probeMediaMetadata("/tmp/clip.mp4");

    expect(execFileMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });

  it("hides the waveform FFmpeg console window", async () => {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
    proc.stdout = new EventEmitter();
    spawnMock.mockReturnValue(proc);

    const peaks = decodeAudioPeaks("/tmp/audio.wav");
    proc.stdout.emit("data", Buffer.from(new Float32Array([0.5]).buffer));
    proc.emit("close", 0);
    await peaks;

    expect(spawnMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
