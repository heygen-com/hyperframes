import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { noteSeekCopyPlayback, startSeekCopies, type SeekCopyHost } from "./mediaProxy";
import { swappedElements } from "./proxySrc";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

vi.mock("./mediaProxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mediaProxy")>()),
  noteSeekCopyPlayback: vi.fn(),
  startSeekCopies: vi.fn(),
}));

it("starts seek copies after the first frame, on the transport's clips, and reports play and pause", async () => {
  resetRuntimeFixtureDom();
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="20"><video id="clip" data-start="4" data-duration="6" src="/clip.mp4"></video></div>';
  const video = document.querySelector("video")!;
  video.load = vi.fn();
  window.__timelines = { main: createMockTimeline(20) };

  initSandboxRuntimeModular();
  await vi.waitFor(() => expect(startSeekCopies).toHaveBeenCalledTimes(1));
  const host = vi.mocked(startSeekCopies).mock.calls[0]![0] as SeekCopyHost;
  expect(host.clips()).toEqual([expect.objectContaining({ el: video, start: 4, end: 10 })]);
  expect(host.playing()).toBe(false);

  window.__player!.play();
  expect(host.playing()).toBe(true);
  expect(noteSeekCopyPlayback).toHaveBeenLastCalledWith(true);
  window.__player!.pause();
  expect(noteSeekCopyPlayback).toHaveBeenLastCalledWith(false);
  window.__player!.seek(7);
  expect(host.playhead()).toBe(7);
});

it("tells Studio an element's authored src, not the preview copy it plays", () => {
  resetRuntimeFixtureDom();
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="5"><video id="clip" data-start="0" src="/copy.mp4?hf-proxy=h264"></video></div>';
  const video = document.querySelector("video")!;
  video.load = vi.fn();
  swappedElements.set(video, "/clip.mp4");
  window.__timelines = { main: createMockTimeline(5) };

  initSandboxRuntimeModular();

  expect(window.__hf?.unproxiedSrc?.(video)).toBe("/clip.mp4");
});

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});
