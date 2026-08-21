import { describe, expect, it } from "vitest";
import type { HfAutomation } from "@hyperframes/core/audio-automation";
import { automationAttrValue, withLane, withoutLane } from "./propertyPanelAutomation.js";

const carved = (): HfAutomation => ({
  version: 1,
  lanes: [
    { target: "fx.n1.gain", points: [{ t: 0, v: -6 }] },
    { target: "fx.n2.gain", points: [{ t: 0, v: -9 }] },
    { target: "volume", points: [{ t: 0, v: 0.8 }] },
  ],
});

/**
 * A script hands back a whole `HfAutomation` that describes only its OWN lane.
 * Writing that to the attribute would take everything else with it — the
 * carve's per-band lanes and the track's volume lane — which is silent, total,
 * and only noticed later when the mix has quietly lost its ducking.
 */
describe("withLane", () => {
  it("keeps every lane it was not asked about", () => {
    const next = withLane(carved(), { target: "fx.n9.gain", points: [{ t: 0, v: 3 }] });
    expect(next.lanes.map((l) => l.target).sort()).toEqual([
      "fx.n1.gain",
      "fx.n2.gain",
      "fx.n9.gain",
      "volume",
    ]);
    expect(next.lanes.find((l) => l.target === "volume")?.points).toEqual([{ t: 0, v: 0.8 }]);
  });

  it("replaces a lane rather than adding a second one for the same target", () => {
    // Re-running a script must not leave two lanes fighting over one parameter.
    const once = withLane(carved(), { target: "fx.n9.gain", points: [{ t: 0, v: 3 }] });
    const twice = withLane(once, { target: "fx.n9.gain", points: [{ t: 0, v: 5 }] });
    expect(twice.lanes.filter((l) => l.target === "fx.n9.gain")).toHaveLength(1);
    expect(twice.lanes.find((l) => l.target === "fx.n9.gain")?.points).toEqual([{ t: 0, v: 5 }]);
    expect(twice.lanes).toHaveLength(4);
  });

  it("does not mutate what it was given", () => {
    const before = carved();
    withLane(before, { target: "fx.n9.gain", points: [{ t: 0, v: 3 }] });
    expect(before.lanes).toHaveLength(3);
  });
});

describe("withoutLane", () => {
  it("takes one lane and leaves the rest", () => {
    // A node removed without its lane leaves an orphan driving a parameter that
    // is no longer in the graph.
    const next = withoutLane(carved(), "fx.n1.gain");
    expect(next.lanes.map((l) => l.target)).toEqual(["fx.n2.gain", "volume"]);
  });

  it("empties the attribute when the last lane goes", () => {
    const one: HfAutomation = { version: 1, lanes: [{ target: "fx.n1.gain", points: [] }] };
    expect(automationAttrValue(withoutLane(one, "fx.n1.gain"))).toBe("");
  });
});
