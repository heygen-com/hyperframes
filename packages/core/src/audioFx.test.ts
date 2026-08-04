import { describe, expect, it } from "vitest";
import {
  AudioFxChainError,
  defaultAudioFxParams,
  enabledAudioFxNodes,
  getAudioFxDef,
  HF_AUDIO_FX,
  HF_AUDIO_FX_CHAIN_VERSION,
  HF_AUDIO_FX_IDS,
  normalizeAudioFxParams,
  parseAudioFxChain,
} from "./audioFx.js";

const chain = (nodes: unknown[]): string =>
  JSON.stringify({ version: HF_AUDIO_FX_CHAIN_VERSION, nodes });

describe("effect registry", () => {
  it("has unique ids and unique parameter keys per effect", () => {
    expect(new Set(HF_AUDIO_FX_IDS).size).toBe(HF_AUDIO_FX.length);
    for (const def of HF_AUDIO_FX) {
      const keys = def.params.map((p) => p.key);
      expect(new Set(keys).size, `${def.id} has duplicate param keys`).toBe(keys.length);
    }
  });

  it("declares every default inside its own declared range", () => {
    for (const def of HF_AUDIO_FX) {
      for (const p of def.params) {
        if (p.kind === "enum") {
          expect(
            p.options.some((o) => o.value === p.default),
            `${def.id}.${p.key} default is not one of its options`,
          ).toBe(true);
        } else {
          expect(p.default, `${def.id}.${p.key} default below min`).toBeGreaterThanOrEqual(p.min);
          expect(p.default, `${def.id}.${p.key} default above max`).toBeLessThanOrEqual(p.max);
          expect(p.min).toBeLessThan(p.max);
        }
      }
    }
  });

  it("gives every effect at least one knob to turn", () => {
    for (const def of HF_AUDIO_FX) {
      expect(def.params.length, `${def.id} exposes no parameters`).toBeGreaterThan(0);
    }
  });
});

describe("normalizeAudioFxParams", () => {
  it("fills missing keys with defaults", () => {
    expect(normalizeAudioFxParams("peaking", {})).toEqual(defaultAudioFxParams("peaking"));
  });

  it("clamps out-of-range numbers into the renderable range", () => {
    const v = normalizeAudioFxParams("peaking", { frequency: 999999, gain: -500, q: 0 });
    expect(v.frequency).toBe(20000);
    expect(v.gain).toBe(-40);
    expect(v.q).toBe(0.1);
  });

  it("replaces NaN and non-numeric junk with the default", () => {
    // NaN reaching a filter string fails the entire render, so it must never survive.
    const v = normalizeAudioFxParams("peaking", {
      frequency: Number.NaN,
      gain: "loud" as unknown as number,
    });
    expect(v.frequency).toBe(1000);
    expect(v.gain).toBe(0);
  });

  it("falls back to the default for an unrecognised enum value", () => {
    expect(normalizeAudioFxParams("saturate", { type: "sawtooth" }).type).toBe("tanh");
    expect(normalizeAudioFxParams("saturate", { type: "atan" }).type).toBe("atan");
  });

  it("drops keys the effect does not declare", () => {
    const v = normalizeAudioFxParams("peaking", { frequency: 500, nonsense: 1 });
    expect(Object.keys(v).sort()).toEqual(["frequency", "gain", "q"]);
  });
});

describe("parseAudioFxChain", () => {
  it("round-trips a chain and defaults `enabled` to true", () => {
    const parsed = parseAudioFxChain(chain([{ type: "peaking", params: { gain: -6 } }]));
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]!.enabled).toBe(true);
    expect(parsed.nodes[0]!.params!.gain).toBe(-6);
  });

  it("rejects an unknown effect rather than silently dropping it", () => {
    // Skipping the node would render something other than what was authored.
    expect(() => parseAudioFxChain(chain([{ type: "vibrato" }]))).toThrow(AudioFxChainError);
  });

  it("rejects an unsupported version", () => {
    expect(() => parseAudioFxChain(JSON.stringify({ version: 99, nodes: [] }))).toThrow(
      /Unsupported chain version/,
    );
  });

  it("rejects malformed JSON and a missing nodes array", () => {
    expect(() => parseAudioFxChain("{oops")).toThrow(/not valid JSON/);
    expect(() => parseAudioFxChain(JSON.stringify({ version: 1 }))).toThrow(/missing a `nodes`/);
  });
});

describe("enabledAudioFxNodes", () => {
  it("treats a missing enabled flag as enabled", () => {
    const nodes = enabledAudioFxNodes({
      version: 1,
      nodes: [{ type: "peaking" }, { type: "delay", enabled: false }],
    });
    expect(nodes.map((n) => n.type)).toEqual(["peaking"]);
  });
});

describe("declared parameters are real", () => {
  const paramKeys = (id: string): string[] => (getAudioFxDef(id)?.params ?? []).map((p) => p.key);

  it("offers no shelf Q, which a BiquadFilterNode ignores for shelf types", () => {
    // It was also flagged automatable, so a lane could be drawn on it and heard
    // not at all.
    expect(paramKeys("lowshelf")).not.toContain("q");
    expect(paramKeys("highshelf")).not.toContain("q");
    // Peaking and the pass filters do use Q.
    expect(paramKeys("peaking")).toContain("q");
    expect(paramKeys("lowpass")).toContain("q");
  });

  it("offers no knob whose builder reads nothing", () => {
    // chorus `decay` and bitcrush `aa` were declared with ranges and defaults but
    // no builder ever read them: dials that moved and did nothing.
    expect(paramKeys("chorus")).not.toContain("decay");
    expect(paramKeys("bitcrush")).not.toContain("aa");
    // The phaser's decay does drive its sweep depth, and the gate's knee is read.
    expect(paramKeys("phaser")).toContain("decay");
    expect(paramKeys("gate")).toContain("knee");
  });
});
