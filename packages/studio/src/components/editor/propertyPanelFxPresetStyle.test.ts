// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { HF_AUDIO_FX_PRESETS } from "@hyperframes/core/audio-fx-presets";
import {
  FX_PRESET_STYLE,
  FX_PRESET_STYLE_DEFAULT,
  fxPresetStyle,
} from "./propertyPanelFxPresetStyle.js";

describe("per-preset title treatments", () => {
  it("styles every preset the catalogue ships", () => {
    // An unstyled preset is not broken — it falls back — but it is a row that
    // silently opts out of the design, which nobody would notice.
    const missing = HF_AUDIO_FX_PRESETS.filter((p) => !FX_PRESET_STYLE[p.id]).map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it("styles no preset the catalogue does not", () => {
    // Dead entries for renamed or removed presets read as coverage.
    const shipped = new Set(HF_AUDIO_FX_PRESETS.map((p) => p.id));
    expect(Object.keys(FX_PRESET_STYLE).filter((id) => !shipped.has(id))).toEqual([]);
  });

  it("gives the character presets treatments that differ from each other", () => {
    // The whole point: a preset is a character, and Telephone should not look
    // like Megaphone. The corrective families may legitimately share a look.
    const character = HF_AUDIO_FX_PRESETS.filter((p) => p.family === "character");
    const looks = new Set(character.map((p) => `${fxPresetStyle(p.id).type}`));
    expect(looks.size).toBe(character.length);
  });

  it("keeps every colour in one narrow lightness band", () => {
    // A per-preset colour free-for-all would read as status. These sit where the
    // family tints do, and the panel already spends saturation on "automated"
    // and "bypassed".
    for (const [id, style] of Object.entries(FX_PRESET_STYLE)) {
      const match = /hsl\(\s*\d+,\s*(\d+)%,\s*(\d+)%\s*\)/.exec(style.color);
      expect(match, `${id} is not a plain hsl() colour`).toBeTruthy();
      const saturation = Number(match?.[1]);
      const lightness = Number(match?.[2]);
      expect(saturation, `${id} is too saturated to be type`).toBeLessThanOrEqual(50);
      expect(lightness, `${id} is too dark to read on the panel`).toBeGreaterThanOrEqual(66);
      expect(lightness, `${id} is too light to sit beside the others`).toBeLessThanOrEqual(78);
    }
  });

  it("falls back rather than failing for a preset it does not know", () => {
    expect(fxPresetStyle("not-a-preset")).toBe(FX_PRESET_STYLE_DEFAULT);
  });
});
