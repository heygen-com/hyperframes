// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { createTimelineElementFromManifestClip } from "../lib/timelineDOM";
import type { ClipManifestClip } from "../lib/playbackTypes";
import { createPreviewMessageHandler, type ClipManifestMessage } from "./previewMessageRouter";
import { detachedFakeIframe, serveEditingRequests } from "./timelinePlayerTestHarness";

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  usePlayerStore.getState().reset();
});

const clip = (fields: Record<string, unknown>) => ({
  id: "good",
  label: "good",
  kind: "element",
  tagName: "div",
  start: 1,
  duration: 2,
  track: 3,
  ...fields,
});

const CLIPS = [
  clip({}),
  clip({ id: "text-track", track: '0" onload="x' }),
  clip({ id: "fraction-track", track: 1.5 }),
  clip({ id: "nan-start", start: Number.NaN }),
  clip({ id: "endless", duration: Number.POSITIVE_INFINITY }),
  clip({ id: "text-start", start: "1" }),
  clip({ id: "text-rate", playbackRate: "2" }),
  clip({ id: "endless-media-start", playbackStart: Number.POSITIVE_INFINITY }),
];

/** Turns the clip list into store rows the way Studio's timeline sync does. */
function storeClips(message: ClipManifestMessage): void {
  const rows = message.clips.map((item: ClipManifestClip, fallbackIndex) =>
    createTimelineElementFromManifestClip({ clip: item, fallbackIndex }),
  );
  usePlayerStore.getState().setElements(rows);
}

function expectOnlyNumericRows(): void {
  const rows = usePlayerStore.getState().elements;
  expect(rows.map((row) => row.id)).toEqual(["good"]);
  for (const row of rows) {
    for (const value of [row.start, row.duration, row.track, row.authoredTrack]) {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(Number.isInteger(row.track)).toBe(true);
  }
}

function handlerFor(frame: Record<string, unknown>, iframe: HTMLIFrameElement) {
  const handle = createPreviewMessageHandler({
    iframeRef: { current: iframe },
    processTimelineMessageRef: { current: storeClips },
    enrichMissingCompositionsRef: { current: vi.fn() },
    lastTimelineMessageRef: { current: Date.now() },
    getAdapter: () => null,
    syncTimelineElements: vi.fn(),
  });
  return (data: unknown) =>
    handle(
      new MessageEvent("message", {
        source: frame as unknown as Window,
        origin: window.location.origin,
        data,
      }),
    );
}

describe("clip fields a preview frame sends", () => {
  it("keeps only clips with numeric timing and a whole-number track from a timeline message", () => {
    const frame: Record<string, unknown> = {};
    const post = handlerFor(frame, detachedFakeIframe(frame));
    post({ source: "hf-preview", type: "timeline", clips: CLIPS, durationInFrames: 300 });
    expectOnlyNumericRows();
  });

  it("keeps only clips with numeric timing and a whole-number track from a sealed frame's snapshot", async () => {
    const frame: Record<string, unknown> = {};
    const iframe = detachedFakeIframe(frame);
    Object.defineProperty(iframe, "contentDocument", { value: null });
    Object.defineProperty(frame, "document", {
      get: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    const clipManifest = { clips: CLIPS, durationInFrames: 300, scenes: [] };
    closers.push(serveEditingRequests(frame, () => ({ clipManifest })));
    const post = handlerFor(frame, iframe);
    post({ source: "hf-preview", type: "state", isPlaying: false });
    await vi.waitFor(() => expect(usePlayerStore.getState().elements).toHaveLength(1));
    expectOnlyNumericRows();
  });
});
