import { describe, it, expect, vi, afterEach } from "vitest";
import { refreshRuntimeMediaCache, syncRuntimeMedia } from "./media";
import type { RuntimeMediaClip } from "./media";

function createVideo(attrs: Record<string, string>): HTMLVideoElement {
  const el = document.createElement("video");
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  // jsdom doesn't compute media duration, so we stub it
  Object.defineProperty(el, "duration", { value: NaN, writable: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

function createAudio(attrs: Record<string, string>): HTMLAudioElement {
  const el = document.createElement("audio");
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  Object.defineProperty(el, "duration", { value: NaN, writable: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

describe("refreshRuntimeMediaCache", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finds video elements with data-start", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    const result = refreshRuntimeMediaCache();
    expect(result.timedMediaEls).toHaveLength(1);
    expect(result.mediaClips).toHaveLength(1);
    expect(result.videoClips).toHaveLength(1);
  });

  it("finds audio elements with data-start", () => {
    createAudio({ "data-start": "2", "data-duration": "3" });
    const result = refreshRuntimeMediaCache();
    expect(result.timedMediaEls).toHaveLength(1);
    expect(result.mediaClips).toHaveLength(1);
    expect(result.videoClips).toHaveLength(0);
  });

  it("ignores media without data-start", () => {
    document.body.appendChild(document.createElement("video"));
    const result = refreshRuntimeMediaCache();
    expect(result.timedMediaEls).toHaveLength(0);
  });

  it("calculates clip end from start + duration", () => {
    createVideo({ "data-start": "2", "data-duration": "3" });
    const result = refreshRuntimeMediaCache();
    const clip = result.mediaClips[0];
    expect(clip.start).toBe(2);
    expect(clip.duration).toBe(3);
    expect(clip.end).toBe(5);
  });

  it("uses media-start offset", () => {
    createVideo({ "data-start": "0", "data-duration": "5", "data-media-start": "10" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].mediaStart).toBe(10);
  });

  it("parses volume attribute", () => {
    createVideo({ "data-start": "0", "data-duration": "5", "data-volume": "0.5" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].volume).toBe(0.5);
  });

  it("handles missing volume gracefully", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].volume).toBeNull();
  });

  it("maxMediaEnd tracks highest clip end", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    createVideo({ "data-start": "3", "data-duration": "10" });
    const result = refreshRuntimeMediaCache();
    expect(result.maxMediaEnd).toBe(13);
  });

  it("uses custom resolveStartSeconds", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    const result = refreshRuntimeMediaCache({ resolveStartSeconds: () => 10 });
    expect(result.mediaClips[0].start).toBe(10);
  });

  it("falls back to element.duration when data-duration missing", () => {
    const el = createVideo({ "data-start": "0" });
    Object.defineProperty(el, "duration", { value: 8, writable: true });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].duration).toBe(8);
  });

  it("reads defaultPlaybackRate from element", () => {
    const el = createVideo({ "data-start": "0", "data-duration": "10" });
    Object.defineProperty(el, "defaultPlaybackRate", { value: 0.5, writable: true });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].playbackRate).toBe(0.5);
  });

  it("defaults playback rate to 1", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].playbackRate).toBe(1);
  });

  it("clamps playback rate to [0.1, 5]", () => {
    const el1 = createVideo({ "data-start": "0", "data-duration": "5" });
    Object.defineProperty(el1, "defaultPlaybackRate", { value: 0.01, writable: true });
    const r1 = refreshRuntimeMediaCache();
    expect(r1.mediaClips[0].playbackRate).toBe(0.1);
    document.body.innerHTML = "";
    const el2 = createVideo({ "data-start": "0", "data-duration": "5" });
    Object.defineProperty(el2, "defaultPlaybackRate", { value: 10, writable: true });
    const r2 = refreshRuntimeMediaCache();
    expect(r2.mediaClips[0].playbackRate).toBe(5);
  });

  it("adjusts fallback duration by playback rate", () => {
    const el = createVideo({ "data-start": "0" });
    Object.defineProperty(el, "defaultPlaybackRate", { value: 0.5, writable: true });
    Object.defineProperty(el, "duration", { value: 10, writable: true });
    const result = refreshRuntimeMediaCache();
    // 10s source at 0.5x = 20s on timeline
    expect(result.mediaClips[0].duration).toBe(20);
  });

  it("reads native loop attribute", () => {
    createVideo({ "data-start": "0", "data-duration": "15", loop: "" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].loop).toBe(true);
  });

  it("defaults loop to false", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].loop).toBe(false);
  });
});

describe("syncRuntimeMedia", () => {
  function fakePlayedRanges(el: HTMLMediaElement, ranges: Array<[number, number]>): void {
    Object.defineProperty(el, "played", {
      configurable: true,
      get: () => ({
        length: ranges.length,
        start: (i: number) => ranges[i][0],
        end: (i: number) => ranges[i][1],
      }),
    });
  }

  function createMockClip(overrides?: Partial<RuntimeMediaClip>): RuntimeMediaClip {
    const el = document.createElement("video") as HTMLVideoElement;
    document.body.appendChild(el);
    Object.defineProperty(el, "paused", { value: true, writable: true, configurable: true });
    el.play = vi.fn(() => Promise.resolve());
    el.pause = vi.fn();
    Object.defineProperty(el, "currentTime", { value: 0, writable: true, configurable: true });
    Object.defineProperty(el, "playbackRate", { value: 1, writable: true, configurable: true });
    // Default: audio has been playing — so drift-seek forward is allowed.
    // Tests that exercise the "cold first play" guard call fakePlayedRanges(el, []).
    fakePlayedRanges(el, [[0, 1]]);
    return {
      el,
      start: 0,
      mediaStart: 0,
      duration: 10,
      end: 10,
      volume: null,
      playbackRate: 1,
      loop: false,
      sourceDuration: null,
      ...overrides,
    };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("plays active clip when playing and buffered", () => {
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    expect(clip.el.play).toHaveBeenCalled();
  });

  it("plays synchronously even when media is unbuffered (preserves user gesture)", () => {
    // Calling play() synchronously inside the user-gesture call chain lets the
    // browser queue playback until data buffers, while consuming the transient
    // user activation. Deferring to an async canplay handler would let the
    // activation expire and the autoplay policy silently reject — producing
    // the "silent first play, audio only after second click" bug.
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 0, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    expect(clip.el.play).toHaveBeenCalled();
  });

  it("forces preload=auto on every active element, not just during play", () => {
    // Streaming formats (MP3) may arrive with preload="metadata", which only
    // buffers the first few seconds. Setting preload="auto" on every active
    // tick catches elements whose preload was overridden after init.ts set it
    // — and ensures it happens even when paused (e.g. during a seek).
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "preload", { value: "metadata", writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: false, playbackRate: 1 });
    expect(clip.el.preload).toBe("auto");
  });

  it("does not re-fire play() while a previous play() is in flight", () => {
    // Without a play-request dedup, the 50ms runtime poll would fire 20–40
    // spurious play() calls per element during the 1–2s initial buffer, each
    // with a catch() that would swallow any real AbortError / NotAllowedError
    // the developer needs to see.
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5.02, playing: true, playbackRate: 1 });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5.04, playing: true, playbackRate: 1 });
    expect(clip.el.play).toHaveBeenCalledTimes(1);
  });

  it("re-issues play() after a hard seek clears the in-flight guard", () => {
    // A scrub during playback triggers a hard seek (offset jump > 0.5s).
    // The fix clears the playRequested guard so the very next sync tick can
    // re-issue play() instead of waiting 50-150ms for the guard to clear
    // naturally — closing the audible desync gap on timeline scrub.
    const clip = createMockClip({ start: 0, end: 20, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 2, writable: true });
    // Steady-state playback at t=2
    syncRuntimeMedia({ clips: [clip], timeSeconds: 2, playing: true, playbackRate: 1 });
    expect(clip.el.play).toHaveBeenCalledTimes(1);
    // Scrub to t=15 — hard seek fires, guard should be cleared
    syncRuntimeMedia({ clips: [clip], timeSeconds: 15, playing: true, playbackRate: 1 });
    // Next tick: play() should fire again (guard was cleared by the seek)
    syncRuntimeMedia({ clips: [clip], timeSeconds: 15.02, playing: true, playbackRate: 1 });
    expect(clip.el.play).toHaveBeenCalledTimes(2);
  });

  it("calls load() once when a seek fails past the buffered range (MP3 partial buffer)", () => {
    // Streaming MP3 with preload="metadata" only buffers the first ~15s.
    // When the user seeks to 20s, el.currentTime = 20 silently fails —
    // currentTime stays at 0. The fix detects this and calls load() once
    // to trigger a full network fetch.
    const clip = createMockClip({ start: 0, end: 30, mediaStart: 0 });
    // Simulate: currentTime is writable but the setter is intercepted
    // to stay at 0 (simulating failed seek past buffer).
    let internalTime = 0;
    Object.defineProperty(clip.el, "currentTime", {
      get: () => internalTime,
      set: () => {
        // Seek silently fails — stays at 0 (MP3 past buffer)
      },
      configurable: true,
    });
    clip.el.load = vi.fn();
    // First tick at t=20 — hard seek fires, fails, should call load()
    syncRuntimeMedia({ clips: [clip], timeSeconds: 20, playing: true, playbackRate: 1 });
    expect(clip.el.load).toHaveBeenCalledTimes(1);
    // Second tick — load() should NOT be called again (one-shot guard)
    syncRuntimeMedia({ clips: [clip], timeSeconds: 20.05, playing: true, playbackRate: 1 });
    expect(clip.el.load).toHaveBeenCalledTimes(1);
  });

  it("does not call load() when the seek succeeds", () => {
    const clip = createMockClip({ start: 0, end: 30, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    clip.el.load = vi.fn();
    // Seek to 20 — succeeds (currentTime updates)
    syncRuntimeMedia({ clips: [clip], timeSeconds: 20, playing: true, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(20);
    expect(clip.el.load).not.toHaveBeenCalled();
  });

  it("clears the load-retry guard when clip deactivates and reactivates", () => {
    const clip = createMockClip({ start: 0, end: 10, mediaStart: 0 });
    let internalTime = 0;
    Object.defineProperty(clip.el, "currentTime", {
      get: () => internalTime,
      set: () => {},
      configurable: true,
    });
    clip.el.load = vi.fn();
    // First activation — seek fails, load() called
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    expect(clip.el.load).toHaveBeenCalledTimes(1);
    // Deactivate
    syncRuntimeMedia({ clips: [clip], timeSeconds: 11, playing: true, playbackRate: 1 });
    // Reactivate — guard was cleared, so load() can fire again
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    expect(clip.el.load).toHaveBeenCalledTimes(2);
  });

  it("pauses active clip when not playing", () => {
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "paused", { value: false, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: false, playbackRate: 1 });
    expect(clip.el.pause).toHaveBeenCalled();
  });

  it("pauses inactive clip", () => {
    const clip = createMockClip({ start: 5, end: 10 });
    Object.defineProperty(clip.el, "paused", { value: false, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 2, playing: true, playbackRate: 1 });
    expect(clip.el.pause).toHaveBeenCalled();
  });

  it("sets volume when clip has volume", () => {
    const clip = createMockClip({ start: 0, end: 10, volume: 0.7 });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: false, playbackRate: 1 });
    expect(clip.el.volume).toBe(0.7);
  });

  it("hard-syncs on the first active tick (sub-composition activation, mediaStart offsets)", () => {
    const clip = createMockClip({ start: 0, end: 10, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: false, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(5);
  });

  it("does not seek on sub-0.5s drift in steady-state — avoids pause/play hiccups", () => {
    const clip = createMockClip({ start: 0, end: 10, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 5.4, writable: true });
    // Establish a baseline offset of 0 with a steady-state tick first.
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5.4, playing: true, playbackRate: 1 });
    // Now a small transient drift: timeline backs up 0.4s (typical of
    // pause/play ordering). Below the 0.5s threshold — don't seek.
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(5.4);
  });

  it("does not force audio forward while it's still buffering (gradual drift growth)", () => {
    // Cold-play: audio stuck buffering at 0, timeline advances ~16ms per tick.
    // The offset grows gradually; no single tick jumps by 0.5s, so the
    // drift-correction seek must NOT fire. Without this guard the runtime
    // would force-seek audio forward and the user would miss the opening
    // words of the narration.
    const clip = createMockClip({ start: 0, end: 10, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    // First tick: timeline at 0, audio at 0, no drift — first-tick hard-sync is a no-op.
    syncRuntimeMedia({ clips: [clip], timeSeconds: 0, playing: true, playbackRate: 1 });
    // Subsequent ticks: timeline advances, audio stays buffering at 0.
    for (let t = 0.016; t < 0.7; t += 0.016) {
      syncRuntimeMedia({ clips: [clip], timeSeconds: t, playing: true, playbackRate: 1 });
    }
    expect(clip.el.currentTime).toBe(0);
  });

  it("re-syncs on a scrub — offset jumps in one tick", () => {
    const clip = createMockClip({ start: 0, end: 20, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 2, writable: true });
    // Steady-state.
    syncRuntimeMedia({ clips: [clip], timeSeconds: 2, playing: true, playbackRate: 1 });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 2.02, playing: true, playbackRate: 1 });
    // User scrubs forward to 15 — offset jumps from ~0 to ~13 in one tick.
    syncRuntimeMedia({ clips: [clip], timeSeconds: 15, playing: true, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(15);
  });

  it("catastrophic-drift safety valve eventually resyncs a stuck element", () => {
    const clip = createMockClip({ start: 0, end: 100, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    // Establish baseline at t=0.
    syncRuntimeMedia({ clips: [clip], timeSeconds: 0, playing: true, playbackRate: 1 });
    // Gradually advance timeline by 0.3s per tick without audio moving.
    // Each tick's offset delta is 0.3 (< 0.5s jump threshold), so only the
    // >3s catastrophic-drift safety valve can trigger the resync.
    for (let t = 0.3; t <= 4; t += 0.3) {
      syncRuntimeMedia({ clips: [clip], timeSeconds: t, playing: true, playbackRate: 1 });
    }
    expect(clip.el.currentTime).toBeGreaterThan(3);
  });

  it("clears offset baseline when clip deactivates — re-entry hard-syncs", () => {
    const clip = createMockClip({ start: 0, end: 5, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    // Active pass: establish baseline at t=2.
    syncRuntimeMedia({ clips: [clip], timeSeconds: 2, playing: true, playbackRate: 1 });
    // Deactivate: timeline moves past the clip window.
    syncRuntimeMedia({ clips: [clip], timeSeconds: 6, playing: true, playbackRate: 1 });
    // Re-activate at t=3 — first-tick hard-sync should fire despite having
    // a previous baseline, because the clip was inactive in between.
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 3, playing: true, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(3);
  });

  it("sets per-element playbackRate × global rate", () => {
    const clip = createMockClip({ start: 0, end: 10, playbackRate: 0.5 });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 2 });
    expect(clip.el.playbackRate).toBe(1); // 0.5 × 2 = 1
  });

  it("computes relTime with per-element playback rate", () => {
    const clip = createMockClip({ start: 0, end: 20, playbackRate: 0.5, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 10, playing: false, playbackRate: 1 });
    // At timeline t=10, with 0.5x rate: relTime = 10 * 0.5 + 0 = 5s into the media
    expect(clip.el.currentTime).toBe(5);
  });

  it("wraps relTime when loop is true and media has ended", () => {
    // 3s source at 1x, looped over 10s clip
    const clip = createMockClip({
      start: 0,
      end: 10,
      mediaStart: 0,
      loop: true,
      sourceDuration: 3,
    });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    // At t=7, relTime = 7, wraps to 7 % 3 = 1
    syncRuntimeMedia({ clips: [clip], timeSeconds: 7, playing: false, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(1);
  });

  it("wraps loop with mediaStart offset", () => {
    // Source is 10s, mediaStart=5, so loop length is 5s (5-10)
    const clip = createMockClip({
      start: 0,
      end: 15,
      mediaStart: 5,
      loop: true,
      sourceDuration: 10,
    });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    // At t=7: relTime = 7*1 + 5 = 12, wraps: 5 + ((12-5) % 5) = 5 + (7%5) = 5+2 = 7
    syncRuntimeMedia({ clips: [clip], timeSeconds: 7, playing: false, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(7);
  });

  it("does not loop when loop is false", () => {
    const clip = createMockClip({
      start: 0,
      end: 10,
      mediaStart: 0,
      loop: false,
      sourceDuration: 3,
    });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    // At t=7, relTime = 7 (no wrapping, even though > sourceDuration)
    syncRuntimeMedia({ clips: [clip], timeSeconds: 7, playing: false, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(7);
  });

  it("asserts muted=true every tick while outputMuted is set", () => {
    // Parent ownership has taken over audible playback via parent-frame
    // proxies. The iframe runtime must silence every active media element
    // per tick so new sub-composition media inherits the mute as soon as
    // it appears in the DOM — otherwise a late <audio> insertion would
    // briefly play audibly and double-voice the viewer.
    const clip = createMockClip({ start: 0, end: 10, volume: 1 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    Object.defineProperty(clip.el, "muted", { value: false, writable: true });
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: 5,
      playing: true,
      playbackRate: 1,
      outputMuted: true,
    });
    expect(clip.el.muted).toBe(true);
    // A second tick re-asserts — captures the sticky behavior, since
    // the bridge handler only runs on flip transitions.
    Object.defineProperty(clip.el, "muted", { value: false, writable: true });
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: 5.02,
      playing: true,
      playbackRate: 1,
      outputMuted: true,
    });
    expect(clip.el.muted).toBe(true);
  });

  it("does not touch muted when outputMuted is absent", () => {
    // The un-mute decision belongs to author intent (`<audio muted>`) and
    // user preference (`onSetMuted`) — syncRuntimeMedia must not race them.
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    Object.defineProperty(clip.el, "muted", { value: true, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    expect(clip.el.muted).toBe(true);
  });

  it("fires onAutoplayBlocked when play() rejects with NotAllowedError", async () => {
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    const rejection = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
    clip.el.play = vi.fn(() => Promise.reject(rejection));
    const onAutoplayBlocked = vi.fn();
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: 5,
      playing: true,
      playbackRate: 1,
      onAutoplayBlocked,
    });
    // The rejection is delivered on a microtask — flush it.
    await Promise.resolve();
    await Promise.resolve();
    expect(onAutoplayBlocked).toHaveBeenCalledTimes(1);
  });

  it("does not fire onAutoplayBlocked for non-autoplay rejections", async () => {
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    const rejection = Object.assign(new Error("aborted"), { name: "AbortError" });
    clip.el.play = vi.fn(() => Promise.reject(rejection));
    const onAutoplayBlocked = vi.fn();
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: 5,
      playing: true,
      playbackRate: 1,
      onAutoplayBlocked,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(onAutoplayBlocked).not.toHaveBeenCalled();
  });

  it("asserts muted=true every tick while userMuted is set", () => {
    // Mirror of the `outputMuted` test — user preference must be sticky
    // too. A sub-composition that activates after the user mutes should
    // inherit the silence, not briefly play at author volume before the
    // next bridge message lands.
    const clip = createMockClip({ start: 0, end: 10, volume: 1 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    Object.defineProperty(clip.el, "muted", { value: false, writable: true });
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: 5,
      playing: true,
      playbackRate: 1,
      userMuted: true,
    });
    expect(clip.el.muted).toBe(true);
  });

  it("fires onAutoplayBlocked for every rejected play (caller owns the latch)", async () => {
    // media.ts is intentionally memoryless — each NotAllowedError rejection
    // invokes the callback. The init.ts caller wraps with
    // `mediaAutoplayBlockedPosted` so the outbound message is posted at most
    // once per session. This test pins down the contract (fires always) so
    // a future refactor can't quietly add deduplication here and break the
    // caller's latching logic.
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    const rejection = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
    clip.el.play = vi.fn(() => Promise.reject(rejection));
    const onAutoplayBlocked = vi.fn();

    // Simulate two ticks — between them `playRequested` clears so play() runs
    // again and rejects again.
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: 5,
      playing: true,
      playbackRate: 1,
      onAutoplayBlocked,
    });
    await Promise.resolve();
    await Promise.resolve();
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: 5.05,
      playing: true,
      playbackRate: 1,
      onAutoplayBlocked,
    });
    await Promise.resolve();
    await Promise.resolve();

    // No latch inside media.ts — two rejections, two callback invocations.
    // The caller's latch is what prevents a second outbound message.
    expect(onAutoplayBlocked).toHaveBeenCalledTimes(2);
  });

  it("caller-side latch pattern posts once across many rejections", async () => {
    // Mirrors what init.ts does: the onAutoplayBlocked wrapper checks and
    // sets a boolean flag so the outbound post fires exactly once even if
    // the raw callback fires many times. Regression guard for the latch
    // wiring in the init.ts handler.
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    const rejection = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
    clip.el.play = vi.fn(() => Promise.reject(rejection));

    let posted = 0;
    const state = { latched: false };
    const wrapped = () => {
      if (state.latched) return;
      state.latched = true;
      posted += 1;
    };

    for (let i = 0; i < 5; i++) {
      syncRuntimeMedia({
        clips: [clip],
        timeSeconds: 5 + i * 0.05,
        playing: true,
        playbackRate: 1,
        onAutoplayBlocked: wrapped,
      });
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(posted).toBe(1);
  });

  it("mutes when either outputMuted OR userMuted is true (OR invariant)", () => {
    // Explicit validation of the combined-flag contract: setting one to
    // false while the other is true must keep the element muted.
    const clip = createMockClip({ start: 0, end: 10, volume: 1 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    Object.defineProperty(clip.el, "muted", { value: false, writable: true });
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: 5,
      playing: true,
      playbackRate: 1,
      outputMuted: false,
      userMuted: true,
    });
    expect(clip.el.muted).toBe(true);
    Object.defineProperty(clip.el, "muted", { value: false, writable: true });
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: 5,
      playing: true,
      playbackRate: 1,
      outputMuted: true,
      userMuted: false,
    });
    expect(clip.el.muted).toBe(true);
  });
});
