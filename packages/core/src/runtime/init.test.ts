// fallow-ignore-file code-duplication
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";

function createMockTimeline(duration: number): RuntimeTimelineLike {
  const state = { time: 0, paused: true, duration };
  return {
    play: () => {
      state.paused = false;
    },
    pause: () => {
      state.paused = true;
    },
    seek: (time: number) => {
      state.time = time;
    },
    totalTime: (time: number) => {
      state.time = time;
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
    to: (_target: object, vars: { duration: number }, position: number) => void;
  };
  const baseDuration = timeline.duration;
  let paddedDuration = baseDuration();
  timeline.duration = () => paddedDuration;
  timeline.to = (_target, vars, position) => {
    paddedDuration = Math.max(paddedDuration, position + Math.max(0, Number(vars.duration) || 0));
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

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    window.__timelines = {} as Record<string, RuntimeTimelineLike>;
    delete window.__player;
    delete window.__playerReady;
    delete window.__renderReady;
    delete window.__hfTimelinesBuilding;
    delete (window as { THREE?: unknown }).THREE;
    vi.restoreAllMocks();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
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
});
