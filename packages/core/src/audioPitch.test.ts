import { describe, expect, it } from "vitest";
import { atPitchRate, pitchTrack, voicedShare, PITCH_RATE } from "./audioPitch";

const tone = (rate: number, seconds = 1, gain = 0.5) =>
  Float32Array.from(
    { length: Math.floor(rate * seconds) },
    (_, i) => gain * Math.sin((2 * Math.PI * 200 * i) / rate),
  );

describe("voice pitch evidence", () => {
  it.each([8000, 16000, 22050, 44100, 48000, 96000])(
    "keeps pitch and voiced share at %s Hz, in mono and duplicated stereo",
    (rate) => {
      const channel = tone(rate);
      const mono = atPitchRate([channel], rate);
      expect(mono).toHaveLength(PITCH_RATE);
      expect(atPitchRate([channel, channel], rate)).toEqual(mono);
      const track = pitchTrack(mono);
      expect(track).toHaveLength(24);
      expect(track[0]).toEqual({ t: 0.02, hz: 200 });
      expect(track.every(({ hz }) => hz === 200)).toBe(true);
      expect(voicedShare([channel], rate)).toBe(24 / 25);
    },
  );

  it("keeps voiced evidence when stereo channels have opposite polarity", () => {
    const channel = tone(48000);
    const reversed = Float32Array.from(channel, (value) => -value);
    expect(voicedShare([channel, reversed], 48000)).toBe(voicedShare([channel], 48000));
  });

  it("has no evidence for empty, silent, too-short or below-gate signals", () => {
    expect(voicedShare([], 48000)).toBe(0);
    expect(voicedShare([new Float32Array(48000)], 48000)).toBe(0);
    expect(voicedShare([tone(8000, 0.04)], 8000)).toBe(0);
    expect(voicedShare([tone(8000, 1, 0.001)], 8000)).toBe(0);
    expect(pitchTrack(tone(8000, 435 / 8000))).toHaveLength(1);
  });
});
