import { describe, expect, it } from "vitest";
import { buildRmsEnvelope, compareAudioEnvelopes } from "./audioRegression.js";

describe("compareAudioEnvelopes", () => {
  it("treats silent-vs-silent audio as a perfect match", () => {
    const silentSamples = new Int16Array(4096);

    const rendered = buildRmsEnvelope(silentSamples);
    const snapshot = buildRmsEnvelope(silentSamples);

    expect(compareAudioEnvelopes(rendered, snapshot, 120)).toEqual({
      correlation: 1,
      lagWindows: 0,
    });
  });
});
