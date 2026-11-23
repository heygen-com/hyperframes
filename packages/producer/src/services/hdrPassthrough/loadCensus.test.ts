import { describe, expect, it } from "bun:test";
import { compareLoadCensus } from "./loadCensus.js";

const census = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("compareLoadCensus", () => {
  it("passes a capture page that holds what the analysis page held, or fewer", () => {
    const analysis = census({ "MutationObserver instances": 7, "Worker instances": 0 });
    expect(compareLoadCensus(analysis, analysis)).toBeNull();
    // The runtime's own observers vary from load to load.
    expect(compareLoadCensus(analysis, census({ "MutationObserver instances": 5 }))).toBeNull();
  });

  it("declines a capture page that holds more of anything", () => {
    const analysis = census({ "MutationObserver instances": 1, "Worker instances": 0 });
    expect(
      compareLoadCensus(
        analysis,
        census({ "MutationObserver instances": 2, "Worker instances": 0 }),
      ),
    ).toBe(
      "the capture page loaded differently from the analysis page (MutationObserver instances: 2 against 1)",
    );
    // A key the analysis page never counted is 0 there.
    expect(
      compareLoadCensus(analysis, census({ "animation-frame callbacks by no script": 1 })),
    ).toContain("animation-frame callbacks by no script: 1 against 0");
  });
});
