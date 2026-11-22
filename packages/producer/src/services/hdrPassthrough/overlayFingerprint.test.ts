import { describe, expect, it } from "bun:test";
import type { ElementStackingInfo } from "@hyperframes/engine";
import { overlayFingerprintKey, stackingFingerprint } from "./overlayFingerprint.js";

function entry(id: string, overrides: Partial<ElementStackingInfo> = {}): ElementStackingInfo {
  return {
    id,
    zIndex: 0,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    layoutWidth: 10,
    layoutHeight: 10,
    opacity: 1,
    visible: true,
    renderFrameVisible: false,
    isHdr: false,
    transform: "none",
    borderRadius: [0, 0, 0, 0],
    objectFit: "fill",
    objectPosition: "50% 50%",
    clipRect: null,
    ...overrides,
  };
}

describe("stackingFingerprint", () => {
  it("leaves out the passthrough video's own entry", () => {
    const shown = [entry("video", { isHdr: true, renderFrameVisible: true }), entry("cue")];
    const hidden = [entry("video", { isHdr: true, renderFrameVisible: false }), entry("cue")];
    expect(stackingFingerprint(shown, "video")).toBe(stackingFingerprint(hidden, "video"));
  });

  it("changes with any overlay entry's box, opacity or visibility", () => {
    const base = stackingFingerprint([entry("video"), entry("cue")], "video");
    for (const change of [{ x: 1 }, { opacity: 0.99 }, { visible: false }, { zIndex: 2 }]) {
      expect(stackingFingerprint([entry("video"), entry("cue", change)], "video")).not.toBe(base);
    }
  });
});

describe("overlayFingerprintKey", () => {
  it("is a sha256 that separates page states, stackings and kinds", () => {
    const key = overlayFingerprintKey({ kind: "digest", value: "ab" }, "[]");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(overlayFingerprintKey({ kind: "digest", value: "ab" }, "[]")).toBe(key);
    expect(overlayFingerprintKey({ kind: "text", value: "ab" }, "[]")).not.toBe(key);
    expect(overlayFingerprintKey({ kind: "digest", value: "ac" }, "[]")).not.toBe(key);
    expect(overlayFingerprintKey({ kind: "digest", value: "ab" }, "[1]")).not.toBe(key);
    // The separator keeps a shifted boundary between the two parts from colliding.
    expect(overlayFingerprintKey({ kind: "digest", value: "a" }, "b[]")).not.toBe(
      overlayFingerprintKey({ kind: "digest", value: "ab" }, "[]"),
    );
  });
});
