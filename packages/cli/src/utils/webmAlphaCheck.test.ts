import { describe, expect, it } from "vitest";
import { webmAlphaAdvisory } from "./webmAlphaCheck.js";

describe("webmAlphaAdvisory", () => {
  it("warns when a probed webm lacks the ALPHA_MODE sidecar tag", () => {
    // A build that dropped the alpha sidecar: ffprobe reported a stream but no
    // ALPHA_MODE=1 tag. (pix_fmt is irrelevant — libvpx-vp9 always reports
    // yuv420p; the sidecar tag is the real signal.)
    const msg = webmAlphaAdvisory("webm", { probed: true, alphaMode: false });
    expect(msg).toBeDefined();
    expect(msg).toContain("ALPHA_MODE");
    expect(msg).toContain("--format mov");
  });

  it("stays SILENT when the webm carries ALPHA_MODE=1 (working transparent WebM)", () => {
    // Regression guard for the #2044 R1 blocker: a correct transparent WebM
    // reports pix_fmt=yuv420p BUT ALPHA_MODE=1 — it must NOT warn.
    expect(webmAlphaAdvisory("webm", { probed: true, alphaMode: true })).toBeUndefined();
  });

  it("stays silent when the output could not be probed", () => {
    expect(webmAlphaAdvisory("webm", { probed: false, alphaMode: false })).toBeUndefined();
  });

  it("stays silent for non-webm formats (mp4 opaque; mov carries alpha natively)", () => {
    expect(webmAlphaAdvisory("mp4", { probed: true, alphaMode: false })).toBeUndefined();
    expect(webmAlphaAdvisory("mov", { probed: true, alphaMode: false })).toBeUndefined();
  });
});
