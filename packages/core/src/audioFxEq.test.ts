import { describe, expect, it } from "vitest";
import {
  HF_AUDIO_FX_CHAIN_VERSION,
  parseAudioFxChain,
  serializeAudioFxChain,
  type HfAudioFxChain,
} from "./audioFx.js";
import {
  addAudioEq,
  audioEqIds,
  audioEqSummary,
  HF_AUDIO_EQ_3,
  HF_AUDIO_EQ_5,
  HF_AUDIO_EQ_RANGE_DB,
  readAudioEqBands,
  removeAudioEq,
  setAudioEqBandGain,
} from "./audioFxEq.js";

const empty = (): HfAudioFxChain => ({ version: HF_AUDIO_FX_CHAIN_VERSION, nodes: [] });

describe("adding an EQ", () => {
  it("writes one ordinary filter per band, in band order", () => {
    const { chain } = addAudioEq(empty());
    expect(chain.nodes.map((n) => n.type)).toEqual(["lowshelf", "peaking", "highshelf"]);
    // Ordinary nodes: an author who opens the details finds filters they could
    // have added by hand, not an opaque "eq" the graph has to special-case.
    expect(chain.nodes.every((n) => n.enabled)).toBe(true);
    expect(chain.nodes.map((n) => n.label)).toEqual(["Bass", "Middle", "Treble"]);
  });

  it("gives every band an id, because a lane addresses effects by id", () => {
    const { chain } = addAudioEq(empty(), HF_AUDIO_EQ_5);
    const ids = chain.nodes.map((n) => n.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts flat, so adding one changes nothing until a fader moves", () => {
    const { chain, eqId } = addAudioEq(empty());
    for (const band of readAudioEqBands(chain, eqId)) expect(band.gain).toBe(0);
    expect(audioEqSummary(readAudioEqBands(chain, eqId))).toMatch(/^Flat/);
  });

  it("keeps two EQs apart", () => {
    const first = addAudioEq(empty());
    const second = addAudioEq(first.chain, HF_AUDIO_EQ_5);
    expect(second.eqId).not.toBe(first.eqId);
    expect(audioEqIds(second.chain)).toEqual([first.eqId, second.eqId]);
    expect(readAudioEqBands(second.chain, first.eqId)).toHaveLength(3);
    expect(readAudioEqBands(second.chain, second.eqId)).toHaveLength(5);
    expect(new Set(second.chain.nodes.map((n) => n.id)).size).toBe(second.chain.nodes.length);
  });

  it("leaves effects that were already there alone", () => {
    const before: HfAudioFxChain = {
      version: HF_AUDIO_FX_CHAIN_VERSION,
      nodes: [{ type: "reverb", id: "mine", enabled: true }],
    };
    const { chain } = addAudioEq(before);
    expect(chain.nodes[0]?.id).toBe("mine");
    expect(chain.nodes).toHaveLength(4);
  });
});

describe("moving a fader", () => {
  it("changes only that band", () => {
    const { chain, eqId } = addAudioEq(empty());
    const next = setAudioEqBandGain(chain, eqId, "Bass", 4.5);
    const bands = readAudioEqBands(next, eqId);
    expect(bands.find((b) => b.name === "Bass")?.gain).toBe(4.5);
    expect(bands.find((b) => b.name === "Middle")?.gain).toBe(0);
    expect(bands.find((b) => b.name === "Treble")?.gain).toBe(0);
  });

  it("leaves the band's frequency and width alone", () => {
    // The fader is one control. Moving it must not quietly re-seed the rest of
    // the band, or an author who set a frequency by hand loses it on the next drag.
    const { chain, eqId } = addAudioEq(empty(), HF_AUDIO_EQ_5);
    const before = readAudioEqBands(chain, eqId).find((b) => b.name === "Clarity")!;
    const next = setAudioEqBandGain(chain, eqId, "Clarity", -3);
    const after = readAudioEqBands(next, eqId).find((b) => b.name === "Clarity")!;
    expect(after.frequency).toBe(before.frequency);
    expect(after.q).toBe(before.q);
    expect(after.gain).toBe(-3);
  });

  it("holds the fader to a tone control's range, not a repair tool's", () => {
    // The filters themselves allow ±40 dB. A tone control that can bury a
    // track under 40 dB of bass is not a tone control.
    const { chain, eqId } = addAudioEq(empty());
    const hot = setAudioEqBandGain(chain, eqId, "Bass", 40);
    const cold = setAudioEqBandGain(chain, eqId, "Bass", -40);
    expect(readAudioEqBands(hot, eqId)[0]?.gain).toBe(HF_AUDIO_EQ_RANGE_DB);
    expect(readAudioEqBands(cold, eqId)[0]?.gain).toBe(-HF_AUDIO_EQ_RANGE_DB);
  });

  it("ignores a band name that is not in this EQ", () => {
    const { chain, eqId } = addAudioEq(empty());
    const next = setAudioEqBandGain(chain, eqId, "Nonsense", 6);
    expect(readAudioEqBands(next, eqId).every((b) => b.gain === 0)).toBe(true);
  });
});

describe("the chain is the truth", () => {
  it("reads a frequency the author moved by hand", () => {
    // The nodes are authoritative, not a cached band list: opening the details
    // and moving a frequency has to show up on the fader's own band.
    const { chain, eqId } = addAudioEq(empty());
    const edited: HfAudioFxChain = {
      ...chain,
      nodes: chain.nodes.map((n) =>
        n.label === "Middle" ? { ...n, params: { ...n.params, frequency: 700 } } : n,
      ),
    };
    expect(readAudioEqBands(edited, eqId).find((b) => b.name === "Middle")?.frequency).toBe(700);
  });

  it("survives being written to an attribute and read back", () => {
    const { chain, eqId } = addAudioEq(empty(), HF_AUDIO_EQ_5);
    const moved = setAudioEqBandGain(chain, eqId, "Air", 2.5);
    const back = parseAudioFxChain(serializeAudioFxChain(moved));
    // Without fromEq surviving, the module cannot find its own bands after a
    // reload and the EQ silently becomes five loose filters.
    expect(audioEqIds(back)).toEqual([eqId]);
    expect(readAudioEqBands(back, eqId).map((b) => b.name)).toEqual([
      "Bass",
      "Warmth",
      "Middle",
      "Clarity",
      "Air",
    ]);
    expect(readAudioEqBands(back, eqId).find((b) => b.name === "Air")?.gain).toBe(2.5);
  });

  it("removes a whole EQ without touching anything else", () => {
    const before: HfAudioFxChain = {
      version: HF_AUDIO_FX_CHAIN_VERSION,
      nodes: [{ type: "reverb", id: "mine", enabled: true }],
    };
    const { chain, eqId } = addAudioEq(before);
    const gone = removeAudioEq(chain, eqId);
    expect(gone.nodes.map((n) => n.id)).toEqual(["mine"]);
  });
});

describe("what it says when closed", () => {
  it("names only the bands that were moved", () => {
    const { chain, eqId } = addAudioEq(empty());
    const next = setAudioEqBandGain(setAudioEqBandGain(chain, eqId, "Bass", 3), eqId, "Treble", -2);
    expect(audioEqSummary(readAudioEqBands(next, eqId))).toBe("Bass +3, Treble −2");
  });

  it("says so when nothing has been touched", () => {
    expect(audioEqSummary(HF_AUDIO_EQ_3)).toMatch(/^Flat/);
  });
});
