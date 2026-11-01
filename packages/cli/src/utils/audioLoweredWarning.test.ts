import { describe, expect, it } from "vitest";
import { audioLoweredWarning } from "./audioLoweredWarning";

describe("audioLoweredWarning", () => {
  it("names the cut and the fix", () => {
    const warning = audioLoweredWarning(7.3);
    expect(warning?.code).toBe("audio_lowered");
    expect(warning?.message).toContain("7.3 dB across the whole mix");
    expect(warning?.message).toContain("truepeak");
  });

  it("says nothing when the mix was not lowered", () => {
    expect(audioLoweredWarning(undefined)).toBeNull();
  });
});
