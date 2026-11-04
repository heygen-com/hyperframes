import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import * as timeline from "./timeline";
import type { RuntimeTimelineLike } from "./types";

vi.mock("../compositionReadiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../compositionReadiness")>();
  return {
    ...actual,
    settleCompositionReadiness: vi.fn(),
    settleFirstFrameCompositionReadiness: vi.fn(),
  };
});
vi.mock("./timeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./timeline")>();
  return { ...actual, isRuntimeElementVisibleAt: vi.fn(actual.isRuntimeElementVisibleAt) };
});

// Pins what a playing frame touches: clips on screen and clips whose edge it crossed, never the whole film.

type CountingTimeline = RuntimeTimelineLike & { seeks: number; childScans: number };

function countingTimeline(duration: number): CountingTimeline {
  const state = { time: 0, paused: true };
  const tl: CountingTimeline = {
    seeks: 0,
    childScans: 0,
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
      if (time !== undefined) {
        tl.seeks += 1;
        state.time = time;
      }
      return state.time;
    },
    time: () => state.time,
    duration: () => duration,
    add: () => {},
    paused: (value?: boolean) => {
      if (typeof value === "boolean") state.paused = value;
      return state.paused;
    },
    timeScale: () => {},
    set: () => {},
    getChildren: () => {
      tl.childScans += 1;
      return [];
    },
  };
  return tl;
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
    pending: () => callbacks.size,
    step: (milliseconds: number) => {
      now += milliseconds;
      const batch = Array.from(callbacks.values());
      callbacks.clear();
      for (const callback of batch) callback(now);
    },
  };
}

describe("a playing frame's scope", () => {
  const originalRaf = window.requestAnimationFrame;
  const originalCancelRaf = window.cancelAnimationFrame;
  let raf: ReturnType<typeof createManualRaf>;
  let posted: Array<Record<string, unknown>>;
  let nowMs: number;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    nowMs = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    (globalThis as typeof globalThis & { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (value: string) => value;
    raf = createManualRaf();
    window.requestAnimationFrame = raf.requestAnimationFrame as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = raf.cancelAnimationFrame as typeof window.cancelAnimationFrame;
    posted = [];
    vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
      posted.push(message as Record<string, unknown>);
    });
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    window.__timelines = {} as Record<string, RuntimeTimelineLike>;
    delete window.__player;
    delete window.__playerReady;
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
  });

  /** Advances clock and frame together, `ms` at a time, for `count` frames. */
  const frames = (count: number, ms = 50) => {
    for (let i = 0; i < count; i += 1) {
      nowMs += ms;
      vi.advanceTimersByTime(ms);
      raf.step(ms);
    }
  };

  /** Clips a..f at 2 s apart; c and d sit inside host h, which shows from 4 s to 9 s. */
  const CLIPS: Record<string, [number, number]> = {
    a: [0, 3],
    b: [2, 6],
    h: [4, 5],
    c: [4.5, 2],
    d: [7, 5],
    e: [10, 4],
    f: [16, 3],
  };
  const mountFilm = (registry: Record<string, unknown> = {}) => {
    const clip = (id: string, inner = "") =>
      `<div id="${id}" data-start="${CLIPS[id]![0]}" data-duration="${CLIPS[id]![1]}">${inner}</div>`;
    document.body.innerHTML =
      `<div id="root" data-composition-id="main" data-root="true" data-start="0" data-duration="20">` +
      clip("a") +
      clip("b") +
      clip("h", clip("c") + clip("d")) +
      clip("e") +
      clip("f") +
      `</div>`;
    window.__timelines = { main: countingTimeline(20), ...registry } as Record<
      string,
      RuntimeTimelineLike
    >;
    initSandboxRuntimeModular();
    frames(10, 1);
  };
  const shownAt = (id: string, t: number): boolean => {
    const within = ([start, duration]: [number, number]) => t >= start && t < start + duration;
    return within(CLIPS[id]!) && (id !== "c" && id !== "d" ? true : within(CLIPS.h!));
  };

  it("shows each clip exactly when it and its host are in window, deciding only the clips whose edge it crossed", () => {
    mountFilm();
    const decide = vi.mocked(timeline.isRuntimeElementVisibleAt);
    window.__player!.play();
    frames(2);
    let quietFrames = 0;
    for (let i = 0; i < 300; i += 1) {
      const before = window.__player!.getTime();
      decide.mockClear();
      frames(1);
      const after = window.__player!.getTime();
      for (const id of Object.keys(CLIPS)) {
        const expected = shownAt(id, after) ? "visible" : "hidden";
        expect(document.getElementById(id)!.style.visibility, `${id} at ${after}`).toBe(expected);
      }
      const edgeCrossed = Object.values(CLIPS).some(([start, duration]) =>
        [start, start + duration].some((edge) =>
          [0, 2, 4].some((lead) =>
            [edge - lead, edge + lead].some((x) => x >= before && x <= after),
          ),
        ),
      );
      if (!edgeCrossed) {
        quietFrames += 1;
        expect(decide, `frame ${before} -> ${after}`).not.toHaveBeenCalled();
      }
    }
    expect(quietFrames).toBeGreaterThan(20);
  });

  it("shows a clip on the next frame when its timing moves it onto the playhead mid-play", async () => {
    mountFilm();
    window.__player!.play();
    while (window.__player!.getTime() < 5) frames(1);
    const moved = document.getElementById("e")!;
    const stretched = document.getElementById("a")!;
    expect([moved.style.visibility, stretched.style.visibility]).toEqual(["hidden", "hidden"]);
    moved.setAttribute("data-start", "4");
    stretched.setAttribute("data-duration", "19");
    await Promise.resolve();
    frames(1);
    expect([moved.style.visibility, stretched.style.visibility]).toEqual(["visible", "visible"]);
  });

  it("leaves a scene that ended alone while the film plays on, after resting it at its end once", () => {
    const scene = countingTimeline(8);
    document.body.innerHTML =
      `<div id="root" data-composition-id="main" data-root="true" data-start="0" data-duration="20">` +
      `<div id="host" data-composition-id="scene" data-start="1" data-duration="2"></div></div>`;
    window.__timelines = { main: countingTimeline(20), scene } as Record<
      string,
      RuntimeTimelineLike
    >;
    initSandboxRuntimeModular();
    frames(10, 1);
    window.__player!.play();
    frames(80);
    expect(window.__player!.getTime()).toBeGreaterThan(3.5);
    scene.seeks = 0;
    frames(40);
    expect(scene.seeks).toBe(0);
    expect(scene.time()).toBe(2);
  });

  it("checks the timeline registry once a second while playing, not every frame", () => {
    const scene = countingTimeline(2);
    mountFilm({ scene });
    window.__player!.play();
    frames(2);
    scene.childScans = 0;
    frames(40);
    expect(scene.childScans).toBeLessThanOrEqual(3);
  });

  it("holds clip-list posts while playing and sends one when playback stops", () => {
    mountFilm();
    window.__player!.play();
    frames(4);
    posted.length = 0;
    document.getElementById("e")!.setAttribute("data-duration", "5");
    frames(40);
    expect(posted.filter((m) => m["type"] === "timeline")).toHaveLength(0);
    window.__player!.pause();
    frames(4);
    expect(posted.filter((m) => m["type"] === "timeline").length).toBeGreaterThanOrEqual(1);
  });

  it("plays past a registry entry that is not a timeline", () => {
    mountFilm({ stray: 42 });
    window.__player!.play();
    expect(() => frames(40)).not.toThrow();
    expect(window.__player!.getTime()).toBeGreaterThan(1.5);
  });
});
