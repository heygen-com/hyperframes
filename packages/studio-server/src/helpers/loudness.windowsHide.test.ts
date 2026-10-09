import { describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (_file: string, _args: string[], _options: unknown, callback: (error: Error) => void) =>
      callback(new Error("ffmpeg stub")),
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

    expect(execFileMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
