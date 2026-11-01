import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { acquireCopyLock, CopyLockStalledError } from "./proxyLock.js";

const dir = mkdtempSync(join(tmpdir(), "hf-proxy-lock-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

/** A lock held by a live process (this one) whose files last changed an hour ago. */
function staleLock(name: string): string {
  const cachePath = join(dir, name);
  const lock = join(dir, `.lock-${name}`);
  writeFileSync(lock, String(process.pid));
  utimesSync(lock, hourAgo, hourAgo);
  return cachePath;
}

const within = <T>(work: Promise<T>, ms: number) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms),
    ),
  ]);

describe("acquireCopyLock", () => {
  it("gives up on a live owner that has made no progress for the stall window, naming the copy", async () => {
    const cachePath = staleLock("a.mp4");

    const waiting = acquireCopyLock(cachePath, new AbortController().signal, 300);

    await expect(within(waiting, 3_000)).rejects.toThrow(CopyLockStalledError);
    await expect(
      within(acquireCopyLock(cachePath, new AbortController().signal, 300), 3_000),
    ).rejects.toThrow(/a\.mp4.*no progress/);
  });

  it("keeps waiting while the owner's temp file is still changing", async () => {
    const cachePath = staleLock("b.mp4");
    writeFileSync(join(dir, ".tmp-1234-b.mp4"), "x");
    const abort = new AbortController();

    const waiting = acquireCopyLock(cachePath, abort.signal, 60_000);
    setTimeout(() => abort.abort(new Error("stopped")), 400);

    await expect(within(waiting, 3_000)).rejects.toThrow("stopped");
  });
});
