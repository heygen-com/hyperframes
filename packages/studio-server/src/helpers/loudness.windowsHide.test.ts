import { describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (
      _file: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout?: string, stderr?: string) => void,
    ) =>
      // ffprobe finds a track to measure; ffmpeg's measurement then fails.
      args.includes("-select_streams")
        ? callback(
            null,
            JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "aac" }] }),
            "",
          )
        : callback(new Error("ffmpeg stub")),
  ),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, default: { ...actual, execFile: execFileMock }, execFile: execFileMock };
});

import { measureAudio } from "./loudness.js";

describe("measureAudio child-process options", () => {
  it("hides the ffmpeg console window on Windows", async () => {
    await expect(
      measureAudio("/fake/ffmpeg", "/fake/a.wav", { mediaStart: 0, duration: 1 }),
    ).rejects.toThrow();

    const ffmpeg = execFileMock.mock.calls.find(([file]) => file === "/fake/ffmpeg");
    expect(ffmpeg?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
