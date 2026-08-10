import { describe, expect, it } from "vitest";
import { defaultAudioFxParams, getAudioFxDef } from "./audioFx.js";
import { EFFECT_COPY } from "./audioFxCopy.js";
import {
  applyAudioFxProfile,
  audioFxProfileStrength,
  getAudioFxProfile,
  HF_AUDIO_FX_PROFILES,
} from "./audioFxProfiles.js";

describe("derived one-knob profiles", () => {
  it("covers exactly the effects whose copy asks for one", () => {
    // `primary: "strength"` is the copy layer saying "this module has no real
    // parameter that can honestly be its face". A profile missing for one of
    // those leaves the module opening on all seven of its controls; a profile
    // for anything else is a knob nobody asked for.
    const asked = Object.entries(EFFECT_COPY)
      .filter(([, copy]) => copy.primary === "strength")
      .map(([id]) => id)
      .sort();
    expect(Object.keys(HF_AUDIO_FX_PROFILES).sort()).toEqual(asked);
  });

  it("derives only parameters the effect actually has", () => {
    for (const [id, profile] of Object.entries(HF_AUDIO_FX_PROFILES)) {
      const keys = getAudioFxDef(id)?.params.map((p) => p.key) ?? [];
      for (const key of profile.derives) {
        expect(keys, `${id} derives "${key}", which it does not have`).toContain(key);
      }
      // And the curve sets everything it claims to.
      for (const key of profile.derives) {
        expect(profile.at(0.5)[key], `${id}.${key} is not set at 0.5`).toBeDefined();
      }
    }
  });

  it("stays inside every parameter's declared range across the whole knob", () => {
    // A profile that runs past a range is not clipped by the panel — it is
    // clamped on the way into the chain, so the knob would silently stop
    // meaning anything past that point.
    for (const [id, profile] of Object.entries(HF_AUDIO_FX_PROFILES)) {
      const def = getAudioFxDef(id);
      for (let s = 0; s <= 1.0001; s += 0.05) {
        const derived = profile.at(s);
        for (const param of def?.params ?? []) {
          const value = derived[param.key];
          if (value === undefined || param.kind !== "number") continue;
          expect(value, `${id}.${param.key} at ${s.toFixed(2)}`).toBeGreaterThanOrEqual(param.min);
          expect(value, `${id}.${param.key} at ${s.toFixed(2)}`).toBeLessThanOrEqual(param.max);
        }
      }
    }
  });

  it("moves every derived parameter monotonically", () => {
    // The whole promise of one knob: everything under it moves together and in
    // one direction. A parameter that turns around mid-sweep means the knob
    // makes the effect stronger and then weaker, which is unusable and is the
    // failure a hand-tuned table invites.
    for (const [id, profile] of Object.entries(HF_AUDIO_FX_PROFILES)) {
      for (const key of profile.derives) {
        const series: number[] = [];
        for (let s = 0; s <= 1.0001; s += 0.05) {
          const value = profile.at(s)[key];
          if (typeof value === "number") series.push(value);
        }
        const up = series.every((v, i) => i === 0 || v >= (series[i - 1] ?? v));
        const down = series.every((v, i) => i === 0 || v <= (series[i - 1] ?? v));
        expect(up || down, `${id}.${key} turns around mid-sweep`).toBe(true);
      }
    }
  });

  it("keeps what the author set under Details", () => {
    // A profile names only the parameters it derives. A compressor's knee and a
    // saturation's curve type are the author's, and the knob must not reach in
    // and reset them on the way past.
    const params = { ...defaultAudioFxParams("compressor"), knee: 6, mix: 0.5 };
    const next = applyAudioFxProfile("compressor", 0.8, params);
    expect(next.knee).toBe(6);
    expect(next.mix).toBe(0.5);
    expect(next.ratio).not.toBe(params.ratio);
  });

  it("reads a strength back out of the values a chain stores", () => {
    // A chain stores mechanism, not the knob — the mechanism is what renders,
    // so it has to be authoritative. Reopening a project has to put the knob
    // back where it was.
    for (const [id, profile] of Object.entries(HF_AUDIO_FX_PROFILES)) {
      for (const s of [0, 0.25, 0.5, 0.75, 1]) {
        const params = applyAudioFxProfile(id, s, defaultAudioFxParams(id));
        expect(audioFxProfileStrength(id, params), `${id} at ${s}`).toBeCloseTo(s, 1);
      }
      void profile;
    }
  });

  it("passes through the figures the design proposed", () => {
    // The curves replaced a three-point table, and these are the points it
    // named. Continuous beats three settings, but not at the price of landing
    // somewhere else than the design said.
    expect(getAudioFxProfile("compressor")?.at(0).threshold).toBe(-12);
    expect(getAudioFxProfile("compressor")?.at(0.5).ratio).toBe(4);
    expect(getAudioFxProfile("compressor")?.at(1).release).toBe(90);
    expect(getAudioFxProfile("gate")?.at(0).threshold).toBe(-55);
    expect(getAudioFxProfile("saturate")?.at(1).threshold).toBe(-18);
    expect(getAudioFxProfile("reverb")?.at(0).size).toBe(0.25);
    expect(getAudioFxProfile("reverb")?.at(0.5).size).toBe(0.55);
    expect(getAudioFxProfile("reverb")?.at(1).size).toBe(0.9);
    expect(getAudioFxProfile("bitcrush")?.at(1).bits).toBe(6);
  });

  it("takes a value that is not a number as the middle", () => {
    // The knob has to land somewhere, and silence is the one answer that is
    // never right.
    expect(getAudioFxProfile("reverb")?.at(Number.NaN).size).toBe(
      getAudioFxProfile("reverb")?.at(0.5).size,
    );
    expect(audioFxProfileStrength("reverb", {})).toBe(0.5);
    expect(audioFxProfileStrength("not-an-effect", {})).toBe(0.5);
  });
});
