import { describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", () => {
  const mocked = { execFile: execFileMock };
  return { ...mocked, default: mocked };
});
vi.mock("@hyperframes/parsers/ff-binaries", () => ({
  findFfBinary: () => "/fake/bin/ffprobe",
}));

import { lintHevcPreviewCodec } from "./hevcPreviewLint.js";

describe("HEVC preview probe options", () => {
  it("hides the ffprobe console window", async () => {
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        callback(null, JSON.stringify({ streams: [{ codec_name: "hevc" }] }));
      },
    );

    await lintHevcPreviewCodec(new Map([["/tmp/clip.mp4", "clip.mp4"]]));

    expect(execFileMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
