// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { MAX_FRAME_CLIPS } from "../lib/manifestClips";
import { createPreviewMessageHandler } from "./previewMessageRouter";
import { detachedFakeIframe } from "./timelinePlayerTestHarness";

afterEach(() => usePlayerStore.getState().reset());

function frameHandler() {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  const processed = vi.fn();
  const handle = createPreviewMessageHandler({
    iframeRef: { current: iframe },
    processTimelineMessageRef: { current: processed },
    enrichMissingCompositionsRef: { current: vi.fn() },
    lastTimelineMessageRef: { current: Date.now() },
  });
  const post = (data: unknown) =>
    handle(
      new MessageEvent("message", {
        source: frame as unknown as Window,
        origin: window.location.origin,
        data,
      }),
    );
  return { post, processed };
}

const gapped = (list: unknown[]) => {
  delete list[1];
  return list;
};

describe("a clip list in a frame's timeline message", () => {
  const clip = { id: "a", kind: "element", tagName: "div", start: 0, duration: 1, track: 0 };
  const timeline = (clips: unknown[]) => ({
    source: "hf-preview",
    type: "timeline",
    clips,
    durationInFrames: 30,
  });

  it("is read up to the clip cap", () => {
    const { post, processed } = frameHandler();
    post(timeline(Array(MAX_FRAME_CLIPS).fill(clip)));
    expect(processed).toHaveBeenCalledOnce();
  });

  it("is refused past the clip cap or with a gap", () => {
    const { post, processed } = frameHandler();
    post(timeline(Array(MAX_FRAME_CLIPS + 1).fill(clip)));
    post(timeline(gapped([clip, clip, clip])));
    expect(processed).not.toHaveBeenCalled();
  });

  it("is refused at once when its length has no entries", () => {
    const { post, processed } = frameHandler();
    const started = performance.now();
    post(timeline(new Array(2 ** 32 - 1)));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(processed).not.toHaveBeenCalled();
  });
});

describe("the lists in a frame's preview facts", () => {
  const video = { codec: "h264", width: 1920, height: 1080, bitDepth: 8, count: 1 };
  const facts = (fields: Record<string, unknown>) => ({
    source: "hf-preview",
    type: "preview-facts",
    facts: {
      sceneCount: 1,
      mountedElementCount: 1,
      durationSeconds: 1,
      videos: [video],
      copiesReady: true,
      lighterAt: [0.5],
      ...fields,
    },
  });
  const stored = () => usePlayerStore.getState().previewFacts;

  it("are read when whole", () => {
    frameHandler().post(facts({}));
    expect(stored()).toMatchObject({ videos: [video], lighterAt: [0.5] });
  });

  it.each([
    ["with a gap", gapped([video, video, video])],
    ["whose length has no entries", new Array(2 ** 32 - 1)],
  ])("are refused at once for videos %s", (_name, videos) => {
    const started = performance.now();
    frameHandler().post(facts({ videos }));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(stored()).toBeNull();
  });

  it.each([
    ["with a gap", gapped([0.5, 0.5, 0.25])],
    ["whose length has no entries", new Array(2 ** 32 - 1)],
  ])("drop at once a lighter-at list %s", (_name, lighterAt) => {
    const started = performance.now();
    frameHandler().post(facts({ lighterAt }));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(stored()?.lighterAt).toEqual([]);
  });
});
