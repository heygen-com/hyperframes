import { describe, expect, it } from "vitest";
import {
  getAudioFxDef,
  HF_AUDIO_FX_CHAIN_VERSION,
  normalizeAudioFxParams,
  parseAudioFxChain,
  serializeAudioFxChain,
  type HfAudioFxChain,
  type HfAudioFxNumberParam,
} from "./audioFx.js";
import {
  activeAudioFxPresetIds,
  applyAudioFxPreset,
  audioFxPresetNodes,
  audioFxPresetsByFamily,
  getAudioFxPreset,
  HF_AUDIO_FX_PRESET_FAMILIES,
  HF_AUDIO_FX_PRESETS,
} from "./audioFxPresets.js";

const empty = (): HfAudioFxChain => ({ version: HF_AUDIO_FX_CHAIN_VERSION, nodes: [] });
const need = (id: string) => {
  const p = getAudioFxPreset(id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
};

/**
 * The catalogue is hand-written numbers, which is exactly the kind of thing
 * that rots quietly: a value outside its declared range does not throw, it gets
 * clamped, and the preset then sounds like something nobody chose. These check
 * the data itself rather than the machinery around it.
 */
describe("the catalogue is internally valid", () => {
  it("has unique ids and a family the menu knows", () => {
    const ids = HF_AUDIO_FX_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of HF_AUDIO_FX_PRESETS) {
      expect(HF_AUDIO_FX_PRESET_FAMILIES, `${p.id} sits on no shelf`).toContain(p.family);
      expect(p.nodes.length, `${p.id} is empty`).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it("names only real effects", () => {
    for (const p of HF_AUDIO_FX_PRESETS) {
      for (const node of p.nodes) {
        expect(getAudioFxDef(node.type), `${p.id} uses unknown effect "${node.type}"`).toBeTruthy();
      }
    }
  });

  it("names only parameters those effects declare", () => {
    for (const p of HF_AUDIO_FX_PRESETS) {
      for (const node of p.nodes) {
        const keys = new Set((getAudioFxDef(node.type)?.params ?? []).map((x) => x.key));
        for (const key of Object.keys(node.params ?? {})) {
          expect(keys.has(key), `${p.id}: ${node.type} has no parameter "${key}"`).toBe(true);
        }
      }
    }
  });

  it("sets every value inside its own declared range", () => {
    // The one that actually catches typos. A value out of range is silently
    // clamped, so without this a preset can ship sounding like nothing anyone
    // chose and still pass every other test here.
    for (const p of HF_AUDIO_FX_PRESETS) {
      for (const node of p.nodes) {
        const def = getAudioFxDef(node.type);
        for (const [key, raw] of Object.entries(node.params ?? {})) {
          const param = def?.params.find((x) => x.key === key);
          if (!param) continue;
          if (param.kind === "enum") {
            expect(
              param.options.some((o) => o.value === raw),
              `${p.id}: ${node.type}.${key} = "${String(raw)}" is not one of its options`,
            ).toBe(true);
            continue;
          }
          const n = param as HfAudioFxNumberParam;
          expect(typeof raw, `${p.id}: ${node.type}.${key} is not a number`).toBe("number");
          expect(
            raw as number,
            `${p.id}: ${node.type}.${key} = ${String(raw)} is below its minimum ${n.min}`,
          ).toBeGreaterThanOrEqual(n.min);
          expect(
            raw as number,
            `${p.id}: ${node.type}.${key} = ${String(raw)} is above its maximum ${n.max}`,
          ).toBeLessThanOrEqual(n.max);
        }
      }
    }
  });

  it("survives being written to an attribute and read back, TAGS AND ALL", () => {
    // Comparing only types is what let `fromPreset` be silently dropped by the
    // parser: every preset round-tripped its effects while losing the tag that
    // lets it find its own nodes again. Compare what the rack actually needs.
    for (const p of HF_AUDIO_FX_PRESETS) {
      const chain = applyAudioFxPreset(empty(), p);
      const back = parseAudioFxChain(serializeAudioFxChain(chain));
      expect(
        back.nodes.map((x) => ({
          type: x.type,
          id: x.id,
          fromPreset: x.fromPreset,
          label: x.label,
        })),
        `${p.id} did not round-trip`,
      ).toEqual(
        chain.nodes.map((x) => ({
          type: x.type,
          id: x.id,
          fromPreset: x.fromPreset,
          label: x.label,
        })),
      );
    }
  });

  it("round-trips how much of the preset is applied", () => {
    // `presetAmount` is what the switch writes and what a lane ramps, so losing
    // it on reload silently turns every part-applied or switched-off preset back
    // on — the same failure `fromPreset` had, one field along. The INVARIANT: a
    // new HfAudioFxNode field goes in BOTH parseAudioFxChain and
    // serializeAudioFxChain.
    const preset = HF_AUDIO_FX_PRESETS[0];
    if (!preset) throw new Error("empty catalogue");
    for (const amount of [0, 0.4, 1]) {
      const chain = applyAudioFxPreset(empty(), preset);
      const withAmount = {
        ...chain,
        nodes: chain.nodes.map((n) => ({ ...n, presetAmount: amount })),
      };
      const back = parseAudioFxChain(serializeAudioFxChain(withAmount));
      // 1 is the absent case — a fully applied preset should not grow a field in
      // every chain that carries one — and reads back as fully applied.
      const expected = amount === 1 ? undefined : amount;
      expect(
        back.nodes.map((n) => n.presetAmount),
        `amount ${amount} did not survive`,
      ).toEqual(chain.nodes.map(() => expected));
    }
  });

  it("refuses an amount outside the blend it drives", () => {
    // Two gains in opposition: past 1 the dry leg goes negative rather than the
    // preset simply getting louder.
    const preset = HF_AUDIO_FX_PRESETS[0];
    if (!preset) throw new Error("empty catalogue");
    const chain = applyAudioFxPreset(empty(), preset);
    const raw = JSON.parse(serializeAudioFxChain(chain)) as {
      nodes: { presetAmount?: number }[];
    };
    raw.nodes = raw.nodes.map((n) => ({ ...n, presetAmount: 4 }));
    const back = parseAudioFxChain(JSON.stringify(raw));
    for (const node of back.nodes) expect(node.presetAmount).toBe(1);
  });

  it("names every node for the job it is doing", () => {
    for (const p of HF_AUDIO_FX_PRESETS) {
      for (const node of p.nodes) {
        expect(node.label, `${p.id}: a ${node.type} node has no job name`).toBeTruthy();
      }
    }
  });

  it("never shows the same name twice in one chain", () => {
    // The failure this exists to prevent: a rack reading "Shape One Range"
    // twice, once cutting mud and once adding clarity, with nothing to tell
    // them apart. Identical CONSECUTIVE nodes are exempt — a stacked pair is
    // one stage built from two biquads, not two jobs.
    for (const p of HF_AUDIO_FX_PRESETS) {
      const seen = new Map<string, number>();
      p.nodes.forEach((node, i) => {
        const key = node.label ?? node.type;
        const prev = seen.get(key);
        const stackedPair =
          prev === i - 1 && JSON.stringify(p.nodes[prev]?.params) === JSON.stringify(node.params);
        expect(
          prev === undefined || stackedPair,
          `${p.id} shows "${key}" twice — an author cannot tell the two apart`,
        ).toBe(true);
        seen.set(key, i);
      });
    }
  });

  it("ends anything that boosts with a ceiling", () => {
    // A preset that adds presence and makeup gain can push the chain past full
    // scale, and the render clamps what it is handed. Every preset that lifts
    // has to hand the mix something bounded.
    for (const p of HF_AUDIO_FX_PRESETS) {
      const lifts = p.nodes.some((node) => {
        const g = node.params?.["gain"];
        const makeup = node.params?.["makeup"];
        const out = node.params?.["output"];
        return (
          (typeof g === "number" && g > 0) ||
          (typeof makeup === "number" && makeup > 0) ||
          (typeof out === "number" && out > 0)
        );
      });
      if (!lifts) continue;
      const last = p.nodes[p.nodes.length - 1];
      const bounded =
        p.nodes.some((n) => n.type === "limiter") ||
        // A band-limited character preset cannot run away: its own filters and
        // soft clip cap it, and a limiter would change the effect.
        p.family === "character";
      expect(bounded, `${p.id} lifts level but never bounds it (ends on ${last?.type})`).toBe(true);
    }
  });

  it("puts the limiter last wherever it has one", () => {
    for (const p of HF_AUDIO_FX_PRESETS) {
      const at = p.nodes.findIndex((n) => n.type === "limiter");
      if (at === -1) continue;
      expect(at, `${p.id}: a limiter that is not last is not a ceiling`).toBe(p.nodes.length - 1);
    }
  });

  it("keeps every shelf stocked", () => {
    for (const family of HF_AUDIO_FX_PRESET_FAMILIES) {
      expect(audioFxPresetsByFamily(family).length, `${family} is empty`).toBeGreaterThan(0);
    }
  });
});

describe("applying a preset", () => {
  it("writes ordinary nodes with their defaults filled in", () => {
    const chain = applyAudioFxPreset(empty(), need("rumble-cut"));
    expect(chain.nodes).toHaveLength(1);
    const node = chain.nodes[0]!;
    expect(node.type).toBe("highpass");
    // Named 100 Hz; everything else comes from the effect, so the file holds a
    // complete node rather than a partial one the graph has to guess at.
    expect(node.params).toEqual({ ...normalizeAudioFxParams("highpass", {}), frequency: 100 });
    expect(node.fromPreset).toBe("rumble-cut");
    expect(node.label).toBe("Cut Rumble");
    expect(node.enabled).toBe(true);
  });

  it("gives every node an id, because a lane addresses effects by id", () => {
    const chain = applyAudioFxPreset(empty(), need("telephone"));
    const ids = chain.nodes.map((n) => n.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("appends rather than replacing, so a character preset can stack on a clean voice", () => {
    const voiced = applyAudioFxPreset(empty(), need("voice-clean"));
    const both = applyAudioFxPreset(voiced, need("telephone"));
    expect(both.nodes.length).toBe(voiced.nodes.length + need("telephone").nodes.length);
    expect(activeAudioFxPresetIds(both)).toEqual(["voice-clean", "telephone"]);
    // ids stay unique across the two batches
    expect(new Set(both.nodes.map((n) => n.id)).size).toBe(both.nodes.length);
  });

  it("replaces the whole chain when asked", () => {
    const voiced = applyAudioFxPreset(empty(), need("voice-clean"));
    const only = applyAudioFxPreset(voiced, need("hall"), { replaceChain: true });
    expect(activeAudioFxPresetIds(only)).toEqual(["hall"]);
    expect(only.nodes).toHaveLength(need("hall").nodes.length);
  });

  it("re-applying swaps its own nodes instead of stacking a second copy", () => {
    const once = applyAudioFxPreset(empty(), need("telephone"));
    const twice = applyAudioFxPreset(once, need("telephone"));
    expect(twice.nodes.length).toBe(once.nodes.length);
    expect(activeAudioFxPresetIds(twice)).toEqual(["telephone"]);
  });

  it("re-applying keeps the preset's place in the signal order", () => {
    // Order is audible: a telephone band before a limiter is a different sound
    // from one after it. Re-applying must not quietly move the preset to the end.
    const start = applyAudioFxPreset(empty(), need("telephone"));
    const withTail = applyAudioFxPreset(start, need("hall"));
    const again = applyAudioFxPreset(withTail, need("telephone"));
    expect(again.nodes.map((n) => n.fromPreset)).toEqual([
      ...new Array(need("telephone").nodes.length).fill("telephone"),
      ...new Array(need("hall").nodes.length).fill("hall"),
    ]);
  });

  it("leaves hand-added effects alone when a preset is re-applied", () => {
    const hand = { type: "reverb", id: "mine", params: normalizeAudioFxParams("reverb", {}) };
    const chain: HfAudioFxChain = { version: HF_AUDIO_FX_CHAIN_VERSION, nodes: [hand] };
    const once = applyAudioFxPreset(chain, need("voice-clean"));
    const twice = applyAudioFxPreset(once, need("voice-clean"));
    expect(twice.nodes.filter((n) => n.id === "mine")).toHaveLength(1);
    expect(twice.nodes.filter((n) => n.fromPreset === "voice-clean")).toHaveLength(
      need("voice-clean").nodes.length,
    );
  });

  it("mints ids that cannot collide with what is already in the chain", () => {
    const chain: HfAudioFxChain = {
      version: HF_AUDIO_FX_CHAIN_VERSION,
      nodes: [
        { type: "reverb", id: "n1" },
        { type: "delay", id: "n2" },
      ],
    };
    const made = audioFxPresetNodes(need("voice-clean"), chain);
    for (const node of made) expect(["n1", "n2"]).not.toContain(node.id);
    expect(new Set(made.map((n) => n.id)).size).toBe(made.length);
  });
});
