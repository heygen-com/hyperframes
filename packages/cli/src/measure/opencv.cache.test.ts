import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const ownedByAnotherAccount = vi.hoisted(() => new Set<string>());
const downloads = vi.hoisted(() => [] as string[]);
const signals = vi.hoisted(() => [] as (AbortSignal | undefined)[]);
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const lstatSync = ((path: string, options?: object) => {
    const stat = fs.lstatSync(path, options as never);
    return stat && ownedByAnotherAccount.has(path)
      ? Object.assign(stat, { uid: process.getuid!() + 1 })
      : stat;
  }) as typeof fs.lstatSync;
  return { ...fs, lstatSync };
});
vi.mock("../cloud/download.js", () => ({
  downloadToFile: async (url: string, _dest: string, options?: { signal?: AbortSignal }) => {
    downloads.push(url);
    signals.push(options?.signal);
  },
}));

let cache: string;
beforeEach(() => {
  vi.resetModules();
  cache = mkdtempSync(join(tmpdir(), "hf-opencv-cache-"));
  vi.stubEnv("HYPERFRAMES_CACHE_DIR", cache);
});
afterEach(() => {
  ownedByAnotherAccount.clear();
  downloads.length = 0;
  signals.length = 0;
  vi.unstubAllEnvs();
  rmSync(cache, { recursive: true, force: true });
});

it.skipIf(!process.getuid)(
  "downloads nothing into an opencv folder another account owns",
  async () => {
    const { OPENCV_DIR, loadOpenCv } = await import("./opencv.js");
    mkdirSync(OPENCV_DIR, { recursive: true });
    ownedByAnotherAccount.add(join(cache, "opencv"));
    await expect(loadOpenCv()).rejects.toThrow(
      `${join(cache, "opencv")} can be changed by another user account`,
    );
    expect(downloads).toEqual([]);
  },
);

it("hands the caller's signal to the download, so a check that stops ends it", async () => {
  const { loadOpenCv } = await import("./opencv.js");
  const stop = new AbortController();
  await expect(loadOpenCv(undefined, stop.signal)).rejects.toThrow(
    "did not match its pinned size and sha256",
  );
  expect(signals).toEqual([stop.signal]);
});
