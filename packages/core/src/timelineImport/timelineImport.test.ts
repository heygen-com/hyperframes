import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../lint";
import {
  emitTimelineComposition,
  parseTimelineImport,
  TIMELINE_IMPORT_SCHEMA,
  type ImportTimeline,
} from "./index";

const base = {
  schema: TIMELINE_IMPORT_SCHEMA,
  fps: { num: 30000, den: 1001 },
  width: 1920,
  height: 1080,
  clips: [
    { id: "v1", kind: "video", start: 0, duration: 4, src: "media/a.mp4", mediaStart: 2.5 },
    {
      id: "v2",
      kind: "video",
      start: 4,
      duration: 3,
      src: "media/b.mp4",
      playbackRate: 2,
      hasAudio: true,
    },
    { id: "still 1", kind: "image", start: 7, duration: 2, src: "media/c.png", label: "Title" },
    {
      id: "a1",
      kind: "audio",
      start: 0,
      duration: 9,
      src: "media/m.wav",
      volume: 0.5,
      trackIndex: 2,
    },
  ],
};

function parsed(input: unknown): ImportTimeline {
  const result = parseTimelineImport(input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("parseTimelineImport", () => {
  it("fills defaults and derives end and duration", () => {
    const tl = parsed(base);
    expect(tl.duration).toBe(9);
    expect(tl.clips[0]).toMatchObject({ end: 4, trackIndex: 0, volume: null, hasAudio: false });
    expect(tl.transitions).toEqual([]);
  });

  it.each([
    [{ ...base, schema: "hyperframes-timeline/2" }, "unsupported schema"],
    [{ ...base, fps: { num: 24, den: 0 } }, "fps"],
    [{ ...base, clips: [] }, "clips"],
    [{ ...base, clips: [{ ...base.clips[0], duration: 0 }] }, "duration"],
    [{ ...base, clips: [{ ...base.clips[0], kind: "text" }] }, "kind"],
    [{ ...base, clips: [base.clips[0], base.clips[0]] }, "duplicate clip id"],
    [null, "JSON object"],
  ])("rejects bad input (%#)", (input, message) => {
    const result = parseTimelineImport(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});

describe("emitTimelineComposition", () => {
  it("maps trims, rates, volume and NTSC fps to composition attributes", () => {
    const { html } = emitTimelineComposition(parsed(base));
    expect(html).toContain('data-fps="30000/1001"');
    expect(html).toContain('data-duration="9"');
    expect(html).toContain('data-media-start="2.5"');
    expect(html).toContain('data-playback-rate="2"');
    expect(html).toContain('data-volume="0.5"');
    expect(html).toContain('id="still-1"');
    expect(html).toMatch(/<video id="v1" class="clip"[^>]* muted /);
    expect(html).toMatch(/<video id="v2"[^>]*data-has-audio="true"/);
  });

  it("marks a still as deliberately still, and nothing else", () => {
    const { html } = emitTimelineComposition(parsed(base));
    expect(html).toMatch(/<img id="still-1"[^>]* data-hold /);
    expect(html.match(/data-hold/g)).toHaveLength(1);
    expect(html).not.toMatch(/<(video|audio) [^>]*data-hold/);
  });

  describe("ids", () => {
    const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

    it("never repeats the composition's own id, however a clip is named", () => {
      const tl = parsed({
        ...base,
        clips: [
          { id: "root", kind: "video", start: 0, duration: 2, src: "media/a.mp4" },
          { id: "layer", kind: "video", start: 0, duration: 2, src: "media/b.mp4", trackIndex: 1 },
        ],
        transitions: [{ from: null, to: "root", inOffset: 0, outOffset: 1, kind: "dissolve" }],
      });
      const { html } = emitTimelineComposition(tl);
      const all = ids(html);
      expect(all.filter((id) => id === "root")).toEqual(["root"]); // the container, once
      expect(new Set(all).size).toBe(all.length);
      expect(all).toContain("root-2");
      // The fade is aimed at the clip, not at the container that holds every layer.
      expect(html).toContain('tl.fromTo("#root-2"');
      expect(html).not.toContain('tl.fromTo("#root"');
    });

    it("trims hyphens from either end of a clip's id", () => {
      const tl = parsed({
        ...base,
        clips: [{ id: "--shot 7--", kind: "video", start: 0, duration: 2, src: "media/a.mp4" }],
      });
      expect(ids(emitTimelineComposition(tl).html)).toContain("shot-7");
    });

    it("cleans an id made of a very long run of hyphens in linear time", () => {
      const id = `${"-".repeat(200_000)}x${"-".repeat(200_000)}!`;
      const tl = parsed({
        ...base,
        clips: [{ id, kind: "video", start: 0, duration: 2, src: "media/a.mp4" }],
      });
      const began = performance.now();
      const all = ids(emitTimelineComposition(tl).html);
      expect(performance.now() - began).toBeLessThan(1000);
      expect(all).toContain("x");
    });

    it("keeps clips apart that differ only in what is not allowed in an id", () => {
      const tl = parsed({
        ...base,
        clips: [
          { id: "a b", kind: "video", start: 0, duration: 1, src: "media/a.mp4" },
          { id: "a-b", kind: "video", start: 1, duration: 1, src: "media/b.mp4" },
          { id: "a!b", kind: "video", start: 2, duration: 1, src: "media/c.mp4" },
        ],
      });
      const all = ids(emitTimelineComposition(tl).html);
      expect(new Set(all).size).toBe(all.length);
    });
  });

  it("rewrites src through srcFor and escapes attribute values", () => {
    const tl = parsed({
      ...base,
      clips: [{ id: "x", kind: "image", start: 0, duration: 1, src: "a.png", label: 'a"<b' }],
    });
    const { html } = emitTimelineComposition(tl, { srcFor: (c) => `assets/${c.src}` });
    expect(html).toContain('src="assets/a.png"');
    expect(html).toContain('alt="a&quot;&lt;b"');
  });

  it("passes the composition linter with no errors", async () => {
    const { html } = emitTimelineComposition(parsed(base), {
      srcFor: (c) => `assets/${c.src.split("/").pop()}`,
    });
    const result = await lintHyperframeHtml(html);
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});

describe("image sequence clips", () => {
  const seq = {
    rate: 24,
    images: ["file:///show/img.0001.png", "file:///show/img.0001.png", "file:///show/img.0002.png"],
  };
  const clip = (extra: Record<string, unknown>) => ({
    id: "s",
    kind: "video",
    start: 0,
    duration: 2,
    src: "file:///show/img.0001.png",
    ...extra,
  });
  const parse = (c: unknown) => parseTimelineImport({ ...base, clips: [c] });

  it("parses a sequence as a rate and a list of images, in order", () => {
    const ok = parse(clip({ sequence: seq }));
    expect(ok.ok && ok.value.clips[0].sequence).toEqual(seq);
  });

  it("is null when absent", () => {
    const ok = parse(clip({}));
    expect(ok.ok && ok.value.clips[0].sequence).toBeNull();
  });

  it.each([
    [{ ...seq, rate: 0 }, "rate"],
    [{ ...seq, rate: "24" }, "rate"],
    [{ rate: 24 }, "images"],
    [{ ...seq, images: [] }, "images"],
    [{ ...seq, images: "a.png" }, "images"],
    [{ ...seq, images: ["a.png", 3] }, "images"],
    [{ ...seq, images: ["a.png", ""] }, "images"],
    ["nope", "not an object"],
  ])("rejects a bad sequence (%#)", (sequence, message) => {
    const result = parse(clip({ sequence }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it("only applies to video clips", () => {
    const result = parse(clip({ kind: "audio", sequence: seq }));
    expect(result.ok).toBe(false);
  });
});
