import { describe, expect, it, vi } from "vitest";
import { remoteVideoInput } from "./snapshot.js";

describe("remoteVideoInput", () => {
  const url = "https://cdn.example.com/clip.mp4";

  it("hands FFmpeg a local copy of a remote clip", async () => {
    const download = vi.fn(
      async (_url: string, _dir: string, _timeoutMs?: number) => "/cache/clip.mp4",
    );

    await expect(remoteVideoInput(url, download)).resolves.toBe("/cache/clip.mp4");
    expect(download).toHaveBeenCalledWith(url, expect.any(String), expect.any(Number));
  });

  it("gives a stalled host the same 30 s FFmpeg would have", async () => {
    const download = vi.fn(
      async (_url: string, _dir: string, _timeoutMs?: number) => "/cache/clip.mp4",
    );

    await remoteVideoInput(url, download);
    expect(download.mock.calls[0]).toEqual([url, expect.any(String), 30_000]);
  });

  it("keeps the URL when the clip cannot be downloaded", async () => {
    const download = vi.fn(
      async (_url: string, _dir: string, _timeoutMs?: number): Promise<string> =>
        Promise.reject(new Error("not a public https URL")),
    );

    await expect(remoteVideoInput(url, download)).resolves.toBe(url);
  });
});
