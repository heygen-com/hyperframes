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

/**
 * Copy that assumes the track is a voice.
 *
 * The rack sits on whatever the author selected — a music bed, a sound effect,
 * a room tone. Every effect, every named job and every profile is offered on
 * all of them, so a control that reads "Thins the voice out" on a synth pad is
 * describing something the author cannot hear and does not have. It is the same
 * rule this file's header already states — describe a control by what changes in
 * THE SOUND — applied to the words rather than to the mechanism.
 *
 * The voice presets are the deliberate exception: they are voice by definition,
 * and the shelf hides them on a track that classifies as music or as an effect,
 * so "My voice sounds amateur" is only ever read next to a voice.
 *
 * This is a lint on the words, not a judgement about mixing. It exists because
 * the offending strings were written one at a time over months and read fine in
 * isolation — nobody notices the assumption until they apply Cut Rumble to a
 * bass line and the panel tells them it will thin their voice out.
 */
describe("no copy assumes the track is a voice", () => {
  /** Words that only mean something if the material is speech. */
  const SPEECH =
    /\b(voice|vocal|voices|speech|spoken|word|words|sentence|sentences|syllable|syllables|narration|narrator|talking|chest)\b/i;

  /** Presets whose whole purpose is a voice, so their copy may say so. */
  const VOICE_PRESETS = new Set(
    HF_AUDIO_FX_PRESETS.filter((p) => p.family === "voice").map((p) => p.id),
  );

  const offenders = (entries: [string, string][]): string[] =>
    entries.filter(([, text]) => SPEECH.test(text)).map(([where, text]) => `${where}: "${text}"`);

  it("not in an effect's name, blurb, reach-for line or any knob", () => {
    const entries: [string, string][] = [];
    for (const [id, copy] of Object.entries(EFFECT_COPY)) {
      entries.push([`${id}.title`, copy.title], [`${id}.does`, copy.does]);
      entries.push([`${id}.reachFor`, copy.reachFor]);
      entries.push([`${id}.primaryEnds.low`, copy.primaryEnds.low]);
      entries.push([`${id}.primaryEnds.high`, copy.primaryEnds.high]);
      for (const [key, param] of Object.entries(copy.params)) {
        entries.push([`${id}.${key}.label`, param.label]);
        if (param.hint) entries.push([`${id}.${key}.hint`, param.hint]);
        if (param.ends) {
          entries.push([`${id}.${key}.ends.low`, param.ends.low]);
          entries.push([`${id}.${key}.ends.high`, param.ends.high]);
        }
      }
    }
    expect(offenders(entries)).toEqual([]);
  });

  it("not in the band vocabulary, which every spectral module shares", () => {
    // These names get taught once and then reused everywhere, so a voice-only
    // word here spreads to every filter in the rack.
    expect(offenders(BANDS.map((b) => [b.name, b.says]))).toEqual([]);
  });

  it("not in the complaint a non-voice preset answers", () => {
    const entries = Object.entries(PRESET_PROBLEM).filter(([id]) => !VOICE_PRESETS.has(id));
    expect(offenders(entries as [string, string][])).toEqual([]);
  });

  it("still lets the voice presets say what they are for", () => {
    // The exception has to be real, or the rule above is untested — a catalogue
    // where nothing said "voice" would pass every assertion here vacuously.
    const voiced = Object.entries(PRESET_PROBLEM).filter(([id]) => VOICE_PRESETS.has(id));
    expect(voiced.length).toBeGreaterThan(0);
    expect(voiced.some(([, text]) => SPEECH.test(text))).toBe(true);
  });
});
