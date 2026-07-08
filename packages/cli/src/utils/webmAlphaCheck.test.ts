import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.fn();
const findFFprobe = vi.fn();
const trackWebmAlphaDropped = vi.fn();

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSync(...args),
}));

vi.mock("../browser/ffmpeg.js", () => ({
  findFFprobe: () => findFFprobe(),
}));

vi.mock("../telemetry/events.js", () => ({
  trackWebmAlphaDropped: () => trackWebmAlphaDropped(),
}));

const { webmAlphaAdvisory, warnIfWebmAlphaDropped } = await import("./webmAlphaCheck.js");

beforeEach(() => {
  execFileSync.mockReset();
  findFFprobe.mockReset();
  trackWebmAlphaDropped.mockReset();
});

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

describe("warnIfWebmAlphaDropped", () => {
  it("tracks telemetry when a completed WebM lost alpha", () => {
    findFFprobe.mockReturnValue("/usr/bin/ffprobe");
    execFileSync.mockReturnValue(JSON.stringify({ streams: [{ codec_name: "vp9", tags: {} }] }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      warnIfWebmAlphaDropped("out.webm", "webm", false);
    } finally {
      warn.mockRestore();
    }

    expect(trackWebmAlphaDropped).toHaveBeenCalledTimes(1);
  });

  it("does not track telemetry when quiet or not rendering WebM", () => {
    warnIfWebmAlphaDropped("out.webm", "webm", true);
    warnIfWebmAlphaDropped("out.mp4", "mp4", false);

    expect(trackWebmAlphaDropped).not.toHaveBeenCalled();
    expect(findFFprobe).not.toHaveBeenCalled();
  });
});
