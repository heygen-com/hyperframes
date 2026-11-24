import { describe, expect, it } from "vitest";
import {
  REVIEW_SEAM_OFFSETS,
  planReview,
  resolveReviewTimeline,
  reviewFrames,
  seamTimes,
} from "./snapshotReview.js";

const FILM = `<html><body><div data-composition-id="main" data-duration="20">
  <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="0" data-duration="6"></div>
  <div id="stat" data-composition-id="stat" data-composition-src="compositions/stat.html" data-start="6" data-duration="7">
    <div class="scene-body">
      <div id="number" class="clip" data-start="1.2" data-duration="5.8" data-beat="number">42%</div>
      <div id="caption" data-beat="caption">untimed</div>
    </div>
  </div>
  <div id="outro" data-composition-id="outro" data-start="stat" data-duration="7"></div>
  <div id="captions" data-track-kind="captions" data-start="0" data-duration="20"></div>
  <audio id="music" src="music.mp3" data-start="0" data-duration="20"></audio>
</div></body></html>`;

describe("resolveReviewTimeline", () => {
  it("reads the root's timed scene hosts, skipping captions and audio tracks", () => {
    const timeline = resolveReviewTimeline(FILM, {}, 20);
    expect(timeline.window).toEqual([0, 20]);
    expect(timeline.scenes).toEqual([
      { id: "intro", start: 0, end: 6 },
      { id: "stat", start: 6, end: 13 },
      { id: "outro", start: 13, end: 20 },
    ]);
  });

  it("times a nested data-beat on the root timeline and notes an untimed one", () => {
    const timeline = resolveReviewTimeline(FILM, {}, 20);
    expect(timeline.beats).toEqual([{ time: 7.5, label: "beat:number" }]);
    expect(timeline.notes).toEqual([expect.stringContaining('data-beat="caption"')]);
  });

  it("scopes to one composition with --composition", () => {
    const timeline = resolveReviewTimeline(FILM, {}, 20, "stat");
    expect(timeline.window).toEqual([6, 13]);
    expect(timeline.scenes).toEqual([{ id: "number", start: 7.2, end: 13 }]);
  });

  it("names the --composition command for a host that holds several timed clips", () => {
    const html = `<div data-composition-id="main" data-duration="10">
      <div id="reel" data-composition-id="reel-comp" data-start="0" data-duration="9">
        <div id="a" class="clip" data-start="0" data-duration="3"></div>
        <div id="b" class="clip" data-start="3" data-duration="3"></div>
      </div>
      <div id="solo" data-composition-id="solo-comp" data-start="9" data-duration="1">
        <div id="only" class="clip" data-start="0" data-duration="1"></div>
      </div>
    </div>`;
    expect(resolveReviewTimeline(html, {}, 10).notes).toEqual([
      "reel holds several timed clips; run --review --composition reel-comp to review its cuts.",
    ]);
  });

  it("leaves out the note for hosts whose layers share one start and end", () => {
    const html = `<div data-composition-id="main" data-duration="10">
      <div id="stills" data-composition-id="stills-comp" data-start="0" data-duration="5">
        <img src="bg.png"><img src="logo.png">
      </div>
      <div id="layered" data-composition-id="layered-comp" data-start="5" data-duration="5">
        <video src="bg.mp4" data-start="5" data-duration="5"></video>
        <div class="clip" data-start="5" data-duration="5"></div>
      </div>
    </div>`;
    expect(resolveReviewTimeline(html, {}, 10).notes).toEqual([]);
  });

  it("times a host without data-duration from its registered timeline", () => {
    const html = `<div data-composition-id="main" data-duration="10">
      <div data-composition-id="a" data-start="0"></div>
      <div data-composition-id="b" data-start="a"></div>
    </div>`;
    expect(resolveReviewTimeline(html, { a: 4, b: 6 }, 10).scenes).toEqual([
      { id: "a", start: 0, end: 4 },
      { id: "b", start: 4, end: 10 },
    ]);
  });
});

describe("planReview", () => {
  it("frames each scene 0.3 s in and at its middle, and strips every cut at ±0.1 and ±0.2 s", () => {
    const plan = planReview(resolveReviewTimeline(FILM, {}, 20), 20 - 1 / 30);
    expect(plan.beats).toEqual([
      { time: 0.3, label: "intro" },
      { time: 3, label: "intro mid" },
      { time: 6.3, label: "stat" },
      { time: 7.5, label: "beat:number" },
      { time: 9.5, label: "stat mid" },
      { time: 13.3, label: "outro" },
      { time: 16.5, label: "outro mid" },
    ]);
    expect(plan.seams).toEqual([
      { time: 6, from: "intro", to: "stat", times: [5.8, 5.9, 6, 6.1, 6.2] },
      { time: 13, from: "stat", to: "outro", times: [12.8, 12.9, 13, 13.1, 13.2] },
    ]);
  });

  it("merges a data-beat that lands on a scene's beat into one frame", () => {
    const plan = planReview(
      {
        window: [0, 10],
        scenes: [
          { id: "a", start: 0, end: 5 },
          { id: "b", start: 5, end: 10 },
        ],
        beats: [{ time: 5.31, label: "beat:logo" }],
        notes: [],
      },
      10,
    );
    expect(plan.beats.map((beat) => beat.label)).toEqual(["a", "a mid", "b + beat:logo", "b mid"]);
  });

  it("uses a short scene's middle and keeps every frame inside the film", () => {
    const plan = planReview(
      {
        window: [0, 4],
        scenes: [
          { id: "flash", start: 0, end: 0.4 },
          { id: "rest", start: 0.4, end: 4 },
        ],
        beats: [],
        notes: [],
      },
      4 - 1 / 30,
    );
    expect(plan.beats[0]).toEqual({ time: 0.2, label: "flash" });
    expect(plan.seams[0]?.times).toEqual([0.2, 0.3, 0.4, 0.5, 0.6]);
  });

  it("spreads beats evenly when there are fewer than two scenes", () => {
    const plan = planReview({ window: [0, 10], scenes: [], beats: [], notes: [] }, 10);
    expect(plan.beats.map((beat) => beat.time)).toEqual([1, 3, 5, 7, 9]);
    expect(plan.notes[0]).toContain("Fewer than two scene starts");
  });

  it("spreads beats evenly when every scene starts at the same time", () => {
    const scenes = [
      { id: "basemap", start: 0, end: 10 },
      { id: "pin", start: 0, end: 10 },
    ];
    const plan = planReview({ window: [0, 10], scenes, beats: [], notes: [] }, 10);
    expect(plan.beats.map((beat) => beat.time)).toEqual([1, 3, 5, 7, 9]);
  });
});

describe("seamTimes", () => {
  it("adds an end no scene starts at, for a gap or an overlapping transition", () => {
    const scenes = [
      { id: "a", start: 0, end: 4 },
      { id: "b", start: 3.5, end: 8 },
      { id: "c", start: 9, end: 12 },
    ];
    expect(seamTimes(scenes, [0, 12])).toEqual([3.5, 4, 8, 9]);
  });
});

describe("reviewFrames", () => {
  it("names beat and seam stills in capture order", () => {
    const plan = planReview(resolveReviewTimeline(FILM, {}, 20), 20 - 1 / 30);
    const frames = reviewFrames(plan);
    expect(frames).toHaveLength(plan.beats.length + plan.seams.length * REVIEW_SEAM_OFFSETS.length);
    expect(frames[0]).toMatchObject({ role: "beat", file: "beat-01-at-0.3s.png", label: "intro" });
    expect(frames.find((frame) => frame.role === "seam" && frame.time === 6)).toMatchObject({
      file: "seam-01-3-at-6s.png",
      label: "cut intro -> stat",
    });
  });
});
