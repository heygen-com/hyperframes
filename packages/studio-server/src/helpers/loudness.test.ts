import { describe, expect, it } from "vitest";
import {
  absoluteLoudnessPlan,
  audioTags,
  loudnessMeasureArgs,
  updateAudioVolume,
} from "./loudness.js";

const track = (integratedLufs: number, truePeakDbfs: number, volume = 1) => ({
  id: "vo",
  volume,
  integratedLufs,
  truePeakDbfs,
});

describe("audioTags with video", () => {
  it("includes a video with sound as a normalizable clip", () => {
    const html = `<video id="a-roll" src="talk.mp4" data-has-audio="true" data-duration="4"></video>`;
    expect(audioTags(html)).toEqual([
      expect.objectContaining({ tag: "video", id: "a-roll", src: "talk.mp4", duration: 4 }),
    ]);
  });

  it("includes an unmuted video that does not declare data-has-audio", () => {
    expect(audioTags(`<video id="v" src="v.mp4"></video>`).map((t) => t.id)).toEqual(["v"]);
  });

  it.each([
    `<video id="b-roll" src="b.mp4" muted></video>`,
    `<video id="b-roll" src="b.mp4" muted data-start="0"></video>`,
    `<video id="b-roll" src="b.mp4" muted=""></video>`,
    `<video id="b-roll" src="b.mp4" data-has-audio="false"></video>`,
    `<video id="b-roll" src="b.mp4" data-has-audio=""></video>`,
  ])("skips a silent video without throwing: %s", (html) => {
    expect(audioTags(html)).toEqual([]);
  });

  it("does not read muted out of another attribute's value", () => {
    const html = `<video id="v" src="v.mp4" title="be muted later"></video>`;
    expect(audioTags(html).map((t) => t.id)).toEqual(["v"]);
  });

  it("skips a video it could not address instead of failing the run", () => {
    const html = `<video src="v.mp4"></video><audio id="music" src="m.mp3"></audio>`;
    expect(audioTags(html).map((t) => t.id)).toEqual(["music"]);
  });

  it("still requires an id on every audio element", () => {
    expect(() => audioTags(`<audio src="m.mp3"></audio>`)).toThrow(/needs an id/);
  });

  it("rejects an id shared by an audio and a video", () => {
    const html = `<audio id="x" src="a.mp3"></audio><video id="x" src="v.mp4"></video>`;
    expect(() => audioTags(html)).toThrow(/duplicate/i);
  });

  it("writes data-volume on the video tag", () => {
    const html = `<video id="a-roll" src="talk.mp4" data-has-audio="true"></video>`;
    expect(updateAudioVolume(html, "a-roll", 2)).toBe(
      `<video id="a-roll" src="talk.mp4" data-has-audio="true" data-volume="2"></video>`,
    );
  });
});

describe("loudnessMeasureArgs with a playback rate", () => {
  it("measures the source span a sped-up clip actually plays", () => {
    const args = loudnessMeasureArgs("clip.mp4", { mediaStart: 0, duration: 4, playbackRate: 2 });
    expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", "8"]);
  });

  it("reads data-playback-rate from the tag", () => {
    const html = `<audio id="a" src="a.wav" data-duration="3" data-playback-rate="0.5"></audio>`;
    expect(audioTags(html)[0]).toEqual(expect.objectContaining({ playbackRate: 0.5 }));
  });
});

describe("absoluteLoudnessPlan", () => {
  it("targets -16 LUFS by default", () => {
    const plan = absoluteLoudnessPlan(track(-19.2, -8));
    expect(plan.gainDb).toBeCloseTo(3.2, 6);
    expect(plan.projectedLufs).toBeCloseTo(-16, 6);
    expect(plan.volume).toBeCloseTo(10 ** (3.2 / 20), 6);
    expect(plan.limitedBy).toBeNull();
  });

  it("reports the change relative to the clip's current gain", () => {
    const plan = absoluteLoudnessPlan(track(-16, -6, 2));
    expect(plan.gainDb).toBeCloseTo(0, 6);
    expect(plan.changeDb).toBeCloseTo(-6.0206, 3);
  });

  it("stops at the +12 dB ceiling and says so", () => {
    const plan = absoluteLoudnessPlan(track(-40, -30));
    expect(plan.gainDb).toBeCloseTo(12, 6);
    expect(plan.limitedBy).toBe("gain-ceiling");
  });

  it("stops short of -1.5 dBTP and says so", () => {
    const plan = absoluteLoudnessPlan(track(-22, -3));
    expect(plan.gainDb).toBeCloseTo(1.5, 6);
    expect(plan.projectedTruePeakDbfs).toBeCloseTo(-1.5, 6);
    expect(plan.limitedBy).toBe("true-peak");
  });

  it("attenuates a clip that is too loud", () => {
    const plan = absoluteLoudnessPlan(track(-10, 0));
    expect(plan.gainDb).toBeCloseTo(-6, 6);
    expect(plan.limitedBy).toBeNull();
  });

  it("refuses a silent window", () => {
    expect(() => absoluteLoudnessPlan(track(-70, -90))).toThrow(/silent/);
  });

  it("treats a muted clip's change as the applied gain", () => {
    expect(absoluteLoudnessPlan(track(-19, -10, 0)).changeDb).toBeCloseTo(3, 6);
  });
});
