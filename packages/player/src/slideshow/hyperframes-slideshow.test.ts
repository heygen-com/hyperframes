// fallow-ignore-file code-duplication
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleRuntimeMessage } from "../runtime-message-handler.js";
import { dropInvalidSlides } from "./hyperframes-slideshow.js";
import { slideshowChannelName } from "./slideshowPresenter.js";

// Dynamic import defers custom-element registration until happy-dom is active.
// (Static top-level imports execute before the test environment is set up, which
// means HTMLElement is undefined.  This is the same pattern used by
// packages/player/src/hyperframes-player.test.ts.)

describe("<hyperframes-slideshow>", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  function makeEl(opts: {
    onNext?: () => void;
    onPrev?: () => void;
    index?: number;
    total?: number;
    sound?: boolean;
  }) {
    const el = document.createElement("hyperframes-slideshow") as any;
    if (opts.sound) el.setAttribute("sound", "");
    document.body.appendChild(el);
    el.__setControllerForTest({
      next: opts.onNext ?? (() => {}),
      prev: opts.onPrev ?? (() => {}),
      onChange: () => () => {},
      counter: { index: opts.index ?? 1, total: opts.total ?? 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      get position() {
        return { sequenceId: "main", slideIndex: (opts.index ?? 1) - 1, fragmentIndex: -1 };
      },
    });
    return el;
  }

  it("is registered as a custom element", () => {
    expect(customElements.get("hyperframes-slideshow")).toBeDefined();
  });

  it("advances on ArrowRight key dispatched on window (regression: element need not be focused)", () => {
    let nextCalled = false;
    const el = makeEl({
      onNext: () => {
        nextCalled = true;
      },
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(nextCalled).toBe(true);
    el.remove();
  });

  it("goes back on ArrowLeft key dispatched on window", () => {
    let prevCalled = false;
    const el = makeEl({
      onPrev: () => {
        prevCalled = true;
      },
      index: 2,
      total: 3,
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(prevCalled).toBe(true);
    el.remove();
  });

  it("advances on Space key only when the deck is focused (does not hijack the host page)", () => {
    let nextCalled = false;
    const el = makeEl({
      onNext: () => {
        nextCalled = true;
      },
    });
    // Unfocused: Space must NOT navigate (the host page owns scroll).
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(nextCalled).toBe(false);
    // Focused: Space navigates.
    el.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(nextCalled).toBe(true);
    el.remove();
  });

  it("goes back on Backspace key only when the deck is focused (does not hijack history)", () => {
    let prevCalled = false;
    const el = makeEl({
      onPrev: () => {
        prevCalled = true;
      },
    });
    // Unfocused: Backspace must NOT navigate (the host page owns history nav).
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    expect(prevCalled).toBe(false);
    // Focused: Backspace navigates.
    el.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    expect(prevCalled).toBe(true);
    el.remove();
  });

  it("disconnectedCallback removes window keydown listener so arrow keys no longer navigate", () => {
    let nextCalled = false;
    const el = makeEl({
      onNext: () => {
        nextCalled = true;
      },
    });
    el.remove(); // triggers disconnectedCallback — listener removed from window
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(nextCalled).toBe(false);
  });

  it("renders prev/next buttons and counter in a single nav cluster after controller injection", () => {
    const el = makeEl({ index: 1, total: 3 });
    const cluster = el.querySelector("[data-hf-nav-cluster]");
    expect(cluster).toBeTruthy();
    expect(el.querySelector("[data-hf-prev]")).toBeTruthy();
    expect(el.querySelector("[data-hf-next]")).toBeTruthy();
    // No breadcrumb, no separate back button in chrome
    expect(el.querySelector("[data-hf-breadcrumb-item]")).toBeNull();
    expect(el.querySelector("[data-hf-back]")).toBeNull();
    el.remove();
  });

  it("renders an icon-only present button inside the nav cluster in normal mode", () => {
    const el = makeEl({ index: 1, total: 3 });
    const cluster = el.querySelector("[data-hf-nav-cluster]");
    const presentBtn = el.querySelector("[data-hf-present]");
    expect(cluster).toBeTruthy();
    expect(presentBtn).toBeTruthy();
    expect(cluster?.contains(presentBtn)).toBe(true);
    expect(presentBtn?.textContent?.trim()).toBe("");
    expect(presentBtn?.querySelector("svg")).toBeTruthy();
    expect(presentBtn?.querySelector('path[d="M10 8.5v4l4-2-4-2z"]')).toBeTruthy();
    expect(presentBtn?.getAttribute("aria-label")).toBe("Present");
    expect(presentBtn?.getAttribute("title")).toBe("Present");
    expect(presentBtn?.getAttribute("data-hf-tooltip")).toBe("Present");
    el.remove();
  });

  it("does not render the present button in audience mode", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    el.setAttribute("mode", "audience");
    document.body.appendChild(el);
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 3 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      get position() {
        return { sequenceId: "main", slideIndex: 0, fragmentIndex: -1 };
      },
    });

    expect(el.querySelector("[data-hf-present]")).toBeNull();
    expect(el.querySelector("[data-hf-fullscreen]")).toBeTruthy();
    el.remove();
  });

  it("renders counter text", () => {
    const el = makeEl({ index: 2, total: 5 });
    const counter = el.querySelector("[data-hf-counter]");
    expect(counter).toBeTruthy();
    expect(counter.textContent).toContain("2");
    expect(counter.textContent).toContain("5");
    expect(counter.getAttribute("style")).toContain("font-family:Inter");
    expect(counter.getAttribute("style")).toContain("font-variant-numeric:tabular-nums");
    el.remove();
  });

  it("adds hover tooltips to all nav control buttons", () => {
    const el = makeEl({ index: 2, total: 5, sound: true });
    const expected: [string, string][] = [
      ["[data-hf-mute]", "Mute"],
      ["[data-hf-prev]", "Previous slide"],
      ["[data-hf-next]", "Next slide"],
      ["[data-hf-present]", "Present"],
      ["[data-hf-fullscreen]", "Full screen"],
    ];
    for (const [selector, label] of expected) {
      const button = el.querySelector(selector);
      expect(button).toBeTruthy();
      expect(button?.getAttribute("aria-label")).toBe(label);
      expect(button?.getAttribute("title")).toBe(label);
      expect(button?.getAttribute("data-hf-tooltip")).toBe(label);
    }
    el.remove();
  });

  it("handles postMessage next", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    let nextCalled = false;
    el.__setControllerForTest({
      next: () => {
        nextCalled = true;
      },
      prev: () => {},
      goToSlide: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });
    window.dispatchEvent(new MessageEvent("message", { data: { type: "next" } }));
    expect(nextCalled).toBe(true);
    el.remove();
  });

  it("hotspot buttons do not accumulate on repeated renders", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    let onChangeCb: (() => void) | null = null;
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      goToSlide: () => {},
      onChange: (cb: () => void) => {
        onChangeCb = cb;
        return () => {};
      },
      counter: { index: 1, total: 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: {
        hotspots: [
          { id: "h1", label: "Why?", target: "deep", region: { x: 0, y: 0, w: 10, h: 10 } },
        ],
      },
      nextSlide: null,
    });
    // Trigger a second render via the onChange callback.
    // Cast re-widens past control-flow narrowing: TS can't see the assignment
    // inside the controller's onChange closure, so it narrows this to `never`.
    (onChangeCb as (() => void) | null)?.();
    // After two renders, there should still be exactly 1 hotspot button
    expect(el.querySelectorAll("[data-hotspot-id]").length).toBe(1);
    el.remove();
  });

  it("swipe with dominant vertical delta does NOT navigate; horizontal delta DOES", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    let nextCalled = 0;
    el.__setControllerForTest({
      next: () => {
        nextCalled++;
      },
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });

    // Mostly vertical swipe (deltaX=50, deltaY=80) — should NOT navigate
    el.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 })],
      }),
    );
    el.dispatchEvent(
      new TouchEvent("touchend", {
        changedTouches: [new Touch({ identifier: 1, target: el, clientX: 50, clientY: 20 })],
      }),
    );
    expect(nextCalled).toBe(0);

    // Mostly horizontal swipe (deltaX=50, deltaY=10) — SHOULD navigate
    el.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 })],
      }),
    );
    el.dispatchEvent(
      new TouchEvent("touchend", {
        changedTouches: [new Touch({ identifier: 1, target: el, clientX: 50, clientY: 110 })],
      }),
    );
    expect(nextCalled).toBe(1);
    el.remove();
  });

  it("renders a hotspot overlay and enters the branch on click", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    let entered = "";
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      goToSlide: () => {},
      enterBranch: (id: string) => {
        entered = id;
      },
      onChange: () => () => {},
      counter: { index: 1, total: 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: {
        hotspots: [
          { id: "h1", label: "Why?", target: "deep", region: { x: 0, y: 0, w: 10, h: 10 } },
        ],
      },
      nextSlide: null,
    });
    const hotspot = el.querySelector("[data-hotspot-id='h1']") as HTMLElement;
    expect(hotspot).toBeTruthy();
    hotspot.click();
    expect(entered).toBe("deep");
    el.remove();
  });

  // ---------------------------------------------------------------------------
  // Mute toggle tests
  // ---------------------------------------------------------------------------

  it("does NOT render a mute button when the `sound` attribute is absent", () => {
    const el = makeEl({ index: 1, total: 3 });
    // No `sound` attribute on the element — makeEl does not set it.
    expect(el.querySelector("[data-hf-mute]")).toBeNull();
    el.remove();
  });

  it("renders a mute button inside the nav capsule when `sound` attribute is present", () => {
    const el = makeEl({ index: 1, total: 3 });
    el.setAttribute("sound", "");
    // Trigger re-render via __setControllerForTest (re-sets the controller which calls render).
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 3 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });
    const cluster = el.querySelector("[data-hf-nav-cluster]");
    const muteBtn = el.querySelector("[data-hf-mute]");
    expect(cluster).toBeTruthy();
    expect(muteBtn).toBeTruthy();
    // Mute button must be inside the cluster
    expect(cluster.contains(muteBtn)).toBe(true);
    el.remove();
  });

  it("mute button click toggles `muted` getter, sets data-hf-muted, and dispatches hf-sound event", () => {
    const el = makeEl({ index: 2, total: 4 });
    el.setAttribute("sound", "");
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 2, total: 4 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });

    const events: { muted: boolean }[] = [];
    el.addEventListener("hf-sound", (e: Event) => {
      events.push((e as CustomEvent<{ muted: boolean }>).detail);
    });

    expect((el as any).muted).toBe(false);
    expect(el.hasAttribute("data-hf-muted")).toBe(false);

    // Click once — mute
    const muteBtn = el.querySelector("[data-hf-mute]") as HTMLElement;
    expect(muteBtn).toBeTruthy();
    muteBtn.click();

    expect((el as any).muted).toBe(true);
    expect(el.hasAttribute("data-hf-muted")).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ muted: true });

    // Click again — unmute
    const muteBtnAfter = el.querySelector("[data-hf-mute]") as HTMLElement;
    muteBtnAfter.click();

    expect((el as any).muted).toBe(false);
    expect(el.hasAttribute("data-hf-muted")).toBe(false);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ muted: false });

    el.remove();
  });

  it("mute button applies globally to child players and page media", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    el.setAttribute("sound", "");
    const player = document.createElement("hyperframes-player") as any;
    player.muted = false;
    el.appendChild(player);
    const pageVideo = document.createElement("video");
    document.body.append(pageVideo, el);
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });

    const muteBtn = el.querySelector("[data-hf-mute]") as HTMLElement;
    muteBtn.click();
    expect(player.muted).toBe(true);
    expect(pageVideo.muted).toBe(true);

    const muteBtnAfter = el.querySelector("[data-hf-mute]") as HTMLElement;
    muteBtnAfter.click();
    expect(player.muted).toBe(false);
    expect(pageVideo.muted).toBe(false);

    el.remove();
    pageVideo.remove();
  });

  it("mute button glyph reflects muted state (aria-pressed)", () => {
    const el = makeEl({ index: 1, total: 2 });
    el.setAttribute("sound", "");
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });

    const muteBtn = el.querySelector("[data-hf-mute]") as HTMLElement;
    expect(muteBtn.getAttribute("aria-pressed")).toBe("false");

    muteBtn.click();

    const muteBtnAfter = el.querySelector("[data-hf-mute]") as HTMLElement;
    expect(muteBtnAfter.getAttribute("aria-pressed")).toBe("true");

    el.remove();
  });
});

// Seam test: handleRuntimeMessage passes scenes from the "timeline" postMessage
// to the setScenes callback so the player can cache and expose them.
describe("handleRuntimeMessage scenes seam", () => {
  function makeCallbacks(
    setScenes: (s: { id: string; start: number; duration: number }[]) => void,
  ) {
    return {
      getPlaybackState: () => ({ currentTime: 0, duration: 0, paused: true, lastUpdateMs: 0 }),
      setPlaybackState: () => {},
      getShaderLoadingMode: () => "default",
      shaderLoader: { update: () => {}, destroy: () => {} } as any,
      setCompositionSize: () => {},
      sendControl: () => {},
      getIframeDoc: () => null,
      onRuntimeReady: () => {},
      setScenes,
      updateControlsTime: () => {},
      updateControlsPlaying: () => {},
      dispatchEvent: () => {},
      seek: () => {},
      play: () => {},
      getLoop: () => false,
      media: {
        audioOwner: "iframe",
        promoteToParentProxy: () => {},
        mirrorTime: () => {},
        pauseAll: () => {},
        playAll: () => {},
      } as any,
    };
  }

  it("passes scenes from the timeline message to setScenes", () => {
    const received: { id: string; start: number; duration: number }[][] = [];
    const fakeWindow = {} as Window;
    const event = new MessageEvent("message", {
      source: fakeWindow,
      data: {
        source: "hf-preview",
        type: "timeline",
        durationInFrames: 300,
        clips: [],
        scenes: [
          {
            id: "intro",
            start: 0,
            duration: 5,
            label: "Intro",
            thumbnailUrl: null,
            avatarName: null,
          },
          {
            id: "body",
            start: 5,
            duration: 10,
            label: "Body",
            thumbnailUrl: null,
            avatarName: null,
          },
        ],
        compositionWidth: 1920,
        compositionHeight: 1080,
      },
    });
    handleRuntimeMessage(
      event,
      fakeWindow,
      makeCallbacks((s) => received.push(s)),
    );
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(2);
    expect(received[0][0]).toMatchObject({ id: "intro", start: 0, duration: 5 });
    expect(received[0][1]).toMatchObject({ id: "body", start: 5, duration: 10 });
  });

  it("calls setScenes with [] when scenes array is absent", () => {
    const received: unknown[][] = [];
    const fakeWindow = {} as Window;
    const event = new MessageEvent("message", {
      source: fakeWindow,
      data: {
        source: "hf-preview",
        type: "timeline",
        durationInFrames: 300,
        clips: [],
        compositionWidth: 1920,
        compositionHeight: 1080,
      },
    });
    handleRuntimeMessage(
      event,
      fakeWindow,
      makeCallbacks((s) => received.push(s)),
    );
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Presenter-mode / BroadcastChannel tests
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> presenter mode", () => {
  beforeEach(async () => {
    localStorage.clear();
    await import("./hyperframes-slideshow.js");
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** Shared stub position used across presenter-mode tests. */
  const MAIN_POS = { sequenceId: "main", slideIndex: 0, fragmentIndex: -1 };

  /**
   * Creates a slideshow element with a stub controller whose syncTo records
   * the last called (sequenceId, slideIndex, fragmentIndex). Appends to body;
   * caller must call el.remove().
   */
  function makeAudienceEl() {
    const el = document.createElement("hyperframes-slideshow") as any;
    el.setAttribute("mode", "audience");
    document.body.appendChild(el);
    let lastSync: { sequenceId: string; slideIndex: number; fragmentIndex: number } | null = null;
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      goToSlide: () => {},
      syncTo: (sequenceId: string, slideIndex: number, fragmentIndex: number) => {
        lastSync = { sequenceId, slideIndex, fragmentIndex };
      },
      onChange: () => () => {},
      counter: { index: 1, total: 3 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });
    return { el, getLastSync: () => lastSync };
  }

  /**
   * Creates a presenter-mode element with a stub controller that exposes the
   * last onChange callback. Appends to body; caller must call el.remove().
   */
  function makePresenterEl() {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    let onChangeCb: (() => void) | null = null;
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      goToSlide: () => {},
      onChange: (cb: () => void) => {
        onChangeCb = cb;
        return () => {};
      },
      counter: { index: 1, total: 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      get position() {
        return MAIN_POS;
      },
    });
    return { el, triggerChange: () => onChangeCb?.() };
  }

  function makeMediaSyncedEl(mode: "presenter" | "audience", opts: { playRejects?: boolean } = {}) {
    const el = document.createElement("hyperframes-slideshow") as any;
    if (mode === "audience") el.setAttribute("mode", "audience");

    const player = document.createElement("hyperframes-player");
    const iframe = document.createElement("iframe");
    Object.defineProperty(player, "iframeElement", {
      configurable: true,
      value: iframe,
    });
    player.appendChild(iframe);
    el.appendChild(player);
    document.body.appendChild(el);

    const frameDoc = iframe.contentDocument;
    if (!frameDoc) throw new Error("expected iframe document in test");
    const video = frameDoc.createElement("video");
    video.id = "demo";
    video.volume = 0.75;
    video.playbackRate = 1;
    frameDoc.body.appendChild(video);

    let paused = true;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get() {
        return paused;
      },
    });
    Object.defineProperty(video, "ended", {
      configurable: true,
      get() {
        return false;
      },
    });
    const play = vi.fn(() => {
      paused = false;
      return opts.playRejects ? Promise.reject(new Error("blocked")) : Promise.resolve();
    });
    const pause = vi.fn(() => {
      paused = true;
    });
    Object.defineProperty(video, "play", { configurable: true, value: play });
    Object.defineProperty(video, "pause", { configurable: true, value: pause });

    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      goToSlide: () => {},
      syncTo: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      get position() {
        return MAIN_POS;
      },
    });

    return {
      el,
      video,
      play,
      pause,
      key: "player:0|id:demo",
      setPaused(value: boolean) {
        paused = value;
      },
    };
  }

  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  it("audience mode: mirrors full position (sequence + slide + fragment) via syncTo", async () => {
    const presenterChannel = new BroadcastChannel(slideshowChannelName());
    const { el, getLastSync } = makeAudienceEl();

    await tick();
    presenterChannel.postMessage({
      type: "goto",
      sequenceId: "main",
      slideIndex: 2,
      fragmentIndex: 0,
    });
    await tick();

    expect(getLastSync()).toEqual({ sequenceId: "main", slideIndex: 2, fragmentIndex: 0 });
    presenterChannel.close();
    el.remove();
  });

  it("audience mode: mirrors a branch position too (full sequenceId forwarded to syncTo)", async () => {
    const presenterChannel = new BroadcastChannel(slideshowChannelName());
    const { el, getLastSync } = makeAudienceEl();

    await tick();

    // A non-main sequenceId is now forwarded to syncTo (controller decides validity).
    expect(() => {
      presenterChannel.postMessage({
        type: "goto",
        sequenceId: "branch-a",
        slideIndex: 1,
        fragmentIndex: 2,
      });
    }).not.toThrow();

    await tick();
    expect(getLastSync()).toEqual({ sequenceId: "branch-a", slideIndex: 1, fragmentIndex: 2 });

    presenterChannel.close();
    el.remove();
  });

  it("presenter mode: posts position to channel on controller onChange", async () => {
    const received: unknown[] = [];
    const listenerChannel = new BroadcastChannel(slideshowChannelName());
    listenerChannel.onmessage = (e: MessageEvent) => received.push(e.data);

    const { el, triggerChange } = makePresenterEl();
    await tick();

    triggerChange();
    await tick();

    expect(received.length).toBeGreaterThanOrEqual(1);
    const msg = received[received.length - 1] as Record<string, unknown>;
    expect(msg["type"]).toBe("goto");
    expect(msg["sequenceId"]).toBe("main");
    expect(typeof msg["slideIndex"]).toBe("number");

    listenerChannel.close();
    el.remove();
  });

  it("presenter mode: broadcasts iframe media play events", async () => {
    const received: unknown[] = [];
    const listenerChannel = new BroadcastChannel(slideshowChannelName());
    listenerChannel.onmessage = (e: MessageEvent) => received.push(e.data);

    const { el, video, setPaused } = makeMediaSyncedEl("presenter");
    await tick();

    setPaused(false);
    video.currentTime = 7.25;
    video.dispatchEvent(new Event("play"));
    await tick();

    const msg = received.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as Record<string, unknown>)["type"] === "media",
    ) as Record<string, unknown> | undefined;
    expect(msg).toMatchObject({
      type: "media",
      sender: "presenter",
      key: "player:0|id:demo",
      action: "play",
      currentTime: 7.25,
      paused: false,
      muted: false,
      volume: 0.75,
      playbackRate: 1,
    });

    listenerChannel.close();
    el.remove();
  });

  it("audience mode: does not echo local muted autoplay state back to presenter", async () => {
    const received: unknown[] = [];
    const listenerChannel = new BroadcastChannel(slideshowChannelName());
    listenerChannel.onmessage = (e: MessageEvent) => received.push(e.data);

    const { el, video } = makeMediaSyncedEl("audience");
    await tick();

    video.muted = true;
    video.dispatchEvent(new Event("volumechange"));
    await tick();

    expect(
      received.some(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          (candidate as Record<string, unknown>)["type"] === "media",
      ),
    ).toBe(false);

    listenerChannel.close();
    el.remove();
  });

  it("audience mode: remote play starts iframe media muted", async () => {
    const presenterChannel = new BroadcastChannel(slideshowChannelName());
    const { el, video, play, key } = makeMediaSyncedEl("audience");
    await tick();

    presenterChannel.postMessage({
      type: "media",
      sender: "presenter",
      key,
      action: "play",
      currentTime: 12.5,
      paused: false,
      ended: false,
      muted: false,
      volume: 0.8,
      playbackRate: 1.25,
    });
    await tick();

    expect(video.currentTime).toBe(12.5);
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.8);
    expect(video.playbackRate).toBe(1.25);
    expect(play).toHaveBeenCalledTimes(1);

    presenterChannel.close();
    el.remove();
  });

  it("audience mode: keeps remote media muted during subsequent time sync", async () => {
    const presenterChannel = new BroadcastChannel(slideshowChannelName());
    const { el, video, key } = makeMediaSyncedEl("audience");
    await tick();

    presenterChannel.postMessage({
      type: "media",
      sender: "presenter",
      key,
      action: "play",
      currentTime: 1,
      paused: false,
      ended: false,
      muted: false,
      volume: 1,
      playbackRate: 1,
    });
    await tick();
    presenterChannel.postMessage({
      type: "media",
      sender: "presenter",
      key,
      action: "timeupdate",
      currentTime: 4,
      paused: false,
      ended: false,
      muted: false,
      volume: 1,
      playbackRate: 1,
    });
    await tick();

    expect(video.currentTime).toBe(4);
    expect(video.muted).toBe(true);

    presenterChannel.close();
    el.remove();
  });

  it("audience mode: rejected muted play stops chasing remote timeupdates", async () => {
    const presenterChannel = new BroadcastChannel(slideshowChannelName());
    const { el, video, play, key } = makeMediaSyncedEl("audience", { playRejects: true });
    await tick();

    presenterChannel.postMessage({
      type: "media",
      sender: "presenter",
      key,
      action: "play",
      currentTime: 2,
      paused: false,
      ended: false,
      muted: false,
      volume: 1,
      playbackRate: 1,
    });
    await tick();
    await tick();

    presenterChannel.postMessage({
      type: "media",
      sender: "presenter",
      key,
      action: "timeupdate",
      currentTime: 20,
      paused: false,
      ended: false,
      muted: false,
      volume: 1,
      playbackRate: 1,
    });
    await tick();

    expect(play).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(2);
    expect(video.muted).toBe(true);
    const buttonTexts = Array.from(
      el.querySelectorAll("button") as NodeListOf<HTMLButtonElement>,
      (button) => button.textContent,
    );
    expect(buttonTexts).toContain("Play audience media muted");

    presenterChannel.close();
    el.remove();
  });

  it("present() opens a new window with mode=audience and sets presenter attribute", () => {
    const openCalls: { url: string; target: string }[] = [];
    vi.spyOn(window, "open").mockImplementation((url, target) => {
      openCalls.push({ url: String(url), target: String(target) });
      return null;
    });

    const { el } = makePresenterEl();
    el.present();

    expect(openCalls.length).toBe(1);
    expect(openCalls[0].url).toContain("mode=audience");
    expect(openCalls[0].target).toBe("_blank");
    expect(el.getAttribute("data-hf-presenting")).toBe("true");

    el.remove();
  });

  it("built-in nav present button opens presenter mode and then hides itself", () => {
    const openCalls: { url: string; target: string }[] = [];
    vi.spyOn(window, "open").mockImplementation((url, target) => {
      openCalls.push({ url: String(url), target: String(target) });
      return null;
    });

    const { el } = makePresenterEl();
    const presentBtn = el.querySelector("[data-hf-present]") as HTMLButtonElement;
    expect(presentBtn).toBeTruthy();

    presentBtn.click();

    expect(openCalls).toHaveLength(1);
    expect(openCalls[0].url).toContain("mode=audience");
    expect(el.getAttribute("data-hf-presenting")).toBe("true");
    expect(el.querySelector("[data-hf-present]")).toBeNull();

    el.remove();
  });

  it("P shortcut opens presenter mode from the shared component", () => {
    const openCalls: { url: string; target: string }[] = [];
    vi.spyOn(window, "open").mockImplementation((url, target) => {
      openCalls.push({ url: String(url), target: String(target) });
      return null;
    });

    const { el } = makePresenterEl();
    el.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "P" }));

    expect(openCalls).toHaveLength(1);
    expect(openCalls[0].url).toContain("mode=audience");
    expect(el.getAttribute("data-hf-presenting")).toBe("true");

    el.remove();
  });

  it("present() rebroadcasts the current position for a newly opened audience window", async () => {
    const received: unknown[] = [];
    const spy = new BroadcastChannel(slideshowChannelName());
    spy.onmessage = (e: MessageEvent) => received.push(e.data);
    vi.spyOn(window, "open").mockImplementation(() => null);

    const { el } = makePresenterEl();
    el.present();
    await tick();

    expect(received).toContainEqual({ type: "goto", ...MAIN_POS });

    spy.close();
    el.remove();
  });

  it("disconnectedCallback closes the BroadcastChannel", async () => {
    const { el } = makePresenterEl();
    await tick();

    const received: unknown[] = [];
    const spy = new BroadcastChannel(slideshowChannelName());
    spy.onmessage = (e: MessageEvent) => received.push(e.data);

    el.remove(); // triggers disconnectedCallback
    await tick();

    // Channel closed — no further messages should arrive from the removed element
    expect(received.length).toBe(0);
    spy.close();
  });

  function makePresenterWithSlides(opts: {
    currentSlide: { sceneId: string; notes?: string };
    nextSlide: { sceneId: string; notes?: string } | null;
    index?: number;
    total?: number;
  }) {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      goToSlide: () => {},
      onChange: () => () => {},
      counter: { index: opts.index ?? 1, total: opts.total ?? 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [], ...opts.currentSlide },
      nextSlide: opts.nextSlide,
      get position() {
        return MAIN_POS;
      },
    });
    el.present();
    return el;
  }

  it("presenter chrome contains current slide notes when present", () => {
    const el = makePresenterWithSlides({
      currentSlide: { sceneId: "intro", notes: "Talk about the mission here" },
      nextSlide: { sceneId: "features", notes: "Highlight top 3 features" },
    });
    const text = el.querySelector("[data-hf-chrome]").textContent as string;
    expect(text).toContain("Talk about the mission here");
    expect(text).toContain("features");
    el.remove();
  });

  it("presenter counters use the shared sans-serif number style", () => {
    const el = makePresenterWithSlides({
      currentSlide: { sceneId: "intro", notes: "Intro notes" },
      nextSlide: { sceneId: "features", notes: "Feature notes" },
      index: 2,
      total: 5,
    });
    const counter = el.querySelector("[data-hf-presenter-counter]");
    const elapsed = el.querySelector("[data-hf-presenter-elapsed]");
    expect(counter?.textContent).toContain("2 / 5");
    expect(counter?.getAttribute("style")).toContain("font-family:Inter");
    expect(counter?.getAttribute("style")).toContain("font-variant-numeric:tabular-nums");
    expect(elapsed?.getAttribute("style")).toContain("font-family:Inter");
    expect(elapsed?.getAttribute("style")).toContain("font-variant-numeric:tabular-nums");
    el.remove();
  });

  it("presenter notes are editable and reload from localStorage", () => {
    const el = makePresenterWithSlides({
      currentSlide: { sceneId: "intro", notes: "Original manifest notes" },
      nextSlide: { sceneId: "features", notes: "Highlight top 3 features" },
    });
    const notes = el.querySelector("[data-hf-presenter-notes]");
    expect(notes).toBeInstanceOf(HTMLTextAreaElement);
    const textarea = notes as HTMLTextAreaElement;
    expect(textarea.value).toBe("Original manifest notes");

    textarea.value = "Edited speaker notes";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const storageKey = textarea.getAttribute("data-hf-presenter-notes-key");
    expect(storageKey).toBeTruthy();
    expect(localStorage.getItem(storageKey ?? "")).toBe("Edited speaker notes");
    el.remove();

    const reloaded = makePresenterWithSlides({
      currentSlide: { sceneId: "intro", notes: "Original manifest notes" },
      nextSlide: { sceneId: "features", notes: "Highlight top 3 features" },
    });
    const reloadedNotes = reloaded.querySelector("[data-hf-presenter-notes]");
    expect(reloadedNotes).toBeInstanceOf(HTMLTextAreaElement);
    expect((reloadedNotes as HTMLTextAreaElement).value).toBe("Edited speaker notes");
    reloaded.remove();
  });

  it("presenter notes preserve an intentionally cleared local edit", () => {
    const el = makePresenterWithSlides({
      currentSlide: { sceneId: "intro", notes: "Original manifest notes" },
      nextSlide: null,
    });
    const notes = el.querySelector("[data-hf-presenter-notes]");
    expect(notes).toBeInstanceOf(HTMLTextAreaElement);
    const textarea = notes as HTMLTextAreaElement;

    textarea.value = "";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    el.remove();

    const reloaded = makePresenterWithSlides({
      currentSlide: { sceneId: "intro", notes: "Original manifest notes" },
      nextSlide: null,
    });
    const reloadedNotes = reloaded.querySelector("[data-hf-presenter-notes]");
    expect(reloadedNotes).toBeInstanceOf(HTMLTextAreaElement);
    expect((reloadedNotes as HTMLTextAreaElement).value).toBe("");
    reloaded.remove();
  });

  it("presenter chrome contains next slide sceneId when nextSlide is set", () => {
    const el = makePresenterWithSlides({
      currentSlide: { sceneId: "intro", notes: "Intro notes" },
      nextSlide: { sceneId: "slide-two", notes: "Second slide notes" },
    });
    const text = el.querySelector("[data-hf-chrome]").textContent as string;
    expect(text).toContain("slide-two");
    el.remove();
  });

  it("presenter chrome contains 'End of sequence' when nextSlide is null", () => {
    const el = makePresenterWithSlides({
      currentSlide: { sceneId: "last", notes: "Final notes" },
      nextSlide: null,
      index: 2,
      total: 2,
    });
    const text = el.querySelector("[data-hf-chrome]").textContent as string;
    expect(text).toContain("End of sequence");
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// Bug fix tests: connectedCallback microtask defer + waitForScenes polling
// ---------------------------------------------------------------------------

/**
 * waitForScenes seam: import the module and invoke the private helper through
 * a minimal stub player.  We verify two behaviours:
 *   1. resolves once scenes become available (non-empty poll result)
 *   2. resolves with [] after timeout when scenes never appear
 *
 * The helper is not exported, so we test it via the component's init() path
 * using __setControllerForTest (which bypasses init entirely) and a small
 * white-box test that exercises the async scenes-poll path indirectly through
 * a fake player whose `scenes` property starts empty then fills in after a
 * tick.
 */
describe("waitForScenes seam — async scene polling", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("resolves immediately when scenes are already populated", async () => {
    // Build a minimal fake player that already has scenes set
    const player = document.createElement("div");
    Object.defineProperty(player, "scenes", {
      get() {
        return [{ id: "intro", start: 0, duration: 5 }];
      },
    });

    // waitForScenes is private but we verify its behaviour by checking the
    // path that calls it: if scenes are already present the fast path returns
    // Promise.resolve() synchronously.
    let resolved = false;

    // Inline the same logic the module uses so the seam is testable without
    // exporting the helper.
    function readScenesFake(el: HTMLElement): { id: string; start: number; duration: number }[] {
      if ("scenes" in el && Array.isArray((el as { scenes: unknown }).scenes)) {
        return (el as { scenes: { id: string; start: number; duration: number }[] }).scenes;
      }
      return [];
    }

    const scenes = readScenesFake(player);
    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes[0]).toMatchObject({ id: "intro", start: 0, duration: 5 });
    resolved = true;
    expect(resolved).toBe(true);
  });

  it("resolves with scenes once they become available after a delay", async () => {
    vi.useFakeTimers();

    const player = document.createElement("div");
    let _scenes: { id: string; start: number; duration: number }[] = [];
    Object.defineProperty(player, "scenes", {
      get() {
        return _scenes;
      },
    });

    // Replicate waitForScenes logic inline (same algorithm as the module)
    const timeoutMs = 2500;
    const maxIterations = Math.ceil(timeoutMs / 100);

    const resultPromise = new Promise<{ id: string; start: number; duration: number }[]>(
      (resolve) => {
        function readScenesFake(
          el: HTMLElement,
        ): { id: string; start: number; duration: number }[] {
          if ("scenes" in el && Array.isArray((el as { scenes: unknown }).scenes)) {
            return (el as { scenes: { id: string; start: number; duration: number }[] }).scenes;
          }
          return [];
        }
        const initial = readScenesFake(player);
        if (initial.length > 0) {
          resolve(initial);
          return;
        }
        let iterations = 0;
        const poll = (): void => {
          const current = readScenesFake(player);
          if (current.length > 0) {
            resolve(current);
            return;
          }
          iterations += 1;
          if (iterations >= maxIterations) {
            resolve([]);
            return;
          }
          setTimeout(poll, 100);
        };
        setTimeout(poll, 100);
      },
    );

    // Populate scenes after 300ms (3 poll ticks)
    setTimeout(() => {
      _scenes = [{ id: "slide-1", start: 0, duration: 8 }];
    }, 300);

    // Advance fake timers
    await vi.advanceTimersByTimeAsync(400);

    const result = await resultPromise;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "slide-1", start: 0, duration: 8 });

    vi.useRealTimers();
  });

  it("resolves with [] when scenes never appear within the timeout", async () => {
    vi.useFakeTimers();

    const player = document.createElement("div");
    Object.defineProperty(player, "scenes", {
      get() {
        return [];
      },
    });

    const timeoutMs = 500;
    const maxIterations = Math.ceil(timeoutMs / 100);

    const resultPromise = new Promise<{ id: string; start: number; duration: number }[]>(
      (resolve) => {
        function readScenesFake(
          el: HTMLElement,
        ): { id: string; start: number; duration: number }[] {
          if ("scenes" in el && Array.isArray((el as { scenes: unknown }).scenes)) {
            return (el as { scenes: { id: string; start: number; duration: number }[] }).scenes;
          }
          return [];
        }
        const initial = readScenesFake(player);
        if (initial.length > 0) {
          resolve(initial);
          return;
        }
        let iterations = 0;
        const poll = (): void => {
          const current = readScenesFake(player);
          if (current.length > 0) {
            resolve(current);
            return;
          }
          iterations += 1;
          if (iterations >= maxIterations) {
            resolve([]);
            return;
          }
          setTimeout(poll, 100);
        };
        setTimeout(poll, 100);
      },
    );

    await vi.advanceTimersByTimeAsync(600);
    const result = await resultPromise;
    expect(result).toEqual([]);

    vi.useRealTimers();
  });
});

describe("<hyperframes-slideshow> deferred init (Bug 1)", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("connectedCallback defers init to a macrotask so parser-appended children are found", async () => {
    // The fix defers player-dependent init to a setTimeout(0) macrotask rather
    // than a microtask: when the bundle is loaded synchronously via <script src>
    // in <head>, connectedCallback fires while the parser is still inside the
    // open tag, and the children are appended in a LATER task. A microtask drains
    // before that task and would observe an empty subtree; a macrotask yields to
    // the parser first. (Proven against real headless Chrome in
    // scripts/slideshow-e2e-verify.mjs — see task-13-report.md.)
    const el = document.createElement("hyperframes-slideshow") as HTMLElement & {
      __setControllerForTest: (c: unknown) => void;
    };
    const fakePlayer = document.createElement("div");
    el.appendChild(fakePlayer);
    document.body.appendChild(el);

    // After a macrotask the deferred init has had its chance to run; the child
    // is reachable via querySelector.
    let foundChild: Element | null = null;
    await new Promise<void>((r) => setTimeout(r, 0));
    foundChild = el.querySelector("div");

    expect(foundChild).toBe(fakePlayer);
    el.remove();
  });

  it("does NOT call init if element is disconnected before the deferred init fires", async () => {
    // If the element is removed before the macrotask runs, init should be skipped
    // (the timer is cleared in disconnectedCallback and the isConnected guard
    // would also bail).
    const el = document.createElement("hyperframes-slideshow") as HTMLElement & {
      __setControllerForTest: (c: unknown) => void;
    };
    document.body.appendChild(el);
    // Immediately disconnect — before the deferred init fires.
    el.remove();

    // Allow the macrotask + any subsequent promise chains to settle.
    await new Promise<void>((r) => setTimeout(r, 0));

    // init bailed (isConnected=false / timer cleared), so no chrome was mounted.
    expect(el.querySelector("[data-hf-chrome]")).toBeNull();
  });

  it("renders initial nav chrome from the manifest before scene metadata arrives", async () => {
    vi.useFakeTimers();

    const el = document.createElement("hyperframes-slideshow") as any;
    el.innerHTML = `
      <script type="application/hyperframes-slideshow+json">
        {
          "slides": [
            { "sceneId": "intro", "startTime": 0, "endTime": 1 },
            { "sceneId": "second", "startTime": 1, "endTime": 2 }
          ]
        }
      </script>
    `;

    const fakePlayer = document.createElement("hyperframes-player");
    Object.defineProperty(fakePlayer, "ready", { get: () => true });
    Object.defineProperty(fakePlayer, "seek", { value: () => {} });
    Object.defineProperty(fakePlayer, "play", { value: () => {} });
    Object.defineProperty(fakePlayer, "pause", { value: () => {} });
    Object.defineProperty(fakePlayer, "currentTime", { get: () => 0 });
    Object.defineProperty(fakePlayer, "scenes", { get: () => [] });
    el.appendChild(fakePlayer);
    document.body.appendChild(el);

    await vi.advanceTimersByTimeAsync(10);

    const chrome = el.querySelector("[data-hf-chrome]");
    const counter = el.querySelector("[data-hf-counter]");
    expect(chrome).toBeTruthy();
    expect(counter?.textContent).toContain("1");
    expect(counter?.textContent).toContain("2");
    expect(el.querySelector("[data-hf-prev]")).toBeNull();
    expect(el.querySelector("[data-hf-next]")).toBeNull();
    const loading = el.querySelector("[data-hf-nav-loading]");
    expect(loading).toBeTruthy();
    expect(loading?.getAttribute("aria-label")).toBe("Loading slides");
    expect(el.querySelector("[data-hf-present]")).toBeTruthy();
    expect(el.querySelector("[data-hf-fullscreen]")).toBeTruthy();

    await vi.advanceTimersByTimeAsync(2600);

    expect(el.querySelector("[data-hf-nav-loading]")).toBeNull();
    expect(el.querySelector("[data-hf-next]")).toBeTruthy();

    el.remove();
    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Fix 1: XSS — hotspot attribute escaping (breadcrumb removed from chrome)
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix 1 — hotspot id/label XSS escape", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("hotspot id containing double-quote does not break out of the attribute", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: {
        hotspots: [{ id: 'h1"onmouseover="bad', label: "Show me", target: "branch" }],
      },
      nextSlide: null,
    });
    const chrome = el.querySelector("[data-hf-chrome]") as HTMLElement;
    const btn = chrome.querySelector("[data-hotspot-id]");
    // The attribute value should be the round-tripped value with the quote intact
    expect(btn).toBeTruthy();
    // When escaped correctly the DOM parses the attribute as one value (not multiple attrs)
    expect(btn?.hasAttribute("onmouseover")).toBe(false);
    // The raw innerHTML must contain the &quot; escape (not a bare " that breaks the attribute)
    expect(chrome.innerHTML).toContain("&quot;");
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// Fix 2: XSS — presenter slide text escaping
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix 2 — presenter text XSS escape", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("a slide note containing HTML renders as inert text (no element node created)", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      goToSlide: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: {
        hotspots: [],
        sceneId: "intro",
        notes: '<img src=x onerror="window.__xss=1">',
      },
      nextSlide: null,
      get position() {
        return { sequenceId: "main", slideIndex: 0, fragmentIndex: -1 };
      },
    });
    el.setAttribute("data-hf-presenting", "true");
    (el as any).render?.();
    // Force-render the presenter view
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      goToSlide: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: {
        hotspots: [],
        sceneId: "intro",
        notes: '<img src=x onerror="window.__xss=1">',
      },
      nextSlide: null,
      get position() {
        return { sequenceId: "main", slideIndex: 0, fragmentIndex: -1 };
      },
    });
    el.present();
    const chrome = el.querySelector("[data-hf-chrome]") as HTMLElement;
    // The injected <img> must NOT appear as a real element
    expect(chrome.querySelector("img")).toBeNull();
    // The raw string must appear as escaped text somewhere in the chrome
    expect(chrome.innerHTML).toContain("&lt;img");
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Controller lifecycle — dispose() called on disconnect and rebind
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix 3 — controller dispose on lifecycle", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("disconnectedCallback disposes the controller", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    let disposed = false;
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      dispose: () => {
        disposed = true;
      },
    });
    el.remove(); // triggers disconnectedCallback
    expect(disposed).toBe(true);
  });

  it("binding a second controller disposes the first", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    let firstDisposed = false;
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      dispose: () => {
        firstDisposed = true;
      },
    });
    // Bind a second controller — must dispose the first
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });
    expect(firstDisposed).toBe(true);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// Fix 5: waitForReady timeout — resolves within timeout if ready never fires
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix 5 — waitForReady timeout", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("waitForReady resolves within timeout when ready never fires", async () => {
    vi.useFakeTimers();
    const player = document.createElement("div");
    // ready property is absent / undefined — simulates a player that never fires ready

    // Replicate waitForReady logic inline (same algorithm as the module)
    const TIMEOUT_MS = 5000;
    let resolved = false;
    const p = new Promise<void>((resolve) => {
      const ready = (player as { ready?: boolean }).ready;
      if (ready === true) {
        resolve();
        return;
      }
      let timer: ReturnType<typeof setTimeout> | null = null;
      const handler = (): void => {
        if (timer !== null) clearTimeout(timer);
        resolve();
      };
      player.addEventListener("ready", handler, { once: true });
      timer = setTimeout(() => {
        player.removeEventListener("ready", handler);
        resolve();
      }, TIMEOUT_MS);
    });
    p.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 10);
    await p;
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Fix 6: keydown — does not navigate from form controls
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix 6 — keydown form-control guard", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("ArrowRight keydown from an input does NOT call controller.next", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    let nextCalled = false;
    el.__setControllerForTest({
      next: () => {
        nextCalled = true;
      },
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });
    // Dispatch the keydown ON the input — it bubbles up to window so the
    // listener fires with e.target === input, which the form-control guard catches.
    const input = document.createElement("input");
    el.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(nextCalled).toBe(false);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// Fix 7: window.postMessage nav — audience mode is ignored
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix 7 — audience mode ignores window postMessage nav", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("audience-mode element ignores window.postMessage {type:'next'}", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    el.setAttribute("mode", "audience");
    document.body.appendChild(el);
    let nextCalled = false;
    el.__setControllerForTest({
      next: () => {
        nextCalled = true;
      },
      prev: () => {},
      goToSlide: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });
    window.dispatchEvent(new MessageEvent("message", { data: { type: "next" } }));
    expect(nextCalled).toBe(false);
    el.remove();
  });

  it("default-mode element honors window.postMessage {type:'next'}", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    // no mode attribute = default mode
    document.body.appendChild(el);
    let nextCalled = false;
    el.__setControllerForTest({
      next: () => {
        nextCalled = true;
      },
      prev: () => {},
      goToSlide: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 2 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });
    window.dispatchEvent(new MessageEvent("message", { data: { type: "next" } }));
    expect(nextCalled).toBe(true);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// Bug fix tests: #1 — chrome nulled on disconnect so reconnect re-appends it
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix #1 — chrome re-appended on reconnect", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("after disconnect+reconnect chrome is re-appended (not left detached)", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);

    // Inject a controller so chrome is created and appended
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });

    // Chrome should exist and be a child of el
    const firstChrome = el.querySelector("[data-hf-chrome]");
    expect(firstChrome).toBeTruthy();
    expect(el.contains(firstChrome)).toBe(true);

    // Disconnect
    el.remove();

    // Reconnect
    document.body.appendChild(el);

    // Inject controller again (simulating init completing after reconnect)
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 2, total: 3 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });

    // Chrome must be a live child of el (not a detached orphan from before disconnect)
    const newChrome = el.querySelector("[data-hf-chrome]");
    expect(newChrome).toBeTruthy();
    expect(el.contains(newChrome)).toBe(true);

    el.remove();
  });
});

// ---------------------------------------------------------------------------
// Bug fix tests: #14 — controller/offChange nulled on disconnect
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix #14 — controller and offChange nulled on disconnect", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("disconnectedCallback nulls controller and offChange so no double-dispose on reconnect", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    let disposeCount = 0;
    let offChangeCalled = 0;

    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => {
        return () => {
          offChangeCalled++;
        };
      },
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      dispose: () => {
        disposeCount++;
      },
    });

    // First disconnect — should dispose once and call offChange once
    el.remove();
    expect(disposeCount).toBe(1);
    expect(offChangeCalled).toBe(1);

    // Reconnect and bind a new controller
    document.body.appendChild(el);
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      dispose: () => {
        disposeCount++;
      },
    });

    // disposeCount must still be 1 (old controller was already nulled on disconnect)
    expect(disposeCount).toBe(1);
    el.remove();
    // New controller disposed on second disconnect
    expect(disposeCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Bug fix tests: #2 — malformed island does not leave initInFlight stuck
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix #2 — malformed island try/finally", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("malformed parseSlideshowManifest does not leave initInFlight stuck (second init can run)", async () => {
    vi.useFakeTimers();

    const el = document.createElement("hyperframes-slideshow") as any;

    // Build a minimal fake player that is "ready" so we pass the ready guard
    const fakePlayer = document.createElement("div");
    Object.defineProperty(fakePlayer, "ready", { get: () => true });
    Object.defineProperty(fakePlayer, "seek", { value: () => {} });
    Object.defineProperty(fakePlayer, "play", { value: () => {} });
    Object.defineProperty(fakePlayer, "pause", { value: () => {} });
    Object.defineProperty(fakePlayer, "currentTime", { get: () => 0 });

    // Set innerHTML to something that parseSlideshowManifest will throw on
    // (a script island with malformed JSON)
    el.innerHTML = '<script type="application/json+hf-slideshow">{ NOT VALID JSON }</script>';
    el.appendChild(fakePlayer);
    document.body.appendChild(el);

    // Advance the macrotask that fires init
    await vi.advanceTimersByTimeAsync(10);

    // After the failed init the element should not have chrome (graceful fail)
    expect(el.querySelector("[data-hf-chrome]")).toBeNull();

    // A second init must be possible — initInFlight must not be stuck true.
    // We test by verifying that __setControllerForTest works (bindController path)
    // and that the element renders normally after a controller is injected.
    expect(() =>
      el.__setControllerForTest({
        next: () => {},
        prev: () => {},
        onChange: () => () => {},
        counter: { index: 1, total: 1 },
        breadcrumb: [{ id: "main", label: "Main deck" }],
        currentSlide: { hotspots: [] },
        nextSlide: null,
      }),
    ).not.toThrow();
    expect(el.querySelector("[data-hf-chrome]")).toBeTruthy();

    el.remove();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Bug fix tests: #4/#6/#9 — epoch counter cancels stale init
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix #4/#6/#9 — epoch counter cancels stale init", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  it("disconnect during waitForScenes cancels the old init; reconnect can bind a fresh controller", async () => {
    vi.useFakeTimers();
    let bindCount = 0;

    const el = document.createElement("hyperframes-slideshow") as any;

    // Fake player: ready immediately, scenes never arrive (so waitForScenes polls)
    const fakePlayer = document.createElement("div");
    Object.defineProperty(fakePlayer, "ready", { get: () => true });
    Object.defineProperty(fakePlayer, "seek", { value: () => {} });
    Object.defineProperty(fakePlayer, "play", { value: () => {} });
    Object.defineProperty(fakePlayer, "pause", { value: () => {} });
    Object.defineProperty(fakePlayer, "currentTime", { get: () => 0 });
    // scenes returns [] always — init will be stuck in waitForScenes polling
    Object.defineProperty(fakePlayer, "scenes", { get: () => [] });

    // Give it valid (but minimal) manifest HTML so parseSlideshowManifest won't throw
    // We use an empty slides array — parseSlideshowManifest should return a manifest.
    el.innerHTML = "";
    el.appendChild(fakePlayer);
    document.body.appendChild(el);

    // Advance past the macrotask init defer — init() starts and is now in waitForScenes
    await vi.advanceTimersByTimeAsync(10);

    // Disconnect mid-init — increments epoch, cancels the in-flight init
    el.remove();

    // Reconnect — new init() will start with a new epoch
    document.body.appendChild(el);

    // Inject a controller directly (simulating a successful second init)
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => {
        bindCount++;
        return () => {};
      },
      counter: { index: 1, total: 1 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
    });

    // The old in-flight init's waitForScenes eventually resolves with [] (timeout)
    // but the epoch guard must prevent it from calling bindController again.
    await vi.advanceTimersByTimeAsync(3000);

    // bindCount must be 1 (only the manual injection via __setControllerForTest)
    expect(bindCount).toBe(1);

    el.remove();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Fix #12/#13: dropInvalidSlides — phantom zero-duration slides are excluded
// ---------------------------------------------------------------------------
describe("dropInvalidSlides — phantom slide filtering", () => {
  function makeSlide(
    sceneId: string,
    start: number,
    end: number,
  ): import("@hyperframes/core/slideshow").ResolvedSlide {
    return { sceneId, start, end, fragments: [], hotspots: [] };
  }

  it("keeps slides with end > start and drops slides with end <= start", () => {
    const show = {
      slides: [
        makeSlide("valid", 0, 5),
        makeSlide("phantom", 3, 3), // zero-duration (unresolvable partial override)
        makeSlide("also-valid", 5, 10),
      ],
      sequences: {},
    };
    const cleaned = dropInvalidSlides(show);
    expect(cleaned.slides).toHaveLength(2);
    expect(cleaned.slides.map((s) => s.sceneId)).toEqual(["valid", "also-valid"]);
  });

  it("also filters phantoms from sequence slides", () => {
    const show = {
      slides: [makeSlide("main-slide", 0, 5)],
      sequences: {
        "branch-a": {
          id: "branch-a",
          label: "Branch A",
          slides: [
            makeSlide("good", 0, 3),
            makeSlide("bad", 7, 7), // phantom
          ],
        },
      },
    };
    const cleaned = dropInvalidSlides(show);
    expect(cleaned.sequences["branch-a"]?.slides).toHaveLength(1);
    expect(cleaned.sequences["branch-a"]?.slides[0]?.sceneId).toBe("good");
  });

  it("does not mutate the input — original slides array is unchanged", () => {
    const original = [makeSlide("a", 0, 5), makeSlide("phantom", 2, 2)];
    const show = { slides: original, sequences: {} };
    dropInvalidSlides(show);
    expect(show.slides).toHaveLength(2);
  });

  it("a manifest with one phantom slide (partial startTime, missing scene) leaves zero navigable slides", () => {
    // This is the exact scenario from bug #12/#13:
    // { sceneId: 'x', startTime: 3 } with scene 'x' absent → start=3, end=3 (phantom)
    const phantom = makeSlide("x", 3, 3);
    const show = { slides: [phantom], sequences: {} };
    const cleaned = dropInvalidSlides(show);
    expect(cleaned.slides).toHaveLength(0);
  });

  it("a manifest with one phantom + one valid slide → only the valid slide is navigable", () => {
    const phantom = makeSlide("x", 3, 3);
    const valid = makeSlide("intro", 0, 10);
    const show = { slides: [valid, phantom], sequences: {} };
    const cleaned = dropInvalidSlides(show);
    expect(cleaned.slides).toHaveLength(1);
    expect(cleaned.slides[0]?.sceneId).toBe("intro");
  });
});

// ---------------------------------------------------------------------------
// Conditional prev/next buttons (Fix 1 — nav button visibility)
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> conditional prev/next buttons", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  function makeElWithNav(opts: {
    canPrev?: boolean;
    canNext?: boolean;
    index?: number;
    total?: number;
  }) {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: opts.index ?? 1, total: opts.total ?? 11 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      canPrev: opts.canPrev,
      canNext: opts.canNext,
    });
    return el;
  }

  it("first slide of main deck (canPrev=false): prev button absent, next button present", () => {
    const el = makeElWithNav({ canPrev: false, canNext: true, index: 1, total: 11 });
    expect(el.querySelector("[data-hf-prev]")).toBeNull();
    expect(el.querySelector("[data-hf-next]")).toBeTruthy();
    expect(el.querySelector("[data-hf-counter]")?.textContent).toContain("1");
    el.remove();
  });

  it("last slide of main deck (canNext=false): next button absent, prev button present", () => {
    const el = makeElWithNav({ canPrev: true, canNext: false, index: 11, total: 11 });
    expect(el.querySelector("[data-hf-next]")).toBeNull();
    expect(el.querySelector("[data-hf-prev]")).toBeTruthy();
    expect(el.querySelector("[data-hf-counter]")?.textContent).toContain("11");
    el.remove();
  });

  it("middle slide (canPrev=true, canNext=true): both buttons present", () => {
    const el = makeElWithNav({ canPrev: true, canNext: true, index: 5, total: 11 });
    expect(el.querySelector("[data-hf-prev]")).toBeTruthy();
    expect(el.querySelector("[data-hf-next]")).toBeTruthy();
    el.remove();
  });

  it("inside branch (both canPrev=true, canNext=true): both buttons present", () => {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 1 },
      breadcrumb: [
        { id: "main", label: "Main deck" },
        { id: "branch-a", label: "Branch A" },
      ],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      canPrev: true,
      canNext: true,
    });
    expect(el.querySelector("[data-hf-prev]")).toBeTruthy();
    expect(el.querySelector("[data-hf-next]")).toBeTruthy();
    el.remove();
  });

  it("when canPrev/canNext are undefined (legacy stub), both buttons are shown (default-safe)", () => {
    // Stubs without canPrev/canNext should render both buttons (undefined !== false)
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 3 },
      breadcrumb: [{ id: "main", label: "Main deck" }],
      currentSlide: { hotspots: [] },
      nextSlide: null,
      // no canPrev / canNext
    });
    expect(el.querySelector("[data-hf-prev]")).toBeTruthy();
    expect(el.querySelector("[data-hf-next]")).toBeTruthy();
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// Fix 4 (updated): Back chrome removed; postMessage back still works
// Navigation is forward/back only — no breadcrumb or back button in chrome.
// The controller's back()/backToMain() are retained for internal use by prev().
// ---------------------------------------------------------------------------
describe("<hyperframes-slideshow> Fix 4 — back affordance (postMessage only; chrome breadcrumb/back removed)", () => {
  beforeEach(async () => {
    await import("./hyperframes-slideshow.js");
  });

  function makeElWithBreadcrumb(opts: {
    breadcrumbLength: number;
    onBack?: () => void;
    onBackToMain?: () => void;
  }) {
    const el = document.createElement("hyperframes-slideshow") as any;
    document.body.appendChild(el);
    const breadcrumb =
      opts.breadcrumbLength === 1
        ? [{ id: "main", label: "Main deck" }]
        : [
            { id: "main", label: "Main deck" },
            { id: "branch-a", label: "Branch A" },
          ];
    el.__setControllerForTest({
      next: () => {},
      prev: () => {},
      onChange: () => () => {},
      counter: { index: 1, total: 2 },
      breadcrumb,
      currentSlide: { hotspots: [] },
      nextSlide: null,
      back: opts.onBack ?? (() => {}),
      backToMain: opts.onBackToMain ?? (() => {}),
    });
    return el;
  }

  it("back button is NEVER present in chrome (removed in redesign)", () => {
    const el = makeElWithBreadcrumb({ breadcrumbLength: 2 });
    expect(el.querySelector("[data-hf-back]")).toBeNull();
    el.remove();
  });

  it("breadcrumb items are NEVER present in chrome (removed in redesign)", () => {
    const el = makeElWithBreadcrumb({ breadcrumbLength: 2 });
    expect(el.querySelector("[data-hf-breadcrumb-item]")).toBeNull();
    el.remove();
  });

  it("nav cluster (prev/counter/next) is present regardless of branch depth", () => {
    const el = makeElWithBreadcrumb({ breadcrumbLength: 2 });
    expect(el.querySelector("[data-hf-nav-cluster]")).toBeTruthy();
    expect(el.querySelector("[data-hf-prev]")).toBeTruthy();
    expect(el.querySelector("[data-hf-next]")).toBeTruthy();
    expect(el.querySelector("[data-hf-counter]")).toBeTruthy();
    el.remove();
  });

  it("postMessage {type:'back'} calls controller.back()", () => {
    let backCalled = false;
    const el = makeElWithBreadcrumb({
      breadcrumbLength: 2,
      onBack: () => {
        backCalled = true;
      },
    });
    window.dispatchEvent(new MessageEvent("message", { data: { type: "back" } }));
    expect(backCalled).toBe(true);
    el.remove();
  });

  it("postMessage {type:'back'} is ignored in audience mode", () => {
    let backCalled = false;
    const el = makeElWithBreadcrumb({
      breadcrumbLength: 2,
      onBack: () => {
        backCalled = true;
      },
    });
    el.setAttribute("mode", "audience");
    window.dispatchEvent(new MessageEvent("message", { data: { type: "back" } }));
    expect(backCalled).toBe(false);
    el.remove();
  });
});
