import { gsap } from "gsap";
import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../lint";
import {
  emitTimelineComposition,
  parseTimelineImport,
  planTransitions,
  TIMELINE_IMPORT_SCHEMA,
  type ImportTimeline,
} from "./index";

const FPS = { num: 30, den: 1 };
const FRAME = 1 / 30;

const video = (
  id: string,
  start: number,
  duration: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind: "video",
  start,
  duration,
  src: `media/${id}.mp4`,
  ...extra,
});

function timeline(
  clips: unknown[],
  transitions: unknown[] = [],
  extra: Record<string, unknown> = {},
): ImportTimeline {
  const result = parseTimelineImport({
    schema: TIMELINE_IMPORT_SCHEMA,
    fps: FPS,
    width: 1280,
    height: 720,
    clips,
    transitions,
    ...extra,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const dissolve = (inOffset: number, outOffset: number, from = "a", to = "b") => ({
  from,
  to,
  inOffset,
  outOffset,
  kind: "dissolve",
});

// Two 4 s clips meeting at 4 s; `a` has 10 s of footage and uses 0-4, `b` uses 3-7.
const pair = () => [video("a", 0, 4), video("b", 4, 4, { mediaStart: 3 })];
const lengthOf = (clip: { id: string }) => (clip.id === "a" ? 10 : 20);

describe("planTransitions", () => {
  it("overlaps the clips around the cut and fades the incoming one in", () => {
    const plan = planTransitions(timeline(pair(), [dissolve(0.5, 0.5)]), {
      mediaDuration: lengthOf,
    });
    const [a, b] = plan.clips;
    expect(a).toMatchObject({ start: 0, duration: 4.5, end: 4.5 });
    expect(b.start).toBeLessThanOrEqual(3.5);
    expect(b.start).toBeGreaterThan(3.499);
    expect(b.mediaStart).toBeGreaterThanOrEqual(2.5);
    expect(b.mediaStart).toBeLessThan(2.5001);
    expect(b.end).toBe(8);
    expect(plan.fades).toEqual([{ clipId: "b", start: b.start, duration: 1, direction: "in" }]);
    expect(plan.warnings).toEqual([]);
  });

  it("clamps the tail to the footage left after the outgoing clip's out-point", () => {
    const clips = [video("a", 0, 4), video("b", 4, 4, { mediaStart: 3 })];
    const plan = planTransitions(timeline(clips, [dissolve(0.5, 1)]), {
      mediaDuration: (clip) => (clip.id === "a" ? 4.25 : 20), // only 0.25 s after the out-point
    });
    expect(plan.clips[0].end).toBeCloseTo(4.25, 6);
    expect(plan.fades[0].duration).toBeCloseTo(0.75, 6);
    expect(plan.warnings[0]).toMatch(/shortened from 1\.5s to 0\.75s.*0\.25s after a's out-point/);
  });

  it("clamps the head to the footage before the incoming clip's in-point", () => {
    const clips = [video("a", 0, 4), video("b", 4, 4, { mediaStart: 0.1 })];
    const plan = planTransitions(timeline(clips, [dissolve(1, 0.5)]), { mediaDuration: lengthOf });
    expect(plan.clips[1].start).toBeCloseTo(3.9, 5);
    expect(plan.clips[1].mediaStart).toBeCloseTo(0, 5);
    expect(plan.fades[0].duration).toBeCloseTo(0.6, 6);
    expect(plan.warnings[0]).toContain("before b's in-point");
  });

  it("scales the head handle by playback rate", () => {
    // At 2x, 1 s of footage before the in-point is only 0.5 s of timeline.
    const clips = [video("a", 0, 4), video("b", 4, 4, { mediaStart: 1, playbackRate: 2 })];
    const plan = planTransitions(timeline(clips, [dissolve(2, 0)]), { mediaDuration: lengthOf });
    expect(plan.fades[0].duration).toBeCloseTo(0.5, 6);
    expect(plan.clips[1].mediaStart).toBeLessThan(0.0001);
  });

  it("stays a hard cut with a warning when there are no handles at all", () => {
    const clips = [video("a", 0, 4), video("b", 4, 4)]; // b starts at 0 of its file
    const plan = planTransitions(timeline(clips, [dissolve(0.5, 0.5)]), {
      mediaDuration: (clip) => (clip.id === "a" ? 4 : 20), // and a plays to its last frame
    });
    expect(plan.fades).toEqual([]);
    expect(plan.clips).toEqual(timeline(clips).clips);
    expect(plan.warnings[0]).toContain("hard cut: no footage beyond the trim points");
  });

  it("dissolves entirely before the cut when the file length is unknown", () => {
    const plan = planTransitions(timeline(pair(), [dissolve(0.5, 0.5)]));
    expect(plan.clips[0].end).toBe(4); // outgoing clip is not extended
    expect(plan.fades[0].duration).toBeCloseTo(0.5, 6);
    expect(plan.warnings[0]).toContain("file could not be read");
  });

  it("never runs out of handle on stills", () => {
    const clips = [
      { id: "a", kind: "image", start: 0, duration: 2, src: "a.png" },
      { id: "b", kind: "image", start: 2, duration: 2, src: "b.png" },
    ];
    const plan = planTransitions(timeline(clips, [dissolve(0.5, 0.5)]));
    expect(plan.fades[0].duration).toBe(1);
    expect(plan.clips[1].mediaStart).toBe(0);
    expect(plan.warnings).toEqual([]);
  });

  it("chains dissolves: a clip can be faded in and extended for the next one", () => {
    const clips = [
      video("a", 0, 4),
      video("b", 4, 4, { mediaStart: 3 }),
      video("c", 8, 4, { mediaStart: 3 }),
    ];
    const plan = planTransitions(
      timeline(clips, [dissolve(0.5, 0.5), dissolve(0.5, 0.5, "b", "c")]),
      { mediaDuration: () => 30 },
    );
    const [, b, c] = plan.clips;
    expect(b.start).toBeLessThan(3.5 + 1e-6);
    expect(b.end).toBeCloseTo(8.5, 6); // extended for the second dissolve
    expect(c.start).toBeLessThan(7.5 + 1e-6);
    expect(plan.fades.map((f) => f.clipId)).toEqual(["b", "c"]);
  });

  it.each([
    ["wipe", /hard cut; only dissolves are applied/],
    ["iris", /hard cut; only dissolves/],
  ])("keeps %s as a hard cut", (kind, message) => {
    const plan = planTransitions(timeline(pair(), [{ ...dissolve(0.5, 0.5), kind }]), {
      mediaDuration: lengthOf,
    });
    expect(plan.fades).toEqual([]);
    expect(plan.warnings[0]).toMatch(message);
  });

  it("leaves audio transitions as hard cuts", () => {
    const clips = [
      { id: "a", kind: "audio", start: 0, duration: 4, src: "a.wav" },
      { id: "b", kind: "audio", start: 4, duration: 4, src: "b.wav", mediaStart: 3 },
    ];
    const plan = planTransitions(timeline(clips, [dissolve(0.5, 0.5)]));
    expect(plan.fades).toEqual([]);
    expect(plan.warnings[0]).toContain("audio transition");
  });

  it("skips a transition whose clips do not meet", () => {
    const clips = [video("a", 0, 4), video("b", 6, 4, { mediaStart: 3 })];
    const plan = planTransitions(timeline(clips, [dissolve(0.5, 0.5)]), {
      mediaDuration: lengthOf,
    });
    expect(plan.fades).toEqual([]);
    expect(plan.warnings[0]).toContain("do not meet");
  });

  it("ignores a transition whose clip was dropped", () => {
    const plan = planTransitions(timeline([video("a", 0, 4)], [dissolve(0.5, 0.5)]));
    expect(plan).toMatchObject({ fades: [], warnings: [] });
  });

  it("splits a plain duration evenly around the cut when no offsets are given", () => {
    const t = timeline(pair(), [{ from: "a", to: "b", duration: 1, kind: "crossfade" }]);
    expect(t.transitions[0]).toMatchObject({ inOffset: 0.5, outOffset: 0.5, duration: 1 });
  });

  it("does not mutate the timeline it was given", () => {
    const t = timeline(pair(), [dissolve(0.5, 0.5)]);
    const before = JSON.stringify(t);
    planTransitions(t, { mediaDuration: lengthOf });
    expect(JSON.stringify(t)).toBe(before);
  });
});

describe("overlapping clips and multiple tracks", () => {
  const lanes = timeline([
    video("base", 0, 10),
    { id: "logo", kind: "image", start: 2, duration: 5, src: "media/logo.png", trackIndex: 1 },
    video("pip", 3, 2, { trackIndex: 2 }),
    { id: "music", kind: "audio", start: 0, duration: 10, src: "media/m.wav", trackIndex: 3 },
  ]);

  it("stacks higher tracks above lower ones", () => {
    const { html } = emitTimelineComposition(lanes);
    const z = (id: string) => Number(new RegExp(`id="${id}"[^>]*z-index: (\\d+)`).exec(html)?.[1]);
    expect(z("base")).toBeLessThan(z("logo"));
    expect(z("logo")).toBeLessThan(z("pip"));
    expect(html).toMatch(/<audio id="music"[^>]*data-track-index="3"/);
  });

  it("keeps overlapping clips timed independently", () => {
    const { html } = emitTimelineComposition(lanes);
    expect(html).toMatch(/id="logo"[^>]*data-start="2" data-duration="5"/);
    expect(html).toMatch(/id="pip"[^>]*data-start="3" data-duration="2"/);
  });

  it("paints a dissolve's incoming clip over the outgoing one on the same track", () => {
    const { html } = emitTimelineComposition(timeline(pair(), [dissolve(0.5, 0.5)]), {
      mediaDuration: lengthOf,
    });
    expect(html.indexOf('id="a"')).toBeLessThan(html.indexOf('id="b"')); // later in the DOM paints on top
    expect(html).toMatch(
      /tl\.fromTo\("#b", \{ opacity: 0 \}, \{ opacity: 1, duration: 1, ease: "none" \}, 3\.49999\d*\);/,
    );
  });

  it("keeps a dissolve on one track and a clip on another from fighting over paint order", () => {
    const clips = [
      ...pair(),
      { id: "title", kind: "image", start: 3, duration: 2, src: "t.png", trackIndex: 1 },
    ];
    const { html } = emitTimelineComposition(timeline(clips, [dissolve(0.5, 0.5)]), {
      mediaDuration: lengthOf,
    });
    const z = (id: string) => Number(new RegExp(`id="${id}"[^>]*z-index: (\\d+)`).exec(html)?.[1]);
    expect(z("title")).toBeGreaterThan(z("a"));
    expect(z("title")).toBeGreaterThan(z("b"));
  });

  it.each([
    ["stacked tracks", lanes, undefined],
    ["a dissolve", timeline(pair(), [dissolve(0.5, 0.5)]), lengthOf],
    [
      "chained dissolves across two tracks",
      timeline(
        [
          video("a", 0, 4),
          video("b", 4, 4, { mediaStart: 3 }),
          video("c", 8, 4, { mediaStart: 3 }),
          video("o", 1, 6, { trackIndex: 1 }),
        ],
        [dissolve(0.5, 0.5), dissolve(0.5, 0.5, "b", "c")],
      ),
      () => 30,
    ],
  ])("lints clean: %s", async (_name, tl, mediaDuration) => {
    const { html } = emitTimelineComposition(tl, {
      srcFor: (c) => `assets/${c.src.split("/").pop()}`,
      mediaDuration,
    });
    const result = await lintHyperframeHtml(html);
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(result.findings.filter((f) => f.code.includes("overlap"))).toEqual([]);
  });

  it("ends every clip by the root duration, including the extended outgoing clip", () => {
    const tl = timeline(pair(), [dissolve(0.5, 0.5)]);
    const { html } = emitTimelineComposition(tl, { mediaDuration: lengthOf });
    expect(html).toContain('data-duration="8"');
    const plan = planTransitions(tl, { mediaDuration: lengthOf });
    for (const clip of plan.clips) expect(clip.end).toBeLessThanOrEqual(tl.duration + FRAME);
  });
});

describe("fades from and to nothing", () => {
  const fade = (inOffset: number, outOffset: number, from: string | null, to: string | null) => ({
    from,
    to,
    inOffset,
    outOffset,
    kind: "dissolve",
  });

  it("fades a clip in from nothing, starting early on its head handle", () => {
    const clips = [video("b", 2, 4, { mediaStart: 1 })];
    const plan = planTransitions(timeline(clips, [fade(0.5, 0.5, null, "b")]), {
      mediaDuration: () => 20,
    });
    expect(plan.clips[0].start).toBeLessThanOrEqual(1.5);
    expect(plan.fades).toEqual([
      { clipId: "b", start: plan.clips[0].start, duration: 1, direction: "in" },
    ]);
    expect(plan.clips[0].end).toBe(6);
  });

  it("fades in from nothing at the cut when the offset before it is zero", () => {
    const plan = planTransitions(timeline([video("b", 2, 4)], [fade(0, 1, null, "b")]));
    expect(plan.fades[0]).toMatchObject({ start: 2, duration: 1, direction: "in" });
    expect(plan.clips[0].start).toBeLessThan(2 + 1e-6);
  });

  it("clamps a fade in to the clip's own length", () => {
    const plan = planTransitions(timeline([video("b", 0, 0.5)], [fade(0, 2, null, "b")]));
    expect(plan.fades[0].duration).toBe(0.5);
  });

  it("fades a clip out to nothing, playing on over its tail handle", () => {
    const plan = planTransitions(timeline([video("a", 0, 4)], [fade(0.5, 0.5, "a", null)]), {
      mediaDuration: () => 10,
    });
    expect(plan.clips[0].end).toBe(4.5);
    expect(plan.fades).toEqual([{ clipId: "a", start: 3.5, duration: 1, direction: "out" }]);
  });

  it("fades out entirely before the cut when there is no tail handle", () => {
    const plan = planTransitions(timeline([video("a", 0, 4)], [fade(1, 1, "a", null)]), {
      mediaDuration: () => 4,
    });
    expect(plan.clips[0].end).toBe(4);
    expect(plan.fades[0]).toMatchObject({ start: 3, duration: 1, direction: "out" });
    expect(plan.warnings[0]).toContain("shortened from 2s to 1s");
  });

  it("emits a fade out as an opacity 1 to 0 tween", () => {
    const { html } = emitTimelineComposition(
      timeline([video("a", 0, 4)], [fade(0.5, 0.5, "a", null)]),
      { mediaDuration: () => 10 },
    );
    expect(html).toContain(
      'tl.fromTo("#a", { opacity: 1 }, { opacity: 0, duration: 1, ease: "none" }, 3.5);',
    );
  });

  it("ignores a transition when its clip was dropped", () => {
    const plan = planTransitions(timeline([video("a", 0, 4)], [fade(0, 1, null, "missing")]));
    expect(plan).toMatchObject({ fades: [], warnings: [] });
  });

  it("rejects a transition with a clip on neither side", () => {
    const result = parseTimelineImport({
      schema: TIMELINE_IMPORT_SCHEMA,
      fps: FPS,
      clips: [video("a", 0, 4)],
      transitions: [{ from: null, to: null, duration: 1 }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("freeze and mediaRoot fields", () => {
  it("defaults freeze to false and keeps it when set", () => {
    const t = timeline([video("a", 0, 2), video("b", 2, 2, { freeze: true })]);
    expect(t.clips.map((c) => c.freeze)).toEqual([false, true]);
  });

  it("carries a media root through, or null", () => {
    expect(timeline([video("a", 0, 2)]).mediaRoot).toBeNull();
    expect(timeline([video("a", 0, 2)], [], { mediaRoot: "/unpacked" }).mediaRoot).toBe(
      "/unpacked",
    );
    const bad = parseTimelineImport({
      schema: TIMELINE_IMPORT_SCHEMA,
      fps: FPS,
      clips: [video("a", 0, 2)],
      mediaRoot: 5,
    });
    expect(bad.ok).toBe(false);
  });
});

describe("fades stay inside the composition", () => {
  const fade = (inOffset: number, outOffset: number, from: string | null, to: string | null) => ({
    from,
    to,
    inOffset,
    outOffset,
    kind: "dissolve",
  });

  /** Replays the fade tweens the emitter wrote through GSAP itself; returns where each really starts. */
  function actualStarts(html: string): number[] {
    const calls = [
      ...html.matchAll(
        /tl\.fromTo\("[^"]+", \{ opacity: (\d) \}, \{ opacity: (\d), duration: ([-\d.e]+), ease: "none" \}, ([-\d.e]+)\);/g,
      ),
    ];
    const tl = gsap.timeline({ paused: true });
    for (const [, from, to, duration, at] of calls) {
      tl.fromTo(
        { opacity: 0 },
        { opacity: Number(from) },
        { opacity: Number(to), duration: Number(duration), ease: "none" },
        Number(at),
      );
    }
    return tl.getChildren(false).map((tween) => tween.startTime());
  }

  it("never plans a fade before 0, and GSAP keeps every fade where it was planned", () => {
    const clips = [
      video("a", 0, 4, { mediaStart: 5 }),
      video("b", 4, 4, { mediaStart: 3 }),
      video("c", 8, 4, { mediaStart: 3 }),
    ];
    const t = timeline(clips, [
      fade(0.5, 0.5, null, "a"),
      fade(0.5, 0.5, "a", "b"),
      fade(0.5, 0.5, "b", "c"),
    ]);
    const plan = planTransitions(t, { mediaDuration: () => 60 });
    for (const f of plan.fades) expect(f.start).toBeGreaterThanOrEqual(0);
    for (const c of plan.clips) expect(c.start).toBeGreaterThanOrEqual(0);
    const { html } = emitTimelineComposition(t, { mediaDuration: () => 60 });
    const planned = plan.fades.map((f) => f.start);
    const actual = actualStarts(html);
    expect(actual).toHaveLength(planned.length);
    actual.forEach((at, i) => expect(at).toBeCloseTo(planned[i], 5));
  });

  it("limits an opening dissolve to the room before the clip's start and says so", () => {
    const t = timeline([video("a", 0, 4, { mediaStart: 5 })], [fade(0.5, 0.5, null, "a")]);
    const plan = planTransitions(t, { mediaDuration: () => 60 });
    expect(plan.clips[0].start).toBe(0);
    expect(plan.fades[0]).toMatchObject({ start: 0, duration: 0.5, direction: "in" });
    expect(plan.warnings[0]).toContain("on the timeline");
  });

  it("keeps a dissolve into a clip near the start from reaching before 0", () => {
    const t = timeline(
      [video("a", 0, 0.2), video("b", 0.2, 4, { mediaStart: 5 })],
      [fade(0.5, 0, "a", "b")],
    );
    const plan = planTransitions(t, { mediaDuration: () => 60 });
    for (const f of plan.fades) expect(f.start).toBeGreaterThanOrEqual(0);
  });
});
