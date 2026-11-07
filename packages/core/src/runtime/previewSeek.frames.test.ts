import { afterEach, expect, it, vi } from "vitest";
import { createPreviewSeek } from "./previewSeek";
import type { PreparedPausedVideoFrames } from "./pausedVideoFrames";
import type { RuntimeMediaClip } from "./types";

const jobs: ReturnType<typeof createPreviewSeek>[] = [];
afterEach(() => {
  for (const job of jobs.splice(0)) job.cancel();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const batch = (): PreparedPausedVideoFrames => ({
  valid: () => true,
  present: vi.fn(() => true),
  refresh: vi.fn(),
  release: vi.fn(),
});
function fixture() {
  const video = document.createElement("video");
  document.body.append(video);
  const clip: RuntimeMediaClip = {
    el: video,
    start: 0,
    duration: 10,
    end: 10,
    mediaStart: 0,
    playbackRate: 1,
    volume: null,
    loop: false,
    sourceDuration: 10,
  };
  const pending: Array<{
    signal: AbortSignal;
    resolve: (result: PreparedPausedVideoFrames | null) => void;
  }> = [];
  const commit = vi.fn();
  const native = vi.fn();
  const prepare = vi.fn(
    (_clips: RuntimeMediaClip[], _time: number, signal: AbortSignal) =>
      new Promise<PreparedPausedVideoFrames | null>((resolve) => pending.push({ signal, resolve })),
  );
  const job = createPreviewSeek({
    clipsAt: () => [clip],
    videosToHold: () => [],
    scenesReadyAt: () => true,
    prepare: native,
    commit,
    frames: { available: () => true, prepare, prepareNative: vi.fn(), clear: vi.fn() },
  });
  jobs.push(job);
  return { job, commit, native, prepare, pending };
}

it("presents coherent intermediate work while retaining the latest requested destination", async () => {
  const { job, commit, pending } = fixture();
  const done = job.seek(1);
  expect(job.seek(2)).toBe(done);
  const first = batch();
  pending[0]!.resolve(first);
  await Promise.resolve();
  expect(commit).toHaveBeenCalledWith(1);
  expect(job.time).toBe(2);
  expect(first.present).toHaveBeenCalledTimes(1);
  const last = batch();
  pending[1]!.resolve(last);
  await done;
  expect(commit.mock.calls.map(([time]) => time)).toEqual([1, 2]);
  expect(job.time).toBeUndefined();
});

it("does not rebuild document structure when no native snapshots need hiding", async () => {
  const { job, pending } = fixture();
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) => mutations.push(...records));
  observer.observe(document.head, { childList: true });
  const done = job.seek(1);
  job.seek(2);
  pending[0]!.resolve(batch());
  await Promise.resolve();
  pending[1]!.resolve(batch());
  await done;
  expect([...mutations, ...observer.takeRecords()]).toEqual([]);
  observer.disconnect();
});

it("resumes provider decoding when a scrub interrupts a native play handoff", async () => {
  const { job, commit, prepare, native, pending } = fixture();
  const initial = job.seek(1);
  pending[0]!.resolve(batch());
  await initial;
  const play = job.handoff(2);
  expect(native).toHaveBeenCalledTimes(1);
  const scrub = job.seek(3);
  await play;
  expect(prepare).toHaveBeenLastCalledWith(expect.any(Array), 3, expect.any(AbortSignal), false);
  pending[1]!.resolve(batch());
  await scrub;
  expect(commit.mock.calls.map(([time]) => time)).toEqual([1, 3]);
});

it("releases a decode that arrives after cancellation without presenting it", async () => {
  const { job, commit, pending } = fixture();
  const done = job.seek(1);
  job.cancel();
  expect(pending[0]!.signal.aborted).toBe(true);
  const late = batch();
  pending[0]!.resolve(late);
  await Promise.resolve();
  await done;
  expect(late.release).toHaveBeenCalledTimes(1);
  expect(late.present).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it("lets a new gesture supersede a full-quality refinement without changing its destination", async () => {
  const { job, prepare, pending, commit } = fixture();
  const refining = job.refine(1);
  expect(prepare).toHaveBeenLastCalledWith(expect.any(Array), 1, expect.any(AbortSignal), true);
  const next = job.seek(2);
  expect(pending[0]!.signal.aborted).toBe(true);
  pending[0]!.resolve(batch());
  pending[1]!.resolve(batch());
  await Promise.all([refining, next]);
  expect(commit.mock.calls.map(([time]) => time)).toEqual([2]);
});

it("does not erase a seek requested synchronously while publishing the previous one", async () => {
  const { job, commit, pending } = fixture();
  commit.mockImplementationOnce(() => {
    job.seek(4);
  });
  const first = job.seek(1);
  pending[0]!.resolve(batch());
  await first;
  expect(job.time).toBe(4);
  pending[1]!.resolve(batch());
  await Promise.resolve();
  expect(commit.mock.calls.map(([time]) => time)).toEqual([1, 4]);
});
