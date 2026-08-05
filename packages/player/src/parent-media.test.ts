import { describe, it, expect } from "vitest";
import { ParentMediaManager, type ProxyEntry } from "./parent-media";

// A fake media element whose paused state is driven by play()/pause() stubs.
function makeFakeAudio(initiallyPaused: boolean): HTMLMediaElement {
  const el = new Audio();
  let paused = initiallyPaused;
  Object.defineProperty(el, "paused", { get: () => paused });
  el.pause = () => {
    paused = true;
  };
  el.play = () => {
    paused = false;
    return Promise.resolve();
  };
  el.src = "https://example.test/music.mp3";
  return el;
}

function makeManager(
  overrides: Partial<{ isPaused: boolean; playbackRate: number; volume: number }> = {},
) {
  const mgr = new ParentMediaManager({
    dispatchEvent: () => {},
    getMuted: () => false,
    getVolume: () => overrides.volume ?? 1,
    getPlaybackRate: () => overrides.playbackRate ?? 1,
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

  it("pauses a proxy once the playhead passes the clip end (trimmed clip)", () => {
    const mgr = makeManager({ isPaused: false });
    const el = makeFakeAudio(false); // already playing within the clip
    mgr.entries.push({ el, start: 0, duration: 5, driftSamples: 0 });

    mgr.mirrorTime(3); // inside [0, 5) — stays playing
    expect(el.paused).toBe(false);

    mgr.mirrorTime(6); // past the trimmed end — must pause
    expect(el.paused).toBe(true);
  });

  it("re-reads the source element's live data-duration so trims bound the proxy", () => {
    const mgr = makeManager({ isPaused: false });
    const source = new Audio();
    source.setAttribute("data-start", "0");
    source.setAttribute("data-duration", "30");
    // jsdom reports isConnected=false unless attached; attach it.
    document.body.appendChild(source);

    const el = makeFakeAudio(false);
    mgr.entries.push({ el, start: 0, duration: 30, driftSamples: 0, source });

    mgr.mirrorTime(20); // within 30 → playing
    expect(el.paused).toBe(false);

    // User trims the clip to 10s; the proxy must pick it up and pause at 20s.
    source.setAttribute("data-duration", "10");
    mgr.mirrorTime(20);
    expect(el.paused).toBe(true);
    source.remove();
  });

  it("scrubAll plays in-window proxies at the playhead and pauses out-of-window ones", () => {
    const mgr = makeManager();
    const inWin = makeFakeAudio(true); // currently paused — scrub should start it
    const outWin = makeFakeAudio(false); // currently playing, but outside its window
    mgr.entries.push({ el: inWin, start: 0, duration: 5, driftSamples: 0 });
    mgr.entries.push({ el: outWin, start: 10, duration: 5, driftSamples: 0 });

    mgr.scrubAll(2); // playhead at 2s

    // in-window proxy: positioned at rel time and AUDIBLE (the point of scrub-audio)
    expect(inWin.currentTime).toBe(2);
    expect(inWin.paused).toBe(false);
    // out-of-window proxy: paused, not blipped
    expect(outWin.paused).toBe(true);
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

  it("defers connected gain changes to the runtime's live effective volume", () => {
    const mgr = makeManager({ volume: 0.5 });
    const iframeDoc = document.implementation.createHTMLDocument();
    const source = iframeDoc.createElement("audio");
    source.src = "https://example.test/scored.mp3";
    source.preload = "auto";
    source.setAttribute("data-start", "0");
    source.setAttribute("data-duration", "10");
    source.setAttribute("data-volume", "0.12");
    // The iframe runtime has already applied authored × global volume.
    source.volume = 0.06;
    iframeDoc.body.appendChild(source);

    mgr.setupFromIframe(iframeDoc);
    expect(mgr.entries).toHaveLength(1);
    const proxy = mgr.entries[0].el;
    expect(proxy.volume).toBeCloseTo(0.06);

    // GSAP/runtime envelopes are already effective values on the source. The
    // parent proxy copies them directly instead of multiplying global volume
    // a second time.
    source.volume = 0.018;
    mgr.mirrorTime(1, { force: true });
    expect(proxy.volume).toBeCloseTo(0.018);

    // A non-zero player-volume update must not reconstruct the GSAP envelope
    // from static data-volume. Keep the last effective gain until the iframe
    // runtime publishes its next authoritative source.volume value.
    mgr.updateVolume(0.25);
    expect(proxy.volume).toBeCloseTo(0.018);
    mgr.mirrorTime(1, { force: true });
    expect(proxy.volume).toBeCloseTo(0.018);

    // Once the iframe applies the new global volume, mirror it directly.
    source.volume = 0.009;
    mgr.mirrorTime(1, { force: true });
    expect(proxy.volume).toBeCloseTo(0.009);

    // Zero is safe to apply immediately. On unmute, remain silent until the
    // runtime has re-established the current envelope at the new gain.
    mgr.updateVolume(0);
    expect(proxy.volume).toBe(0);
    // A mirror can run before the iframe handles set-volume; stale non-zero
    // source gain must not undo the immediate silence.
    mgr.mirrorTime(1, { force: true });
    expect(proxy.volume).toBe(0);
    source.volume = 0;
    mgr.mirrorTime(1, { force: true });
    mgr.updateVolume(0.75);
    expect(proxy.volume).toBe(0);
    mgr.mirrorTime(1, { force: true });
    expect(proxy.volume).toBe(0);
    source.volume = 0.09;
    mgr.mirrorTime(1, { force: true });
    expect(proxy.volume).toBeCloseTo(0.09);

    // A fully faded track stays fully faded when global volume changes.
    source.volume = 0;
    mgr.mirrorTime(1, { force: true });
    mgr.updateVolume(0.5);
    mgr.mirrorTime(1, { force: true });
    expect(proxy.volume).toBe(0);

    mgr.destroy();
  });

  it("applies live media offsets to mirror, seek, and scrub positioning", () => {
    const mgr = makeManager();
    const iframeDoc = document.implementation.createHTMLDocument();
    const source = iframeDoc.createElement("audio");
    source.src = "https://example.test/offset.mp3";
    source.preload = "auto";
    source.setAttribute("data-start", "5");
    source.setAttribute("data-duration", "10");
    source.setAttribute("data-media-start", "36.947");
    iframeDoc.body.appendChild(source);

    mgr.setupFromIframe(iframeDoc);
    expect(mgr.entries).toHaveLength(1);
    const proxy = mgr.entries[0].el;

    mgr.mirrorTime(7, { force: true });
    expect(proxy.currentTime).toBeCloseTo(38.947);

    mgr.seekAll(8);
    expect(proxy.currentTime).toBeCloseTo(39.947);

    mgr.scrubAll(9);
    expect(proxy.currentTime).toBeCloseTo(40.947);

    // Both aliases are live, with data-playback-start taking precedence just
    // as it does in the iframe runtime.
    source.setAttribute("data-media-start", "10");
    mgr.mirrorTime(7, { force: true });
    expect(proxy.currentTime).toBeCloseTo(12);
    source.setAttribute("data-playback-start", "4");
    mgr.mirrorTime(7, { force: true });
    expect(proxy.currentTime).toBeCloseTo(6);

    mgr.destroy();
  });

  it("combines authored and global playback rates in positioning and playback", () => {
    const state = { playbackRate: 0.5 };
    const mgr = makeManager(state);
    const iframeDoc = document.implementation.createHTMLDocument();
    const source = iframeDoc.createElement("audio");
    source.src = "https://example.test/rate.mp3";
    source.preload = "auto";
    source.setAttribute("data-start", "5");
    source.setAttribute("data-duration", "10");
    source.setAttribute("data-media-start", "3");
    source.setAttribute("data-playback-rate", "2");
    iframeDoc.body.appendChild(source);

    mgr.setupFromIframe(iframeDoc);
    expect(mgr.entries).toHaveLength(1);
    const proxy = mgr.entries[0].el;
    expect(proxy.playbackRate).toBe(1);

    mgr.mirrorTime(7, { force: true });
    expect(proxy.currentTime).toBe(7);

    mgr.seekAll(8);
    expect(proxy.currentTime).toBe(9);

    mgr.scrubAll(9);
    expect(proxy.currentTime).toBe(11);

    state.playbackRate = 1.5;
    mgr.updatePlaybackRate(state.playbackRate);
    expect(proxy.playbackRate).toBe(3);
    mgr.mirrorTime(7, { force: true });
    expect(proxy.playbackRate).toBe(3);

    // Live authored-rate edits affect both source-time mapping and effective
    // proxy playback without requiring re-adoption.
    source.setAttribute("data-playback-rate", "0.75");
    mgr.mirrorTime(7, { force: true });
    expect(proxy.currentTime).toBe(4.5);
    expect(proxy.playbackRate).toBe(1.125);

    mgr.destroy();
  });

  it("keeps URL-driven proxies at the global playback rate", () => {
    const state = { playbackRate: 0.75, volume: 0.5 };
    const mgr = makeManager(state);
    mgr.setupFromUrl("https://example.test/url-rate.mp3");
    expect(mgr.entries[0].el.playbackRate).toBe(0.75);
    expect(mgr.entries[0].el.volume).toBe(0.5);

    state.volume = 0.25;
    mgr.updateVolume(state.volume);
    expect(mgr.entries[0].el.volume).toBe(0.25);

    state.playbackRate = 1.25;
    mgr.updatePlaybackRate(state.playbackRate);
    expect(mgr.entries[0].el.playbackRate).toBe(1.25);
    mgr.mirrorTime(2, { force: true });
    expect(mgr.entries[0].el.currentTime).toBe(2);
    expect(mgr.entries[0].el.playbackRate).toBe(1.25);

    mgr.destroy();
  });
});
