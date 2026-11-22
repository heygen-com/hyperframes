import { describe, expect, it } from "bun:test";
import {
  FIXTURE_FPS,
  INELIGIBLE_CASES,
  STREAM_OFFSET_SECONDS,
  buildAnimatedImageArgs,
  buildCaptionCues,
  buildCompositionHtml,
  buildSourceClipArgs,
  buildStreamOffsetArgs,
  isFixtureTransfer,
} from "./fixture.js";

function argAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe("buildSourceClipArgs", () => {
  const args = buildSourceClipArgs({
    outputPath: "/tmp/out.mp4",
    durationSec: 20,
    width: 1920,
    height: 1080,
    fps: 30,
    crf: 12,
  });

  it("encodes 10-bit HEVC Main10 tagged as BT.2020 HLG at container and VUI level", () => {
    expect(argAfter(args, "-c:v")).toBe("libx265");
    expect(argAfter(args, "-pix_fmt")).toBe("yuv420p10le");
    expect(argAfter(args, "-profile:v")).toBe("main10");
    expect(argAfter(args, "-color_primaries")).toBe("bt2020");
    expect(argAfter(args, "-color_trc")).toBe("arib-std-b67");
    expect(argAfter(args, "-colorspace")).toBe("bt2020nc");
    expect(argAfter(args, "-x265-params")).toContain("transfer=arib-std-b67");
    expect(argAfter(args, "-x265-params")).toContain("colorprim=bt2020");
    expect(argAfter(args, "-tag:v")).toBe("hvc1");
  });

  it("adds no HDR10 static metadata to the HLG clip", () => {
    expect(argAfter(args, "-x265-params")).not.toContain("master-display");
    expect(argAfter(args, "-x265-params")).not.toContain("max-cll");
  });

  it("generates motion + gradients at the requested size and rate, with audio", () => {
    const graph = argAfter(args, "-filter_complex") ?? "";
    expect(graph).toContain("gradients=size=1920x1080:rate=30");
    expect(graph).toContain("testsrc2=size=960x540:rate=30");
    expect(graph).toContain("sine=");
    expect(argAfter(args, "-c:a")).toBe("aac");
    expect(argAfter(args, "-t")).toBe("20");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });
});

describe("buildSourceClipArgs with transfer pq", () => {
  const args = buildSourceClipArgs({
    outputPath: "/tmp/pq.mp4",
    durationSec: 20,
    width: 1920,
    height: 1080,
    fps: 30,
    crf: 12,
    transfer: "pq",
  });

  it("tags SMPTE ST 2084 at container and VUI level and writes HDR10 static metadata", () => {
    expect(argAfter(args, "-color_trc")).toBe("smpte2084");
    expect(argAfter(args, "-color_primaries")).toBe("bt2020");
    expect(argAfter(args, "-colorspace")).toBe("bt2020nc");
    const x265 = argAfter(args, "-x265-params") ?? "";
    expect(x265).toContain("transfer=smpte2084");
    expect(x265).not.toContain("arib-std-b67");
    expect(x265).toContain("master-display=G(8500,39850)");
    expect(x265).toContain("max-cll=1000,400");
    expect(x265.endsWith("log-level=error")).toBe(true);
  });

  it("accepts only hlg and pq", () => {
    expect(isFixtureTransfer("hlg")).toBe(true);
    expect(isFixtureTransfer("pq")).toBe(true);
    expect(isFixtureTransfer("sdr")).toBe(false);
  });
});

describe("buildCaptionCues", () => {
  it("makes 10 frame-aligned, non-overlapping cues with gaps for the 20 s fixture", () => {
    const cues = buildCaptionCues(20, 10, FIXTURE_FPS);
    expect(cues).toHaveLength(10);
    let previousEnd = 0;
    for (const cue of cues) {
      const startFrames = cue.startSec * FIXTURE_FPS;
      const endFrames = (cue.startSec + cue.durationSec) * FIXTURE_FPS;
      expect(Math.abs(startFrames - Math.round(startFrames))).toBeLessThan(1e-6);
      expect(Math.abs(endFrames - Math.round(endFrames))).toBeLessThan(1e-4);
      expect(cue.startSec).toBeGreaterThan(previousEnd);
      expect(cue.durationSec).toBeGreaterThan(0);
      previousEnd = cue.startSec + cue.durationSec;
    }
    expect(previousEnd).toBeLessThan(20);
    expect(new Set(cues.map((cue) => cue.id)).size).toBe(10);
  });

  it("rejects bad input", () => {
    expect(() => buildCaptionCues(1, 3, 30)).toThrow();
    expect(() => buildCaptionCues(20, 0, 30)).toThrow();
  });
});

describe("buildCompositionHtml", () => {
  const cues = buildCaptionCues(20, 10, FIXTURE_FPS);
  const base = {
    compositionId: "hdr-passthrough-captions",
    videoSrc: "assets/hlg-source.mp4",
    durationSec: 20,
    width: 1920,
    height: 1080,
    cues,
  };

  it("puts the video full-bleed on track 0 and every cue on track 1", () => {
    const html = buildCompositionHtml(base);
    expect(html).toContain('data-composition-id="hdr-passthrough-captions"');
    expect(html).toMatch(/<video[^>]*id="hdr-source"[^>]*data-track-index="0"/s);
    expect(html).toContain('data-duration="20"');
    expect(html.match(/class="clip caption"/g)).toHaveLength(10);
    expect(html.match(/data-track-index="1"/g)).toHaveLength(10);
    expect(html).toContain("rgba(12, 14, 20, 0.58)");
    expect(html).not.toContain("transform:");
    expect(html).not.toContain("<script");
  });

  it("adds the transform only on the negative fixture", () => {
    const html = buildCompositionHtml({
      ...base,
      videoStyle: "transform: scale(0.9) rotate(1.5deg)",
    });
    expect(html).toContain('style="transform: scale(0.9) rotate(1.5deg)"');
  });

  it("has no wrapper, extra overlay or timeline unless asked", () => {
    const html = buildCompositionHtml(base);
    expect(html).toContain("data-no-timeline");
    expect(html).not.toContain('id="hdr-frame"');
    expect(html).not.toContain('id="extra-overlay"');
    expect(html).not.toContain("gsap");
  });

  it("wraps the video, adds a track-2 overlay and registers a GSAP timeline on request", () => {
    const html = buildCompositionHtml({
      ...base,
      videoWrapperStyle: "position:absolute;inset:0;overflow:hidden;border-radius:48px",
      headHtml: "<style>.x{}</style>",
      overlayHtml: '<div id="spinner"></div>',
      timelineScript: 'tl.to("#spinner", { rotation: 360, duration: 2 }, 0);',
    });
    expect(html).toMatch(/<div id="hdr-frame" style="[^"]*border-radius:48px">\s*<video/s);
    expect(html).toContain('<script src="assets/gsap.min.js"></script>');
    expect(html).toContain("<style>.x{}</style>");
    expect(html).toMatch(
      /id="extra-overlay" class="clip"[^>]*data-track-index="2"><div id="spinner">/,
    );
    expect(html).not.toContain("data-no-timeline");
    expect(html).toContain('window.__timelines["hdr-passthrough-captions"] = tl;');
    expect(html.indexOf("gsap.min.js")).toBeLessThan(html.indexOf("gsap.timeline"));
  });

  it("escapes cue text", () => {
    const html = buildCompositionHtml({
      ...base,
      cues: [{ id: "cue-001", text: "<b>&</b>", startSec: 1, durationSec: 1 }],
    });
    expect(html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});

describe("INELIGIBLE_CASES", () => {
  it("has unique names and covers every fallback class the passthrough declines", () => {
    const names = INELIGIBLE_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const reasons = new Set(INELIGIBLE_CASES.map((c) => c.reason));
    for (const reason of [
      "not_full_canvas",
      "transform_or_filter",
      "clip_or_mask",
      "overlay_non_gsap_animation",
      "overlay_continuous_animation",
      "canvas",
      "video_count",
      "overlay_unverified",
    ]) {
      expect(reasons.has(reason)).toBe(true);
    }
    for (const name of [
      "lottie-player",
      "three",
      "webgpu",
      "svg-smil",
      "animated-gif",
      "animated-webp",
      "animated-apng",
      "animated-avif",
      "hf-seek-listener",
      "seek-time-setter",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("drives the seek-hook cases from the runtime's seek, not from GSAP", () => {
    const listener = INELIGIBLE_CASES.find((c) => c.name === "hf-seek-listener")!;
    expect(listener.composition.headHtml).toContain('addEventListener("hf-seek"');
    const setter = INELIGIBLE_CASES.find((c) => c.name === "seek-time-setter")!;
    expect(setter.composition.headHtml).toContain("__hfTypegpuTime");
    expect(setter.composition.headHtml).not.toContain("addEventListener");
    for (const c of [listener, setter]) expect(c.composition.timelineScript).toBeUndefined();
  });

  it("ships the assets each case references", () => {
    const gsap = INELIGIBLE_CASES.filter((c) => c.composition.timelineScript !== undefined);
    expect(gsap.length).toBeGreaterThan(0);
    for (const c of gsap) expect(c.assets).toContain("gsap");
    for (const c of INELIGIBLE_CASES.filter((c) => c.name.startsWith("animated-"))) {
      expect(c.assets).toHaveLength(1);
    }
  });
});

describe("buildStreamOffsetArgs", () => {
  it("remuxes every stream without re-encoding, shifted by the offset", () => {
    const args = buildStreamOffsetArgs("/in.mp4", "/out.mp4", STREAM_OFFSET_SECONDS);
    expect(argAfter(args, "-i")).toBe("/in.mp4");
    expect(argAfter(args, "-map")).toBe("0");
    expect(argAfter(args, "-c")).toBe("copy");
    expect(argAfter(args, "-output_ts_offset")).toBe("0.2");
    expect(args.at(-1)).toBe("/out.mp4");
  });

  it("stays under the lead at which the layered path hides the video", () => {
    expect(STREAM_OFFSET_SECONDS).toBeGreaterThan(0);
    expect(STREAM_OFFSET_SECONDS).toBeLessThan(1);
  });
});

describe("buildAnimatedImageArgs", () => {
  it("writes a looping 2 s animation in each format", () => {
    for (const [format, codec] of [
      ["gif", "gif"],
      ["webp", "libwebp_anim"],
      ["apng", "apng"],
      ["avif", "libaom-av1"],
    ] as const) {
      const args = buildAnimatedImageArgs(format, `/tmp/a.${format}`);
      expect(argAfter(args, "-c:v")).toBe(codec);
      expect(argAfter(args, "-i")).toContain("duration=2");
      expect(args.at(-1)).toBe(`/tmp/a.${format}`);
    }
    expect(buildAnimatedImageArgs("avif", "/tmp/a.avif").slice(-3)).toEqual([
      "-f",
      "avif",
      "/tmp/a.avif",
    ]);
    expect(argAfter(buildAnimatedImageArgs("apng", "/tmp/a.png"), "-plays")).toBe("0");
  });
});
