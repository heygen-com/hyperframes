import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatTime, formatSpeed, SPEED_PRESETS } from "./controls.js";

// ── Controls unit tests ──

describe("SPEED_PRESETS", () => {
  it("contains logarithmic speed steps", () => {
    expect(SPEED_PRESETS).toEqual([0.25, 0.5, 1, 1.5, 2, 4]);
  });

  it("includes 1x as default speed", () => {
    expect(SPEED_PRESETS).toContain(1);
  });
});

describe("formatSpeed", () => {
  it("formats integer speeds", () => {
    expect(formatSpeed(1)).toBe("1x");
    expect(formatSpeed(2)).toBe("2x");
    expect(formatSpeed(4)).toBe("4x");
  });

  it("formats fractional speeds", () => {
    expect(formatSpeed(0.25)).toBe("0.25x");
    expect(formatSpeed(0.5)).toBe("0.5x");
    expect(formatSpeed(1.5)).toBe("1.5x");
  });
});

describe("formatTime", () => {
  it("formats 0 seconds", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats seconds under a minute", () => {
    expect(formatTime(45)).toBe("0:45");
  });

  it("formats exact minutes", () => {
    expect(formatTime(120)).toBe("2:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(95)).toBe("1:35");
  });

  it("pads seconds with leading zero", () => {
    expect(formatTime(61)).toBe("1:01");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(3.7)).toBe("0:03");
  });

  it("handles negative input", () => {
    expect(formatTime(-5)).toBe("0:00");
  });
});

// ── Parent-frame audio proxies (ownership-based) ──
//
// Parent-frame audio/video copies are preloaded mirror proxies of the iframe's
// timed media. They exist as a fallback for environments that block iframe
// `.play()`. Under the default `runtime` audio ownership, the iframe drives
// audible playback and the proxies stay paused. Ownership flips to `parent`
// only when the runtime posts `media-autoplay-blocked` — then the proxies
// become the audible source and the iframe is silenced via bridge.

describe("HyperframesPlayer parent-frame media", () => {
  type PlayerElement = HTMLElement & {
    play: () => void;
    pause: () => void;
    seek: (t: number) => void;
    _audioOwner?: "runtime" | "parent";
    _promoteToParentProxy?: () => void;
  };

  let player: PlayerElement;
  let mockAudio: {
    src: string;
    preload: string;
    muted: boolean;
    playbackRate: number;
    currentTime: number;
    paused: boolean;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    await import("./hyperframes-player.js");

    mockAudio = {
      src: "",
      preload: "",
      muted: false,
      playbackRate: 1,
      currentTime: 0,
      paused: true,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      load: vi.fn(),
    };

    vi.spyOn(globalThis, "Audio").mockImplementation(
      () => mockAudio as unknown as HTMLAudioElement,
    );

    player = document.createElement("hyperframes-player") as PlayerElement;
  });

  afterEach(() => {
    player.remove();
    vi.restoreAllMocks();
  });

  it("includes audio-src in observedAttributes", () => {
    const Ctor = player.constructor as typeof HTMLElement & {
      observedAttributes: string[];
    };
    expect(Ctor.observedAttributes).toContain("audio-src");
  });

  it("creates Audio and starts preloading when audio-src is set", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    expect(globalThis.Audio).toHaveBeenCalled();
    expect(mockAudio.preload).toBe("auto");
    expect(mockAudio.src).toBe("https://cdn.example.com/narration.mp3");
    expect(mockAudio.load).toHaveBeenCalled();
  });

  it("syncs muted attribute to parent media", () => {
    player.setAttribute("muted", "");
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    expect(mockAudio.muted).toBe(true);
  });

  it("syncs playback-rate to parent media", () => {
    player.setAttribute("playback-rate", "1.5");
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    expect(mockAudio.playbackRate).toBe(1.5);
  });

  it("play() does NOT start parent-proxy under runtime ownership", () => {
    // Default ownership is `runtime` — the iframe drives audible playback.
    // If we also started parent proxies here, both would play and the user
    // would hear doubled, slightly-offset audio (the original bug).
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.play();
    expect(mockAudio.play).not.toHaveBeenCalled();
    expect(player._audioOwner).toBe("runtime");
  });

  it("pause() does NOT touch parent-proxy under runtime ownership", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.pause();
    expect(mockAudio.pause).not.toHaveBeenCalled();
  });

  it("seek() does NOT update parent currentTime under runtime ownership", () => {
    // Under runtime ownership the iframe is authoritative for time; touching
    // the proxy's currentTime would just trigger a re-buffer for no gain.
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.seek(12.5);
    expect(mockAudio.currentTime).toBe(0);
  });

  it("after promotion to parent ownership: play/pause/seek drive parent proxy", () => {
    // Simulates the runtime having posted `media-autoplay-blocked`. Post
    // promotion: the web component owns audible output and fully drives
    // the parent proxy.
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player._promoteToParentProxy?.();
    expect(player._audioOwner).toBe("parent");

    player.play();
    expect(mockAudio.play).toHaveBeenCalled();

    player.seek(12.5);
    expect(mockAudio.currentTime).toBe(12.5);

    player.pause();
    expect(mockAudio.pause).toHaveBeenCalled();
  });

  it("promotion is idempotent", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player._promoteToParentProxy?.();
    player._promoteToParentProxy?.();
    player._promoteToParentProxy?.();
    // Only one play() attempt is triggered by promotion itself (gated on
    // `!this._paused`, which is true by default so it doesn't trigger at all).
    // The test's meaning is: ownership stays `parent`, no thrash, no errors.
    expect(player._audioOwner).toBe("parent");
  });

  it("dispatches audioownershipchange on promotion", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    const events: Array<{ owner: string; reason: string }> = [];
    player.addEventListener("audioownershipchange", (e: Event) => {
      const detail = (e as CustomEvent<{ owner: string; reason: string }>).detail;
      events.push(detail);
    });

    player._promoteToParentProxy?.();
    expect(events).toEqual([{ owner: "parent", reason: "autoplay-blocked" }]);

    // Second promote is idempotent — no duplicate event.
    player._promoteToParentProxy?.();
    expect(events).toHaveLength(1);
  });

  it("promotion mid-playback plays parent proxy immediately", () => {
    // Previously-missing coverage: if the user is already playing when
    // the runtime reports autoplay-blocked, the proxy must start audible
    // right away — not wait for the user to hit pause/play again.
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.play(); // `_paused = false`, owner still `runtime` → no parent play yet
    expect(mockAudio.play).not.toHaveBeenCalled();

    player._promoteToParentProxy?.();
    expect(mockAudio.play).toHaveBeenCalled();
  });

  it("surfaces playbackerror when parent proxy play() rejects", async () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    const rejection = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
    mockAudio.play = vi.fn().mockRejectedValueOnce(rejection);

    const errors: unknown[] = [];
    player.addEventListener("playbackerror", (e: Event) => {
      errors.push((e as CustomEvent).detail);
    });

    player._promoteToParentProxy?.();
    player.play();
    // Promise rejection delivered on a microtask — flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(errors.length).toBeGreaterThan(0);
    expect((errors[0] as { source: string }).source).toBe("parent-proxy");
  });

  it("playbackerror dedup: fires at most once per parent-ownership session", async () => {
    // Under parent ownership with parent-also-blocked, every iframe
    // paused→playing transition in the state loop re-invokes `_playParentMedia`.
    // Without a latch, each rejection would re-fire `playbackerror`, spamming
    // subscribers. Mirrors the runtime's `mediaAutoplayBlockedPosted` latch.
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    const rejection = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
    mockAudio.play = vi.fn().mockRejectedValue(rejection);

    const errors: unknown[] = [];
    player.addEventListener("playbackerror", (e: Event) => {
      errors.push((e as CustomEvent).detail);
    });

    player._promoteToParentProxy?.();
    player.play();
    player.pause();
    player.play();
    player.pause();
    player.play();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toHaveLength(1);
  });

  it("cleans up parent media on disconnect", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.remove();
    expect(mockAudio.pause).toHaveBeenCalled();
    expect(mockAudio.src).toBe("");
  });

  it("updates parent media when playback-rate changes after setup", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.setAttribute("playback-rate", "2");
    expect(mockAudio.playbackRate).toBe(2);
  });

  it("updates parent media when muted toggles after setup", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.setAttribute("muted", "");
    expect(mockAudio.muted).toBe(true);

    player.removeAttribute("muted");
    expect(mockAudio.muted).toBe(false);
  });
});

// ── Shader transition preview controls ──
//
// Shader transition capture scale and loading UI ownership are player-level
// preview concerns. The player forwards those options into the iframe before
// the composition runs, then renders transition-prep progress from runtime
// messages when `shader-loading="player"` is enabled.

describe("HyperframesPlayer shader transition options", () => {
  type PlayerWithIframe = HTMLElement & {
    iframeElement: HTMLIFrameElement;
  };

  beforeEach(async () => {
    await import("./hyperframes-player.js");
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("observes shader capture scale and loading attributes", () => {
    const player = document.createElement("hyperframes-player");
    const Ctor = player.constructor as typeof HTMLElement & {
      observedAttributes: string[];
    };

    expect(Ctor.observedAttributes).toContain("shader-capture-scale");
    expect(Ctor.observedAttributes).toContain("shader-loading");
  });

  it("passes shader options through src query parameters", () => {
    const player = document.createElement("hyperframes-player") as PlayerWithIframe;
    player.setAttribute("shader-capture-scale", "0.5");
    player.setAttribute("shader-loading", "player");
    player.setAttribute("src", "/api/projects/demo/preview?x=1#stage");

    const url = new URL(player.iframeElement.src);
    expect(url.pathname).toBe("/api/projects/demo/preview");
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.searchParams.get("__hf_shader_capture_scale")).toBe("0.5");
    expect(url.searchParams.get("__hf_shader_loading")).toBe("player");
    expect(url.hash).toBe("#stage");
  });

  it("injects shader options into srcdoc before composition scripts run", () => {
    const player = document.createElement("hyperframes-player") as PlayerWithIframe;
    player.setAttribute("shader-capture-scale", "0.5");
    player.setAttribute("shader-loading", "player");
    player.setAttribute(
      "srcdoc",
      '<!doctype html><html><head><script src="composition.js"></script></head><body></body></html>',
    );

    const srcdoc = player.iframeElement.srcdoc;
    expect(srcdoc).toContain('window.__HF_SHADER_CAPTURE_SCALE="0.5";');
    expect(srcdoc).toContain('window.__HF_SHADER_LOADING="player";');
    expect(srcdoc.indexOf("data-hyperframes-player-shader-options")).toBeLessThan(
      srcdoc.indexOf("composition.js"),
    );
  });

  it("shows and hides the player-owned shader loader from transition state messages", () => {
    vi.useFakeTimers();
    const player = document.createElement("hyperframes-player") as PlayerWithIframe;
    player.setAttribute("shader-loading", "player");
    document.body.appendChild(player);

    const iframeWindow = player.iframeElement.contentWindow;
    expect(iframeWindow).toBeTruthy();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframeWindow,
        data: {
          source: "hf-preview",
          type: "shader-transition-state",
          compositionId: "main",
          state: {
            loading: true,
            progress: 3,
            total: 10,
            currentTransition: 1,
            transitionTotal: 2,
            transitionFrame: 3,
            transitionFrames: 5,
            phase: "capturing",
          },
        },
      }),
    );

    const loader = player.shadowRoot?.querySelector(".hfp-shader-loader");
    expect(loader?.classList.contains("hfp-visible")).toBe(true);
    expect(loader?.textContent).toContain("1/2");
    expect(loader?.textContent).toContain("3/5");

    const playEvents: Event[] = [];
    player.addEventListener("play", (event) => playEvents.push(event));
    loader?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(playEvents).toHaveLength(0);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframeWindow,
        data: {
          source: "hf-preview",
          type: "shader-transition-state",
          compositionId: "main",
          state: { loading: false, ready: true },
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframeWindow,
        data: {
          source: "hf-preview",
          type: "shader-transition-state",
          compositionId: "main",
          state: { loading: false, ready: true },
        },
      }),
    );
    expect(loader?.classList.contains("hfp-visible")).toBe(false);
    expect(loader?.classList.contains("hfp-hiding")).toBe(true);
    vi.advanceTimersByTime(420);
    expect(loader?.classList.contains("hfp-hiding")).toBe(false);
    vi.useRealTimers();
  });
});

// ── Shared stylesheet (adoptedStyleSheets) ──
//
// Every player constructed in the same document should adopt the *same*
// CSSStyleSheet instance instead of getting its own <style> element. This is
// the studio thumbnail-grid win — N players, one parsed sheet.

describe("HyperframesPlayer adoptedStyleSheets", () => {
  type AdoptingShadowRoot = ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] };
  type PlayerWithShadow = HTMLElement & { shadowRoot: AdoptingShadowRoot | null };

  beforeEach(async () => {
    await import("./hyperframes-player.js");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shares a single CSSStyleSheet across multiple player instances", () => {
    const a = document.createElement("hyperframes-player") as PlayerWithShadow;
    const b = document.createElement("hyperframes-player") as PlayerWithShadow;
    document.body.appendChild(a);
    document.body.appendChild(b);

    const sheetsA = a.shadowRoot?.adoptedStyleSheets ?? [];
    const sheetsB = b.shadowRoot?.adoptedStyleSheets ?? [];

    expect(sheetsA.length).toBeGreaterThan(0);
    expect(sheetsB.length).toBeGreaterThan(0);
    expect(sheetsA.at(-1)).toBe(sheetsB.at(-1));
  });

  it("does not inject a per-instance <style> when adoption succeeds", () => {
    const player = document.createElement("hyperframes-player") as PlayerWithShadow;
    document.body.appendChild(player);

    expect(player.shadowRoot?.querySelector("style")).toBeNull();
  });
});

// ── Media MutationObserver scoping ──
//
// The observer that catches late-attached `<audio data-start>` from
// sub-composition activation used to watch `iframe.contentDocument.body`
// wholesale. That fired on every body-level mutation — analytics scripts,
// runtime telemetry markers, dev-only overlays — even though only
// composition-tree changes can introduce new timed media. The fix is to
// scope per top-level composition host (see `selectMediaObserverTargets`);
// these tests verify the player honors that scoping.

describe("HyperframesPlayer media MutationObserver scoping", () => {
  type PlayerInternal = HTMLElement & {
    _observeDynamicMedia?: (doc: Document) => void;
  };

  beforeEach(async () => {
    await import("./hyperframes-player.js");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("attaches the observer to each top-level composition host (not the body)", () => {
    const observeSpy = vi.spyOn(MutationObserver.prototype, "observe");

    const player = document.createElement("hyperframes-player") as PlayerInternal;
    document.body.appendChild(player);
    // The constructor doesn't install an observer — only `_observeDynamicMedia`
    // does — so the spy starts clean for the call we care about.
    observeSpy.mockClear();

    // Simulates the iframe document the runtime hands the player after mount.
    // Bypassing the iframe lifecycle keeps the test deterministic; the
    // selection logic itself is exercised in `mediaObserverScope.test.ts`.
    const fakeDoc = document.implementation.createHTMLDocument("test");
    fakeDoc.body.innerHTML = `
      <div data-composition-id="root-a"></div>
      <div data-composition-id="root-b"></div>
      <script>// runtime telemetry — body-level, must NOT be observed</script>
    `;

    player._observeDynamicMedia?.(fakeDoc);

    expect(observeSpy).toHaveBeenCalledTimes(2);
    const observedTargets = observeSpy.mock.calls.map((call) => call[0]);
    expect(observedTargets.map((t) => (t as Element).getAttribute("data-composition-id"))).toEqual([
      "root-a",
      "root-b",
    ]);
    expect(observedTargets).not.toContain(fakeDoc.body);
    // Subtree is still required — sub-composition media can be deeply nested
    // inside the host (e.g. wrapper div around the `<audio>`).
    for (const call of observeSpy.mock.calls) {
      expect(call[1]).toEqual({ childList: true, subtree: true });
    }
  });

  it("falls back to observing the document body when no composition hosts exist", () => {
    // Preserves the legacy behavior for documents that haven't bootstrapped
    // a composition tree yet (e.g. a blank iframe between src changes).
    const observeSpy = vi.spyOn(MutationObserver.prototype, "observe");

    const player = document.createElement("hyperframes-player") as PlayerInternal;
    document.body.appendChild(player);
    observeSpy.mockClear();

    const fakeDoc = document.implementation.createHTMLDocument("test");
    fakeDoc.body.innerHTML = `<div class="not-a-composition"></div>`;

    player._observeDynamicMedia?.(fakeDoc);

    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(observeSpy.mock.calls[0]?.[0]).toBe(fakeDoc.body);
  });
});

// ── Parent-proxy time-mirror coalescing ──
//
// `_mirrorParentMediaTime` is the steady-state correction loop that nudges
// every parent-frame audio/video proxy back onto the iframe's timeline. The
// post-`P1-4` contract: a single over-threshold sample (one slow bridge tick,
// one tab-throttled rAF, one GC pause) is absorbed by a per-proxy counter and
// does NOT cost a `currentTime` write. Only a *trending* drift — two
// consecutive samples above the 50 ms threshold — triggers a seek. Forced
// callers (audio-ownership promotion, brand-new proxy initialization) bypass
// the gate so the listener never hears a misaligned sample on cut-over.

describe("HyperframesPlayer parent-proxy time-mirror coalescing", () => {
  type DriftEntry = {
    el: { currentTime: number; src: string; pause: () => void };
    start: number;
    duration: number;
    driftSamples: number;
  };
  type PlayerInternal = HTMLElement & {
    _parentMedia: DriftEntry[];
    _mirrorParentMediaTime: (timelineSeconds: number, options?: { force?: boolean }) => void;
    _promoteToParentProxy?: () => void;
  };

  let player: PlayerInternal;

  beforeEach(async () => {
    await import("./hyperframes-player.js");
    player = document.createElement("hyperframes-player") as PlayerInternal;
    document.body.appendChild(player);
    // No audio-src was set, so `_parentMedia` is empty. Tests push synthetic
    // POJO entries — `_mirrorParentMediaTime` only reads/writes
    // `el.currentTime`, so a plain object stands in fine for HTMLMediaElement.
  });

  afterEach(() => {
    player.remove();
    vi.restoreAllMocks();
  });

  function makeEntry(
    opts: {
      currentTime?: number;
      start?: number;
      duration?: number;
      driftSamples?: number;
    } = {},
  ): DriftEntry {
    // Include `pause`/`src` so `disconnectedCallback`'s teardown loop
    // (`m.el.pause(); m.el.src = ""`) doesn't blow up when the player is
    // removed at the end of the test — `_mirrorParentMediaTime` itself only
    // touches `currentTime`.
    const entry: DriftEntry = {
      el: {
        currentTime: opts.currentTime ?? 0,
        src: "",
        pause: vi.fn(),
      },
      start: opts.start ?? 0,
      duration: opts.duration ?? 100,
      driftSamples: opts.driftSamples ?? 0,
    };
    player._parentMedia.push(entry);
    return entry;
  }

  it("initializes new parent-media entries with driftSamples=0", () => {
    // Mock Audio just for this test so the audio-src bootstrap path produces
    // a real entry rather than throwing on construction.
    const mockAudio = {
      src: "",
      preload: "",
      muted: false,
      playbackRate: 1,
      currentTime: 0,
      paused: true,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      load: vi.fn(),
    };
    vi.spyOn(globalThis, "Audio").mockImplementation(
      () => mockAudio as unknown as HTMLAudioElement,
    );

    const fresh = document.createElement("hyperframes-player") as PlayerInternal;
    fresh.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(fresh);

    expect(fresh._parentMedia).toHaveLength(1);
    expect(fresh._parentMedia[0]?.driftSamples).toBe(0);
    fresh.remove();
  });

  it("does nothing when drift is within the 50 ms threshold", () => {
    const m = makeEntry({ currentTime: 5 });
    player._mirrorParentMediaTime(5.04);
    expect(m.el.currentTime).toBe(5);
    expect(m.driftSamples).toBe(0);
  });

  it("absorbs a single over-threshold spike without writing currentTime", () => {
    const m = makeEntry({ currentTime: 5 });
    player._mirrorParentMediaTime(5.5);
    expect(m.el.currentTime).toBe(5);
    expect(m.driftSamples).toBe(1);
  });

  it("issues a seek on the second consecutive over-threshold sample", () => {
    const m = makeEntry({ currentTime: 5 });
    player._mirrorParentMediaTime(5.5);
    expect(m.el.currentTime).toBe(5);
    expect(m.driftSamples).toBe(1);
    // Second sample with the same drift: the gate trips, the write fires,
    // and the counter resets so the proxy doesn't re-seek every later tick.
    player._mirrorParentMediaTime(5.5);
    expect(m.el.currentTime).toBe(5.5);
    expect(m.driftSamples).toBe(0);
  });

  it("resets the counter when a sample comes back within threshold", () => {
    const m = makeEntry({ currentTime: 5 });
    player._mirrorParentMediaTime(5.5);
    expect(m.driftSamples).toBe(1);
    // Recovery — counter must clear so a later isolated spike doesn't
    // accidentally satisfy the 2-sample gate by piggy-backing on stale state.
    player._mirrorParentMediaTime(5.02);
    expect(m.driftSamples).toBe(0);
    expect(m.el.currentTime).toBe(5);
    player._mirrorParentMediaTime(5.5);
    expect(m.driftSamples).toBe(1);
    expect(m.el.currentTime).toBe(5);
  });

  it("force: true writes immediately on the first over-threshold sample", () => {
    const m = makeEntry({ currentTime: 5 });
    player._mirrorParentMediaTime(5.5, { force: true });
    expect(m.el.currentTime).toBe(5.5);
    expect(m.driftSamples).toBe(0);
  });

  it("force: true clears any pre-existing drift counter", () => {
    const m = makeEntry({ currentTime: 5, driftSamples: 1 });
    player._mirrorParentMediaTime(5.5, { force: true });
    expect(m.el.currentTime).toBe(5.5);
    expect(m.driftSamples).toBe(0);
  });

  it("does not seek out-of-range entries and resets their counters", () => {
    // Active window [10, 15). currentTime=99 is a sentinel — if the function
    // ever writes inside an out-of-range branch the test catches it because
    // relTime would be 5 (or 15), not 99.
    const m = makeEntry({
      currentTime: 99,
      start: 10,
      duration: 5,
      driftSamples: 5,
    });
    player._mirrorParentMediaTime(5);
    expect(m.el.currentTime).toBe(99);
    expect(m.driftSamples).toBe(0);
    // Boundary: relTime === duration → still out of range (the loop uses `>=`).
    m.driftSamples = 7;
    player._mirrorParentMediaTime(15);
    expect(m.el.currentTime).toBe(99);
    expect(m.driftSamples).toBe(0);
  });

  it("tracks drift independently across multiple proxies", () => {
    // a is drifted; b is aligned. A single tick must increment a's counter
    // and reset b's — proving the per-entry state is genuinely per-entry.
    const a = makeEntry({ currentTime: 5 });
    const b = makeEntry({ currentTime: 7.01, driftSamples: 1 });
    player._mirrorParentMediaTime(7);
    expect(a.el.currentTime).toBe(5);
    expect(a.driftSamples).toBe(1);
    expect(b.el.currentTime).toBe(7.01);
    expect(b.driftSamples).toBe(0);
  });

  it("force: true bypasses the gate for every proxy in a single sweep", () => {
    const a = makeEntry({ currentTime: 5 });
    const b = makeEntry({ currentTime: 8 });
    player._mirrorParentMediaTime(7, { force: true });
    expect(a.el.currentTime).toBe(7);
    expect(b.el.currentTime).toBe(7);
    expect(a.driftSamples).toBe(0);
    expect(b.driftSamples).toBe(0);
  });

  it("_promoteToParentProxy invokes _mirrorParentMediaTime with force: true", () => {
    // Integration check of the promotion call site — we cannot tolerate even
    // ~80 ms of audible drift across an ownership flip, so the call site
    // must opt out of the jitter gate.
    const spy = vi.spyOn(player, "_mirrorParentMediaTime");
    player._promoteToParentProxy?.();
    const forcedCall = spy.mock.calls.find(([, opts]) => opts?.force === true);
    expect(forcedCall).toBeDefined();
  });
});

// ── Synchronous seek() with same-origin detection ──
//
// Studio has long reached past the postMessage bridge and called the runtime's
// `__player.seek` directly (`useTimelinePlayer.ts:233`) — that's the only way
// to land a scrubbed frame in the same task as the input event so the user
// sees no perceived lag. P3-1 promotes that pattern to a public API: the
// player element's own `seek()` now tries the same shortcut first, and only
// falls back to the async postMessage bridge when the iframe is genuinely
// cross-origin (or the runtime hasn't installed `__player` yet). The tests
// here stub `iframe.contentWindow` so we can exercise the branch matrix
// without booting an actual runtime.

describe("HyperframesPlayer seek() sync path", () => {
  type SyncPlayerStub = {
    seek?: (t: number) => void;
    play?: () => void;
    pause?: () => void;
  };
  type FakeContentWindow = {
    __player?: SyncPlayerStub;
    postMessage?: ReturnType<typeof vi.fn>;
  };
  type PlayerInternal = HTMLElement & {
    seek: (t: number) => void;
    iframe: HTMLIFrameElement;
    _currentTime: number;
  };

  let player: PlayerInternal;

  beforeEach(async () => {
    await import("./hyperframes-player.js");
    player = document.createElement("hyperframes-player") as PlayerInternal;
    document.body.appendChild(player);
  });

  afterEach(() => {
    player.remove();
    vi.restoreAllMocks();
  });

  // Replace the iframe's `contentWindow` getter so the test controls what the
  // sync path sees. Passing `"throw"` simulates the cross-origin SecurityError
  // a real browser raises when reading `contentWindow.<anything>`.
  function stubContentWindow(stub: FakeContentWindow | "throw") {
    Object.defineProperty(player.iframe, "contentWindow", {
      configurable: true,
      get() {
        if (stub === "throw") throw new Error("SecurityError");
        return stub;
      },
    });
  }

  it("calls __player.seek directly on the same-origin path", () => {
    // The whole point of P3-1: when the runtime is reachable, scrubs land in
    // the same task as the input. `postMessage` must NOT also fire — that
    // would cause a duplicate, async re-seek a tick later.
    const sync = vi.fn();
    const post = vi.fn();
    stubContentWindow({ __player: { seek: sync }, postMessage: post });

    player.seek(12.5);

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(12.5);
    expect(post).not.toHaveBeenCalled();
  });

  it("passes the raw time-in-seconds through, not a rounded frame number", () => {
    // The postMessage bridge has to round to a frame at the wire boundary,
    // but the in-process call accepts seconds directly — preserving the
    // caller's precision for fractional scrubs.
    const sync = vi.fn();
    stubContentWindow({ __player: { seek: sync } });

    player.seek(7.3333);

    expect(sync).toHaveBeenCalledWith(7.3333);
  });

  it("falls back to postMessage when __player has not been installed yet", () => {
    // Before the runtime bootstraps, `contentWindow` exists but `__player` is
    // undefined. The fallback queues the seek via postMessage, which the
    // runtime drains once `installRuntimeControlBridge` runs.
    const post = vi.fn();
    stubContentWindow({ postMessage: post });

    player.seek(12.5);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "hf-parent",
        type: "control",
        action: "seek",
        frame: Math.round(12.5 * 30),
      }),
      "*",
    );
  });

  it("falls back to postMessage when __player exists but lacks seek()", () => {
    // Defensive: a partial `__player` (e.g. older runtime, mocked stub) must
    // not be assumed callable. `typeof seek !== "function"` guards this.
    const post = vi.fn();
    stubContentWindow({
      __player: { play: vi.fn(), pause: vi.fn() },
      postMessage: post,
    });

    player.seek(7);

    expect(post).toHaveBeenCalledWith(expect.objectContaining({ action: "seek", frame: 210 }), "*");
  });

  it("does not throw when contentWindow access raises (cross-origin embed)", () => {
    // Reading `iframe.contentWindow` on a true cross-origin iframe throws a
    // DOMException. Both `_trySyncSeek` AND the postMessage fallback hit the
    // same getter, so both swallow the error — the public seek() must remain
    // a clean no-op surface for the caller.
    stubContentWindow("throw");

    expect(() => player.seek(12.5)).not.toThrow();
  });

  it("falls back to postMessage when __player.seek throws at runtime", () => {
    // If the runtime's seek implementation panics, we catch in `_trySyncSeek`
    // and degrade to the bridge. The postMessage path runs in a separate
    // task — it may succeed where the sync call failed, and at worst the
    // failure mode is identical.
    const sync = vi.fn(() => {
      throw new Error("runtime panic");
    });
    const post = vi.fn();
    stubContentWindow({ __player: { seek: sync }, postMessage: post });

    expect(() => player.seek(12.5)).not.toThrow();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ action: "seek" }), "*");
  });

  it("updates _currentTime regardless of which path is taken", () => {
    // `_currentTime` is the parent-side cache that drives controls and parent
    // proxy mirroring. It must update unconditionally — otherwise scrubs on a
    // cross-origin embed leave the controls UI showing stale time.
    const sync = vi.fn();
    stubContentWindow({ __player: { seek: sync } });
    player.seek(8.25);
    expect(player._currentTime).toBe(8.25);

    // Reset and verify the fallback path produces the same caching behavior.
    stubContentWindow({ postMessage: vi.fn() });
    player.seek(11);
    expect(player._currentTime).toBe(11);
  });
});

describe("HyperframesPlayer loop end-state handling", () => {
  type PlayerInternal = HTMLElement & {
    iframe: HTMLIFrameElement;
    play: () => void;
    seek: (timeInSeconds: number) => void;
    loop: boolean;
    _duration: number;
    _paused: boolean;
    _onMessage: (event: MessageEvent) => void;
  };

  let player: PlayerInternal;
  let frameWindow: Window;

  beforeEach(async () => {
    await import("./hyperframes-player.js");
    player = document.createElement("hyperframes-player") as PlayerInternal;
    frameWindow = window;
    vi.spyOn(frameWindow, "postMessage").mockImplementation(() => undefined);
    Object.defineProperty(player.iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });
    document.body.appendChild(player);
  });

  afterEach(() => {
    player.remove();
    vi.restoreAllMocks();
  });

  it("wraps and keeps playing when a looping composition posts its final paused state", () => {
    const seek = vi.spyOn(player, "seek");
    const play = vi.spyOn(player, "play");
    player.loop = true;
    player._duration = 4;
    player._paused = false;

    player._onMessage(
      new MessageEvent("message", {
        source: frameWindow,
        data: {
          source: "hf-preview",
          type: "state",
          frame: 120,
          isPlaying: false,
        },
      }),
    );

    expect(seek).toHaveBeenCalledWith(0);
    expect(play).toHaveBeenCalled();
    expect(player._paused).toBe(false);
  });

  it("fires ended and stays paused when a non-looping composition posts its final paused state", () => {
    const seek = vi.spyOn(player, "seek");
    const play = vi.spyOn(player, "play");
    const ended = vi.fn();
    player.addEventListener("ended", ended);
    player.loop = false;
    player._duration = 4;
    player._paused = false;

    player._onMessage(
      new MessageEvent("message", {
        source: frameWindow,
        data: {
          source: "hf-preview",
          type: "state",
          frame: 120,
          isPlaying: false,
        },
      }),
    );

    expect(seek).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(player._paused).toBe(true);
  });
});

describe("HyperframesPlayer srcdoc attribute", () => {
  type PlayerInternal = HTMLElement & {
    iframe: HTMLIFrameElement;
    _ready: boolean;
  };

  beforeEach(async () => {
    await import("./hyperframes-player.js");
  });

  it("includes srcdoc in observedAttributes", () => {
    // `attributeChangedCallback` only fires for observed attributes. Without
    // this, runtime srcdoc swaps from studio would silently drop on the floor.
    const ctor = customElements.get("hyperframes-player") as
      | (typeof HTMLElement & { observedAttributes: string[] })
      | undefined;
    expect(ctor).toBeDefined();
    expect(ctor!.observedAttributes).toContain("srcdoc");
  });

  it("forwards an initial srcdoc attribute to the iframe on connect", () => {
    // Studio's primary use case: render the player with composition HTML
    // already in hand, no network round-trip. Setting the attribute before
    // the element is connected must still apply on connect.
    const player = document.createElement("hyperframes-player") as PlayerInternal;
    const html = "<!doctype html><html><body>hello</body></html>";
    player.setAttribute("srcdoc", html);
    document.body.appendChild(player);

    expect(player.iframe.getAttribute("srcdoc")).toBe(html);

    player.remove();
  });

  it("forwards a srcdoc attribute set after connect to the iframe", () => {
    // The composition-switching flow: same player element, new HTML.
    // Without `attributeChangedCallback` wiring this would no-op.
    const player = document.createElement("hyperframes-player") as PlayerInternal;
    document.body.appendChild(player);

    const html = "<!doctype html><html><body>after connect</body></html>";
    player.setAttribute("srcdoc", html);

    expect(player.iframe.getAttribute("srcdoc")).toBe(html);

    player.remove();
  });

  it("resets _ready when srcdoc changes so onIframeLoad replays setup", () => {
    // The ready flag gates probe intervals, controls hookup, and poster
    // tear-down. Switching documents must invalidate it so the next `load`
    // event re-runs that setup against the fresh window.
    const player = document.createElement("hyperframes-player") as PlayerInternal;
    document.body.appendChild(player);
    player._ready = true;

    player.setAttribute("srcdoc", "<!doctype html><html></html>");

    expect(player._ready).toBe(false);

    player.remove();
  });

  it("removes iframe.srcdoc when the attribute is removed so src can take over", () => {
    // Per HTML spec, iframe.srcdoc beats iframe.src whenever both are
    // present. Studio's fetch-fail fallback path needs srcdoc cleared so
    // setting src afterwards actually navigates to that URL.
    const player = document.createElement("hyperframes-player") as PlayerInternal;
    player.setAttribute("srcdoc", "<!doctype html><html></html>");
    document.body.appendChild(player);
    expect(player.iframe.hasAttribute("srcdoc")).toBe(true);

    player.removeAttribute("srcdoc");

    expect(player.iframe.hasAttribute("srcdoc")).toBe(false);

    player.remove();
  });

  it("treats an empty-string srcdoc as a deliberate empty document, not removal", () => {
    // `setAttribute("srcdoc", "")` and `removeAttribute("srcdoc")` send
    // different signals from the caller — empty string means "load a blank
    // doc," removal means "fall back to src." We have to distinguish them.
    const player = document.createElement("hyperframes-player") as PlayerInternal;
    document.body.appendChild(player);

    player.setAttribute("srcdoc", "");

    expect(player.iframe.hasAttribute("srcdoc")).toBe(true);
    expect(player.iframe.getAttribute("srcdoc")).toBe("");

    player.remove();
  });

  it("forwards both src and srcdoc to the iframe and lets the browser arbitrate", () => {
    // We deliberately don't strip src when srcdoc is set: the HTML spec
    // already says srcdoc wins, and keeping both lets the browser fall back
    // to src automatically if the embed re-renders without srcdoc.
    const player = document.createElement("hyperframes-player") as PlayerInternal;
    player.setAttribute("src", "/api/projects/foo/preview");
    player.setAttribute("srcdoc", "<!doctype html><html></html>");
    document.body.appendChild(player);

    expect(player.iframe.getAttribute("src")).toBe("/api/projects/foo/preview");
    expect(player.iframe.getAttribute("srcdoc")).toBe("<!doctype html><html></html>");

    player.remove();
  });
});
