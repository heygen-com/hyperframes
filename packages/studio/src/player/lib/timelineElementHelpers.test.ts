import { describe, expect, it } from "vitest";
import { isVideoAudible } from "./timelineElementHelpers";

describe("isVideoAudible — the compiler's data-has-audio rule", () => {
  it("explicit data-has-audio wins", () => {
    expect(isVideoAudible({ tag: "video", hasAudioAttr: "true", muted: false })).toBe(true);
    expect(isVideoAudible({ tag: "video", hasAudioAttr: "false", muted: false })).toBe(false);
  });
  it("no attribute: an unmuted video is audible, a muted one is not", () => {
    expect(isVideoAudible({ tag: "video", hasAudioAttr: null, muted: false })).toBe(true);
    expect(isVideoAudible({ tag: "video", hasAudioAttr: undefined, muted: true })).toBe(false);
  });
  it("never true for non-video without the attribute", () => {
    expect(isVideoAudible({ tag: "img", hasAudioAttr: null, muted: false })).toBe(false);
  });
});
