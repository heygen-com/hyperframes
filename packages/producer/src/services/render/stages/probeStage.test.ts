import { describe, expect, it } from "bun:test";
import { hasScriptedAudioVolumeAutomation } from "./probeStage.js";

describe("hasScriptedAudioVolumeAutomation", () => {
  it("ignores non-script volume text", () => {
    expect(
      hasScriptedAudioVolumeAutomation(
        `<style>.volume-control { opacity: 1; }</style><script>const level = 1;</script>`,
        1,
      ),
    ).toBe(false);
  });

  it("detects direct media volume writes", () => {
    expect(hasScriptedAudioVolumeAutomation(`<script>audio.volume = 0.5;</script>`, 1)).toBe(true);
  });

  it("detects GSAP volume tweens", () => {
    expect(
      hasScriptedAudioVolumeAutomation(`<script>gsap.to(audio, { volume: 1 });</script>`, 1),
    ).toBe(true);
  });

  it("parses script tags with whitespace before the closing bracket", () => {
    expect(hasScriptedAudioVolumeAutomation(`<script>audio.volume = 0.5;</script >`, 1)).toBe(true);
  });

  it("requires audio metadata", () => {
    expect(
      hasScriptedAudioVolumeAutomation(`<script>gsap.to(audio, { volume: 1 });</script>`, 0),
    ).toBe(false);
  });
});
