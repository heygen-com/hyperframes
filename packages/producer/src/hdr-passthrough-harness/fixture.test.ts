import { describe, expect, it } from "bun:test";
import {
  FIXTURE_FPS,
  buildCaptionCues,
  buildCompositionHtml,
  buildSourceClipArgs,
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
    const html = buildCompositionHtml({ ...base, videoTransform: "scale(0.9) rotate(1.5deg)" });
    expect(html).toContain('style="transform: scale(0.9) rotate(1.5deg)"');
  });

  it("escapes cue text", () => {
    const html = buildCompositionHtml({
      ...base,
      cues: [{ id: "cue-001", text: "<b>&</b>", startSec: 1, durationSec: 1 }],
    });
    expect(html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});
