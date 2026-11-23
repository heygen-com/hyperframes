import { describe, expect, it } from "bun:test";
import { type Fps, fpsToNumber, isClipOnScreenAt } from "@hyperframes/core";
import type { CaptureSession } from "@hyperframes/engine";
import {
  MAX_SHORT_ANIMATION_RUN_FRAMES,
  analyzeOverlayTiming,
  deriveOverlayTiming,
  planOverlayStates,
  type OverlayPageFacts,
} from "./planner.js";
import type { OverlayTiming, OverlayTimingAnalysis } from "./types.js";
import { createFakePage, FakeElement, FakeTimeline } from "./__test_utils__/fakePage.js";

const FPS30: Fps = { num: 30, den: 1 };

function plan(totalFrames: number, changeFrames: number[]) {
  return planOverlayStates({
    timing: { totalFrames, changeFrames },
    fps: FPS30,
    width: 1920,
    height: 1080,
  });
}

function spans(timing: OverlayTiming): Array<[number, number]> {
  return plan(timing.totalFrames, timing.changeFrames).states.map((s) => [
    s.startFrame,
    s.endFrame,
  ]);
}

describe("planOverlayStates", () => {
  it.each([
    { name: "no change frames", total: 10, cuts: [], want: [[0, 10]] },
    {
      name: "one cut",
      total: 10,
      cuts: [4],
      want: [
        [0, 4],
        [4, 10],
      ],
    },
    {
      name: "unsorted duplicates",
      total: 10,
      cuts: [7, 3, 7, 3],
      want: [
        [0, 3],
        [3, 7],
        [7, 10],
      ],
    },
    {
      name: "out-of-range and non-integer entries ignored",
      total: 10,
      cuts: [0, -2, 10, 12, 2.5, 5],
      want: [
        [0, 5],
        [5, 10],
      ],
    },
    {
      name: "every frame its own state",
      total: 3,
      cuts: [1, 2],
      want: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    },
    { name: "single frame", total: 1, cuts: [], want: [[0, 1]] },
  ])("$name", ({ total, cuts, want }) => {
    const result = plan(total, cuts);
    expect(result.states.map((s) => [s.startFrame, s.endFrame])).toEqual(want);
    expect(result.states.map((s) => s.index)).toEqual(want.map((_, i) => i));
    expect(result.totalFrames).toBe(total);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  it("returns no states for an empty composition", () => {
    expect(plan(0, [1, 2]).states).toEqual([]);
    expect(plan(-5, []).states).toEqual([]);
  });

  it("captures each state at its midpoint, rounding down", () => {
    const states = plan(20, [1, 3, 10]).states;
    // [0,1) → 0, [1,3) → 1, [3,10) → 6, [10,20) → 14
    expect(states.map((s) => s.captureFrame)).toEqual([0, 1, 6, 14]);
    for (const s of states) {
      expect(s.captureFrame).toBeGreaterThanOrEqual(s.startFrame);
      expect(s.captureFrame).toBeLessThan(s.endFrame);
    }
  });
});

// ── analyzeOverlayTiming against a fake page ─────────────────────────────────

interface Clip {
  id: string;
  start: number;
  duration: number;
}

function composition(duration: number, clips: Clip[]) {
  const root = new FakeElement("div", "root", {
    "data-composition-id": "main",
    "data-start": "0",
    "data-duration": String(duration),
  });
  const video = new FakeElement("video", "v", {
    "data-start": "0",
    "data-duration": String(duration),
  });
  root.append(video);
  const els: Record<string, FakeElement> = {};
  for (const clip of clips) {
    const el = new FakeElement("div", clip.id, {
      "data-start": String(clip.start),
      "data-duration": String(clip.duration),
    });
    els[clip.id] = el;
    root.append(el);
  }
  return { root, video, els };
}

function frameCount(duration: number, fps: Fps): number {
  return Math.ceil(duration * fpsToNumber(fps) - 1e-9);
}

async function analyze(opts: {
  duration: number;
  fps?: Fps;
  clips?: Clip[];
  build?: (
    els: Record<string, FakeElement>,
    video: FakeElement,
    root: FakeElement,
  ) => {
    timelines?: Record<string, FakeTimeline>;
    globalTimeline?: FakeTimeline;
    globals?: Record<string, unknown>;
    windowListeners?: readonly string[];
    listenersUnreadable?: boolean;
  };
  maxStates?: number;
  totalFrames?: number;
  hasClipResolver?: boolean;
}): Promise<OverlayTimingAnalysis> {
  const fps = opts.fps ?? FPS30;
  const { root, video, els } = composition(opts.duration, opts.clips ?? []);
  const extra = opts.build?.(els, video, root) ?? {};
  const { page } = createFakePage({
    root,
    duration: opts.duration,
    hasClipResolver: opts.hasClipResolver,
    ...extra,
  });
  return analyzeOverlayTiming({
    session: { page } as unknown as CaptureSession,
    videoId: "v",
    fps,
    totalFrames: opts.totalFrames ?? frameCount(opts.duration, fps),
    maxStates: opts.maxStates ?? 4096,
  });
}

function expectOk(result: OverlayTimingAnalysis): OverlayTiming {
  if (!result.ok) throw new Error(`expected eligible, got ${result.reason}: ${result.detail}`);
  return result.timing;
}

/**
 * Every frame where some clip's visibility flips, as the layered path sees it:
 * frame `i` samples `i * den / num` and the runtime's on-screen rule decides.
 */
function visibilityFlips(clips: Clip[], fps: Fps, duration: number, total: number): number[] {
  const flips: number[] = [];
  const visible = (f: number) =>
    clips.map((c) =>
      isClipOnScreenAt(
        (f * fps.den) / fps.num,
        c.start,
        c.start + c.duration,
        fpsToNumber(fps),
        duration,
      ),
    );
  for (let f = 1; f < total; f++) {
    if (visible(f).some((v, i) => v !== visible(f - 1)[i])) flips.push(f);
  }
  return flips;
}

function rootTimeline(): { global: FakeTimeline; root: FakeTimeline } {
  const global = new FakeTimeline();
  const root = new FakeTimeline();
  global.add(root, 0);
  return { global, root };
}

describe("analyzeOverlayTiming", () => {
  it("full-bleed video + data-start/duration captions with no GSAP: eligible, cuts at every flip", async () => {
    const clips = [
      { id: "c1", start: 1, duration: 2 },
      { id: "c2", start: 3, duration: 2.5 },
      { id: "c3", start: 7.25, duration: 1 },
    ];
    const timing = expectOk(await analyze({ duration: 10, clips }));
    expect(timing.totalFrames).toBe(300);
    for (const f of visibilityFlips(clips, FPS30, 10, 300))
      expect(timing.changeFrames).toContain(f);
    expect(visibilityFlips(clips, FPS30, 10, 300)).toEqual([30, 90, 165, 218, 248]);
    // A handful of 1-frame guard states per cut, long static states between.
    const states = spans(timing);
    expect(states.length).toBeLessThan(40);
    expect(states.some(([a, b]) => a <= 40 && b >= 85)).toBe(true);
  });

  it("treats GSAP set() as a discrete change", async () => {
    const timing = expectOk(
      await analyze({
        duration: 6,
        clips: [{ id: "cap", start: 0, duration: 6 }],
        build: (els) => {
          const { global, root } = rootTimeline();
          root
            .set(els.cap as FakeElement, 2, { opacity: 0 })
            .set(els.cap as FakeElement, 4.1, { opacity: 1 });
          return { timelines: { main: root }, globalTimeline: global };
        },
      }),
    );
    // set at 2.0 s → frame 60; set at 4.1 s → frame 123 (first frame at or after it).
    expect(timing.changeFrames).toContain(60);
    expect(timing.changeFrames).toContain(123);
    expect(timing.changeFrames.length).toBeLessThan(20);
  });

  it("captures every frame of a short fade as its own state", async () => {
    const timing = expectOk(
      await analyze({
        duration: 4,
        clips: [{ id: "cap", start: 0, duration: 4 }],
        build: (els) => {
          const { global, root } = rootTimeline();
          root.tween({
            start: 1,
            duration: 0.2,
            targets: [els.cap as FakeElement],
            vars: { opacity: 1 },
          });
          return { timelines: { main: root }, globalTimeline: global };
        },
      }),
    );
    // Tween covers frames 30..36; every frame from 30 through 37 starts a state.
    for (let f = 30; f <= 37; f++) expect(timing.changeFrames).toContain(f);
    expect(timing.changeFrames).not.toContain(50);
  });

  it("declines a continuous tween on an overlay", async () => {
    const result = await analyze({
      duration: 4,
      clips: [{ id: "cap", start: 0, duration: 4 }],
      build: (els) => {
        const { global, root } = rootTimeline();
        root.tween({ start: 1, duration: 1, targets: [els.cap as FakeElement], vars: { x: 100 } });
        return { timelines: { main: root }, globalTimeline: global };
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "overlay_continuous_animation" });
  });

  it("declines a tl.call() (not seek-idempotent)", async () => {
    const result = await analyze({
      duration: 4,
      build: () => {
        const { global, root } = rootTimeline();
        root.call(1);
        return { timelines: { main: root }, globalTimeline: global };
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "timeline_call" });
  });

  it("declines a second video, a canvas and CSS animation", async () => {
    const second = await analyze({
      duration: 2,
      build: (_els, _v, root) => {
        root.append(new FakeElement("video", "v2"));
        return {};
      },
    });
    expect(second).toMatchObject({ ok: false, reason: "video_count" });

    const canvas = await analyze({
      duration: 2,
      build: (_els, _v, root) => {
        root.append(new FakeElement("canvas", "c"));
        return {};
      },
    });
    expect(canvas).toMatchObject({ ok: false, reason: "canvas" });

    const css = await analyze({
      duration: 2,
      clips: [{ id: "cap", start: 0, duration: 2 }],
      build: (els) => {
        (els.cap as FakeElement).animations.push({ playState: "running" });
        return {};
      },
    });
    expect(css).toMatchObject({ ok: false, reason: "overlay_non_gsap_animation" });
  });

  it("declines a sub-timeline placed at an offset the engine walk cannot see", async () => {
    const result = await analyze({
      duration: 6,
      clips: [{ id: "cap", start: 0, duration: 6 }],
      build: (els) => {
        // Runtime-style: unregistered composite root, sub-composition nested at its host start.
        const global = new FakeTimeline();
        const composite = new FakeTimeline();
        global.add(composite, 0);
        const main = new FakeTimeline();
        const scene = new FakeTimeline().set(els.cap as FakeElement, 0.5);
        composite.add(main, 0).add(scene, 3);
        return { timelines: { main, scene }, globalTimeline: global };
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "analysis_limit" });
    if (!result.ok) expect(result.detail).toContain('"scene"');
  });

  it("accepts a sub-timeline nested inside a registered root at an offset", async () => {
    const timing = expectOk(
      await analyze({
        duration: 6,
        clips: [{ id: "cap", start: 0, duration: 6 }],
        build: (els) => {
          const { global, root } = rootTimeline();
          const scene = new FakeTimeline().set(els.cap as FakeElement, 0.5);
          root.add(scene, 3);
          return { timelines: { main: root, scene }, globalTimeline: global };
        },
      }),
    );
    // 3 s + 0.5 s → frame 105, found through the root's walk.
    expect(timing.changeFrames).toContain(105);
  });

  it("sees through the runtime's registry proxy to the GSAP timeline", async () => {
    const timing = expectOk(
      await analyze({
        duration: 5,
        clips: [{ id: "cap", start: 0, duration: 5 }],
        build: (els) => {
          // Runtime-style duration-floor wrapper around the authored root, registered as a proxy.
          const global = new FakeTimeline();
          const wrapper = new FakeTimeline();
          global.add(wrapper, 0);
          const real = new FakeTimeline().set(els.cap as FakeElement, 3);
          wrapper.add(real, 0);
          const proxy = Object.assign(Object.create(real) as FakeTimeline, { __hfReal: real });
          return { timelines: { main: proxy }, globalTimeline: global };
        },
      }),
    );
    expect(timing.changeFrames).toContain(90);
  });

  it("declines time-scaled timelines and GSAP animations outside every registered timeline", async () => {
    const scaled = await analyze({
      duration: 4,
      clips: [{ id: "cap", start: 0, duration: 4 }],
      build: (els) => {
        const { global, root } = rootTimeline();
        const scene = new FakeTimeline().set(els.cap as FakeElement, 1);
        scene.timeScale(2);
        root.add(scene, 0);
        return { timelines: { main: root }, globalTimeline: global };
      },
    });
    expect(scaled).toMatchObject({ ok: false, reason: "analysis_limit" });

    const stray = await analyze({
      duration: 4,
      clips: [{ id: "cap", start: 0, duration: 4 }],
      build: (els) => {
        const { global, root } = rootTimeline();
        root.set(els.cap as FakeElement, 1);
        global.add(new FakeTimeline().set(els.cap as FakeElement, 2), 0);
        return { timelines: { main: root }, globalTimeline: global };
      },
    });
    expect(stray).toMatchObject({ ok: false, reason: "analysis_limit" });
  });

  it("declines when the runtime cannot resolve clip windows", async () => {
    const result = await analyze({
      duration: 2,
      clips: [{ id: "cap", start: 0.5, duration: 1 }],
      hasClipResolver: false,
    });
    expect(result).toMatchObject({ ok: false, reason: "unresolvable_clip_start" });
  });

  it("declines more states than allowed", async () => {
    const clips = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, start: i, duration: 1 }));
    const result = await analyze({ duration: 10, clips, maxStates: 8 });
    expect(result).toMatchObject({ ok: false, reason: "too_many_states" });
  });

  it.each([
    { name: "30 fps, mid-frame starts", fps: { num: 30, den: 1 }, starts: [1.01, 2.49, 3.5] },
    { name: "24 fps", fps: { num: 24, den: 1 }, starts: [0.52, 1.0, 2.73] },
    { name: "60 fps", fps: { num: 60, den: 1 }, starts: [0.999, 1.5004, 2.3] },
    {
      name: "NTSC 29.97 on exact frame times",
      fps: { num: 30000, den: 1001 },
      starts: [(45 * 1001) / 30000, (91 * 1001) / 30000, 3.1],
    },
    { name: "NTSC 59.94", fps: { num: 60000, den: 1001 }, starts: [0.5, 1.2345, 2.002] },
  ])("lands every visibility flip on a state start ($name)", async ({ fps, starts }) => {
    const duration = 5;
    const clips = starts.map((start, i) => ({ id: `c${i}`, start, duration: 0.61 + i * 0.13 }));
    const total = frameCount(duration, fps);
    const timing = expectOk(await analyze({ duration, fps, clips, totalFrames: total }));
    const flips = visibilityFlips(clips, fps, duration, total);
    expect(flips.length).toBe(clips.length * 2);
    for (const f of flips) expect(timing.changeFrames).toContain(f);
  });

  it("covers frames beyond the analysed range when the render counts one more", async () => {
    const timing = expectOk(await analyze({ duration: 2, totalFrames: 61 }));
    expect(timing.changeFrames).toContain(59);
    expect(timing.changeFrames).toContain(60);
  });
});

// ── Animation the engine's tween walk cannot see ─────────────────────────────

/** Clip-timed captions plus a GSAP `set()` on one of them, as in the vlog case. */
function gsapCaptions(els: Record<string, FakeElement>) {
  const { global, root } = rootTimeline();
  root.set(els.cap as FakeElement, 2, { opacity: 0 });
  return { timelines: { main: root }, globalTimeline: global };
}

const CAPTION = [{ id: "cap", start: 0, duration: 10 }];

describe("analyzeOverlayTiming: seek-hook listeners", () => {
  it("declines an hf-seek listener on window, with or without GSAP", async () => {
    // The listener can rewrite the overlay on any seek; neither the tween walk nor the clip
    // windows see it, and the overlay is only probed at candidate frames.
    for (const withGsap of [false, true]) {
      const result = await analyze({
        duration: 10,
        clips: CAPTION,
        build: (els) => ({
          ...(withGsap ? gsapCaptions(els) : {}),
          windowListeners: ["resize", "hf-seek", "hf-seek"],
        }),
      });
      expect(result).toEqual({
        ok: false,
        reason: "overlay_non_gsap_animation",
        detail: "hf-seek listeners (2)",
      });
    }
  });

  it("accepts window listeners for other events", async () => {
    const result = await analyze({
      duration: 10,
      clips: CAPTION,
      build: () => ({ windowListeners: ["resize", "message", "hf-after-fonts-modules"] }),
    });
    expectOk(result);
  });

  it("declines when the listeners cannot be read", async () => {
    const result = await analyze({
      duration: 10,
      clips: CAPTION,
      build: () => ({ listenersUnreadable: true }),
    });
    expect(result).toMatchObject({ ok: false, reason: "overlay_non_gsap_animation" });
    expect(result.ok ? "" : result.detail).toContain("seek listeners unreadable");
  });
});

describe("analyzeOverlayTiming: non-GSAP drivers", () => {
  it("still accepts GSAP captions with empty adapter registries and images", async () => {
    const result = await analyze({
      duration: 10,
      clips: CAPTION,
      build: (els, _v, root) => {
        root.append(
          new FakeElement("img", "logo", { src: "assets/logo.png" }),
          new FakeElement("svg", "icon").append(new FakeElement("circle", "dot")),
        );
        return {
          ...gsapCaptions(els),
          globals: { __hfLottie: [], __hfAnime: [], lottie: { getRegisteredAnimations: () => [] } },
        };
      },
    });
    expectOk(result);
  });

  it.each([
    { name: "lottie-web registry", globals: { __hfLottie: [{}] }, detail: "lottie" },
    {
      name: "lottie-web loaded before discovery",
      globals: { lottie: { getRegisteredAnimations: () => [{}] } },
      detail: "lottie",
    },
    { name: "anime.js v4 registry", globals: { __hfAnime: [{}] }, detail: "anime.js" },
    { name: "anime.js v3 running list", globals: { anime: { running: [{}] } }, detail: "anime.js" },
    { name: "d3 transitions", globals: { __hfD3: [{}] }, detail: "d3" },
    { name: "leaflet map", globals: { __hfLeaflet: [{}] }, detail: "leaflet" },
    { name: "three.js", globals: { THREE: {} }, detail: "three.js" },
  ])("declines a seek-driven adapter with instances: $name", async ({ globals, detail }) => {
    // With GSAP captions present the engine reports no cause at all.
    const withGsap = await analyze({
      duration: 10,
      clips: CAPTION,
      build: (els) => ({ ...gsapCaptions(els), globals }),
    });
    expect(withGsap).toMatchObject({ ok: false, reason: "overlay_non_gsap_animation" });
    expect(withGsap.ok ? "" : withGsap.detail).toContain(detail);
    // Without GSAP the engine reports the tolerated `no_gsap_tweens` only.
    const clipOnly = await analyze({ duration: 10, clips: CAPTION, build: () => ({ globals }) });
    expect(clipOnly).toMatchObject({ ok: false, reason: "overlay_non_gsap_animation" });
  });

  it("declines lottie web components and WebGPU scenes", async () => {
    const player = await analyze({
      duration: 10,
      clips: CAPTION,
      build: (els, _v, root) => {
        root.append(new FakeElement("dotlottie-player", "sticker"));
        return gsapCaptions(els);
      },
    });
    expect(player).toMatchObject({ ok: false, reason: "overlay_non_gsap_animation" });

    const webgpu = await analyze({
      duration: 10,
      build: (_els, _v, root) => {
        root.attrs["data-requires-webgpu"] = "";
        return {};
      },
    });
    expect(webgpu).toMatchObject({ ok: false, reason: "overlay_non_gsap_animation" });
  });

  it.each(["animate", "animateTransform", "animateMotion", "set"])(
    "declines SVG SMIL <%s>",
    async (tag) => {
      const result = await analyze({
        duration: 10,
        clips: CAPTION,
        build: (els, _v, root) => {
          const shape = new FakeElement("circle", "dot").append(new FakeElement(tag, ""));
          root.append(new FakeElement("svg", "icon").append(shape));
          return gsapCaptions(els);
        },
      });
      expect(result).toMatchObject({ ok: false, reason: "overlay_non_gsap_animation" });
      expect(result.ok ? "" : result.detail).toContain("SVG SMIL");
    },
  );
});

describe("deriveOverlayTiming", () => {
  const facts: OverlayPageFacts = {
    hasClipResolver: true,
    clipWindows: [],
    unresolvedClipIds: [],
    timelineProblems: [],
    unseekedDrivers: [],
  };

  it("declines unseeked drivers whatever the engine reports", () => {
    const base = { fps: 30, totalFrames: 60, maxStates: 100 };
    const page = { ...facts, unseekedDrivers: ["lottie (1 registered)"] };
    for (const causes of [[], ["no_gsap_tweens"]] as const) {
      const stats = { totalFrames: 60, causes, reason: "x", animatedFrameSet: new Set<number>() };
      expect(deriveOverlayTiming({ ...base, page, stats })).toEqual({
        ok: false,
        reason: "overlay_non_gsap_animation",
        detail: "lottie (1 registered)",
      });
    }
  });

  it("tolerates no_gsap_tweens but nothing else", () => {
    const base = { page: facts, fps: 30, totalFrames: 60, maxStates: 100 };
    const stats = { totalFrames: 60, reason: "x", animatedFrameSet: new Set<number>() };
    expect(
      deriveOverlayTiming({ ...base, stats: { ...stats, causes: ["no_gsap_tweens"] } }).ok,
    ).toBe(true);
    expect(
      deriveOverlayTiming({ ...base, stats: { ...stats, causes: ["no_gsap_tweens", "iframe"] } }),
    ).toMatchObject({ ok: false, reason: "iframe" });
    expect(
      deriveOverlayTiming({ ...base, stats: { ...stats, causes: ["frame_limit"] } }),
    ).toMatchObject({
      ok: false,
      reason: "analysis_limit",
    });
  });

  it("declines a frame count that disagrees with the analysis", () => {
    const result = deriveOverlayTiming({
      stats: { totalFrames: 60, causes: [], reason: "eligible", animatedFrameSet: new Set() },
      page: facts,
      fps: 30,
      totalFrames: 90,
      maxStates: 100,
    });
    expect(result).toMatchObject({ ok: false, reason: "analysis_limit" });
  });

  it("allows a run of exactly the short-animation limit", () => {
    const animated = new Set<number>();
    // Animated frames a..b give change frames a..b+1.
    for (let f = 10; f < 10 + MAX_SHORT_ANIMATION_RUN_FRAMES - 1; f++) animated.add(f);
    const ok = deriveOverlayTiming({
      stats: { totalFrames: 100, causes: [], reason: "eligible", animatedFrameSet: animated },
      page: facts,
      fps: 30,
      totalFrames: 100,
      maxStates: 1000,
    });
    expect(ok.ok).toBe(true);
    animated.add(10 + MAX_SHORT_ANIMATION_RUN_FRAMES - 1);
    const tooLong = deriveOverlayTiming({
      stats: { totalFrames: 100, causes: [], reason: "eligible", animatedFrameSet: animated },
      page: facts,
      fps: 30,
      totalFrames: 100,
      maxStates: 1000,
    });
    expect(tooLong).toMatchObject({ ok: false, reason: "overlay_continuous_animation" });
  });
});
