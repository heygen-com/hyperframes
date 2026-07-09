import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { classifyZone, normalizeToZones } from "./timelineZones";

function el(id: string, tag: string, track: number, duration = 2): TimelineElement {
  return { id, tag, start: 0, duration, track };
}

function trackOf(els: TimelineElement[], id: string): number {
  return els.find((e) => e.id === id)!.track;
}

describe("classifyZone", () => {
  it("audio → audio; video / image / everything else → visual", () => {
    expect(classifyZone(el("m", "audio", 3))).toBe("audio");
    expect(classifyZone(el("v", "video", 1))).toBe("visual");
    expect(classifyZone(el("i", "img", 0))).toBe("visual");
  });
});

describe("normalizeToZones", () => {
  it("orders visual (top) → audio (bottom) by ascending index", () => {
    const out = normalizeToZones([
      el("img", "img", 0),
      el("vid", "video", 2),
      el("mus", "audio", 5),
    ]);
    expect(trackOf(out, "img")).toBe(0); // visual
    expect(trackOf(out, "vid")).toBe(1); // visual
    expect(trackOf(out, "mus")).toBe(2); // audio (bottom)
  });

  it("keeps all visual lanes together on top, preserving authored order", () => {
    const out = normalizeToZones([el("v0", "video", 0), el("i1", "img", 1), el("v3", "video", 3)]);
    expect(trackOf(out, "v0")).toBe(0);
    expect(trackOf(out, "i1")).toBe(1);
    expect(trackOf(out, "v3")).toBe(2);
  });

  it("drops audio below the visual lanes even when sharing a track index", () => {
    const out = normalizeToZones([el("v", "video", 0), el("a", "audio", 0)]);
    expect(trackOf(out, "v")).toBe(0); // visual
    expect(trackOf(out, "a")).toBe(1); // audio, below
  });

  it("groups multiple audio tracks at the bottom preserving relative order", () => {
    const out = normalizeToZones([el("v", "video", 0), el("a1", "audio", 1), el("a2", "audio", 4)]);
    expect(trackOf(out, "v")).toBe(0);
    expect(trackOf(out, "a1")).toBe(1);
    expect(trackOf(out, "a2")).toBe(2);
  });

  it("returns the same array (identity) when already zoned", () => {
    const input = [el("i", "img", 0), el("v", "video", 1), el("a", "audio", 2)];
    expect(normalizeToZones(input)).toBe(input);
  });

  it("is idempotent (no drift on re-zoning)", () => {
    const input = [
      el("img", "img", 1),
      el("v", "video", 3),
      el("a1", "audio", 2),
      el("a2", "audio", 6),
    ];
    const once = normalizeToZones(input);
    const twice = normalizeToZones(once);
    for (const e of once) expect(trackOf(twice, e.id)).toBe(e.track);
  });

  it("splits time-overlapping clips on one track onto separate lanes (no visible overlap)", () => {
    const clip = (id: string, start: number, duration: number): TimelineElement => ({
      id,
      tag: "video",
      start,
      duration,
      track: 1, // all authored on the SAME track, some overlapping in time
    });
    // a [0,5), b [2,7) overlaps a, c [6,9) fits after a.
    const out = normalizeToZones([clip("a", 0, 5), clip("b", 2, 5), clip("c", 6, 3)]);
    expect(trackOf(out, "a")).toBe(0); // lane 0
    expect(trackOf(out, "b")).toBe(1); // overlaps a → its own lane
    expect(trackOf(out, "c")).toBe(0); // sequential after a → shares lane 0

    // Idempotent: re-laying the split result changes nothing.
    const twice = normalizeToZones(out);
    for (const e of out) expect(trackOf(twice, e.id)).toBe(e.track);
  });
});
