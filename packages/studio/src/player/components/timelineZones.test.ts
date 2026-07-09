import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { classifyZone, normalizeToZones, resolveMainOriginTrack } from "./timelineZones";

function el(id: string, tag: string, track: number, duration = 2): TimelineElement {
  return { id, tag, start: 0, duration, track };
}

function trackOf(els: TimelineElement[], id: string): number {
  return els.find((e) => e.id === id)!.track;
}

describe("resolveMainOriginTrack", () => {
  it("is the video track with the most total content (primary sequence)", () => {
    // track 4 has more total video duration than track 2 → main, even though higher index
    expect(
      resolveMainOriginTrack([el("a", "img", 0), el("v", "video", 2, 3), el("v2", "video", 4, 9)]),
    ).toBe(4);
  });
  it("breaks ties to the track holding the smallest stable id", () => {
    expect(resolveMainOriginTrack([el("v", "video", 2, 5), el("v2", "video", 4, 5)])).toBe(2);
  });
  it("honors an explicit data-timeline-role=main designation over content", () => {
    const designated: TimelineElement = {
      id: "m",
      tag: "video",
      track: 7,
      start: 0,
      duration: 1,
      timelineRole: "main",
    };
    expect(resolveMainOriginTrack([el("v", "video", 0, 20), designated])).toBe(7);
  });
  it("is null when there is no video", () => {
    expect(resolveMainOriginTrack([el("a", "img", 0), el("m", "audio", 1)])).toBe(null);
  });
});

describe("classifyZone", () => {
  it("audio → audio, main-track video → main, others → overlay", () => {
    expect(classifyZone(el("m", "audio", 3), 1)).toBe("audio");
    expect(classifyZone(el("v", "video", 1), 1)).toBe("main");
    expect(classifyZone(el("i", "img", 0), 1)).toBe("overlay");
    expect(classifyZone(el("v2", "video", 4), 1)).toBe("overlay"); // video not on the main track
    expect(classifyZone(el("i", "img", 1), 1)).toBe("overlay"); // non-video ON the main track → overlay
  });
});

describe("normalizeToZones", () => {
  it("orders overlay → main → audio by ascending index", () => {
    const out = normalizeToZones([
      el("img", "img", 0),
      el("vid", "video", 2),
      el("mus", "audio", 5),
    ]);
    expect(trackOf(out, "img")).toBe(0); // overlay (top)
    expect(trackOf(out, "vid")).toBe(1); // main (middle)
    expect(trackOf(out, "mus")).toBe(2); // audio (bottom)
  });

  it("demotes non-main video tracks into the overlay zone above main", () => {
    const out = normalizeToZones([el("v0", "video", 0), el("i1", "img", 1), el("v3", "video", 3)]);
    // main = track 0 (lowest video); overlay tracks (1,3) sorted → i1=0, v3=1; main → 2
    expect(trackOf(out, "i1")).toBe(0);
    expect(trackOf(out, "v3")).toBe(1);
    expect(trackOf(out, "v0")).toBe(2); // main sits below the overlays (no audio present)
  });

  it("splits a mixed video+audio track: audio drops below the main video", () => {
    const out = normalizeToZones([el("v", "video", 0), el("a", "audio", 0)]);
    expect(trackOf(out, "v")).toBe(0); // main
    expect(trackOf(out, "a")).toBe(1); // audio zone, below main
  });

  it("returns the same array (identity) when already zoned", () => {
    const input = [el("i", "img", 0), el("v", "video", 1), el("a", "audio", 2)];
    expect(normalizeToZones(input)).toBe(input);
  });

  it("is idempotent with multiple video tracks (no drift on re-zoning)", () => {
    // main = the longer video (track 0); a shorter video overlay on track 5 + img + audio.
    const input = [
      el("vmain", "video", 0, 8),
      el("voverlay", "video", 5, 2),
      el("img", "img", 1),
      el("aud", "audio", 2),
    ];
    const once = normalizeToZones(input);
    const twice = normalizeToZones(once);
    // Re-zoning must not move anything (would otherwise swap which video is "main").
    for (const e of once) expect(trackOf(twice, e.id)).toBe(e.track);
    // main video sits below the overlays, above audio.
    expect(trackOf(once, "vmain")).toBeGreaterThan(trackOf(once, "voverlay"));
    expect(trackOf(once, "vmain")).toBeGreaterThan(trackOf(once, "img"));
    expect(trackOf(once, "aud")).toBeGreaterThan(trackOf(once, "vmain"));
  });

  it("groups multiple audio tracks at the bottom preserving relative order", () => {
    const out = normalizeToZones([el("v", "video", 0), el("a1", "audio", 1), el("a2", "audio", 4)]);
    expect(trackOf(out, "v")).toBe(0); // main (no overlays)
    expect(trackOf(out, "a1")).toBe(1);
    expect(trackOf(out, "a2")).toBe(2);
  });

  it("does NOT oscillate with EQUAL-duration videos on distinct tracks", () => {
    // Regression: tie-breaking main on the (mutated) track index made these two
    // swap tracks on every re-zone. Tie-break is now the stable id → fixed point.
    const input = [el("v1", "video", 1, 5), el("v2", "video", 2, 5)];
    const once = normalizeToZones(input);
    const twice = normalizeToZones(once);
    for (const e of once) expect(trackOf(twice, e.id)).toBe(e.track);
  });
});
