import { describe, expect, it } from "vitest";
import { timelineElementsChanged } from "./timelinePlayerSync";

describe("timelineElementsChanged", () => {
  const clip = { id: "v", tag: "video", start: 0, duration: 4, track: 1 };
  it.each([
    ["muted", { muted: true }],
    ["sound", { hasAudio: true }],
    ["volume", { volume: 0 }],
    ["speed", { playbackRate: 2 }],
    ["hidden", { hidden: true }],
    ["audio group volume", { audioGroupVolume: 0 }],
    ["audio group hidden", { audioGroupHidden: true }],
    ["fade in", { fadeIn: 1 }],
    ["fade out", { fadeOut: 1 }],
    ["source (re-pointed at its preview copy)", { src: "clip1.mp4?hf-proxy=h264" }],
  ])("sees a clip whose %s changed with no timing change", (_name, change) => {
    expect(timelineElementsChanged([clip], [{ ...clip, ...change }])).toBe(true);
    expect(timelineElementsChanged([{ ...clip, ...change }], [{ ...clip, ...change }])).toBe(false);
  });
});
