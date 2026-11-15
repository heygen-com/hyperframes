import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateMediaDir, remoteVideoInput } from "./snapshot.js";

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

  it("gives FFmpeg nothing when the clip cannot be downloaded, so FFmpeg never follows the host's redirects", async () => {
    const download = vi.fn(
      async (_url: string, _dir: string, _timeoutMs?: number): Promise<string> =>
        Promise.reject(new Error("socket hang up")),
    );

    await expect(remoteVideoInput(url, download)).resolves.toBeNull();
  });

  it.each([
    "http://cdn.example.com/clip.mp4",
    "https://127.0.0.1:8080/clip.mp4",
    "https://169.254.169.254/latest",
    "https://10.0.0.5/clip.mp4",
  ])("gives FFmpeg nothing for %s, which the download policy refuses", async (refused) => {
    const download = vi.fn(async (): Promise<string> => "/cache/clip.mp4");

    await expect(remoteVideoInput(refused, download)).resolves.toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it("gives FFmpeg nothing when the download is refused, as for a host resolving to a private address", async () => {
    const refusal = Object.assign(new Error("Download URL is not permitted"), {
      kind: "http_rejected",
    });
    const download = vi.fn(async (): Promise<string> => Promise.reject(refusal));

    await expect(remoteVideoInput(url, download)).resolves.toBeNull();
  });
});

describe("privateMediaDir", () => {
  let parent: string | undefined;
  afterEach(() => {
    if (parent) rmSync(parent, { recursive: true, force: true });
    parent = undefined;
  });

  it("keeps clips in one folder per user that only that user can open", () => {
    parent = mkdtempSync(join(tmpdir(), "hf-snapshot-media-"));
    const dir = privateMediaDir(parent);

    expect(privateMediaDir(parent)).toBe(dir);
    if (process.platform !== "win32") expect(statSync(dir).mode & 0o077).toBe(0);
  });

  it.skipIf(process.platform === "win32")(
    "uses a fresh folder when the shared one is open to other users",
    () => {
      parent = mkdtempSync(join(tmpdir(), "hf-snapshot-media-"));
      const shared = join(parent, `hyperframes-snapshot-media-${process.getuid?.()}`);
      mkdirSync(shared);
      chmodSync(shared, 0o777);

      const dir = privateMediaDir(parent);

      expect(dir).not.toBe(shared);
      expect(statSync(dir).mode & 0o077).toBe(0);
    },
  );
});
