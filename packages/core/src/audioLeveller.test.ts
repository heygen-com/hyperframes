import { describe, expect, it } from "vitest";
import {
  HF_AUDIO_FX_CHAIN_VERSION,
  parseAudioFxChain,
  serializeAudioFxChain,
  type HfAudioFxChain,
} from "./audioFx.js";
import { sampleAutomationLane } from "./audioAutomation.js";
import { applyAudioFxPreset, getAudioFxPreset } from "./audioFxPresets.js";
import {
  analyseLevelling,
  levellerProfile,
  levellingResult,
  levellingSummary,
  removeLevelling,
} from "./audioLeveller.js";

const SR = 48000;
const empty = (): HfAudioFxChain => ({ version: HF_AUDIO_FX_CHAIN_VERSION, nodes: [] });

/** A tone whose amplitude changes per section, so the levelling has real work. */
function uneven(sections: { seconds: number; amp: number }[]): Float32Array {
  const total = sections.reduce((n, s) => n + Math.floor(SR * s.seconds), 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const section of sections) {
    const n = Math.floor(SR * section.seconds);
    for (let i = 0; i < n; i += 1) {
      out[at + i] = section.amp * Math.sin((2 * Math.PI * 300 * (at + i)) / SR);
    }
    at += n;
  }
  return out;
}

const at = (points: { t: number; v: number }[], t: number) =>
  sampleAutomationLane({ target: "fx.n1.gain", points }, t);

describe("measuring", () => {
  it("lifts a quiet passage and leaves the loud one alone", () => {
    // Loud, then 18 dB down, then loud again.
    const points = analyseLevelling(
      uneven([
        { seconds: 3, amp: 0.5 },
        { seconds: 3, amp: 0.06 },
        { seconds: 3, amp: 0.5 },
      ]),
      SR,
    );
    expect(points.length).toBeGreaterThan(0);
    // Mid-quiet-section, well past the attack.
    expect(at(points, 5.5)).toBeGreaterThan(3);
    // Mid-loud-section, well past the release.
    expect(Math.abs(at(points, 2.5))).toBeLessThan(2);
  });

  it("finds nothing to do on a track that is already even", () => {
    // A script that always writes something teaches an author it is doing
    // nothing; saying "already even" is the useful answer.
    expect(analyseLevelling(uneven([{ seconds: 6, amp: 0.4 }]), SR)).toEqual([]);
  });

  it("leaves room tone alone rather than lifting it into the mix", () => {
    // Deliberately NOT digital silence: a real pause is quiet but finite, and
    // that is the case the floor exists for. Absolute zero would be skipped by
    // the isFinite check alone and prove nothing.
    const points = analyseLevelling(
      uneven([
        { seconds: 3, amp: 0.5 },
        { seconds: 3, amp: 0.0008 },
        { seconds: 3, amp: 0.5 },
      ]),
      SR,
      1,
    );
    // ~56 dB down: a pause with a noise floor, not a quiet passage. Gain
    // applied here is gain applied to the room.
    expect(Math.abs(at(points, 5.5))).toBeLessThan(1.5);
  });

  it("targets a level the track reaches, not its loudest instant", () => {
    // Mostly quiet with one loud burst. Against the PEAK the whole body of the
    // track reads as "quiet" and gets hauled up; against a level the track
    // actually sustains, the body is already the target and barely moves.
    const points = analyseLevelling(
      uneven([
        { seconds: 6, amp: 0.08 },
        { seconds: 1, amp: 0.8 },
        { seconds: 5, amp: 0.08 },
      ]),
      SR,
      1,
    );
    expect(Math.abs(at(points, 3))).toBeLessThan(3);
  });

  it("never asks for more correction than it can justify", () => {
    // ~30 dB below the loud section: still well above the silence floor, so it
    // IS a passage to lift — and at full strength the raw ask is over 25 dB,
    // which is more gain than any quiet passage should be given.
    const points = analyseLevelling(
      uneven([
        { seconds: 3, amp: 0.6 },
        { seconds: 4, amp: 0.019 },
      ]),
      SR,
      1,
    );
    expect(points.some((p) => p.v > 6)).toBe(true);
    for (const p of points) expect(Math.abs(p.v)).toBeLessThanOrEqual(12);
  });

  it("starts at the clip's start, so the lane does not slide in from nowhere", () => {
    const points = analyseLevelling(
      uneven([
        { seconds: 3, amp: 0.5 },
        { seconds: 3, amp: 0.06 },
      ]),
      SR,
    );
    expect(points[0]?.t).toBe(0);
  });

  it("handles an empty track without inventing a lane", () => {
    expect(analyseLevelling(new Float32Array(0), SR)).toEqual([]);
    expect(analyseLevelling(uneven([{ seconds: 1, amp: 0.4 }]), 0)).toEqual([]);
  });
});

describe("strength", () => {
  it("corrects more the further it is turned up", () => {
    const track = uneven([
      { seconds: 3, amp: 0.5 },
      { seconds: 3, amp: 0.06 },
    ]);
    const gentle = at(analyseLevelling(track, SR, 0.1), 5.5);
    const strong = at(analyseLevelling(track, SR, 1), 5.5);
    expect(strong).toBeGreaterThan(gentle);
  });

  it("still leaves some of the performance in at full strength", () => {
    // Driving a track to a flat line removes the performance along with the
    // inconsistency, so even 1.0 corrects most rather than all of it.
    expect(levellerProfile(1).correction).toBeLessThan(1);
    expect(levellerProfile(0).correction).toBeGreaterThan(0);
  });
});

describe("what it writes", () => {
  it("rides a gain node, because a volume lane can only attenuate", () => {
    // VOLUME_RANGE is 0..1 and normaliseEnvelope clamps into it, so a volume
    // lane cannot lift a quiet passage at all. This is the whole reason the
    // script writes a node instead of only a lane.
    const result = levellingResult(
      empty(),
      uneven([
        { seconds: 3, amp: 0.5 },
        { seconds: 3, amp: 0.06 },
      ]),
      SR,
    );
    expect(result).not.toBeNull();
    const node = result!.chain.nodes[0]!;
    expect(node.type).toBe("gain");
    expect(node.label).toBe("Even Out Levels");
    expect(node.params?.gain).toBe(0);
    expect(result!.automation.lanes[0]!.target).toBe(`fx.${node.id}.gain`);
  });

  it("returns nothing when there is nothing to correct", () => {
    expect(levellingResult(empty(), uneven([{ seconds: 6, amp: 0.4 }]), SR)).toBeNull();
  });

  it("replaces its own stage instead of stacking a second one", () => {
    const track = uneven([
      { seconds: 3, amp: 0.5 },
      { seconds: 3, amp: 0.06 },
    ]);
    const once = levellingResult(empty(), track, SR)!;
    const twice = levellingResult(once.chain, track, SR)!;
    expect(twice.chain.nodes.filter((n) => n.fromLeveller)).toHaveLength(1);
    // Same node id, so the lane it already wrote still addresses the right stage.
    expect(twice.chain.nodes[0]!.id).toBe(once.chain.nodes[0]!.id);
  });

  it("goes in FRONT of a trailing limiter, never after it", () => {
    // The likely sequence: apply Clean Voice, then even out the levels. Clean
    // Voice ends in a Peak Ceiling, and up to 12 dB of lift landing after that
    // ceiling means loud material at -1 dBFS goes over full scale and the
    // render shears it flat. A ceiling with something after it is not a ceiling.
    const voiced = applyAudioFxPreset(empty(), getAudioFxPreset("voice-clean")!);
    expect(voiced.nodes[voiced.nodes.length - 1]!.type).toBe("limiter");

    const result = levellingResult(
      voiced,
      uneven([
        { seconds: 3, amp: 0.5 },
        { seconds: 3, amp: 0.06 },
      ]),
      SR,
    )!;
    const types = result.chain.nodes.map((n) => n.type);
    expect(types[types.length - 1]).toBe("limiter");
    expect(types[types.length - 2]).toBe("gain");
    expect(result.chain.nodes.find((n) => n.fromLeveller)).toBeTruthy();
  });

  it("leaves hand-added effects alone", () => {
    const chain: HfAudioFxChain = {
      version: HF_AUDIO_FX_CHAIN_VERSION,
      nodes: [{ type: "reverb", id: "mine", enabled: true }],
    };
    const result = levellingResult(
      chain,
      uneven([
        { seconds: 3, amp: 0.5 },
        { seconds: 3, amp: 0.06 },
      ]),
      SR,
    )!;
    expect(result.chain.nodes.map((n) => n.id)).toContain("mine");
    expect(result.chain.nodes).toHaveLength(2);
  });

  it("survives the attribute round trip", () => {
    const result = levellingResult(
      empty(),
      uneven([
        { seconds: 3, amp: 0.5 },
        { seconds: 3, amp: 0.06 },
      ]),
      SR,
    )!;
    const back = parseAudioFxChain(serializeAudioFxChain(result.chain));
    // Without fromLeveller surviving, re-running stacks a second gain stage.
    expect(back.nodes.filter((n) => n.fromLeveller)).toHaveLength(1);
    expect(back.nodes[0]!.label).toBe("Even Out Levels");
  });

  it("names the lane it takes away with it", () => {
    const result = levellingResult(
      empty(),
      uneven([
        { seconds: 3, amp: 0.5 },
        { seconds: 3, amp: 0.06 },
      ]),
      SR,
    )!;
    const removed = removeLevelling(result.chain);
    expect(removed.chain.nodes).toHaveLength(0);
    // An orphaned lane keeps driving a parameter that is no longer there.
    expect(removed.removedTarget).toBe(result.automation.lanes[0]!.target);
  });
});

describe("what it says", () => {
  it("describes the moves rather than listing numbers", () => {
    expect(
      levellingSummary([
        { t: 0, v: 0 },
        { t: 1, v: 4.2 },
      ]),
    ).toMatch(/lifting quiet parts/);
    expect(levellingSummary([])).toMatch(/Already even/);
  });
});
