// fallow-ignore-file code-duplication
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { initSandboxRuntimeModular } from "./init";
import { TYPEGPU_PRESENT_HEARTBEAT_MS } from "./adapters/typegpu";
import { WebAudioTransport } from "./webAudioTransport";
import type { RuntimeTimelineLike } from "./types";

it("schedules WebAudio element gain from author volume without bridge volume", () => {
  const source = readFileSync("src/runtime/init.ts", "utf8");
  expect(source).not.toMatch(/vol\s*\*\s*state\.bridgeVolume/);
});

function createMockTimeline(duration: number): RuntimeTimelineLike {
  const state = { time: 0, paused: true, duration };
  return {
    play: () => {
      state.paused = false;
    },
    pause: () => {
      state.paused = true;
    },
    seek: (time?: number) => {
      if (time !== undefined) state.time = time;
      return state.time;
    },
    totalTime: (time?: number) => {
      if (time !== undefined) state.time = time;
      return state.time;
    },
    time: () => state.time,
    duration: () => state.duration,
    add: () => {},
    paused: (value?: boolean) => {
      if (typeof value === "boolean") {
        state.paused = value;
      }
      return state.paused;
    },
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
  };
}

function createPaddableMockTimeline(duration: number): RuntimeTimelineLike {
  const timeline = createMockTimeline(duration) as RuntimeTimelineLike & {
    to: (_target: object, vars: { duration: number }, position?: number) => void;
  };
  const baseDuration = timeline.duration;
  let paddedDuration = baseDuration();
  timeline.duration = () => paddedDuration;
  // Mirrors GSAP: an omitted position appends sequentially at the current end.
  timeline.to = (_target, vars, position) => {
    const resolvedPosition = position ?? paddedDuration;
    paddedDuration = Math.max(
      paddedDuration,
      resolvedPosition + Math.max(0, Number(vars.duration) || 0),
    );
  };
  return timeline;
}

function createManualRaf() {
  let now = 0;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      nextId += 1;
      callbacks.set(nextId, callback);
      return nextId;
    },
    cancelAnimationFrame: (id: number) => {
      callbacks.delete(id);
    },
    step: (milliseconds: number) => {
      now += milliseconds;
      const pending = Array.from(callbacks.entries());
      callbacks.clear();
      for (const [, callback] of pending) {
        callback(now);
      }
    },
    now: () => now,
  };
}

function withStudioIframe(run: () => void): void {
  const originalParent = window.parent;
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: {},
  });
  try {
    run();
  } finally {
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: originalParent,
    });
  }
}

describe("initSandboxRuntimeModular", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { CSS?: { escape?: (value: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (value: string) => value;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  });

  it.each([
    ["2x", 5],
    ["0x2", 10],
  ])("derives a native-parsed natural media window for rate %s", (rate, expected) => {
    document.body.innerHTML = `<div data-composition-id="main" data-root="true"><video data-start="0" data-playback-rate="${rate}"></video></div>`;
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "duration", { value: 10, configurable: true });
    window.__timelines = {};
    initSandboxRuntimeModular();
    expect(window.__player?.getDuration()).toBe(expected);
  });

  it.each([10, 11])(
    "preserves a known zero natural media window at source EOF (start=%s)",
    (start) => {
      document.body.innerHTML = `<div data-composition-id="main" data-root="true"><video data-start="0" data-media-start="${start}"></video></div>`;
      const video = document.querySelector("video")!;
      Object.defineProperty(video, "duration", { value: 10, configurable: true });
      window.__timelines = {};
      initSandboxRuntimeModular();
      expect(window.__player?.getDuration()).toBe(0);
    },
  );

  it("keeps a boosted clip legal on the element when the bridge sets volume", () => {
    // `data-volume` may hold up to 12 dB of authored gain. `el.volume` is
    // spec-pinned to [0,1] and THROWS outside it, so assigning the product raw
    // aborted the loop — every element after the boosted one kept its old
    // volume, and the bridge's own state said otherwise.
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true">` +
      `<audio data-start="0" data-volume="3.98"></audio>` +
      `<audio data-start="0" data-volume="0.5"></audio>` +
      `</div>`;
    window.__timelines = {};
    initSandboxRuntimeModular();

    const [boosted, quiet] = Array.from(document.querySelectorAll("audio"));
    if (!boosted || !quiet) throw new Error("expected both clips");
    // Sentinels, so the assertions cannot be satisfied by what the runtime
    // already applied while starting up.
    boosted.volume = 0.2;
    quiet.volume = 0.1;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "hf-parent", type: "control", action: "set-volume", volume: 1 },
      }),
    );

    expect(boosted.volume).toBe(1);
    // The clip after the boosted one is what a throw mid-loop strands.
    expect(quiet.volume).toBeCloseTo(0.5, 5);
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    window.__timelines = {} as Record<string, RuntimeTimelineLike>;
    delete window.__player;
    delete window.__playerReady;
    delete window.__renderReady;
    delete (window as { __HF_EXPORT_RENDER_SEEK_CONFIG?: unknown }).__HF_EXPORT_RENDER_SEEK_CONFIG;
    delete window.__hfTimelinesBuilding;
    delete (window as { THREE?: unknown }).THREE;
    delete (window as { __hfAutoNoopRegistered?: boolean }).__hfAutoNoopRegistered;
    delete window.gsap;
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  /**
   * `data-volume` is an authoring GAIN up to `MAX_AUDIO_GAIN` (12 dB ~ 3.98) —
   * `HTMLMediaElement.volume` accepts only 0..1. The bridge clamps its own
   * argument, but the PRODUCT `clipVolume * volume` was assigned unclamped, so a
   * clip authored above unity threw
   * `IndexSizeError: The volume provided (2.42103) is outside the range [0, 1]`
   * (2.42103 is the +7.68 dB fader stop) — and the throw aborted the loop, so
   * every media element after it kept its old volume too.
   */
  it("clamps the native volume of an over-unity clip instead of throwing", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const loud = document.createElement("audio");
    loud.setAttribute("data-start", "0");
    loud.setAttribute("data-duration", "10");
    loud.setAttribute("data-volume", "2.42103");
    loud.load = () => {};
    root.appendChild(loud);
    // Second element proves the throw took the whole sweep down with it, not just
    // the offending clip.
    const quiet = document.createElement("audio");
    quiet.setAttribute("data-start", "0");
    quiet.setAttribute("data-duration", "10");
    quiet.setAttribute("data-volume", "0.5");
    quiet.load = () => {};
    root.appendChild(quiet);

    window.__timelines = { main: createMockTimeline(10) };
    initSandboxRuntimeModular();

    const errors: string[] = [];
    const onError = (e: ErrorEvent) => errors.push(String(e.message ?? e.error));
    window.addEventListener("error", onError);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "hf-parent", type: "control", action: "set-volume", volume: 1 },
      }),
    );
    window.removeEventListener("error", onError);
    expect(errors).toEqual([]);
  });

  /**
   * The runtime stamps `data-start`/`data-duration` on every id'd child of the
   * composition root so a blank canvas still shows selectable rows. An
   * `<hf-audio-group>` is a mixer BUS, not a clip: stamping it put it in
   * `__clipManifest` as a full-duration element, which the studio drew as an
   * ordinary clip row above the real group header — draggable, trimmable, and
   * deletable, and deleting it takes the bus (so the group's FX rack) with it.
   */
  it("does not stamp timing onto an <hf-audio-group> bus", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const bus = document.createElement("hf-audio-group");
    bus.id = "voiceover";
    bus.setAttribute("data-label", "Voiceover");
    root.appendChild(bus);

    // A plain id'd sibling proves the stamp still happens for everything else.
    const caption = document.createElement("div");
    caption.id = "cap-1";
    root.appendChild(caption);

    window.__timelines = { main: createMockTimeline(10) };
    // The stamp only runs inside the studio preview (`window.parent !== window`),
    // which jsdom is not — so the condition has to be staged for the test.
    const realParent = window.parent;
    Object.defineProperty(window, "parent", { value: {}, configurable: true });
    try {
      initSandboxRuntimeModular();
    } finally {
      Object.defineProperty(window, "parent", { value: realParent, configurable: true });
    }

    expect(bus.hasAttribute("data-start")).toBe(false);
    expect(bus.hasAttribute("data-duration")).toBe(false);
    expect(caption.getAttribute("data-start")).toBe("0");
  });

  it("resolves Studio hold as a deterministic step at the segment end", () => {
    const defaultEase = (progress: number) => progress;
    const originalParseEase = vi.fn(() => defaultEase);
    window.gsap = {
      timeline: () => createMockTimeline(1),
      parseEase: originalParseEase,
      registerPlugin: vi.fn(),
    };

    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "1");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);
    window.__timelines = { main: createMockTimeline(1) };

    initSandboxRuntimeModular();

    const first = window.gsap.parseEase?.("hold");
    const second = window.gsap.parseEase?.("hold");
    expect(first).toBeTypeOf("function");
    expect(second).toBe(first);
    if (typeof first !== "function") return;

    expect([0, 0.25, 0.5, 0.99].map(first)).toEqual([0, 0, 0, 0]);
    expect(first(1)).toBe(1);
    expect(first(1.01)).toBe(1);
    expect(originalParseEase).not.toHaveBeenCalledWith("hold");
  });

  it("repairs a keyframes tween's inner-timeline ease baked to undefined before custom-ease registration", () => {
    // The composition inline script builds keyframes tweens BEFORE this runtime
    // registers the custom eases, so a `{keyframes, ease:"hold"}` tween's inner
    // timeline `_ease` bakes to undefined (GSAP resolves it once at build via the
    // internal ease map). GSAP then throws "_ease is not a function" on the first
    // render. The runtime must re-resolve that inner ease after registration.
    window.gsap = {
      timeline: () => createMockTimeline(20),
      parseEase: vi.fn(() => (progress: number) => progress),
      registerPlugin: vi.fn(),
      registerEase: vi.fn(),
    } as unknown as typeof window.gsap;

    const innerTimeline: { _ease?: unknown } = { _ease: undefined };
    const keyframesTween = {
      vars: { ease: "hold", keyframes: { "0%": { x: 0 }, "100%": { x: 50 } } },
      timeline: innerTimeline,
      _ease: (progress: number) => progress,
      targets: () => [document.createElement("div")],
    };
    const main = createMockTimeline(20);
    main.getChildren = () => [keyframesTween as unknown as RuntimeTimelineLike];

    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "20");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);
    window.__timelines = { main };

    expect(innerTimeline._ease).toBeUndefined();
    initSandboxRuntimeModular();
    // Bind re-resolves the inner ease to a real function (the installed hold ease),
    // so a subsequent render can call `timeline._ease(...)` without throwing.
    expect(innerTimeline._ease).toBeTypeOf("function");
  });

  it("isolates a failed keyframe ease repair and reports it without skipping siblings", () => {
    const outbound: Array<{ type?: string; event?: string }> = [];
    vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
      if (typeof message === "object" && message !== null) {
        outbound.push(message as { type?: string; event?: string });
      }
    });
    window.gsap = {
      timeline: () => createMockTimeline(20),
      parseEase: vi.fn((ease: unknown) => {
        if (ease === "bad-ease") throw new Error("bad ease");
        return (progress: number) => progress;
      }),
      registerPlugin: vi.fn(),
      registerEase: vi.fn(),
    } as unknown as typeof window.gsap;

    const failedInner: { _ease?: unknown } = { _ease: undefined };
    const repairedInner: { _ease?: unknown } = { _ease: undefined };
    const main = createMockTimeline(20);
    main.getChildren = () =>
      [
        { vars: { ease: "bad-ease", keyframes: {} }, timeline: failedInner },
        { vars: { ease: "hold", keyframes: {} }, timeline: repairedInner },
      ] as unknown as RuntimeTimelineLike[];

    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-duration", "20");
    document.body.appendChild(root);
    window.__timelines = { main };

    initSandboxRuntimeModular();

    expect(failedInner._ease).toBeUndefined();
    expect(repairedInner._ease).toBeTypeOf("function");
    expect(outbound).toContainEqual(
      expect.objectContaining({
        type: "analytics",
        event: "keyframe_ease_repair_failed",
      }),
    );
  });

  it("resolves Studio custom cubic-bezier eases on the composition GSAP instance", () => {
    const defaultEase = (progress: number) => 1 - (1 - progress) ** 2;
    const originalParseEase = vi.fn(() => defaultEase);
    window.gsap = {
      timeline: () => createMockTimeline(1),
      parseEase: originalParseEase,
      registerPlugin: vi.fn(),
    };

    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "1");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);
    window.__timelines = { main: createMockTimeline(1) };

    initSandboxRuntimeModular();

    const custom = "custom(M0,0 C0.42,0 0.58,1 1,1)";
    const first = window.gsap.parseEase?.(custom);
    const second = window.gsap.parseEase?.(custom);
    expect(first).toBeTypeOf("function");
    expect(second).toBe(first);
    if (typeof first !== "function" || typeof second !== "function") return;

    const progressSamples = [0, 0.25, 0.5, 0.75, 1];
    expect(progressSamples.map(first)).toEqual(progressSamples.map(second));
    expect(first(0.25)).toBeCloseTo(0.1292, 4);
    expect(first(0.5)).toBeCloseTo(0.5, 6);
    expect(first(0.5)).not.toBeCloseTo(defaultEase(0.5), 6);
    expect(first(0.75)).toBeCloseTo(0.8708, 4);
    expect(originalParseEase).not.toHaveBeenCalledWith(custom);

    expect(window.gsap.parseEase?.("power1.out")).toBe(defaultEase);
    expect(originalParseEase).toHaveBeenCalledWith("power1.out");
    expect(window.gsap.parseEase?.("custom(not-a-path)")).toBe(defaultEase);
    expect(originalParseEase).toHaveBeenCalledWith("custom(not-a-path)");

    const installedParseEase = window.gsap.parseEase;
    initSandboxRuntimeModular();
    expect(window.gsap.parseEase).toBe(installedParseEase);

    window.gsap = {
      timeline: () => createMockTimeline(1),
      parseEase: vi.fn(() => defaultEase),
      registerPlugin: vi.fn(),
    };
    initSandboxRuntimeModular();
    const freshResolution = window.gsap.parseEase?.(custom);
    expect(freshResolution).toBeTypeOf("function");
    if (typeof freshResolution === "function") {
      expect(progressSamples.map(freshResolution)).toEqual(progressSamples.map(first));
    }
  });

  it("resolves Studio spring eases as deterministic oscillations that settle exactly", () => {
    const defaultEase = (progress: number) => progress;
    const originalParseEase = vi.fn(() => defaultEase);
    window.gsap = {
      timeline: () => createMockTimeline(1),
      parseEase: originalParseEase,
      registerPlugin: vi.fn(),
    };

    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "1");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);
    window.__timelines = { main: createMockTimeline(1) };

    initSandboxRuntimeModular();

    const first = window.gsap.parseEase?.("spring(0.5)");
    const second = window.gsap.parseEase?.("spring(0.5)");
    expect(first).toBeTypeOf("function");
    expect(second).toBe(first);
    if (typeof first !== "function" || typeof second !== "function") return;

    const samples = Array.from({ length: 101 }, (_, index) => first(index / 100));
    expect(first(0)).toBe(0);
    expect(first(1)).toBe(1);
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(samples).toEqual(Array.from({ length: 101 }, (_, index) => second(index / 100)));
    expect(originalParseEase).not.toHaveBeenCalledWith("spring(0.5)");

    expect(window.gsap.parseEase?.("power1.out")).toBe(defaultEase);
    expect(originalParseEase).toHaveBeenCalledWith("power1.out");
  });

  it("keeps authored composition hosts visible when the live child timeline is shorter", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "slide-1");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-hf-authored-duration", "14");
    root.appendChild(child);

    window.__timelines = {
      main: createMockTimeline(20),
      "slide-1": createMockTimeline(8),
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    player?.renderSeek(9);

    expect(child.style.visibility).toBe("visible");
  });

  it("keeps WebGPU presentation active after renderSeek pauses the frame", async () => {
    vi.useFakeTimers();

    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-requires-webgpu", "");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);
    window.__timelines = { main: createMockTimeline(10) };

    const times: number[] = [];
    const onSeek = (event: Event) => {
      times.push((event as CustomEvent<{ time: number }>).detail.time);
    };
    window.addEventListener("hf-seek", onSeek);

    initSandboxRuntimeModular();
    window.__player?.renderSeek(4);
    await vi.advanceTimersByTimeAsync(TYPEGPU_PRESENT_HEARTBEAT_MS);

    window.removeEventListener("hf-seek", onSeek);
    expect(times).toEqual([0, 4, 4]);
  });

  it("uses export render fps when quantizing renderSeek", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "1");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const timeline = createMockTimeline(1);
    window.__timelines = { main: timeline };
    (
      window as {
        __HF_EXPORT_RENDER_SEEK_CONFIG?: { fps: number; fpsSource: "render-options" };
      }
    ).__HF_EXPORT_RENDER_SEEK_CONFIG = {
      fps: 60,
      fpsSource: "render-options",
    };

    initSandboxRuntimeModular();

    window.__player?.renderSeek(1 / 60);

    expect(timeline.time()).toBeCloseTo(1 / 60, 6);
    expect(infoSpy).toHaveBeenCalledWith(
      "[hyperframes] render runtime fps",
      expect.objectContaining({
        canonicalFps: 60,
        source: "render-options",
        rawFpsSource: "render-options",
        rawFps: 60,
      }),
    );
  });

  it("surfaces unknown export render fps sources without collapsing them to render-options", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "1");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    window.__timelines = { main: createMockTimeline(1) };
    (
      window as {
        __HF_EXPORT_RENDER_SEEK_CONFIG?: { fps: number; fpsSource: string };
      }
    ).__HF_EXPORT_RENDER_SEEK_CONFIG = {
      fps: 60,
      fpsSource: "future-source",
    };

    initSandboxRuntimeModular();

    expect(infoSpy).toHaveBeenCalledWith(
      "[hyperframes] render runtime fps",
      expect.objectContaining({
        canonicalFps: 60,
        source: "unknown",
        rawFpsSource: "future-source",
      }),
    );
  });

  it("keeps the default 30fps renderSeek grid when export render fps is absent", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "1");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const timeline = createMockTimeline(1);
    window.__timelines = { main: timeline };

    initSandboxRuntimeModular();

    // This is the originally broken 60fps render sample under the historical
    // 30fps runtime default: floor((1 / 60) * 30) / 30 = 0.
    window.__player?.renderSeek(1 / 60);

    expect(timeline.time()).toBe(0);
  });

  it("uses live child timeline duration when a composition host has no authored duration", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "slide-1");
    child.setAttribute("data-start", "0");
    root.appendChild(child);

    window.__timelines = {
      main: createMockTimeline(20),
      "slide-1": createMockTimeline(8),
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    player?.renderSeek(7);
    expect(child.style.visibility).toBe("visible");

    player?.renderSeek(9);
    expect(child.style.visibility).toBe("hidden");
  });

  it("binds the sole registered timeline even when the root id is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Root is MISSING data-composition-id, but there is exactly one usable
    // timeline registered. The DX fallback can bind it unambiguously instead of
    // letting the render freeze at t=0.
    const root = document.createElement("div");
    root.className = "clip";
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    window.__timelines = { main: createMockTimeline(6) };

    initSandboxRuntimeModular();

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(window.__player?.getDuration()).toBe(6);
    expect(warned).not.toContain("Root timeline not bound");
  });

  it("uses the shorter authored host window when the child timeline is longer", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "slide-1");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-hf-authored-duration", "2");
    root.appendChild(child);

    window.__timelines = {
      main: createMockTimeline(20),
      "slide-1": createMockTimeline(8),
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    player?.renderSeek(3);

    expect(child.style.visibility).toBe("hidden");
  });

  it("uses a half-open interval around a timed element's end boundary", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "2.5");
    root.appendChild(clip);

    window.__timelines = { main: createMockTimeline(5) };
    initSandboxRuntimeModular();

    window.__player?.renderSeek(2.5 - 1e-9);
    expect(clip.style.visibility).toBe("visible");

    window.__player?.renderSeek(2.5);
    expect(clip.style.visibility).toBe("hidden");

    window.__player?.renderSeek(2.5 + 1e-9);
    expect(clip.style.visibility).toBe("hidden");
  });

  it("keeps external composition hosts visible through their authored duration", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "sub");
    child.setAttribute("data-composition-src", "compositions/sub.html");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-duration", "3");
    root.appendChild(child);

    const template = document.createElement("template");
    template.id = "sub-template";
    template.innerHTML = `
      <div data-composition-id="sub" data-width="1920" data-height="1080">
        <div id="hold-marker">HOLD ME</div>
      </div>
    `;
    document.body.appendChild(template);

    window.__timelines = {
      main: createMockTimeline(3),
      sub: createMockTimeline(1),
    };

    initSandboxRuntimeModular();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    const player = window.__player;
    expect(player).toBeDefined();
    expect(child.querySelector("#hold-marker")?.textContent).toBe("HOLD ME");

    player?.renderSeek(2);

    expect(child.style.visibility).toBe("visible");
  });

  it("removes external composition head links during runtime teardown", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "sub");
    child.setAttribute("data-composition-src", "https://example.com/compositions/sub.html");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-duration", "3");
    root.appendChild(child);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<html><head><link rel="stylesheet" href="./sub.css"></head><body><template id="sub-template"><div data-composition-id="sub">Sub</div></template></body></html>`,
        { status: 200 },
      ),
    );
    window.__timelines = { main: createMockTimeline(3), sub: createMockTimeline(3) };

    initSandboxRuntimeModular();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    const injectedLink = document.head.querySelector<HTMLLinkElement>(
      'link[href="https://example.com/compositions/sub.css"]',
    );
    expect(injectedLink).not.toBeNull();

    window.__hfRuntimeTeardown?.();

    expect(injectedLink?.isConnected).toBe(false);
  });

  it("keeps compiled external composition hosts visible through their authored duration", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "sub");
    child.setAttribute("data-composition-file", "compositions/sub.html");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-duration", "3");
    child.innerHTML = '<div id="hold-marker">HOLD ME</div>';
    root.appendChild(child);

    window.__timelines = {
      main: createMockTimeline(3),
      sub: createMockTimeline(1),
    };

    initSandboxRuntimeModular();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    const player = window.__player;
    expect(player).toBeDefined();

    player?.renderSeek(2);

    expect(child.style.visibility).toBe("visible");
  });

  it("pads the root timeline to the authored composition schedule before seeking visibility", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const slide1 = document.createElement("div");
    slide1.id = "slide-1";
    slide1.setAttribute("data-composition-id", "slide-1");
    slide1.setAttribute("data-start", "0");
    slide1.setAttribute("data-hf-authored-duration", "14");
    root.appendChild(slide1);

    const slide2 = document.createElement("div");
    slide2.id = "slide-2";
    slide2.setAttribute("data-composition-id", "slide-2");
    slide2.setAttribute("data-start", "slide-1");
    slide2.setAttribute("data-hf-authored-duration", "12");
    root.appendChild(slide2);

    const slide3 = document.createElement("div");
    slide3.id = "slide-3";
    slide3.setAttribute("data-composition-id", "slide-3");
    slide3.setAttribute("data-start", "slide-2");
    slide3.setAttribute("data-hf-authored-duration", "16");
    root.appendChild(slide3);

    window.__timelines = {
      main: createPaddableMockTimeline(14),
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();
    expect(player?.getDuration()).toBe(42);

    player?.seek(30);

    expect(root.style.visibility).toBe("visible");
    expect(slide1.style.visibility).toBe("hidden");
    expect(slide2.style.visibility).toBe("hidden");
    expect(slide3.style.visibility).toBe("visible");
  });

  it("extends the playable duration to the root's declared data-duration when the timeline ends short", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "250.5");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    // GSAP timeline ends 0.1s short of the declared duration — the declared
    // data-duration must win, or duration-gated consumers (studio adapter
    // selection) reject the runtime player and audio is silently lost.
    window.__timelines = {
      main: createMockTimeline(250.4),
    };

    initSandboxRuntimeModular();

    expect(window.__player?.getDuration()).toBe(250.5);
  });

  it("keeps the timeline duration when it exceeds the root's declared data-duration", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    window.__timelines = {
      main: createMockTimeline(12),
    };

    initSandboxRuntimeModular();

    expect(window.__player?.getDuration()).toBe(12);
  });

  // #6: a single timeline registered under a key that does NOT match the root's
  // data-composition-id must still bind (sole-timeline fallback) instead of
  // silently rendering the frozen t=0 DOM.
  it("binds the sole registered timeline when its key does not match the root id", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    // Registered under "wrong-key", not "main".
    window.__timelines = {
      "wrong-key": createMockTimeline(7),
    };

    initSandboxRuntimeModular();

    expect(window.__player?.getDuration()).toBe(7);
  });

  // #6: when the root id is unmatched AND two timelines are registered, the
  // fallback is ambiguous, so nothing is bound and the loud warning fires.
  it("does not bind any timeline when the root id is unmatched and multiple are registered", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    window.__timelines = {
      "wrong-key-a": createMockTimeline(7),
      "wrong-key-b": createMockTimeline(9),
    };

    initSandboxRuntimeModular();

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(window.__player?.getDuration()).toBe(0);
    expect(warned).toContain("[hyperframes]");
    expect(warned).toContain("Root timeline not bound");
    expect(warned).toContain("wrong-key-a");
    expect(warned).toContain("wrong-key-b");
  });

  it("pauses nested media that is outside the timed-media cache after a seek", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "slide-translation");
    child.setAttribute("data-start", "20");
    child.setAttribute("data-duration", "16");
    root.appendChild(child);

    const video = document.createElement("video");
    child.appendChild(video);
    Object.defineProperty(video, "duration", { value: 20, writable: true, configurable: true });
    Object.defineProperty(video, "paused", { value: false, writable: true, configurable: true });
    Object.defineProperty(video, "readyState", { value: 4, writable: true, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 0, writable: true, configurable: true });
    const pause = () => {
      Object.defineProperty(video, "paused", { value: true, writable: true, configurable: true });
    };
    video.load = () => {};
    video.pause = pause;

    window.__timelines = {
      main: createMockTimeline(40),
      "slide-translation": createMockTimeline(16),
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    player?.seek(29);

    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(9);
  });

  // Regression (#1838): a video authoring its OWN data-start (the normal case
  // for a timed clip the studio positions on a track) took a fast literal-
  // value path that skipped adding the host composition's start offset —
  // unlike the no-own-data-start case above, which already went through
  // resolveStartForElement and got the offset for free. The video played
  // from the ROOT timeline's time instead of holding until its parent scene
  // began, desyncing from the correctly-offset GSAP overlay in the same scene.
  it("offsets a nested video's own data-start by its host composition's start", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "scene-2");
    child.setAttribute("data-start", "20");
    child.setAttribute("data-duration", "16");
    root.appendChild(child);

    const video = document.createElement("video");
    // Authored relative to scene-2's own local timeline, not the root's.
    video.setAttribute("data-start", "0");
    video.setAttribute("data-duration", "16");
    child.appendChild(video);
    Object.defineProperty(video, "duration", { value: 20, writable: true, configurable: true });
    Object.defineProperty(video, "paused", { value: true, writable: true, configurable: true });
    Object.defineProperty(video, "readyState", { value: 4, writable: true, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 0, writable: true, configurable: true });
    video.load = () => {};
    video.play = () => Promise.resolve();

    window.__timelines = {
      main: createMockTimeline(40),
      "scene-2": createMockTimeline(16),
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    // Root t=25 is 5s into scene-2 (which starts at root t=20) — the video
    // must be 5s into its own local playback, not 25s (root time).
    player?.seek(25);

    expect(video.currentTime).toBe(5);
  });

  it("keeps a scene-local video visible inside a later template-mounted host", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "6");
    root.setAttribute("data-width", "360");
    root.setAttribute("data-height", "640");
    document.body.appendChild(root);

    const firstHost = document.createElement("div");
    firstHost.setAttribute("data-composition-id", "first");
    firstHost.setAttribute("data-composition-file", "compositions/first.html");
    firstHost.setAttribute("data-start", "0");
    firstHost.setAttribute("data-duration", "3");
    root.appendChild(firstHost);

    const firstVideo = document.createElement("video");
    firstVideo.setAttribute("data-start", "0");
    firstVideo.setAttribute("data-duration", "3");
    firstHost.appendChild(firstVideo);

    const secondHost = document.createElement("div");
    secondHost.setAttribute("data-composition-id", "second");
    secondHost.setAttribute("data-composition-file", "compositions/second.html");
    secondHost.setAttribute("data-start", "3");
    secondHost.setAttribute("data-duration", "3");
    root.appendChild(secondHost);

    const secondVideo = document.createElement("video");
    secondVideo.setAttribute("data-start", "0");
    secondVideo.setAttribute("data-duration", "3");
    secondHost.appendChild(secondVideo);

    window.__timelines = {
      main: createMockTimeline(6),
      first: createMockTimeline(3),
      second: createMockTimeline(3),
    };

    initSandboxRuntimeModular();
    window.__player?.renderSeek(4);

    expect(firstHost.style.visibility).toBe("hidden");
    expect(firstVideo.style.visibility).toBe("hidden");
    expect(secondHost.style.visibility).toBe("visible");
    expect(secondVideo.style.visibility).toBe("visible");
  });

  it("resolves media starts through arbitrarily nested composition hosts", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const outerHost = document.createElement("div");
    outerHost.setAttribute("data-composition-id", "outer");
    outerHost.setAttribute("data-composition-file", "outer.html");
    outerHost.setAttribute("data-start", "2");
    outerHost.setAttribute("data-duration", "6");
    root.appendChild(outerHost);

    const innerHost = document.createElement("div");
    innerHost.setAttribute("data-composition-id", "inner");
    innerHost.setAttribute("data-composition-file", "inner.html");
    innerHost.setAttribute("data-start", "3");
    innerHost.setAttribute("data-duration", "3");
    outerHost.appendChild(innerHost);

    const video = document.createElement("video");
    video.setAttribute("data-start", "1");
    video.setAttribute("data-duration", "1");
    innerHost.appendChild(video);

    window.__timelines = {
      main: createMockTimeline(10),
      outer: createMockTimeline(6),
      inner: createMockTimeline(3),
    };

    initSandboxRuntimeModular();

    expect(window.__hfResolveMediaStartSeconds?.(video)).toBe(6);
    window.__player?.renderSeek(5.5);
    expect(video.style.visibility).toBe("hidden");
    window.__player?.renderSeek(6.5);
    expect(video.style.visibility).toBe("visible");
  });

  it("uses the canonical resolver for reference starts, auto-start media, and inline hosts", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const intro = document.createElement("section");
    intro.id = "intro";
    intro.setAttribute("data-start", "0");
    intro.setAttribute("data-duration", "2");
    root.appendChild(intro);

    const inlineHost = document.createElement("div");
    inlineHost.setAttribute("data-composition-id", "inline");
    inlineHost.setAttribute("data-start", "intro + 1");
    inlineHost.setAttribute("data-duration", "2");
    root.appendChild(inlineHost);

    const video = document.createElement("video");
    video.setAttribute("data-hf-auto-start", "true");
    video.setAttribute("data-duration", "2");
    inlineHost.appendChild(video);

    window.__timelines = {
      main: createMockTimeline(10),
      inline: createMockTimeline(2),
    };

    initSandboxRuntimeModular();

    expect(window.__hfResolveMediaStartSeconds?.(video)).toBe(3);
  });

  it("updates visibility for timed elements inside nested compositions", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "nested");
    child.setAttribute("data-start", "10");
    child.setAttribute("data-duration", "10");
    root.appendChild(child);

    const sceneA = document.createElement("section");
    sceneA.id = "scene-a";
    sceneA.setAttribute("data-start", "0");
    sceneA.setAttribute("data-duration", "4");
    child.appendChild(sceneA);

    const sceneB = document.createElement("section");
    sceneB.id = "scene-b";
    sceneB.setAttribute("data-start", "4");
    sceneB.setAttribute("data-duration", "4");
    child.appendChild(sceneB);

    window.__timelines = {
      main: createMockTimeline(20),
      nested: createMockTimeline(8),
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    player?.seek(11);

    expect(sceneA.style.visibility).toBe("visible");
    expect(sceneB.style.visibility).toBe("hidden");

    player?.seek(15);

    expect(sceneA.style.visibility).toBe("hidden");
    expect(sceneB.style.visibility).toBe("visible");
  });

  it("hides GSAP tween targets inside a hidden timed clip (issue #1387)", () => {
    withStudioIframe(() => {
      const root = document.createElement("div");
      root.setAttribute("data-composition-id", "main");
      root.setAttribute("data-root", "true");
      root.setAttribute("data-start", "0");
      root.setAttribute("data-duration", "8");
      root.setAttribute("data-width", "1920");
      root.setAttribute("data-height", "1080");
      document.body.appendChild(root);

      const captionOne = document.createElement("div");
      captionOne.id = "t01";
      captionOne.setAttribute("data-start", "0");
      captionOne.setAttribute("data-duration", "4");
      root.appendChild(captionOne);

      const lineOne = document.createElement("div");
      lineOne.className = "line";
      // Studio stamps full-duration pseudo-clips on GSAP tween targets.
      lineOne.setAttribute("data-start", "0");
      lineOne.setAttribute("data-duration", "8");
      captionOne.appendChild(lineOne);

      const captionTwo = document.createElement("div");
      captionTwo.id = "t02";
      captionTwo.setAttribute("data-start", "4");
      captionTwo.setAttribute("data-duration", "4");
      root.appendChild(captionTwo);

      const lineTwo = document.createElement("div");
      lineTwo.className = "line";
      lineTwo.setAttribute("data-start", "0");
      lineTwo.setAttribute("data-duration", "8");
      captionTwo.appendChild(lineTwo);

      window.__timelines = {
        main: createMockTimeline(8),
      };

      initSandboxRuntimeModular();

      const player = window.__player;
      expect(player).toBeDefined();

      player?.seek(1);

      expect(captionOne.style.visibility).toBe("visible");
      expect(lineOne.style.visibility).toBe("visible");
      expect(captionTwo.style.visibility).toBe("hidden");
      expect(lineTwo.style.visibility).toBe("hidden");

      player?.seek(5);

      expect(captionOne.style.visibility).toBe("hidden");
      expect(lineOne.style.visibility).toBe("hidden");
      expect(captionTwo.style.visibility).toBe("visible");
      expect(lineTwo.style.visibility).toBe("visible");
    });
  });

  it("hides timed descendants inside a hidden timed clip in render mode", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "8");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const panel = document.createElement("div");
    panel.id = "panel";
    panel.setAttribute("data-start", "0");
    panel.setAttribute("data-duration", "2");
    root.appendChild(panel);

    const bottomBand = document.createElement("div");
    bottomBand.className = "bottom-band";
    // Regression shape: a child strip outlives its parent scene. Without
    // ancestor suppression it can paint through after the parent has ended.
    bottomBand.setAttribute("data-start", "0");
    bottomBand.setAttribute("data-duration", "8");
    panel.appendChild(bottomBand);

    window.__timelines = {
      main: createMockTimeline(8),
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    player?.seek(3);

    expect(panel.style.visibility).toBe("hidden");
    expect(bottomBand.style.visibility).toBe("hidden");
  });

  it("forces data-hidden timed elements out of layout until the attribute is removed", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const hiddenClip = document.createElement("div");
    hiddenClip.style.position = "absolute";
    hiddenClip.setAttribute("data-start", "2");
    hiddenClip.setAttribute("data-duration", "4");
    hiddenClip.setAttribute("data-hidden", "");
    root.appendChild(hiddenClip);

    window.__timelines = {
      main: createMockTimeline(10),
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    player?.seek(0);
    expect(hiddenClip.style.display).toBe("none");

    player?.seek(3);
    expect(hiddenClip.style.display).toBe("none");

    player?.seek(7);
    expect(hiddenClip.style.display).toBe("none");

    hiddenClip.removeAttribute("data-hidden");

    player?.seek(3);
    expect(hiddenClip.style.visibility).toBe("visible");
    expect(hiddenClip.style.display).toBe("");

    player?.seek(7);
    expect(hiddenClip.style.visibility).toBe("hidden");
    expect(hiddenClip.style.display).toBe("");
  });

  it("excludes a data-hidden audio clip from Web Audio scheduling", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const hiddenAudio = document.createElement("audio");
    hiddenAudio.setAttribute("data-start", "0");
    hiddenAudio.setAttribute("data-duration", "10");
    hiddenAudio.setAttribute("data-hidden", "");
    hiddenAudio.load = () => {};
    hiddenAudio.play = vi.fn(() => Promise.resolve());
    root.appendChild(hiddenAudio);

    const audibleAudio = document.createElement("audio");
    audibleAudio.setAttribute("data-start", "0");
    audibleAudio.setAttribute("data-duration", "10");
    audibleAudio.load = () => {};
    audibleAudio.play = vi.fn(() => Promise.resolve());
    root.appendChild(audibleAudio);

    window.__timelines = { main: createMockTimeline(10) };
    initSandboxRuntimeModular();

    // `scheduleMediaElementPlayback`, not `decodeAudioElement`: the media-element
    // transport is the path the runtime tries FIRST for audio, and the decoded
    // buffer is only its fallback. What is under test either way is which
    // ELEMENTS get scheduled at all.
    const scheduleSpy = vi
      .spyOn(WebAudioTransport.prototype, "scheduleMediaElementPlayback")
      .mockResolvedValue(null);

    const player = window.__player;
    player?.play();
    player?.seek(0);

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy.mock.calls[0]?.[0]).toBe(audibleAudio);
  });

  it("reschedules only when a data-hidden mutation actually moved something", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const hiddenAudio = document.createElement("audio");
    hiddenAudio.setAttribute("data-start", "0");
    hiddenAudio.setAttribute("data-duration", "10");
    hiddenAudio.setAttribute("data-hidden", "");
    hiddenAudio.load = () => {};
    hiddenAudio.play = vi.fn(() => Promise.resolve());
    root.appendChild(hiddenAudio);

    window.__timelines = { main: createMockTimeline(10) };
    initSandboxRuntimeModular();

    const stopSpy = vi.spyOn(WebAudioTransport.prototype, "stopAll");
    const player = window.__player;
    player?.play();

    // A seek stops the transport itself, so the COUNT is the measure. Without
    // the dirty gate the reschedule fired on every visibility pass, adding a
    // second stop — an audible stop-and-restart across the whole mix — to
    // rebuild an identical active set.
    stopSpy.mockClear();
    player?.seek(1, { keepPlaying: true });
    const seekOnly = stopSpy.mock.calls.length;

    // The dirty flag is set by a data-hidden MUTATION, so the toggle is the
    // gesture; a plain seek never reaches the reschedule at all.
    stopSpy.mockClear();
    hiddenAudio.removeAttribute("data-hidden");
    player?.seek(2, { keepPlaying: true });
    const afterToggle = stopSpy.mock.calls.length;

    expect(seekOnly).toBe(1);
    expect(afterToggle).toBe(seekOnly + 1);
  });

  it("batches a mid-playback data-hidden toggle into exactly one Web Audio reschedule", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    // Two separately-toggled audio clips (not a wrapper div — the visibility
    // sweep only walks [data-start] nodes, so the attribute must sit on each
    // timed element itself, matching how the eye button hides per-element).
    const audioA = document.createElement("audio");
    audioA.setAttribute("data-start", "0");
    audioA.setAttribute("data-duration", "10");
    audioA.setAttribute("data-hidden", "");
    audioA.load = () => {};
    audioA.play = vi.fn(() => Promise.resolve());
    root.appendChild(audioA);

    const audioB = document.createElement("audio");
    audioB.setAttribute("data-start", "0");
    audioB.setAttribute("data-duration", "10");
    audioB.setAttribute("data-hidden", "");
    audioB.load = () => {};
    audioB.play = vi.fn(() => Promise.resolve());
    root.appendChild(audioB);

    window.__timelines = { main: createMockTimeline(10) };
    initSandboxRuntimeModular();

    const player = window.__player;
    // play() alone (no seek) already runs one visibility pass while the clock
    // is playing, registering both clips as hidden — the baseline this test
    // toggles away from.
    player?.play();

    const scheduleSpy = vi
      .spyOn(WebAudioTransport.prototype, "scheduleMediaElementPlayback")
      .mockResolvedValue(null);
    const generationSpy = vi.spyOn(WebAudioTransport.prototype, "startGeneration");

    // Both become visible in the SAME sync pass — must still be one reschedule.
    // keepPlaying: a plain seek() pauses the clock before re-syncing visibility,
    // which would make the hiddenAudioDirty branch's isPlaying() gate a no-op.
    audioA.removeAttribute("data-hidden");
    audioB.removeAttribute("data-hidden");
    player?.seek(1, { keepPlaying: true });

    expect(generationSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledTimes(2);
  });

  // Scheduling does NOT replace the active set: it bumps a generation, which
  // only rejects schedules still in flight. Every source already started keeps
  // playing and there is no per-element dedup, so rescheduling on its own laid
  // a second buffer source over every sounding clip — the whole mix doubled,
  // slightly out of phase, from one mute click until the next pause.
  it("stops the running sources before rescheduling on a data-hidden toggle", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const audio = document.createElement("audio");
    audio.setAttribute("data-start", "0");
    audio.setAttribute("data-duration", "10");
    audio.setAttribute("data-hidden", "");
    audio.load = () => {};
    audio.play = vi.fn(() => Promise.resolve());
    root.appendChild(audio);

    window.__timelines = { main: createMockTimeline(10) };
    initSandboxRuntimeModular();
    const player = window.__player;
    player?.play();

    vi.spyOn(WebAudioTransport.prototype, "decodeAudioElement").mockResolvedValue(null);
    const stopSpy = vi.spyOn(WebAudioTransport.prototype, "stopAll");
    const generationSpy = vi.spyOn(WebAudioTransport.prototype, "startGeneration");

    audio.removeAttribute("data-hidden");
    player?.seek(1, { keepPlaying: true });

    expect(generationSpy).toHaveBeenCalledTimes(1);
    // Two: `seek` clears the graph on its way in, and the toggle's own
    // reschedule clears it again. Only the second one is what this covers —
    // without it the count is 1 and the reschedule stacks on live sources.
    expect(stopSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Order matters, not just presence: stopping AFTER the reschedule would
    // silence the clips it had just started.
    const lastStop = Math.max(...stopSpy.mock.invocationCallOrder);
    expect(lastStop).toBeLessThan(generationSpy.mock.invocationCallOrder[0] ?? 0);
  });

  it("does not stamp Studio timing on GSAP targets inside authored timed clips", () => {
    withStudioIframe(() => {
      const root = document.createElement("div");
      root.setAttribute("data-composition-id", "main");
      root.setAttribute("data-root", "true");
      root.setAttribute("data-start", "0");
      root.setAttribute("data-duration", "8");
      root.setAttribute("data-width", "1920");
      root.setAttribute("data-height", "1080");
      document.body.appendChild(root);

      const caption = document.createElement("div");
      caption.id = "t01";
      caption.setAttribute("data-start", "0");
      caption.setAttribute("data-duration", "4");
      root.appendChild(caption);

      const line = document.createElement("div");
      line.className = "line";
      caption.appendChild(line);

      const tweenTarget = {
        targets: () => [line],
      };
      const timeline = createMockTimeline(8) as RuntimeTimelineLike & {
        getChildren: (nested?: boolean) => Array<{ targets: () => Element[] }>;
      };
      timeline.getChildren = () => [tweenTarget];

      window.__timelines = {
        main: timeline,
      };

      initSandboxRuntimeModular();

      expect(line.hasAttribute("data-start")).toBe(false);
      expect(line.hasAttribute("data-duration")).toBe(false);
    });
  });

  it("hides tween targets inside inactive multi-panel beats (niemmo panel stack)", () => {
    withStudioIframe(() => {
      const root = document.createElement("div");
      root.setAttribute("data-composition-id", "niemmo-launch-50");
      root.setAttribute("data-root", "true");
      root.setAttribute("data-start", "0");
      root.setAttribute("data-duration", "50");
      root.setAttribute("data-width", "1280");
      root.setAttribute("data-height", "720");
      document.body.appendChild(root);

      const panelA = document.createElement("div");
      panelA.className = "panel clip";
      panelA.setAttribute("data-composition-id", "cold-open");
      panelA.setAttribute("data-start", "0");
      panelA.setAttribute("data-duration", "2");
      root.appendChild(panelA);

      const headlineA = document.createElement("h1");
      headlineA.className = "co-headline";
      headlineA.setAttribute("data-start", "0");
      headlineA.setAttribute("data-duration", "50");
      panelA.appendChild(headlineA);

      const panelB = document.createElement("div");
      panelB.className = "panel clip";
      panelB.setAttribute("data-composition-id", "problem-dev-beat");
      panelB.setAttribute("data-start", "2");
      panelB.setAttribute("data-duration", "2.5");
      root.appendChild(panelB);

      const headlineB = document.createElement("h1");
      headlineB.className = "pb-headline";
      headlineB.setAttribute("data-start", "0");
      headlineB.setAttribute("data-duration", "50");
      panelB.appendChild(headlineB);

      window.__timelines = {
        "niemmo-launch-50": createMockTimeline(50),
      };

      initSandboxRuntimeModular();

      const player = window.__player;
      expect(player).toBeDefined();

      player?.seek(1);

      expect(panelA.style.visibility).toBe("visible");
      expect(headlineA.style.visibility).toBe("visible");
      expect(panelB.style.visibility).toBe("hidden");
      expect(headlineB.style.visibility).toBe("hidden");

      player?.seek(3);

      expect(panelA.style.visibility).toBe("hidden");
      expect(headlineA.style.visibility).toBe("hidden");
      expect(panelB.style.visibility).toBe("visible");
      expect(headlineB.style.visibility).toBe("visible");
    });
  });

  it("clamps nested media to the authored host window on seek", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "slide-translation");
    child.setAttribute("data-start", "20");
    child.setAttribute("data-duration", "16");
    root.appendChild(child);

    const video = document.createElement("video");
    child.appendChild(video);
    Object.defineProperty(video, "duration", { value: 20, writable: true, configurable: true });
    Object.defineProperty(video, "paused", { value: false, writable: true, configurable: true });
    Object.defineProperty(video, "readyState", { value: 4, writable: true, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 0, writable: true, configurable: true });
    const pause = () => {
      Object.defineProperty(video, "paused", { value: true, writable: true, configurable: true });
    };
    video.load = () => {};
    video.pause = pause;

    window.__timelines = {
      main: createMockTimeline(40),
      "slide-translation": createMockTimeline(16),
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    player?.seek(37);

    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(0);
  });

  it("activates sub-composition timelines at data-start near 0 during renderSeek", () => {
    // Regression: sub-compositions starting at or near t=0 had their GSAP
    // sub-timelines ignored during render because renderSeek did not
    // activate (unpause) nested child timelines before seeking the root.
    // The children were added to the root while paused, and GSAP's
    // totalTime() does not propagate to paused children.
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "24");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const hookHost = document.createElement("div");
    hookHost.setAttribute("data-composition-id", "hook");
    hookHost.setAttribute("data-start", "0.001");
    hookHost.setAttribute("data-duration", "2");
    hookHost.setAttribute("data-track-index", "0");
    hookHost.classList.add("clip");
    root.appendChild(hookHost);

    const laterHost = document.createElement("div");
    laterHost.setAttribute("data-composition-id", "tweet");
    laterHost.setAttribute("data-start", "1.5");
    laterHost.setAttribute("data-duration", "4.5");
    laterHost.setAttribute("data-track-index", "1");
    laterHost.classList.add("clip");
    root.appendChild(laterHost);

    const hookTimeline = createMockTimeline(2);
    const tweetTimeline = createMockTimeline(4.5);
    const rootTimeline = createMockTimeline(24);

    window.__timelines = {
      main: rootTimeline,
      hook: hookTimeline,
      tweet: tweetTimeline,
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    // Simulate that the hook timeline was paused (as happens when
    // children are added to a paused root timeline in GSAP)
    hookTimeline.paused!(true);
    tweetTimeline.paused!(true);

    // Seek to 0.5s — well within the hook's window [0.001, 2.001]
    player?.renderSeek(0.5);

    // renderSeek should activate (unpause) all child timelines before
    // seeking the root. Without the fix, children stay paused and GSAP's
    // totalTime() propagation skips them, leaving elements at initial CSS
    // state (opacity: 0).
    expect(hookTimeline.paused!()).toBe(false);
    expect(tweetTimeline.paused!()).toBe(false);

    // The hook host should be visible at t=0.5
    expect(hookHost.style.visibility).toBe("visible");
  });

  it("seeks child compositions in source time using host offset and playback rate", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "20");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "child");
    child.setAttribute("data-start", "3");
    child.setAttribute("data-duration", "8");
    child.setAttribute("data-playback-start", "1.5");
    child.setAttribute("data-playback-rate", "2");
    root.appendChild(child);

    const childTimeline = createMockTimeline(6);
    window.__timelines = { main: createMockTimeline(20), child: childTimeline };
    initSandboxRuntimeModular();

    window.__player?.renderSeek(5);
    expect(childTimeline.time()).toBeCloseTo(5.5);

    window.__player?.renderSeek(10);
    expect(childTimeline.time()).toBe(6);
  });

  it("keeps the root GSAP render nudge for normal frames but not silent probes", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const seekCalls: Array<{ time: number; suppressEvents?: boolean }> = [];
    const rootTimeline = createMockTimeline(10);
    const originalTotalTime = rootTimeline.totalTime;
    rootTimeline.totalTime = (time: number, suppressEvents?: boolean) => {
      seekCalls.push({ time, suppressEvents });
      return originalTotalTime?.(time, suppressEvents);
    };

    window.__timelines = { main: rootTimeline };
    initSandboxRuntimeModular();
    seekCalls.length = 0;

    window.__player?.renderSeek(2);

    expect(seekCalls).toEqual([
      { time: 2, suppressEvents: false },
      { time: 2.001, suppressEvents: true },
      { time: 2, suppressEvents: true },
    ]);

    seekCalls.length = 0;
    window.__player?.renderSeek(3, { suppressEvents: true });

    expect(seekCalls).toEqual([{ time: 3, suppressEvents: true }]);
  });

  it("does not nudge root GSAP timelines that contain zero-duration callbacks", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const seekCalls: Array<{ time: number; suppressEvents?: boolean }> = [];
    const rootTimeline = createMockTimeline(10);
    const originalTotalTime = rootTimeline.totalTime;
    rootTimeline.totalTime = (time: number, suppressEvents?: boolean) => {
      seekCalls.push({ time, suppressEvents });
      return originalTotalTime?.(time, suppressEvents);
    };
    Object.assign(rootTimeline, {
      getChildren: () => [
        {
          vars: { onComplete: () => {} },
          duration: () => 0,
          totalDuration: () => 0,
        },
      ],
    });

    window.__timelines = { main: rootTimeline };
    initSandboxRuntimeModular();
    seekCalls.length = 0;

    window.__player?.renderSeek(2);

    expect(seekCalls).toEqual([{ time: 2, suppressEvents: false }]);
  });

  it("shows pip video at global start time even when host composition starts late", () => {
    // Regression: resolveStartForElement used to add the host composition's start on top of
    // the video's own data-start, causing double-offset. A pip video with data-start="45.40"
    // inside a host at data-start="45.40" would resolve to 90.80 and stay permanently hidden.
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "scene-pip");
    host.setAttribute("data-composition-file", "compositions/pip.html");
    host.setAttribute("data-start", "45.40");
    host.setAttribute("data-duration", "7.06");
    root.appendChild(host);

    const innerRoot = document.createElement("div");
    innerRoot.setAttribute("data-composition-id", "scene-pip");
    host.appendChild(innerRoot);

    // pip-wired video: data-start is authored in global time (same value as host)
    const pipVideo = document.createElement("video");
    pipVideo.setAttribute("data-start", "45.40");
    pipVideo.setAttribute("data-duration", "7.06");
    Object.defineProperty(pipVideo, "paused", { value: true, configurable: true });
    Object.defineProperty(pipVideo, "readyState", { value: 0, configurable: true });
    Object.defineProperty(pipVideo, "currentTime", {
      value: 0,
      writable: true,
      configurable: true,
    });
    pipVideo.load = () => {};
    innerRoot.appendChild(pipVideo);

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: createMockTimeline(60),
      "scene-pip": createMockTimeline(7.06),
    };

    initSandboxRuntimeModular();

    expect(window.__hfResolveMediaStartSeconds?.(pipVideo)).toBeCloseTo(45.4);

    const player = (
      window as Window & {
        __player?: { seek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();

    // Before the fix: resolveStartForElement(pipVideo) = 45.40 + 45.40 = 90.80, so the
    // video would be hidden at t=46 (90.80 > 46). After the fix: start = 45.40, visible.
    player?.seek(46);
    expect(pipVideo.style.visibility).toBe("visible");

    player?.seek(53);
    expect(pipVideo.style.visibility).toBe("hidden");

    player?.seek(44);
    expect(pipVideo.style.visibility).toBe("hidden");
  });

  it("shows auto-injected video at host time, not at t=0", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "intro");
    host.setAttribute("data-start", "10");
    host.setAttribute("data-duration", "5");
    root.appendChild(host);

    const innerRoot = document.createElement("div");
    innerRoot.setAttribute("data-composition-id", "intro");
    host.appendChild(innerRoot);

    const video = document.createElement("video");
    video.setAttribute("data-start", "0");
    video.setAttribute("data-hf-auto-start", "");
    video.setAttribute("data-duration", "5");
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    Object.defineProperty(video, "readyState", { value: 0, configurable: true });
    Object.defineProperty(video, "currentTime", {
      value: 0,
      writable: true,
      configurable: true,
    });
    video.load = () => {};
    innerRoot.appendChild(video);

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: createMockTimeline(30),
      intro: createMockTimeline(5),
    };

    initSandboxRuntimeModular();

    const player = (
      window as Window & {
        __player?: { seek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();

    player?.seek(12);
    expect(video.style.visibility).toBe("visible");

    player?.seek(5);
    expect(video.style.visibility).toBe("hidden");

    player?.seek(16);
    expect(video.style.visibility).toBe("hidden");
  });

  it("allocates color grading only for the active timed media", () => {
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "4");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const futureComposition = document.createElement("div");
    futureComposition.id = "future-composition";
    futureComposition.setAttribute("data-start", "2");
    root.appendChild(futureComposition);

    for (const [id, start] of [
      ["first", "0"],
      ["second", "2"],
    ]) {
      const video = document.createElement("video");
      video.id = id;
      video.setAttribute("data-start", start);
      video.setAttribute("data-duration", "2");
      video.setAttribute("data-color-grading", '{"adjust":{"exposure":0.1}}');
      Object.defineProperty(video, "paused", { value: true, configurable: true });
      Object.defineProperty(video, "readyState", { value: 0, configurable: true });
      video.load = () => {};
      root.appendChild(video);
    }

    window.__timelines = { main: createMockTimeline(4) };
    initSandboxRuntimeModular();

    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(document.getElementById("first")?.style.visibility).toBe("visible");
    expect(document.getElementById("second")?.style.visibility).toBe("hidden");
    expect(futureComposition.style.visibility).toBe("");
    expect(futureComposition.style.display).toBe("");

    window.__player?.seek(3);

    expect(getContextSpy).toHaveBeenCalledTimes(2);
    expect(document.getElementById("first")?.style.visibility).toBe("hidden");
    expect(document.getElementById("second")?.style.visibility).toBe("visible");
  });

  it("plays scheduled child timelines without a captured root timeline when audio has failed", () => {
    const raf = createManualRaf();
    vi.spyOn(performance, "now").mockImplementation(() => raf.now());
    window.requestAnimationFrame = raf.requestAnimationFrame as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = raf.cancelAnimationFrame as typeof window.cancelAnimationFrame;

    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "4");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "scene");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-duration", "4");
    root.appendChild(child);

    const audio = document.createElement("audio");
    audio.setAttribute("data-start", "0");
    audio.setAttribute("data-duration", "4");
    Object.defineProperty(audio, "error", {
      value: { code: 4, message: "format error" },
      configurable: true,
    });
    Object.defineProperty(audio, "networkState", {
      value: HTMLMediaElement.NETWORK_NO_SOURCE,
      configurable: true,
    });
    Object.defineProperty(audio, "readyState", {
      value: HTMLMediaElement.HAVE_NOTHING,
      configurable: true,
    });
    Object.defineProperty(audio, "paused", { value: true, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 0, writable: true, configurable: true });
    audio.load = () => {};
    audio.play = vi.fn(() => Promise.reject(new Error("format error")));
    root.appendChild(audio);

    const childTimeline = createMockTimeline(4);
    window.__timelines = {
      scene: childTimeline,
    };

    initSandboxRuntimeModular();

    const player = window.__player;
    expect(player).toBeDefined();

    player?.play();
    raf.step(1_000);

    expect(player?.isPlaying()).toBe(true);
    expect(player?.getTime()).toBeCloseTo(1, 1);
    expect(childTimeline.time()).toBeCloseTo(1, 1);
  });

  it.each([24, 30, 60, 30_000 / 1_001])(
    "preserves public playback state across keepPlaying seeks at %s fps",
    (fps) => {
      const raf = createManualRaf();
      vi.spyOn(performance, "now").mockImplementation(() => raf.now());
      vi.spyOn(console, "info").mockImplementation(() => {});
      window.requestAnimationFrame =
        raf.requestAnimationFrame as typeof window.requestAnimationFrame;
      window.cancelAnimationFrame = raf.cancelAnimationFrame as typeof window.cancelAnimationFrame;

      document.body.innerHTML = `
        <div
          data-composition-id="main"
          data-root="true"
          data-start="0"
          data-duration="10"
          data-width="1920"
          data-height="1080"
        ></div>
      `;
      window.__timelines = { main: createMockTimeline(10) };
      window.__HF_EXPORT_RENDER_SEEK_CONFIG = {
        fps,
        fpsSource: "render-options",
      };

      initSandboxRuntimeModular();

      const player = window.__player;
      player?.play();
      raf.step(500);
      player?.seek(2.07, { keepPlaying: true });

      const quantized = Math.floor(2.07 * fps + 1e-9) / fps;
      expect(player?.isPlaying()).toBe(true);
      expect(player?.getTime()).toBeCloseTo(quantized, 6);

      raf.step(500);
      expect(player?.isPlaying()).toBe(true);
      expect(player?.getTime()).toBeCloseTo(quantized + 0.5, 5);
    },
  );

  it("ignores the async media-metadata duration rebind once render capture has started seeking frames (regression HF#2550)", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const video = document.createElement("video");
    video.setAttribute("data-start", "0");
    document.body.appendChild(video);

    // A root timeline with no usable duration yet — mirrors a composition
    // whose length is derived from a full-length <video> that hasn't reported
    // its metadata. window.gsap is needed because resolveRootTimelineFromDocument
    // builds a fresh duration-floor wrapper timeline via gsap.timeline().
    (
      window as unknown as {
        gsap?: { timeline: () => ReturnType<typeof createPaddableMockTimeline> };
      }
    ).gsap = {
      timeline: () => createPaddableMockTimeline(0),
    };
    window.__timelines = { main: createMockTimeline(0) };
    // Only a real producer render/export page sets this (fileServer.ts's
    // pre-head script) — required alongside renderCaptureSeekStarted so the
    // gate doesn't also disable Studio's own preview-iframe rebind.
    window.__HF_EXPORT_RENDER_SEEK_CONFIG = { fps: 30, fpsSource: "default" };

    const postMessageSpy = vi.spyOn(window, "postMessage");

    try {
      initSandboxRuntimeModular();

      // The render/producer capture protocol has claimed the timeline and is
      // now driving frames deterministically (mirrors the engine's
      // window.__hf.seek(t) -> player.renderSeek(t) bridge).
      window.__player?.renderSeek(0);

      // Let the runtime's own deferred re-bind attempt (init.ts's
      // `setTimeout(() => maybePublishRenderReady(), 0)`, unrelated to media
      // metadata) settle first, so only the metadata path below is under test.
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Video metadata resolves late — after capture has started, the exact
      // HF#2550 race (Docker/slow-I/O environments hit this; fast native
      // environments resolve metadata before capture begins and never do).
      Object.defineProperty(video, "duration", { value: 12, configurable: true });
      video.dispatchEvent(new Event("loadedmetadata"));

      // Clears init.ts's internal METADATA_REBIND_DEBOUNCE_MS (100ms, not exported).
      await new Promise((resolve) => setTimeout(resolve, 150));

      const rebindMessages = postMessageSpy.mock.calls
        .map(([message]) => message as { code?: string } | undefined)
        .filter((message) => message?.code === "timeline_rebind_after_media_metadata");
      expect(rebindMessages).toHaveLength(0);
    } finally {
      delete (window as { gsap?: unknown }).gsap;
    }
  });

  it("still applies the media-metadata duration rebind after renderSeek in Studio preview (no export render-seek config)", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const video = document.createElement("video");
    video.setAttribute("data-start", "0");
    document.body.appendChild(video);

    (
      window as unknown as {
        gsap?: { timeline: () => ReturnType<typeof createPaddableMockTimeline> };
      }
    ).gsap = {
      timeline: () => createPaddableMockTimeline(0),
    };
    window.__timelines = { main: createMockTimeline(0) };
    // No window.__HF_EXPORT_RENDER_SEEK_CONFIG here — Studio's preview iframe
    // never sets it, and useTimelinePlayer's overhang fallback drives
    // renderSeek there too. The rebind must still fire for this case.

    const postMessageSpy = vi.spyOn(window, "postMessage");

    try {
      initSandboxRuntimeModular();

      window.__player?.renderSeek(0);

      await new Promise((resolve) => setTimeout(resolve, 10));

      Object.defineProperty(video, "duration", { value: 12, configurable: true });
      video.dispatchEvent(new Event("loadedmetadata"));

      // Clears init.ts's internal METADATA_REBIND_DEBOUNCE_MS (100ms, not exported).
      await new Promise((resolve) => setTimeout(resolve, 150));

      const rebindMessages = postMessageSpy.mock.calls
        .map(([message]) => message as { code?: string } | undefined)
        .filter((message) => message?.code === "timeline_rebind_after_media_metadata");
      expect(rebindMessages).toHaveLength(1);
    } finally {
      delete (window as { gsap?: unknown }).gsap;
    }
  });

  it("sets __renderReady only after timeline is bound, not at __playerReady time", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    window.__timelines = {
      main: createMockTimeline(10),
    };

    initSandboxRuntimeModular();

    expect(window.__playerReady).toBe(true);
    expect(window.__renderReady).toBe(true);
    expect(window.__player).toBeDefined();
  });

  it("waits for GSAP batching to finish before publishing render readiness", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    let timelineDuration = 0;
    const timeline = createMockTimeline(0);
    timeline.duration = () => timelineDuration;
    window.__timelines = {
      main: timeline,
    };
    window.__hfTimelinesBuilding = true;

    initSandboxRuntimeModular();

    expect(window.__playerReady).toBe(true);
    expect(window.__renderReady).toBe(false);
    expect(window.__player?.getDuration()).toBe(0);

    timelineDuration = 10;
    window.__hfTimelinesBuilding = false;
    window.dispatchEvent(new CustomEvent("hf-timelines-built"));

    expect(window.__renderReady).toBe(true);
    expect(window.__player?.getDuration()).toBe(10);
  });

  it("resumes readiness when GSAP batching starts after runtime initialization", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    let timelineDuration = 0;
    const timeline = createMockTimeline(0);
    timeline.duration = () => timelineDuration;
    window.__timelines = { main: timeline };
    window.__hfTimelinesBuilding = false;

    initSandboxRuntimeModular();
    expect(window.__renderReady).toBe(true);

    window.__hfTimelinesBuilding = true;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.__renderReady).toBe(false);

    timelineDuration = 10;
    window.__hfTimelinesBuilding = false;
    window.dispatchEvent(new CustomEvent("hf-timelines-built"));

    expect(window.__renderReady).toBe(true);
    expect(window.__player?.getDuration()).toBe(10);
  });

  it("waits for THREE.DefaultLoadingManager to drain before publishing render readiness", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    window.__timelines = {
      main: createMockTimeline(10),
    };

    // Simulate THREE with an in-flight asset load — same shape the three adapter
    // reads, no actual three.js dependency in tests. `itemsTotal > itemsLoaded`
    // means "loads pending"; resolving the wait fires `onLoad` after wrapping.
    const mgr: {
      itemsLoaded: number;
      itemsTotal: number;
      onStart?: ((url: string, loaded: number, total: number) => void) | null;
      onLoad?: (() => void) | null;
    } = {
      itemsLoaded: 0,
      itemsTotal: 1,
      onStart: null,
      onLoad: null,
    };
    (window as unknown as { THREE: { DefaultLoadingManager: typeof mgr } }).THREE = {
      DefaultLoadingManager: mgr,
    };

    initSandboxRuntimeModular();

    // Player ready, render NOT ready because an asset is pending.
    expect(window.__playerReady).toBe(true);
    expect(window.__renderReady).toBe(false);
    expect(window.__player?.getDuration()).toBe(10);

    // Simulate the asset finishing: drain the queue and fire the (now-wrapped)
    // onLoad. The adapter's wrapper resolves the readiness promise, which
    // triggers a re-publish.
    mgr.itemsLoaded = 1;
    mgr.onLoad?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(window.__renderReady).toBe(true);
    expect(window.__player?.getDuration()).toBe(10);
  });

  it("sets __renderReady even without a GSAP timeline (CSS/WAAPI compositions)", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    window.__timelines = {};

    initSandboxRuntimeModular();

    expect(window.__playerReady).toBe(true);
    expect(window.__renderReady).toBe(true);
  });

  it("infers hf.duration from a CSS animation's computed timing without data-duration or a GSAP timeline", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const animated = document.createElement("div");
    animated.style.animationName = "fadeIn";
    root.appendChild(animated);

    vi.spyOn(window, "getComputedStyle").mockImplementation((target) => {
      const real =
        Object.getPrototypeOf(window).getComputedStyle ?? (() => ({}) as CSSStyleDeclaration);
      return {
        ...real,
        animationName: target === animated ? "fadeIn" : "none",
      } as CSSStyleDeclaration;
    });
    (animated as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [
      {
        currentTime: 0,
        pause: () => {},
        play: () => {},
        effect: { getComputedTiming: () => ({ endTime: 6000 }) },
      } as unknown as Animation,
    ];

    window.__timelines = {};

    initSandboxRuntimeModular();

    expect(window.__renderReady).toBe(true);
    expect(window.__player?.getDuration()).toBe(6);
  });

  it("still requires data-duration when a CSS animation is infinite (unbounded end time)", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const animated = document.createElement("div");
    animated.style.animationName = "spin";
    root.appendChild(animated);

    vi.spyOn(window, "getComputedStyle").mockImplementation((target) => {
      const real =
        Object.getPrototypeOf(window).getComputedStyle ?? (() => ({}) as CSSStyleDeclaration);
      return {
        ...real,
        animationName: target === animated ? "spin" : "none",
      } as CSSStyleDeclaration;
    });
    (animated as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [
      {
        currentTime: 0,
        pause: () => {},
        play: () => {},
        effect: { getComputedTiming: () => ({ endTime: Infinity }) },
      } as unknown as Animation,
    ];

    window.__timelines = {};

    initSandboxRuntimeModular();

    // No data-duration, no GSAP timeline, and the only animation is
    // unbounded — duration cannot be inferred, so it stays at 0. This is the
    // case that must still surface the "add data-duration" lint/runtime error.
    expect(window.__player?.getDuration()).toBe(0);
  });

  it("infers hf.duration from a registered Lottie animation without data-duration or a GSAP timeline", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    (window as Window & { __hfLottie?: unknown[] }).__hfLottie = [
      { play: () => {}, pause: () => {}, totalFrames: 150, frameRate: 30 },
    ];

    window.__timelines = {};

    initSandboxRuntimeModular();

    expect(window.__renderReady).toBe(true);
    expect(window.__player?.getDuration()).toBe(5);

    delete (window as Window & { __hfLottie?: unknown[] }).__hfLottie;
  });

  it("regression: a GSAP timeline's duration is unaffected by adapter duration inference", () => {
    // A GSAP composition can legitimately have an incidental, short CSS
    // animation running alongside the timeline (e.g. a decorative shimmer).
    // The GSAP timeline must remain the source of truth for total duration —
    // the new adapter-inference floor (resolveAdapterDurationFloorSeconds)
    // must not shrink or otherwise override it.
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "root");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const shimmer = document.createElement("div");
    shimmer.style.animationName = "shimmer";
    root.appendChild(shimmer);

    vi.spyOn(window, "getComputedStyle").mockImplementation((target) => {
      return {
        animationName: target === shimmer ? "shimmer" : "none",
      } as CSSStyleDeclaration;
    });
    (shimmer as HTMLElement & { getAnimations?: () => Animation[] }).getAnimations = () => [
      {
        currentTime: 0,
        pause: () => {},
        play: () => {},
        // Much shorter than the GSAP timeline below (2s vs 12s) — must not
        // become the reported duration.
        effect: { getComputedTiming: () => ({ endTime: 2000 }) },
      } as unknown as Animation,
    ];

    window.__timelines = { root: createMockTimeline(12) };

    initSandboxRuntimeModular();

    expect(window.__renderReady).toBe(true);
    expect(window.__player?.getDuration()).toBe(12);
  });

  it("seeks captured timeline to currentTime on initial bind", () => {
    const seekTimes: number[] = [];
    const tl = createMockTimeline(5);
    const origTotalTime = tl.totalTime;
    tl.totalTime = ((time: number, ...rest: unknown[]) => {
      seekTimes.push(time);
      (origTotalTime as Function).call(tl, time, ...rest);
    }) as RuntimeTimelineLike["totalTime"];

    document.body.innerHTML = `
      <div data-composition-id="root" data-duration="5" data-width="1920" data-height="1080"></div>
    `;
    window.__timelines = { root: tl };
    initSandboxRuntimeModular();

    expect(seekTimes.length).toBeGreaterThanOrEqual(2);
    expect(seekTimes[seekTimes.length - 1]).toBe(0);
  });

  it("accepts replayed transport controls when the bridge announces ready without duplicate listeners", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "root");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-duration", "5");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const timeline = createMockTimeline(5);
    timeline.timeScale = vi.fn();
    window.__timelines = { root: timeline };
    const outbound: Array<Record<string, unknown>> = [];
    vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const payload = message as Record<string, unknown>;
      outbound.push(payload);
      if (payload.source !== "hf-preview" || payload.type !== "ready") return;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "hf-parent",
            type: "control",
            action: "seek",
            timeSeconds: 2,
          },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "hf-parent",
            type: "control",
            action: "set-playback-rate",
            playbackRate: 2,
          },
        }),
      );
    });

    expect(() => initSandboxRuntimeModular()).not.toThrow();
    expect(() => initSandboxRuntimeModular()).not.toThrow();

    expect(timeline.time()).toBe(2);
    expect(timeline.timeScale).toHaveBeenLastCalledWith(2);
    expect(outbound.filter((message) => message.type === "ready")).toHaveLength(2);
    expect(
      outbound.filter(
        (message) => message.type === "analytics" && message.event === "composition_seeked",
      ),
    ).toHaveLength(2);
  });

  it("restores timed element visibility after a forced timeline rebind", () => {
    document.body.innerHTML = `
      <div data-composition-id="root" data-root="true" data-duration="30" data-width="1920" data-height="1080">
        <div class="clip" id="clip-expired" data-start="0" data-duration="15.234"></div>
        <div class="clip" id="clip-future" data-start="20.83" data-duration="3"></div>
        <div class="clip" id="clip-control" data-start="10" data-duration="10"></div>
      </div>
    `;
    const clipExpired = document.querySelector<HTMLElement>("#clip-expired");
    const clipFuture = document.querySelector<HTMLElement>("#clip-future");
    const clipControl = document.querySelector<HTMLElement>("#clip-control");
    window.__timelines = { root: createMockTimeline(30) };

    initSandboxRuntimeModular();
    window.__player?.seek(16.2);

    expect(clipExpired?.style.visibility).toBe("hidden");
    expect(clipFuture?.style.visibility).toBe("hidden");
    expect(clipControl?.style.visibility).toBe("visible");

    if (clipExpired) clipExpired.style.visibility = "visible";
    if (clipFuture) clipFuture.style.visibility = "visible";

    window.__hfForceTimelineRebind?.();

    expect(clipExpired?.style.visibility).toBe("hidden");
    expect(clipFuture?.style.visibility).toBe("hidden");
    expect(clipControl?.style.visibility).toBe("visible");
  });

  it("onSetMuted preserves authored muted attribute on video elements", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "root");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const video = document.createElement("video");
    video.setAttribute("muted", "");
    video.muted = true; // browsers auto-sync from attribute; jsdom doesn't
    video.setAttribute("src", "avatar.mp4");
    root.appendChild(video);

    const audio = document.createElement("audio");
    audio.setAttribute("data-start", "0");
    audio.setAttribute("data-duration", "10");
    audio.setAttribute("src", "voiceover.mp3");
    root.appendChild(audio);

    window.__timelines = { root: createMockTimeline(10) };
    initSandboxRuntimeModular();

    expect(video.defaultMuted).toBe(true);
    expect(video.muted).toBe(true);
    expect(audio.muted).toBe(false);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "hf-parent", type: "control", action: "set-muted", muted: false },
      }),
    );

    expect(video.muted).toBe(true);
    expect(audio.muted).toBe(false);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "hf-parent", type: "control", action: "set-muted", muted: true },
      }),
    );

    expect(video.muted).toBe(true);
    expect(audio.muted).toBe(true);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "hf-parent", type: "control", action: "set-muted", muted: false },
      }),
    );

    expect(video.muted).toBe(true);
    expect(audio.muted).toBe(false);
  });

  it("onSetMediaOutputMuted preserves authored muted attribute on video elements", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "root");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const video = document.createElement("video");
    video.setAttribute("muted", "");
    video.muted = true;
    video.setAttribute("src", "avatar.mp4");
    root.appendChild(video);

    const audio = document.createElement("audio");
    audio.setAttribute("data-start", "0");
    audio.setAttribute("data-duration", "10");
    audio.setAttribute("src", "voiceover.mp3");
    root.appendChild(audio);

    window.__timelines = { root: createMockTimeline(10) };
    initSandboxRuntimeModular();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "hf-parent",
          type: "control",
          action: "set-media-output-muted",
          muted: false,
        },
      }),
    );

    expect(video.muted).toBe(true);
    expect(audio.muted).toBe(false);
  });

  it("native media sync opt-out leaves user-started media playing while timeline is paused", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "root");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const audio = document.createElement("audio");
    audio.setAttribute("data-start", "0");
    audio.setAttribute("data-duration", "10");
    audio.setAttribute("src", "voiceover.mp3");
    Object.defineProperty(audio, "duration", { value: 10, configurable: true });
    Object.defineProperty(audio, "readyState", {
      value: HTMLMediaElement.HAVE_FUTURE_DATA,
      configurable: true,
    });
    Object.defineProperty(audio, "currentTime", { value: 0, writable: true, configurable: true });
    Object.defineProperty(audio, "paused", { value: true, writable: true, configurable: true });
    audio.pause = vi.fn(() => {
      Object.defineProperty(audio, "paused", {
        value: true,
        writable: true,
        configurable: true,
      });
    });
    root.appendChild(audio);

    window.__timelines = { root: createMockTimeline(10) };
    initSandboxRuntimeModular();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "hf-parent",
          type: "control",
          action: "set-native-media-sync-disabled",
          disabled: true,
        },
      }),
    );
    Object.defineProperty(audio, "paused", { value: false, writable: true, configurable: true });
    vi.mocked(audio.pause).mockClear();

    window.__player?.renderSeek(5);

    expect(audio.pause).not.toHaveBeenCalled();
  });

  it("skips the per-frame transport re-seek while a Studio manual-edit gesture is active", () => {
    const raf = createManualRaf();
    vi.spyOn(performance, "now").mockImplementation(() => raf.now());
    window.requestAnimationFrame = raf.requestAnimationFrame as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = raf.cancelAnimationFrame as typeof window.cancelAnimationFrame;

    const seekTimes: number[] = [];
    const tl = createMockTimeline(5);
    const origTotalTime = tl.totalTime;
    tl.totalTime = ((time: number, ...rest: unknown[]) => {
      seekTimes.push(time);
      (origTotalTime as Function).call(tl, time, ...rest);
    }) as RuntimeTimelineLike["totalTime"];

    document.body.innerHTML = `
      <div data-composition-id="root" data-duration="5" data-width="1920" data-height="1080">
        <div id="dragged" data-hf-studio-manual-edit-gesture="tok-1"></div>
      </div>
    `;
    window.__timelines = { root: tl };
    initSandboxRuntimeModular();

    // (1) Paused + gesture active → the per-frame transport tick must NOT
    // re-seek the timeline, otherwise it re-applies the animated value and
    // clobbers the draft writer (gsap.set) that owns the dragged element,
    // freezing it mid-drag.
    const afterInit = seekTimes.length;
    raf.step(16);
    raf.step(16);
    raf.step(16);
    expect(seekTimes.length).toBe(afterInit);

    // (2) Playback always wins: with the SAME gesture marker still present, a
    // playing clock must keep re-seeking (the gate must never freeze playback).
    // Guards the clock.isPlaying() short-circuit — a regression flipping `||`
    // to `&&` would skip the seek here and this assertion would catch it.
    const player = window.__player;
    const beforePlaying = seekTimes.length;
    player?.play();
    raf.step(16);
    expect(seekTimes.length).toBeGreaterThan(beforePlaying);
    player?.pause();

    // (3) Paused + marker cleared (drop/cancel) → the per-frame re-seek resumes.
    document.getElementById("dragged")?.removeAttribute("data-hf-studio-manual-edit-gesture");
    const beforeResume = seekTimes.length;
    raf.step(16);
    expect(seekTimes.length).toBeGreaterThan(beforeResume);
  });

  it("redraws animated grading from the transport clock only during playback", () => {
    const raf = createManualRaf();
    vi.spyOn(performance, "now").mockImplementation(() => raf.now());
    window.requestAnimationFrame = raf.requestAnimationFrame as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = raf.cancelAnimationFrame as typeof window.cancelAnimationFrame;

    document.body.innerHTML = `
      <div data-composition-id="root" data-duration="5" data-width="1920" data-height="1080"></div>
    `;
    window.__timelines = { root: createMockTimeline(5) };
    initSandboxRuntimeModular();

    const runtime = (
      window as Window & { __hf?: { colorGrading?: { redrawAnimated: () => number } } }
    ).__hf?.colorGrading;
    if (!runtime) throw new Error("Expected color grading runtime");
    const redrawAnimated = vi.spyOn(runtime, "redrawAnimated");

    raf.step(16);
    expect(redrawAnimated).not.toHaveBeenCalled();

    window.__player?.play();
    raf.step(16);
    expect(redrawAnimated).toHaveBeenCalledTimes(1);

    window.__player?.pause();
    raf.step(16);
    expect(redrawAnimated).toHaveBeenCalledTimes(1);
  });

  it("keeps a usable bound timeline when the registry entry is replaced", () => {
    const raf = createManualRaf();
    vi.spyOn(performance, "now").mockImplementation(() => raf.now());
    window.requestAnimationFrame = raf.requestAnimationFrame as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = raf.cancelAnimationFrame as typeof window.cancelAnimationFrame;

    document.body.innerHTML = `
      <div data-composition-id="root" data-start="0" data-duration="5" data-width="1920" data-height="1080"></div>
    `;
    const originalTimeline = createMockTimeline(5);
    window.__timelines = { root: originalTimeline };
    initSandboxRuntimeModular();

    const replacementTimeline = createMockTimeline(8);
    window.__timelines.root = replacementTimeline;
    for (let frame = 0; frame < 60; frame += 1) raf.step(16);

    expect(window.__player?.getDuration()).toBe(5);
  });

  // applyClipLayout force-absolutizes authored root-level timed clips so they
  // stack as overlays. But in Studio/preview the runtime also stamps `data-start`
  // onto ID'd / GSAP-targeted *flow* children (a <header>/<footer> in a column)
  // so the design panel can discover them — those must NOT be force-absolutized,
  // or the layout collapses (footer shrink-wraps, `space-between` clusters). The
  // marker `data-hf-autostamped` distinguishes them; these tests pin both halves.
  describe("applyClipLayout: runtime-stamped clips stay in document flow", () => {
    const makeRoot = () => {
      const root = document.createElement("div");
      root.setAttribute("data-composition-id", "main");
      root.setAttribute("data-root", "true");
      root.setAttribute("data-start", "0");
      root.setAttribute("data-width", "1920");
      root.setAttribute("data-height", "1080");
      document.body.appendChild(root);
      return root;
    };

    // jsdom does no layout, so a static clip can report computed top "auto" or
    // "" inconsistently. Pin the values the anchor gate keys on so the assertion
    // reflects the real-browser path deterministically.
    const overrideComputed = (
      target: HTMLElement,
      overrides: Partial<Record<"position" | "top" | "left" | "bottom" | "right", string>>,
    ) => {
      const real = window.getComputedStyle.bind(window);
      vi.spyOn(window, "getComputedStyle").mockImplementation(((
        el: Element,
        pseudo?: string | null,
      ) => {
        const style = real(el as Element, pseudo ?? undefined);
        if (el !== target) return style;
        return new Proxy(style, {
          get(t, prop) {
            if (typeof prop === "string" && prop in overrides) {
              return overrides[prop as keyof typeof overrides];
            }
            const value = Reflect.get(t, prop);
            return typeof value === "function" ? value.bind(t) : value;
          },
        }) as CSSStyleDeclaration;
      }) as typeof window.getComputedStyle);
    };

    it("force-absolutizes an authored data-start clip (baseline behavior preserved)", () => {
      const root = makeRoot();
      const clip = document.createElement("div");
      clip.setAttribute("data-start", "0"); // authored clip, no autostamp marker
      root.appendChild(clip);
      overrideComputed(clip, {
        position: "static",
        top: "auto",
        left: "auto",
        bottom: "auto",
        right: "auto",
      });

      window.__timelines = { main: createMockTimeline(10) };
      initSandboxRuntimeModular();

      expect(clip.style.position).toBe("absolute");
      expect(clip.style.top).toBe("0px");
      expect(clip.style.left).toBe("0px");
    });

    it("leaves a runtime-stamped flow child untouched so the layout is preserved", () => {
      const root = makeRoot();
      const footer = document.createElement("footer");
      footer.setAttribute("data-start", "0");
      footer.setAttribute("data-hf-autostamped", "1"); // stamped flow child, not an overlay clip
      root.appendChild(footer);
      overrideComputed(footer, {
        position: "static",
        top: "auto",
        left: "auto",
        bottom: "auto",
        right: "auto",
      });

      window.__timelines = { main: createMockTimeline(10) };
      initSandboxRuntimeModular();

      // Skipped entirely: stays in document flow (no forced absolute, no anchor),
      // so a flex-column footer keeps full width and `space-between` spreads — the
      // preview then matches the rendered video, which never stamps.
      expect(footer.style.position).toBe("");
      expect(footer.style.top).toBe("");
      expect(footer.style.left).toBe("");
    });
  });
  describe("partial registry timelines", () => {
    it("survives play/pause/seek when the sole registered timeline lacks pause()", () => {
      const root = document.createElement("div");
      root.setAttribute("data-composition-id", "main");
      root.setAttribute("data-root", "true");
      root.setAttribute("data-start", "0");
      root.setAttribute("data-duration", "10");
      root.setAttribute("data-width", "1920");
      root.setAttribute("data-height", "1080");
      document.body.appendChild(root);

      // An authored composition can register a PARTIAL timeline — duration/seek
      // only. It renders fine (the render path never pauses), so the interactive
      // transport must tolerate the missing pause() instead of throwing
      // "tl.pause is not a function" (top recurring studio unhandled error).
      const partial = createMockTimeline(10) as RuntimeTimelineLike & { pause?: unknown };
      delete partial.pause;
      window.__timelines = { main: partial as RuntimeTimelineLike };

      initSandboxRuntimeModular();
      const player = window.__player;
      expect(player).toBeDefined();

      expect(() => {
        player?.play();
        player?.pause();
        player?.seek(1);
        player?.renderSeek(2);
      }).not.toThrow();
    });
  });
});
