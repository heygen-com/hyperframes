import { describe, expect, it } from "vitest";
import { defaultAudioFxParams, HF_AUDIO_FX } from "./audioFx.js";
import { HF_AUDIO_FX_PRESETS } from "./audioFxPresets.js";
import { audioBandAt, BANDS, EFFECT_COPY, PRESET_PROBLEM, SUMMARY } from "./audioFxCopy.js";

/**
 * The copy layer is only worth having if it covers everything that ships. A gap
 * is not a missing nicety — it is a rack panel labelled `highpass` in front of
 * somebody who came here to stop a hum, which is the exact failure this layer
 * exists to prevent.
 *
 * This was a build step in `plans/audio-fx-ux/build-preview.mts`, which meant it
 * only caught a gap when somebody remembered to rebuild the review page. Here it
 * catches it on the commit that adds the effect.
 */
describe("every shipped effect has plain-language copy", () => {
  for (const def of HF_AUDIO_FX) {
    it(`${def.id}`, () => {
      const copy = EFFECT_COPY[def.id];
      expect(copy, `${def.id} has no copy`).toBeDefined();
      if (!copy) return;
      for (const param of def.params) {
        expect(copy.params[param.key], `${def.id}.${param.key} has no plain name`).toBeDefined();
      }
      // "strength" is the one legal fiction: it means the module gets a single
      // derived knob and its real parameters live behind Details. Anything else
      // has to name a parameter the effect actually has, or the panel would put
      // its headline control on a knob that does not exist.
      if (copy.primary !== "strength") {
        expect(
          def.params.map((p) => p.key),
          `${def.id}'s primary "${copy.primary}" is not one of its parameters`,
        ).toContain(copy.primary);
      }
      expect(SUMMARY[def.id], `${def.id} has no closed-state summary`).toBeDefined();
    });
  }
});

it("every preset says which everyday problem it answers", () => {
  const missing = HF_AUDIO_FX_PRESETS.filter((p) => !PRESET_PROBLEM[p.id]).map((p) => p.id);
  expect(missing).toEqual([]);
});

it("describes no effect the registry does not ship", () => {
  const shipped = new Set(HF_AUDIO_FX.map((d) => d.id));
  // The other direction. Copy for an effect that has been removed or renamed is
  // dead text that reads as covered, and the count in the review page would say
  // so too.
  expect(Object.keys(EFFECT_COPY).filter((id) => !shipped.has(id))).toEqual([]);
  expect(Object.keys(SUMMARY).filter((id) => !shipped.has(id))).toEqual([]);
});

it("summarises every effect at its own defaults without throwing", () => {
  for (const def of HF_AUDIO_FX) {
    const summary = SUMMARY[def.id];
    if (!summary) continue;
    // The first thing an author reads after adding an effect, so it has to be a
    // sentence at the values it arrives with — not "undefined dB".
    const text = summary(defaultAudioFxParams(def.id));
    expect(text, `${def.id} summarised as "${text}"`).toMatch(/^[^u].*[^ ]$/);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("NaN");
  }
});

it("covers the spectrum without a gap or an overlap", () => {
  // The ruler is shared by every spectral module, so a hole in it is a frequency
  // the rack can name in one place and not in another.
  expect(BANDS[0]?.from).toBe(20);
  expect(BANDS.at(-1)?.to).toBe(20000);
  for (let i = 1; i < BANDS.length; i++) {
    expect(BANDS[i]?.from, `gap or overlap before ${BANDS[i]?.name}`).toBe(BANDS[i - 1]?.to);
  }
});

describe("audioBandAt", () => {
  it("names the range a frequency sits in", () => {
    expect(audioBandAt(50)?.name).toBe("Rumble");
    expect(audioBandAt(250)?.name).toBe("Mud");
    expect(audioBandAt(3000)?.name).toBe("Presence");
    expect(audioBandAt(12000)?.name).toBe("Air");
  });

  it("puts a boundary in the band it opens, not the one it closes", () => {
    // Off by one here means a filter at exactly 250 Hz reads as "Weight" while
    // the ruler beside it highlights Mud.
    for (let i = 1; i < BANDS.length; i++) {
      const edge = BANDS[i]?.from;
      if (edge === undefined) continue;
      expect(audioBandAt(edge)?.name).toBe(BANDS[i]?.name);
    }
  });

  it("clamps past both ends rather than going nameless", () => {
    // A filter parked at the edge of its range still has to say where it works.
    expect(audioBandAt(5)?.name).toBe(BANDS[0]?.name);
    expect(audioBandAt(30000)?.name).toBe(BANDS.at(-1)?.name);
    expect(audioBandAt(20000)?.name).toBe(BANDS.at(-1)?.name);
  });

  it("has no answer for a value that is not a frequency", () => {
    expect(audioBandAt(Number.NaN)).toBeUndefined();
  });
});
