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
  const TAG = "0123456789abcdef".repeat(2);

  it("keeps waiting while the owner writes a piece of a long source", async () => {
    const cachePath = staleLock("c.mp4");
    writeFileSync(join(dir, `.tmp-1234-.part-c-${TAG}-0.mp4`), "x");
    const abort = new AbortController();

    const waiting = acquireCopyLock(
      cachePath,
      () => false,
      abort.signal,
      60_000,
      `.part-c-${TAG}-`,
    );
    setTimeout(() => abort.abort(new Error("stopped")), 400);

    await expect(within(waiting, 3_000)).rejects.toThrow("stopped");
  });

  it("gives up on a live owner that has made no progress for the stall window, naming the copy", async () => {
    const cachePath = staleLock("a.mp4");

    const waiting = acquireCopyLock(cachePath, () => false, new AbortController().signal, 300);

    await expect(within(waiting, 3_000)).rejects.toThrow(CopyLockStalledError);
    await expect(
      within(
        acquireCopyLock(cachePath, () => false, new AbortController().signal, 300),
        3_000,
      ),
    ).rejects.toThrow(/a\.mp4.*no progress/);
  });

  it("gives up on a stalled owner even when a project shipped pieces dated in the future", async () => {
    const cachePath = staleLock("d.mp4");
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    for (const name of [".part-d-0.mp4", `.part-d-${"f".repeat(32)}-0.mp4`]) {
      writeFileSync(join(dir, name), "x");
      utimesSync(join(dir, name), nextYear, nextYear);
    }

    const waiting = acquireCopyLock(
      cachePath,
      () => false,
      new AbortController().signal,
      300,
      `.part-d-${TAG}-`,
    );

    await expect(within(waiting, 3_000)).rejects.toThrow(CopyLockStalledError);
  });

  it("gives up within the stall window on a live owner whose lock and temp file are dated ahead of the clock", async () => {
    const cachePath = staleLock("e.mp4");
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    for (const name of [".lock-e.mp4", ".tmp-1234-e.mp4"]) {
      writeFileSync(join(dir, name), String(process.pid));
      utimesSync(join(dir, name), nextYear, nextYear);
    }

    const waiting = acquireCopyLock(cachePath, () => false, new AbortController().signal, 300);

    await expect(within(waiting, 3_000)).rejects.toThrow(CopyLockStalledError);
  });

  it("keeps waiting for an owner still writing beside a temp file dated ahead of the clock", async () => {
    const cachePath = staleLock("f.mp4");
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    writeFileSync(join(dir, ".tmp-9999-f.mp4"), "x");
    utimesSync(join(dir, ".tmp-9999-f.mp4"), nextYear, nextYear);
    const writing = setInterval(() => writeFileSync(join(dir, ".tmp-1234-f.mp4"), "x"), 100);
    const abort = new AbortController();

    const waiting = acquireCopyLock(cachePath, () => false, abort.signal, 600);
    setTimeout(() => abort.abort(new Error("stopped")), 1_500);

    await expect(within(waiting, 3_000).finally(() => clearInterval(writing))).rejects.toThrow(
      "stopped",
    );
  });

  it("keeps waiting while the owner's temp file is still changing", async () => {
    const cachePath = staleLock("b.mp4");
    writeFileSync(join(dir, ".tmp-1234-b.mp4"), "x");
    const abort = new AbortController();

    const waiting = acquireCopyLock(cachePath, () => false, abort.signal, 60_000);
    setTimeout(() => abort.abort(new Error("stopped")), 400);

    await expect(within(waiting, 3_000)).rejects.toThrow("stopped");
  });
});
