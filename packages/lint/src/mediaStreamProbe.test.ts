import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", () => {
  const mocked = { execFile: execFileMock };
  return { ...mocked, default: mocked };
});
vi.mock("@hyperframes/parsers/ff-binaries", () => ({
  findFfBinary: () => "/fake/bin/ffprobe",
}));

import { probeMediaStreams } from "./mediaStreamProbe.js";

type ExecCallback = (error: Error | null, stdout?: string) => void;

function mockFfprobeReplies(stdoutByFile: Record<string, string | Error>): void {
  execFileMock.mockImplementation(
    (_command: string, args: string[], _options: unknown, callback: ExecCallback) => {
      const reply = stdoutByFile[args[args.length - 1] ?? ""];
      if (reply instanceof Error) callback(reply);
      else callback(null, reply ?? "");
    },
  );
}

describe("probeMediaStreams", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("spawns ffprobe with the unfiltered stream listing, options terminated before the input", async () => {
    mockFfprobeReplies({ "/tmp/clip.mp4": JSON.stringify({ streams: [{ codec_type: "video" }] }) });

    await probeMediaStreams(["/tmp/clip.mp4"]);

    // Pinned literally on purpose: `-select_streams v:0` here would report zero
    // streams for an audio-only file and make every correct <audio> an error.
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0]?.[0]).toBe("/fake/bin/ffprobe");
    expect(execFileMock.mock.calls[0]?.[1]).toEqual([
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name",
      "-of",
      "json",
      "--",
      "/tmp/clip.mp4",
    ]);
    expect(execFileMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ windowsHide: true, timeout: 4000 }),
    );
  });

  it("probes each distinct file once and keeps only codec_type/codec_name per stream", async () => {
    mockFfprobeReplies({
      "/tmp/a.mp3": JSON.stringify({
        streams: [{ codec_type: "audio", codec_name: "mp3", bit_rate: "128000" }],
      }),
    });

    const probes = await probeMediaStreams(["/tmp/a.mp3", "/tmp/a.mp3"]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(probes.get("/tmp/a.mp3")).toEqual([{ codec_type: "audio", codec_name: "mp3" }]);
  });

  it("reports an empty stream list as evidence and a failed or malformed probe as unknown", async () => {
    mockFfprobeReplies({
      "/tmp/empty.bin": JSON.stringify({ streams: [] }),
      "/tmp/broken.mp4": new Error("ffprobe timed out"),
      "/tmp/garbage.mp4": "not json",
      "/tmp/no-streams-key.mp4": JSON.stringify({ format: {} }),
    });

    const probes = await probeMediaStreams([
      "/tmp/empty.bin",
      "/tmp/broken.mp4",
      "/tmp/garbage.mp4",
      "/tmp/no-streams-key.mp4",
    ]);

    expect(probes.get("/tmp/empty.bin")).toEqual([]);
    expect(probes.get("/tmp/broken.mp4")).toBeNull();
    expect(probes.get("/tmp/garbage.mp4")).toBeNull();
    expect(probes.get("/tmp/no-streams-key.mp4")).toBeNull();
  });

  it("does not spawn anything for an empty file set", async () => {
    const probes = await probeMediaStreams([]);

    expect(probes.size).toBe(0);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
