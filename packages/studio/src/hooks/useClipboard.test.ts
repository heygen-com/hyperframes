// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pasteTimelineClips, resolveFreeTrack, type PlacedClip } from "./useClipboard";
import type { TimelineClipboardClip } from "../utils/clipboardPayload";
import type { TimelineElement } from "../player";

const ROOT = '<div id="claude-paper" data-composition-id="claude-paper" data-start="0"></div>';

function clip(id: string, start: number, duration: number, track: number): TimelineClipboardClip {
  return {
    html: `<audio id="${id}" src="typenew.mp3" data-start="${start}" data-duration="${duration}" data-track-index="${track}"></audio>`,
    start,
    duration,
    track,
  };
}

function liveElement(track: number, start: number, duration: number): TimelineElement {
  return { id: `x-${track}`, tag: "audio", start, duration, track, authoredTrack: track };
}

describe("resolveFreeTrack", () => {
  it("keeps the preferred track when nothing occupies it", () => {
    const track = resolveFreeTrack({ track: 5, start: 10, duration: 1 }, []);
    expect(track).toBe(5);
  });

  it("bumps to a new track when the preferred one overlaps in time", () => {
    const taken: PlacedClip[] = [{ track: 5, start: 10.2, duration: 0.5 }];
    const track = resolveFreeTrack({ track: 5, start: 10, duration: 1 }, taken);
    expect(track).toBe(6);
  });

  it("keeps the preferred track when an occupant on it does not overlap in time", () => {
    const taken: PlacedClip[] = [{ track: 5, start: 50, duration: 1 }];
    const track = resolveFreeTrack({ track: 5, start: 10, duration: 1 }, taken);
    expect(track).toBe(5);
  });

  it("picks the next track above the highest taken one, not just +1 from preferred", () => {
    const taken: PlacedClip[] = [
      { track: 5, start: 10, duration: 1 },
      { track: 9, start: 30, duration: 1 },
    ];
    const track = resolveFreeTrack({ track: 5, start: 10.1, duration: 1 }, taken);
    expect(track).toBe(10);
  });
});

describe("pasteTimelineClips", () => {
  it("anchors a single clip's data-start at the anchor time and keeps its track", () => {
    const { content, ids } = pasteTimelineClips(ROOT, [clip("sfx-23", 21.61, 0.57, 132)], 40, []);
    expect(content).toContain('data-start="40"');
    expect(content).toContain('data-track-index="132"');
    expect(ids).toEqual(["sfx-23"]);
  });

  it("preserves each clip's relative offset from the group's earliest clip", () => {
    const clips = [
      clip("sfx-23", 21.61, 0.57, 132),
      clip("sfx-24", 21.73, 0.57, 133),
      clip("sfx-25", 21.84, 0.57, 134),
    ];
    const { content } = pasteTimelineClips(ROOT, clips, 40, []);
    // Offsets from the earliest clip (21.61): 0, 0.12, 0.23 -> 40, 40.12, 40.23
    expect(content).toContain('id="sfx-23" src="typenew.mp3" data-start="40"');
    expect(content).toContain('id="sfx-24" src="typenew.mp3" data-start="40.12"');
    expect(content).toContain('id="sfx-25" src="typenew.mp3" data-start="40.23"');
  });

  it("moves a clip to a new track when its original track is occupied at the target time", () => {
    const live = [liveElement(132, 40, 0.57)];
    const { content } = pasteTimelineClips(ROOT, [clip("sfx-23", 21.61, 0.57, 132)], 40, live);
    expect(content).not.toContain('data-track-index="132"');
    expect(content).toMatch(/data-track-index="133"/);
  });

  it("strips the copied data-hf-id so a fresh one mints on next save", () => {
    const clipWithHfId: TimelineClipboardClip = {
      html: '<audio data-hf-id="hf-75o7" id="sfx-type-0" src="typenew.mp3" data-start="7.8" data-duration="0.57" data-track-index="109"></audio>',
      start: 7.8,
      duration: 0.57,
      track: 109,
    };
    const { content } = pasteTimelineClips(ROOT, [clipWithHfId], 40, []);
    expect(content).not.toContain("data-hf-id");
  });

  it("strips a nested descendant's data-hf-id too, not just the root's", () => {
    // A composition-instance clip's descendants carry their own hf-ids; a
    // clone must remint all of them, not just the root, or the descendants
    // collide with their originals the same way the root would.
    const nested: TimelineClipboardClip = {
      html: '<div data-hf-id="hf-root" id="comp-1" data-start="7.8" data-duration="0.57" data-track-index="109"><span data-hf-id="hf-child"></span></div>',
      start: 7.8,
      duration: 0.57,
      track: 109,
    };
    const { content } = pasteTimelineClips(ROOT, [nested], 40, []);
    expect(content).not.toContain("hf-root");
    expect(content).not.toContain("hf-child");
    expect(content).not.toContain("data-hf-id");
  });

  it("does not strip text content that happens to contain the data-hf-id string", () => {
    const withText: TimelineClipboardClip = {
      html: '<div id="cap-1" data-start="7.8" data-duration="0.57" data-track-index="109"><span>talking about data-hf-id="hf-xyz" in my video</span></div>',
      start: 7.8,
      duration: 0.57,
      track: 109,
    };
    const { content } = pasteTimelineClips(ROOT, [withText], 40, []);
    expect(content).toContain('talking about data-hf-id="hf-xyz" in my video');
  });

  it("bumps the second clip in a batch off the first clip's own new track when their offsets collide", () => {
    // Both clips start life a track apart but paste to overlapping times on
    // the SAME track, so the second must dodge the first's placement, not
    // just the live elements it was checked against.
    const clips = [clip("sfx-23", 21.61, 0.57, 132), clip("sfx-24", 21.7, 0.57, 132)];
    const { content } = pasteTimelineClips(ROOT, clips, 40, []);
    expect(content).toContain(
      'id="sfx-23" src="typenew.mp3" data-start="40" data-duration="0.57" data-track-index="132"',
    );
    expect(content).toContain(
      'id="sfx-24" src="typenew.mp3" data-start="40.09" data-duration="0.57" data-track-index="133"',
    );
  });

  it("dedupes an id that already exists in the target file", () => {
    const withExisting = ROOT.replace(
      "</div>",
      '<audio id="sfx-23" data-start="1" data-duration="1" data-track-index="0"></audio></div>',
    );
    const { content, ids } = pasteTimelineClips(
      withExisting,
      [clip("sfx-23", 21.61, 0.57, 132)],
      40,
      [],
    );
    expect(ids[0]).not.toBe("sfx-23");
    expect(ids[0]).toMatch(/^sfx-23-\d+$/);
    expect(content).toContain(`id="${ids[0]}"`);
  });
});
