import { describe, expect, it } from "vitest";
import { originFromProbe, timecodeSeconds, timeReferenceSeconds } from "./initTimelineOrigin.js";

describe("timecodeSeconds", () => {
  it("counts non-drop timecode at the real rate", () => {
    expect(timecodeSeconds("00:00:41:18", 24)).toBe(41.75); // the ALab clip: 1002 frames
    expect(timecodeSeconds("01:00:00:00", 24)).toBe(3600);
    expect(timecodeSeconds("00:00:00:12", 25)).toBe(0.48);
  });

  it("keeps NTSC timecode on the real clock, which is why an hour of it is 3603.6 s", () => {
    expect(timecodeSeconds("01:00:00:00", 30000 / 1001)).toBeCloseTo(3603.6, 3);
    expect(timecodeSeconds("00:00:01:00", 24000 / 1001)).toBeCloseTo((24 * 1001) / 24000, 9);
  });

  it("takes dropped labels back out of drop-frame timecode", () => {
    const fps = 30000 / 1001;
    // Drop-frame keeps the label on the wall clock: one hour of labels is one hour, within a frame.
    expect(timecodeSeconds("01:00:00;00", fps)).toBeCloseTo(3600, 1);
    // The labels 00:01:00;00 and 00:01:00;01 do not exist, so 00:01:00;02 is frame 1800.
    expect(timecodeSeconds("00:01:00;02", fps)).toBeCloseTo(1800 / fps, 9);
    // Every tenth minute keeps all its labels.
    expect(timecodeSeconds("00:10:00;00", fps)).toBeCloseTo(17982 / fps, 9);
    // 59.94 drops four.
    expect(timecodeSeconds("00:01:00;04", 60000 / 1001)).toBeCloseTo(3600 / (60000 / 1001), 9);
  });

  it("reads a drop-frame mark on a rate that does not drop as plain timecode", () => {
    expect(timecodeSeconds("00:01:00;00", 24)).toBe(60);
  });

  it.each(["", "41:18", "00:00:41", "ab:cd:ef:gh", "00:00:41:", "-1:00:00:00"])(
    "refuses %j",
    (text) => {
      expect(timecodeSeconds(text, 24)).toBeNull();
    },
  );

  it("refuses a rate that is not positive", () => {
    expect(timecodeSeconds("00:00:01:00", 0)).toBeNull();
    expect(timecodeSeconds("00:00:01:00", Number.NaN)).toBeNull();
  });
});

describe("timeReferenceSeconds", () => {
  it("turns BWF samples since midnight into seconds", () => {
    expect(timeReferenceSeconds("172800000", 48000)).toBe(3600); // the ALab WAVs: one hour
    expect(timeReferenceSeconds("0", 48000)).toBe(0);
  });

  it("refuses what is not a count or a rate", () => {
    expect(timeReferenceSeconds("soon", 48000)).toBeNull();
    expect(timeReferenceSeconds("-5", 48000)).toBeNull();
    expect(timeReferenceSeconds("100", 0)).toBeNull();
  });
});

describe("originFromProbe", () => {
  const video = { codec_type: "video", r_frame_rate: "24/1", avg_frame_rate: "24/1" };

  it("reads a video's timecode from the container's tags (the ALab clips)", () => {
    const probe = originFromProbe({
      streams: [video],
      format: { duration: "2.166667", tags: { timecode: "00:00:41:18" } },
    });
    expect(probe).toEqual({ timecode: 41.75, timeReference: null, duration: 2.166667 });
  });

  it("falls back to a stream's timecode, using the video's frame rate", () => {
    const probe = originFromProbe({
      streams: [
        video,
        { codec_type: "data", r_frame_rate: "0/0", tags: { timecode: "00:00:41:18" } },
      ],
      format: { duration: "2" },
    });
    expect(probe.timecode).toBe(41.75);
  });

  it("matches the tag name whatever its case", () => {
    const probe = originFromProbe({
      streams: [video],
      format: { duration: "2", tags: { TIMECODE: "00:00:01:00" } },
    });
    expect(probe.timecode).toBe(1);
  });

  it("reads a WAV's time reference with its sample rate (the ALab WAVs)", () => {
    const probe = originFromProbe({
      streams: [{ codec_type: "audio", sample_rate: "48000" }],
      format: { duration: "103.5", tags: { time_reference: "172800000" } },
    });
    expect(probe).toEqual({ timecode: null, timeReference: 3600, duration: 103.5 });
  });

  it("reports no origin for a file that carries none (the Picchu audio)", () => {
    const probe = originFromProbe({
      streams: [{ codec_type: "audio", sample_rate: "48000" }],
      format: { duration: "4047.12", tags: {} },
    });
    expect(probe).toEqual({ timecode: null, timeReference: null, duration: 4047.12 });
  });

  it("ignores a timecode it has no frame rate to read", () => {
    const probe = originFromProbe({
      streams: [{ codec_type: "data", tags: { timecode: "00:00:41:18" } }],
      format: { duration: "2" },
    });
    expect(probe.timecode).toBeNull();
  });

  it("leaves the length undefined when ffprobe gives none", () => {
    expect(originFromProbe({ streams: [video], format: {} }).duration).toBeUndefined();
    expect(originFromProbe({}).duration).toBeUndefined();
  });
});
