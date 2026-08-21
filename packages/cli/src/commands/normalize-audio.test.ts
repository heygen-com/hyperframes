import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  audioNormalizationPlan,
  audioTags,
  loudnessMeasureArgs,
  parseEbur128Summary,
  resolveLocalAudioPath,
  updateAudioVolume,
} from "./normalize-audio.js";

const PROJECT = "/tmp/example-project";

describe("audioTags", () => {
  it("reads quoted attributes without treating a quoted > as the end of the tag", () => {
    const html = `<audio id='reference' title="a > b" src="assets/ref.mp4" data-volume="1"></audio>`;
    expect(audioTags(html)).toEqual([
      expect.objectContaining({ id: "reference", src: "assets/ref.mp4", volume: 1 }),
    ]);
  });

  it("rejects duplicate ids instead of normalizing an arbitrary element", () => {
    const html = `<audio id="voice" src="a.wav"></audio><audio id="voice" src="b.wav"></audio>`;
    expect(() => audioTags(html)).toThrow(/duplicate audio id "voice"/i);
  });

  it("ignores audio-like text in comments, scripts, and styles", () => {
    const html = `
      <!-- <audio id="comment" src="comment.wav"></audio> -->
      <script>const example = '<audio id="script" src="script.wav"></audio>';</script>
      <style>.demo::after { content: '<audio id="style" src="style.wav">'; }</style>
      <audio id="real" src="real.wav"></audio>
    `;
    expect(audioTags(html).map((tag) => tag.id)).toEqual(["real"]);
  });

  it.each([
    [`<audio id="bad" src="a.wav" data-volume="loud"></audio>`, /data-volume/i],
    [`<audio id="bad" src="a.wav" data-media-start="-1"></audio>`, /data-media-start/i],
    [`<audio id="bad" src="a.wav" data-duration="0"></audio>`, /data-duration/i],
  ])("rejects an invalid authored number", (html, expected) => {
    expect(() => audioTags(html)).toThrow(expected);
  });

  it("measures only the window a data-end trim actually plays", () => {
    // `data-end` is a first-class trim the parser, the runtime and the render
    // mixer all honour. Measuring the whole source for one of these clips reads
    // a loudness the composition never plays, and `--write` then "corrects" an
    // already-matched clip by tens of dB.
    const html = `<audio id="vo" src="vo.wav" data-start="4" data-end="8"></audio>`;
    expect(audioTags(html)[0]).toEqual(expect.objectContaining({ duration: 4 }));
  });

  it("prefers an explicit data-duration over data-end", () => {
    const html = `<audio id="vo" src="vo.wav" data-start="4" data-end="8" data-duration="3"></audio>`;
    expect(audioTags(html)[0]).toEqual(expect.objectContaining({ duration: 3 }));
  });

  it("leaves an untrimmed clip unbounded", () => {
    const html = `<audio id="vo" src="vo.wav" data-start="4"></audio>`;
    expect(audioTags(html)[0]).toEqual(expect.objectContaining({ duration: null }));
  });

  it("ignores a data-end that does not outlast its start", () => {
    const html = `<audio id="vo" src="vo.wav" data-start="8" data-end="4"></audio>`;
    expect(audioTags(html)[0]).toEqual(expect.objectContaining({ duration: null }));
  });
});

describe("loudnessMeasureArgs", () => {
  it("bounds the INPUT, so the loudness filter never sees past the clip", () => {
    // `-t` after `-i` bounds the output, and `-f null` has no output worth
    // bounding: ffmpeg keeps feeding the graph and ebur128 integrates audio the
    // clip never plays. Measured on a fixture whose played window is -61.8 LUFS,
    // output-side `-t` reported -33.8.
    const args = loudnessMeasureArgs("clip.wav", { mediaStart: 2, duration: 4 });
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args.indexOf("-t")).toBeLessThan(args.indexOf("-i"));
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-i"))).toEqual(["-ss", "2", "-t", "4"]);
  });

  it("leaves an untrimmed clip unbounded", () => {
    const args = loudnessMeasureArgs("clip.wav", { mediaStart: 0, duration: null });
    expect(args).not.toContain("-ss");
    expect(args).not.toContain("-t");
  });
});

describe("resolveLocalAudioPath", () => {
  it("resolves a local source and strips query and fragment suffixes", () => {
    expect(resolveLocalAudioPath(PROJECT, "assets/voice%20one.wav?v=2#clip")).toBe(
      resolve(PROJECT, "assets/voice one.wav"),
    );
  });

  it.each(["https://cdn.example.com/a.wav", "/etc/passwd", "../outside.wav", "data:x"])(
    "rejects a non-project source: %s",
    (src) => expect(() => resolveLocalAudioPath(PROJECT, src)).toThrow(/local project file/i),
  );
});

describe("parseEbur128Summary", () => {
  it("takes the final integrated loudness and true-peak summary", () => {
    const stderr = `
[Parsed_ebur128_0] t: 1.0 I: -18.2 LUFS
[Parsed_ebur128_0] Summary:
  Integrated loudness:
    I:         -15.5 LUFS
    Threshold: -25.5 LUFS
  True peak:
    Peak:       -3.2 dBFS
`;
    expect(parseEbur128Summary(stderr)).toEqual({ integratedLufs: -15.5, truePeakDbfs: -3.2 });
  });

  it("fails when FFmpeg did not produce a usable summary", () => {
    expect(() => parseEbur128Summary("no audio stream")).toThrow(/integrated loudness/i);
  });
});

describe("audioNormalizationPlan", () => {
  it("preserves the reference and attenuates the louder target", () => {
    const plan = audioNormalizationPlan(
      { id: "target-audio", volume: 1, integratedLufs: -15.5, truePeakDbfs: -3.2 },
      { id: "user-audio", volume: 1, integratedLufs: -11.7, truePeakDbfs: -0.2 },
    );

    expect(plan.gainDb).toBeCloseTo(-3.8, 6);
    expect(plan.volume).toBeCloseTo(0.645654, 5);
    expect(plan.projectedLufs).toBeCloseTo(-15.5, 6);
    expect(plan.projectedTruePeakDbfs).toBeCloseTo(-4, 6);
  });

  it("includes the reference's authored gain in the target", () => {
    const plan = audioNormalizationPlan(
      { id: "reference", volume: 2, integratedLufs: -20, truePeakDbfs: -8 },
      { id: "target", volume: 0.5, integratedLufs: -18, truePeakDbfs: -6 },
    );

    expect(plan.referenceLufs).toBeCloseTo(-13.9794, 4);
    expect(plan.volume).toBeCloseTo(1.588656, 6);
    expect(plan.projectedLufs).toBeCloseTo(plan.referenceLufs, 6);
  });

  it("refuses a gain beyond Studio's +12 dB ceiling", () => {
    expect(() =>
      audioNormalizationPlan(
        { id: "reference", volume: 1, integratedLufs: -5, truePeakDbfs: -1 },
        { id: "target", volume: 1, integratedLufs: -30, truePeakDbfs: -30 },
      ),
    ).toThrow(/\+12 dB/i);
  });

  it("refuses a boost that would clip", () => {
    expect(() =>
      audioNormalizationPlan(
        { id: "reference", volume: 1, integratedLufs: -10, truePeakDbfs: -1 },
        { id: "target", volume: 1, integratedLufs: -15, truePeakDbfs: -2 },
      ),
    ).toThrow(/clip/i);
  });
});

describe("updateAudioVolume", () => {
  it("updates only the selected audio element and preserves surrounding source", () => {
    const html = `<!doctype html>\n<audio id="ref" src="a.wav" data-volume="1"></audio>\n<audio data-volume='1' id='target' src='b.wav'></audio>\n`;
    expect(updateAudioVolume(html, "target", 0.645654)).toBe(
      `<!doctype html>\n<audio id="ref" src="a.wav" data-volume="1"></audio>\n<audio data-volume='0.645654' id='target' src='b.wav'></audio>\n`,
    );
  });

  it("adds data-volume when it is absent", () => {
    expect(updateAudioVolume(`<audio id="target" src="b.wav" />`, "target", 2)).toBe(
      `<audio id="target" src="b.wav" data-volume="2" />`,
    );
  });
});
