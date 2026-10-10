import gsap from "gsap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";
import { STUDIO_MANUAL_EDIT_GESTURE_ATTR } from "../editing/draftMarkers";
import { sourceTimeAt } from "../speedRamp";
import { readElementRateSpec } from "./playbackRate";
import {
  createMockTimeline,
  resetRuntimeFixtureDom,
  stubDuration,
} from "./runtimeSeekFixture.test-helpers";

// Pins where a running runtime places a sub-composition's timeline, against what a fresh load does.
describe("runtime sub-composition placement", () => {
  beforeEach(() => {
    resetRuntimeFixtureDom();
    window.gsap = gsap as unknown as typeof window.gsap;
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.__player;
    delete window.__playerReady;
    delete window.__hf;
  });

  /** A root with one scene clip at `hostStart`, whose timeline slides `#s` from 0 to 100 over 2 s. */
  function load(hostStart: number | string) {
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true" data-duration="10">` +
      `<div id="host" class="clip" data-composition-id="scene" data-start="${hostStart}" data-duration="3">` +
      `<div id="s"></div></div></div>`;
    const scene = gsap
      .timeline({ paused: true })
      .to("#s", { x: 100, duration: 2, ease: "none" }, 0);
    const root = gsap.timeline({ paused: true }).to({}, { duration: 1 }, 0);
    window.__timelines = { main: root, scene } as unknown as Record<string, RuntimeTimelineLike>;
    initSandboxRuntimeModular();
    return { scene, root };
  }

  const shownX = () => Number(gsap.getProperty("#s", "x"));

  it("places the scene at its host's new start when a rebind follows a host move, as a fresh load does", () => {
    const { scene } = load(1);
    window.__player?.seek(5);
    expect(shownX()).toBe(100);

    document.getElementById("host")!.setAttribute("data-start", "4");
    window.__hfForceTimelineRebind?.();

    expect(scene.startTime()).toBe(4);
    expect(shownX()).toBe(50);
    window.__player?.seek(4.5);
    expect(shownX()).toBe(25);
  });

  it("leaves a scene where the root script places it after a re-run, as a fresh load does", () => {
    const { scene } = load(1);
    const root = gsap.timeline({ paused: true }).to({}, { duration: 1 }, 0).add(scene, 2);
    window.__timelines = { main: root, scene } as unknown as Record<string, RuntimeTimelineLike>;
    window.__hfForceTimelineRebind?.();
    expect(scene.startTime()).toBe(2);

    document.getElementById("host")!.setAttribute("data-start", "4");
    window.__hfForceTimelineRebind?.();

    expect(scene.startTime()).toBe(2);
  });

  it("leaves a scene that a script moved into another timeline where that timeline put it", () => {
    const { root, scene } = load(1);
    const holder = gsap.timeline({ paused: true });
    root.add(holder, 0);
    holder.add(scene, 2);

    document.getElementById("host")!.setAttribute("data-start", "4");
    window.__hfForceTimelineRebind?.();

    expect(scene.parent).toBe(holder);
    expect(scene.startTime()).toBe(2);
  });

  it("still moves a runtime-placed scene when the root script placed another one itself", () => {
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true" data-duration="10">` +
      // Listed first, so a throw on the script-placed intro would stop the loop before the scene.
      `<div class="clip" data-composition-id="intro" data-start="2.5" data-duration="2"></div>` +
      `<div id="host" class="clip" data-composition-id="scene" data-start="1" data-duration="3"></div></div>`;
    const intro = gsap.timeline({ paused: true }).to({}, { duration: 2 }, 0);
    const scene = gsap.timeline({ paused: true }).to({}, { duration: 3 }, 0);
    const root = gsap.timeline({ paused: true }).to({}, { duration: 1 }, 0).add(intro, 2);
    window.__timelines = { main: root, intro, scene } as unknown as Record<
      string,
      RuntimeTimelineLike
    >;
    initSandboxRuntimeModular();

    document.getElementById("host")!.setAttribute("data-start", "4");
    window.__hfForceTimelineRebind?.();

    expect(scene.startTime()).toBe(4);
    expect(intro.startTime()).toBe(2);
  });

  /** Transport frames on demand; the clock moves a second per frame, past the change-service rate limit. */
  function stubFrames() {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.set(++next, cb);
      return next;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    return async (count: number) => {
      for (let frame = 1; frame <= count; frame++) {
        now += 1000;
        await Promise.resolve();
        const due = [...frames.values()];
        frames.clear();
        for (const run of due) run(frame * 16);
      }
    };
  }

  /** A root with no timeline of its own around one scene clip, whose timeline slides `#s` from 0 to 100 over 4 s. */
  function loadWithoutRootTimeline(rootMarkup = "", rootLength = ` data-duration="10"`) {
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true"${rootLength}>${rootMarkup}` +
      `<div id="host" class="clip" data-composition-id="scene" data-start="1" data-duration="4">` +
      `<div id="s"></div></div></div>`;
    const scene = gsap
      .timeline({ paused: true })
      .to("#s", { x: 100, duration: 4, ease: "none" }, 0);
    window.__timelines = { scene } as unknown as Record<string, RuntimeTimelineLike>;
    initSandboxRuntimeModular();
    return scene;
  }

  it("keeps a nested scene where the playhead left it during a drag when the root has no timeline", async () => {
    const runFrames = stubFrames();
    loadWithoutRootTimeline();
    window.__player?.seek(4);
    expect(shownX()).toBe(75);

    // Every transform GSAP writes while the drag is held, including ones a later write in the same tick hides.
    const shown: string[] = [];
    const writes = new MutationObserver((records) =>
      shown.push(...records.map((r) => r.oldValue ?? "")),
    );
    writes.observe(document.getElementById("s")!, {
      attributes: true,
      attributeFilter: ["style"],
      attributeOldValue: true,
    });
    // A Studio press marks the element; a timing edit then wakes the transport's rebind mid-drag.
    document.getElementById("s")!.setAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR, "gesture-1:move");
    document.getElementById("host")!.setAttribute("data-duration", "4");
    await runFrames(30);

    shown.push(
      ...writes.takeRecords().map((r) => r.oldValue ?? ""),
      document.getElementById("s")!.getAttribute("style") ?? "",
    );
    writes.disconnect();
    const xs = shown.map((style) => /translate(?:3d)?\(([-\d.]+)/.exec(style)?.[1]).filter(Boolean);
    expect(xs.length).toBeGreaterThan(0);
    expect(new Set(xs)).toEqual(new Set(["75"]));
  });

  it("keeps a dragged scene where the playhead left it when another scene registers mid-drag", async () => {
    const runFrames = stubFrames();
    loadWithoutRootTimeline(
      `<div id="later" class="clip" data-composition-id="later" data-start="0" data-duration="2"><div id="l"></div></div>`,
    );
    window.__player?.seek(4);
    document.getElementById("s")!.setAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR, "gesture-1:move");
    (window.__timelines as Record<string, unknown>).later = gsap
      .timeline({ paused: true })
      .to("#l", { x: 100, duration: 2, ease: "none" }, 0);
    await runFrames(30);

    expect(shownX()).toBe(75);
  });

  it("reports a scene's new length after a script extends it, when the root declares none", async () => {
    const runFrames = stubFrames();
    const scene = loadWithoutRootTimeline("", "");
    await runFrames(3);
    window.__player?.seek(2);
    scene.to({}, { duration: 8 }, 0);
    await runFrames(5);

    expect(window.__player?.getDuration()).toBe(9);
  });

  it("binds a root timeline that registers after the runtime started on its children", async () => {
    const runFrames = stubFrames();
    loadWithoutRootTimeline(`<div id="r"></div>`);
    const root = gsap
      .timeline({ paused: true })
      .to("#r", { x: 100, duration: 10, ease: "none" }, 0);
    (window.__timelines as Record<string, unknown>).main = root;
    await runFrames(30);

    window.__player?.seek(5);
    expect(Number(gsap.getProperty("#r", "x"))).toBe(50);
    expect(shownX()).toBe(100);
  });

  it("places a scene at its host's new start on a rebind when the root has no timeline", () => {
    const scene = loadWithoutRootTimeline();
    document.getElementById("host")!.setAttribute("data-start", "4");
    window.__hfForceTimelineRebind?.();

    expect(scene.startTime()).toBe(4);
    window.__player?.seek(5);
    expect(shownX()).toBe(25);
  });

  it("leaves an unmoved scene in place on a rebind, whatever its start rounds to", () => {
    const { root, scene } = load("0.33333333");
    const remove = vi.spyOn(root, "remove");

    window.__hfForceTimelineRebind?.();

    expect(remove).not.toHaveBeenCalledWith(scene);
  });

  /** What Studio's split writes for a 12 s scene cut at 5 s and 9 s, each half mounting its own copy. */
  function loadSplitScene() {
    const videos = [
      ["v1", 0, 1],
      ["v2", 4, 5],
      ["v3", 8, 2],
    ]
      .map(
        ([name, start, mediaStart]) =>
          `<video class="${name}" data-start="${start}" data-duration="4" data-media-start="${mediaStart}"></video>`,
      )
      .join("");
    const hosts = [
      ["scene", 0, 5, 0],
      ["scene-split", 5, 4, 5],
      ["scene-split-split", 9, 3, 9],
    ]
      .map(
        ([id, start, duration, inPoint]) =>
          `<div id="${id}" class="clip" data-composition-id="${id}" data-composition-file="compositions/scene.html" ` +
          `data-start="${start}" data-duration="${duration}" data-playback-start="${inPoint}"><div>${videos}</div></div>`,
      )
      .join("");
    mountInRoot(hosts);
  }

  /** A 12 s root around `markup`; every video's source runs `sourceSeconds` and has not been seeked (-1). */
  function mountInRoot(markup: string, sourceSeconds = 30) {
    document.body.innerHTML = `<div data-composition-id="main" data-root="true" data-duration="12">${markup}</div>`;
    for (const video of document.querySelectorAll("video")) {
      stubDuration(video, sourceSeconds);
      Object.defineProperty(video, "currentTime", {
        value: -1,
        writable: true,
        configurable: true,
      });
      video.play = vi.fn(() => Promise.resolve());
      video.pause = vi.fn();
    }
    window.__timelines = { main: createMockTimeline(12) };
    initSandboxRuntimeModular();
  }

  /** The half after a split at 5 s: it starts at 5 with in-point 5, so scene time t plays at t. */
  function loadSecondHalf(inner: string, sourceSeconds?: number) {
    mountInRoot(
      `<div class="clip" data-composition-id="half" data-composition-file="compositions/scene.html" ` +
        `data-start="5" data-duration="7" data-playback-start="5"><div>${inner}</div></div>`,
      sourceSeconds,
    );
  }

  const video = (id: string) => document.getElementById(id) as HTMLVideoElement;

  const sourceTimeOf = (host: string, video: string) =>
    document.querySelector<HTMLVideoElement>(`#${host} .${video}`)!.currentTime;

  it("shifts a split scene's videos by each half's in-point and cuts them to that half", () => {
    loadSplitScene();
    window.__player?.renderSeek(4.5);
    expect(sourceTimeOf("scene", "v2")).toBe(5.5);
    // The second half's v2 lands at 4-8 but is cut until that half starts at 5.
    expect(sourceTimeOf("scene-split", "v2")).toBe(-1);

    window.__player?.renderSeek(5);
    expect(sourceTimeOf("scene-split", "v2")).toBe(6);
    window.__player?.renderSeek(8.5);
    expect(sourceTimeOf("scene-split", "v3")).toBe(2.5);
    window.__player?.renderSeek(10);
    expect(sourceTimeOf("scene-split-split", "v3")).toBe(4);
  });

  it("keeps a video in a composition nested inside the half silent until the half starts", () => {
    loadSecondHalf(
      `<div data-composition-id="inner" data-composition-file="compositions/inner.html" data-start="0" data-duration="12">` +
        `<video id="deep" data-start="0" data-duration="12"></video></div>`,
    );
    window.__player?.renderSeek(1);
    expect(video("deep").currentTime).toBe(-1);
    window.__player?.renderSeek(6);
    expect(video("deep").currentTime).toBe(6);
  });

  it("loops a straddling clip over its whole file, not from the cut", () => {
    loadSecondHalf(
      `<video id="loop" loop data-start="2" data-duration="10" data-media-start="0"></video>`,
      4,
    );
    const at = (t: number) => (window.__player?.renderSeek(t), video("loop").currentTime);
    expect([at(5), at(6), at(7.5)]).toEqual([3, 0, 1.5]);
  });

  it("follows a straddling clip's speed ramp from the clip's own start", () => {
    const ramp = JSON.stringify({
      version: 1,
      lanes: [
        {
          target: "rate",
          points: [
            { t: 0, v: 1 },
            { t: 8, v: 2 },
          ],
        },
      ],
    });
    loadSecondHalf(
      `<video id="ramp" data-start="2" data-duration="8" data-automation='${ramp}'></video>`,
    );
    window.__player?.renderSeek(7);
    expect(video("ramp").currentTime).toBeCloseTo(
      sourceTimeAt(readElementRateSpec(video("ramp")), 5),
      6,
    );
  });

  it("times a straddling clip's fade-in from the clip's own start", () => {
    loadSecondHalf(`<video id="fade" data-start="4" data-duration="4" data-fade-in="2"></video>`);
    window.__player?.renderSeek(5);
    expect(video("fade").volume).toBeCloseTo(0.5, 6);
  });
});
