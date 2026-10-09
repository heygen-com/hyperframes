import { describe, expect, it } from "vitest";
import { buildFadeFilters, buildTrackInputFilter, parseAudioElements } from "./audioMixer.js";

describe("parseAudioElements — clip-edge fades", () => {
  it("reads data-fade-in / data-fade-out in seconds and omits them when absent", () => {
    const [faded, plain] = parseAudioElements(
      `<div data-composition-id="root" data-start="0" data-duration="10">
         <audio id="bed" src="bed.wav" data-start="0" data-duration="10" data-fade-in="0.5" data-fade-out="2"></audio>
         <audio id="hit" src="hit.wav" data-start="1" data-duration="1"></audio>
       </div>`,
    );
    expect(faded).toMatchObject({ id: "bed", fadeIn: 0.5, fadeOut: 2 });
    expect(plain).not.toHaveProperty("fadeIn");
    expect(plain).not.toHaveProperty("fadeOut");
  });

  it("treats a negative or unreadable fade as none", () => {
    const [el] = parseAudioElements(
      `<div data-composition-id="root" data-start="0" data-duration="10">
         <audio id="bed" src="bed.wav" data-start="0" data-duration="10" data-fade-in="-1" data-fade-out="soon"></audio>
       </div>`,
    );
    expect(el).not.toHaveProperty("fadeIn");
    expect(el).not.toHaveProperty("fadeOut");
  });
});

describe("buildFadeFilters", () => {
  it("is empty for a track without fades", () => {
    expect(buildFadeFilters({ start: 0, end: 10 })).toBe("");
  });

  it("emits afade in and out in the track's own stream time, ready to append after volume", () => {
    expect(buildFadeFilters({ start: 3, end: 13, fadeIn: 0.5, fadeOut: 2 })).toBe(
      ",afade=t=in:st=0:d=0.5,afade=t=out:st=8:d=2",
    );
    expect(buildFadeFilters({ start: 0, end: 10, fadeOut: 1 })).toBe(",afade=t=out:st=9:d=1");
    expect(buildFadeFilters({ start: 0, end: 10, fadeIn: 1 })).toBe(",afade=t=in:st=0:d=1");
  });

  it("scales fades that outrun the clip so they meet inside it, matching the preview", () => {
    // 4 s clip asked for 4 s in + 4 s out: each becomes 2 s and the fade-out starts at 2.
    expect(buildFadeFilters({ start: 0, end: 4, fadeIn: 4, fadeOut: 4 })).toBe(
      ",afade=t=in:st=0:d=2,afade=t=out:st=2:d=2",
    );
  });

  it("keeps fade-out anchored to the clip end after a trim", () => {
    expect(buildFadeFilters({ start: 2, end: 12, fadeOut: 3 })).toBe(",afade=t=out:st=7:d=3");
    expect(buildFadeFilters({ start: 2, end: 8, fadeOut: 3 })).toBe(",afade=t=out:st=3:d=3");
  });
});

describe("buildTrackInputFilter", () => {
  it("appends afade after the volume filter on the chain master and group mixes share", () => {
    const filter = buildTrackInputFilter(
      { start: 0, end: 10, fadeIn: 1, fadeOut: 2 },
      0,
      "volume=0.5",
      20,
    );
    expect(filter.indexOf("volume=0.5")).toBeGreaterThanOrEqual(0);
    expect(filter.indexOf("volume=0.5")).toBeLessThan(filter.indexOf("afade="));
    expect(filter).toContain("volume=0.5,afade=t=in:st=0:d=1,afade=t=out:st=8:d=2");
  });
});
