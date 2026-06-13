import { describe, it, expect } from "vitest";
import { ParentMediaManager, type ProxyEntry } from "./parent-media";

function makeManager(overrides: Partial<{ isPaused: boolean; owner: "runtime" | "parent" }> = {}) {
  const mgr = new ParentMediaManager({
    dispatchEvent: () => {},
    getMuted: () => false,
    getVolume: () => 1,
    getPlaybackRate: () => 1,
    getCurrentTime: () => 0,
    isPaused: () => overrides.isPaused ?? true,
  });
  return mgr;
}

describe("ParentMediaManager audio-src proxy lifecycle", () => {
  it("replaces the audio-src proxy instead of stacking a second one", () => {
    const mgr = makeManager();
    mgr.setupFromUrl("https://example.test/a.mp3");
    expect(mgr.entries).toHaveLength(1);

    mgr.setupFromUrl("https://example.test/b.mp3");
    // The old proxy must be gone, not accumulated alongside the new one.
    expect(mgr.entries).toHaveLength(1);
    expect(mgr.entries[0].el.src).toBe("https://example.test/b.mp3");
  });

  it("is a no-op when the same audio-src URL is set again", () => {
    const mgr = makeManager();
    mgr.setupFromUrl("https://example.test/a.mp3");
    const first = mgr.entries[0];

    mgr.setupFromUrl("https://example.test/a.mp3");
    expect(mgr.entries).toHaveLength(1);
    // Same element reference — not torn down and rebuilt.
    expect(mgr.entries[0]).toBe(first);
  });

  it("clears the audio-src proxy on teardownUrlAudio", () => {
    const mgr = makeManager();
    mgr.setupFromUrl("https://example.test/a.mp3");
    const el = mgr.entries[0].el;

    mgr.teardownUrlAudio();
    expect(mgr.entries).toHaveLength(0);
    // The proxy's source is reset so it stops preloading.
    expect(el.src).not.toBe("https://example.test/a.mp3");
  });

  it("teardownUrlAudio removes only the url proxy, leaving other entries", () => {
    const mgr = makeManager();
    // Simulate an iframe-adopted entry already in the pool.
    const adopted: ProxyEntry = {
      el: new Audio(),
      start: 0,
      duration: Infinity,
      driftSamples: 0,
    };
    adopted.el.src = "https://example.test/iframe-clip.mp4";
    mgr.entries.push(adopted);

    mgr.setupFromUrl("https://example.test/a.mp3");
    expect(mgr.entries).toHaveLength(2);

    mgr.teardownUrlAudio();
    expect(mgr.entries).toHaveLength(1);
    expect(mgr.entries[0]).toBe(adopted);
  });

  it("teardownUrlAudio is safe to call with no audio-src set", () => {
    const mgr = makeManager();
    expect(() => mgr.teardownUrlAudio()).not.toThrow();
    expect(mgr.entries).toHaveLength(0);
  });

  it("does not duplicate or hijack a clip the composition already owns", () => {
    const mgr = makeManager();
    // The composition already adopted a clip with this URL.
    const adopted: ProxyEntry = {
      el: new Audio(),
      start: 0,
      duration: Infinity,
      driftSamples: 0,
    };
    adopted.el.src = "https://example.test/shared.mp3";
    mgr.entries.push(adopted);

    // Pointing audio-src at the same URL must not create a second proxy...
    mgr.setupFromUrl("https://example.test/shared.mp3");
    expect(mgr.entries).toHaveLength(1);
    expect(mgr.entries[0]).toBe(adopted);

    // ...and removing audio-src must not tear down the composition's own clip
    // (teardown targets the tracked proxy by reference, not by URL match).
    mgr.teardownUrlAudio();
    expect(mgr.entries).toHaveLength(1);
    expect(mgr.entries[0]).toBe(adopted);
  });
});
