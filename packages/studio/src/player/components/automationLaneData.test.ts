// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { elementAutomation, elementFxChain } from "./automationLaneData";
import type { TimelineElement } from "../store/timelineElement";

const el = (over: Partial<TimelineElement> = {}): TimelineElement => ({
  id: "bgm",
  key: "bgm",
  tag: "audio",
  start: 0,
  duration: 10,
  track: 10,
  ...over,
});

const CHAIN = JSON.stringify({
  version: 1,
  nodes: [{ type: "lowpass", id: "n1", params: { frequency: 400, q: 0.9, poles: "2" } }],
});
const LANE = JSON.stringify({
  version: 1,
  lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] }],
});

describe("automationLaneData", () => {
  it("returns the same object for the same attributes", () => {
    // The lane compares its drag draft against this identity; a fresh object per
    // playhead tick would drop the drag.
    const a = elementAutomation(el({ automation: LANE, fxChain: CHAIN }));
    const b = elementAutomation(el({ automation: LANE, fxChain: CHAIN }));
    expect(a).toBe(b);
    expect(elementFxChain(el({ fxChain: CHAIN }))).toBe(elementFxChain(el({ fxChain: CHAIN })));
  });

  it("re-parses when the chain changes even though the automation text did not", () => {
    const withChain = elementAutomation(el({ automation: LANE, fxChain: CHAIN }));
    const withoutChain = elementAutomation(el({ automation: LANE }));
    expect(withChain.lanes.map((l) => l.target)).toEqual(["fx.n1.frequency"]);
    // No chain to resolve against, so the fx lane is dropped rather than drawn.
    expect(withoutChain.lanes).toEqual([]);
  });

  it("keeps a hot entry alive when other elements push the cache past its limit", () => {
    // Eviction used to clear the whole map, which changed every lane's identity
    // at once and released any drag in progress.
    const hot = el({ automation: LANE, fxChain: CHAIN });
    const first = elementAutomation(hot);
    for (let i = 0; i < 40; i += 1) {
      elementAutomation(
        el({
          automation: JSON.stringify({
            version: 1,
            lanes: [{ target: "volume", points: [{ t: i, v: 0.5 }] }],
          }),
        }),
      );
      elementAutomation(hot);
    }
    expect(elementAutomation(hot)).toBe(first);
  });

  it("reads an unreadable attribute as nothing rather than throwing", () => {
    expect(elementAutomation(el({ automation: "{nope" })).lanes).toEqual([]);
    expect(elementFxChain(el({ fxChain: "{nope" }))).toBeNull();
  });
});
