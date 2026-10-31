import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaElementTime } from "./mediaClock";
import { syncRuntimeMedia, type RuntimeMediaClip } from "./media";

function fixture(overrides: Partial<RuntimeMediaClip> = {}, tag = "video") {
  const el = document.createElement(tag) as HTMLMediaElement;
  document.body.appendChild(el);
  Object.defineProperty(el, "readyState", { value: 4, configurable: true });
  el.play = vi.fn(() => Promise.resolve());
  el.pause = vi.fn();
  const seek = vi.spyOn(el, "currentTime", "set");
  const clip: RuntimeMediaClip = {
    el,
    start: 4,
    end: 6,
    duration: 2,
    mediaStart: 8,
    playbackRate: 1,
    volume: null,
    loop: false,
    sourceDuration: 20,
    ...overrides,
  };
  const tick = (timeSeconds: number, playing = true, playbackRate = 1) =>
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds,
      playing,
      playbackRate,
      getCompositionDuration: () => 10,
    });
  return { el, clip, seek, tick };
}

afterEach(() => {
  document.body.innerHTML = "";
  delete window.__HF_EXPORT_RENDER_SEEK_CONFIG;
  vi.restoreAllMocks();
});

describe("incoming media preparation", () => {
  it.each(["video", "audio"])(
    "lands a %s clip's in-point before the cut without playing or seeking it again at activation",
    (tag) => {
      const { el, seek, tick } = fixture({}, tag);
      tick(0);
      expect(seek).not.toHaveBeenCalled();
      tick(2.5);
      expect(el.currentTime).toBe(mediaElementTime(8));
      expect(el.play).not.toHaveBeenCalled();
      tick(3);
      tick(4);
      expect(seek).toHaveBeenCalledTimes(1);
      expect(el.play).toHaveBeenCalledTimes(1);
    },
  );

  it("retries after metadata arrives without interrupting an outstanding seek", () => {
    const { el, seek, tick } = fixture();
    Object.defineProperty(el, "readyState", { value: 0, configurable: true });
    tick(2.5);
    expect(seek).not.toHaveBeenCalled();
    Object.defineProperty(el, "readyState", { value: 1, configurable: true });
    Object.defineProperty(el, "seeking", { value: true, configurable: true });
    tick(2.6);
    expect(seek).not.toHaveBeenCalled();
    Object.defineProperty(el, "seeking", { value: false, configurable: true });
    tick(2.7);
    expect(el.currentTime).toBe(mediaElementTime(8));
  });

  it.each([
    { origin: 2, playbackRate: 2, expected: 12 },
    { origin: 2, playbackRate: 2, loop: true, sourceDuration: 10, expected: 8 },
    { origin: 2, playbackRate: 2, sourceDuration: 10, expected: 10 },
  ])("prepares the activation source position for %j", ({ expected, ...fields }) => {
    const { el, seek, tick } = fixture(fields);
    tick(3);
    expect(el.currentTime).toBe(mediaElementTime(expected));
    tick(4);
    expect(seek).toHaveBeenCalledTimes(1);
  });

  it("uses wall-time lookahead at a faster transport rate", () => {
    const { el, tick } = fixture();
    tick(1, true, 2);
    expect(el.currentTime).toBe(mediaElementTime(8));
  });

  it.each(["paused", "past", "export", "injected", "playing", "disconnected"])(
    "leaves %s media untouched",
    (kind) => {
      const { el, tick, seek } = fixture();
      if (kind === "export") window.__HF_EXPORT_RENDER_SEEK_CONFIG = {};
      if (kind === "injected") {
        el.id = "incoming";
        el.insertAdjacentHTML("afterend", '<img id="__render_frame_incoming__">');
      }
      if (kind === "playing") Object.defineProperty(el, "paused", { value: false });
      if (kind === "disconnected") el.remove();
      tick(kind === "past" ? 7 : 3, kind !== "paused");
      expect(seek).not.toHaveBeenCalled();
    },
  );
});
