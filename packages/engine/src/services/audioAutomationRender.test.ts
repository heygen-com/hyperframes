import { describe, expect, it } from "vitest";
import { parseAudioElements, volumeLaneKeyframes } from "./audioMixer.js";
import type { HfAutomationLane } from "@hyperframes/core/audio-automation";

const lanes = (points: HfAutomationLane["points"], target = "volume") => ({
  lanes: [{ target, points }],
});

describe("volumeLaneKeyframes", () => {
  it("keeps a straight fade at two keyframes, in composition time", () => {
    const out = volumeLaneKeyframes(
      lanes([
        { t: 0, v: 1 },
        { t: 2, v: 0 },
      ]),
      5,
      2,
    );
    expect(out).toEqual([
      { time: 5, volume: 1 },
      { time: 7, volume: 0 },
    ]);
  });

  it("holds the first value before the envelope starts", () => {
    const out = volumeLaneKeyframes(
      lanes([
        { t: 1, v: 0.3 },
        { t: 2, v: 1 },
      ]),
      0,
      2,
    );
    // Not `data-volume` at t=0 — the lane's own first value.
    expect(out?.[0]).toEqual({ time: 0, volume: 0.3 });
  });

  it("holds the last value out to the clip end", () => {
    const out = volumeLaneKeyframes(
      lanes([
        { t: 0, v: 1 },
        { t: 1, v: 0.5 },
      ]),
      0,
      4,
    );
    expect(out?.at(-1)).toEqual({ time: 4, volume: 0.5 });
  });

  it("samples a bent segment, which the linear baker would straighten", () => {
    const straight = volumeLaneKeyframes(
      lanes([
        { t: 0, v: 0 },
        { t: 2, v: 1 },
      ]),
      0,
      2,
    );
    const bent = volumeLaneKeyframes(
      lanes([
        { t: 0, v: 0, curve: 1 },
        { t: 2, v: 1 },
      ]),
      0,
      2,
    );
    expect(straight?.length).toBe(2);
    expect(bent?.length ?? 0).toBeGreaterThan(30);
    // Same endpoints, different path between them.
    expect(bent?.[0]).toEqual({ time: 0, volume: 0 });
    expect(bent?.at(-1)).toEqual({ time: 2, volume: 1 });
    const mid = bent?.find((k) => Math.abs(k.time - 1) < 0.02);
    expect(mid?.volume ?? 1).toBeLessThan(0.4);
  });

  it("has nothing to bake for a track whose only lane is an FX one", () => {
    expect(volumeLaneKeyframes(lanes([{ t: 0, v: 200 }], "fx.n1.frequency"), 0, 2)).toBeNull();
  });
});

describe("parseAudioElements", () => {
  it("carries the automation attribute through to the mixer", () => {
    const automation = '{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1}]}]}';
    const html = `<!DOCTYPE html><html><body>
      <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10">
        <audio id="bgm" src="a.wav" data-start="0" data-duration="10" data-automation='${automation}'></audio>
      </div></body></html>`;
    const [el] = parseAudioElements(html);
    expect(el?.automation).toBe(automation);
  });

  it("leaves automation unset when the element has none", () => {
    const html = `<!DOCTYPE html><html><body>
      <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10">
        <audio id="bgm" src="a.wav" data-start="0" data-duration="10"></audio>
      </div></body></html>`;
    expect(parseAudioElements(html)[0]?.automation).toBeUndefined();
  });
});
