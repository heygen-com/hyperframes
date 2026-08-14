import { describe, expect, it } from "vitest";
import { chainTailSeconds, MAX_FX_TAIL_SECONDS } from "./audioFxTail.js";
import { synthesizeReverbImpulse } from "./audioFxGraph.js";
import type { HfAudioFxChain } from "../audioFx.js";
import type { HfAutomation } from "../audioAutomation.js";

const chain = (nodes: HfAudioFxChain["nodes"]): HfAudioFxChain => ({ version: 1, nodes });

describe("chainTailSeconds", () => {
  it("is zero for a chain that settles with its input", () => {
    expect(
      chainTailSeconds(
        chain([
          { type: "peaking", id: "n1", params: { frequency: 900, gain: -6, q: 1 } },
          { type: "compressor", id: "n2", params: { threshold: -18, ratio: 4, release: 9000 } },
          // A 9-second release still holds no tail: with no input there is no
          // signal to release, so the output is silence either way.
          { type: "phaser", id: "n3", params: { delay: 3, decay: 0.4, speed: 0.5 } },
        ]),
      ),
    ).toBe(0);
  });

  it("matches the reverb impulse it has to make room for", () => {
    // The whole point: too short and the render cuts the tail the impulse
    // generates. Measured against the generator rather than restating 0.6+2.6.
    for (const size of [0.05, 0.4, 0.7, 1]) {
      const impulse = synthesizeReverbImpulse(48000, size, 0.5);
      const tail = chainTailSeconds(
        chain([{ type: "reverb", id: "r", params: { size, damping: 0.5, wet: 0.35, dry: 0.7 } }]),
      );
      expect(tail).toBeCloseTo(impulse.length / 48000, 4);
    }
  });

  it("counts a delay's repeats down to -60 dB", () => {
    // 250 ms at 0.35 feedback: 0.35^7 = 6.4e-4, the first repeat under the floor.
    expect(
      chainTailSeconds(
        chain([{ type: "delay", id: "d", params: { time: 250, feedback: 0.35, mix: 0.5 } }]),
      ),
    ).toBeCloseTo(1.75, 5);
  });

  it("sums a serial chain instead of taking the longest", () => {
    // The delay hands each repeat to the room, so the last repeat still gets a
    // full tail — taking the max would cut the end of it.
    const both = chainTailSeconds(
      chain([
        { type: "delay", id: "d", params: { time: 250, feedback: 0.35, mix: 0.5 } },
        { type: "reverb", id: "r", params: { size: 0.3, damping: 0.5, wet: 0.35, dry: 0.7 } },
      ]),
    );
    expect(both).toBeCloseTo(1.75 + (0.6 + 0.3 * 2.6), 5);
  });

  it("caps a tail the panel can dial but nobody wants to render", () => {
    // 5 s between repeats at 0.95 feedback decays for eleven minutes.
    expect(
      chainTailSeconds(
        chain([{ type: "delay", id: "d", params: { time: 5000, feedback: 0.95, mix: 1 } }]),
      ),
    ).toBe(MAX_FX_TAIL_SECONDS);
  });

  it("ignores an effect that is bypassed or mixed out", () => {
    const bypassed = chain([
      {
        type: "reverb",
        id: "r",
        enabled: false,
        params: { size: 1, damping: 0.5, wet: 1, dry: 0 },
      },
    ]);
    expect(chainTailSeconds(bypassed)).toBe(0);
    const silent = chain([
      { type: "reverb", id: "r", params: { size: 1, damping: 0.5, wet: 0, dry: 1 } },
    ]);
    expect(chainTailSeconds(silent)).toBe(0);
  });

  it("sizes the room for the loudest moment a lane reaches", () => {
    // Static wet is 0 — read alone it would say "no tail" and cut the swell the
    // lane brings in halfway through the clip.
    const automation: HfAutomation = {
      version: 1,
      lanes: [
        {
          target: "fx.r.wet",
          points: [
            { t: 0, v: 0 },
            { t: 2, v: 0.8 },
          ],
        },
      ],
    };
    const withLane = chain([
      { type: "reverb", id: "r", params: { size: 0.5, damping: 0.5, wet: 0, dry: 1 } },
    ]);
    expect(chainTailSeconds(withLane)).toBe(0);
    expect(chainTailSeconds(withLane, automation)).toBeCloseTo(0.6 + 0.5 * 2.6, 5);
  });
});
