import { describe, expect, it } from "vitest";
import { resolveCompositionDuration } from "./compositionDuration.js";

describe("resolveCompositionDuration", () => {
  it("an authored duration wins over any clip end", () => {
    expect(
      resolveCompositionDuration({ authoredDurationSeconds: 6, clipEndsSeconds: [3, 9] }),
    ).toEqual({ seconds: 6, source: "authored", pendingClips: 0 });
  });

  it("derives the latest clip end when nothing is authored", () => {
    expect(
      resolveCompositionDuration({ authoredDurationSeconds: null, clipEndsSeconds: [2, 7.5, 4] }),
    ).toEqual({ seconds: 7.5, source: "derived", pendingClips: 0 });
  });

  it("counts a pending clip instead of guessing its end", () => {
    expect(
      resolveCompositionDuration({ authoredDurationSeconds: null, clipEndsSeconds: [4, null] }),
    ).toEqual({ seconds: 4, source: "derived", pendingClips: 1 });
  });

  it("is unresolved with a reason when there is nothing to derive from", () => {
    expect(
      resolveCompositionDuration({ authoredDurationSeconds: null, clipEndsSeconds: [] }),
    ).toEqual({
      seconds: null,
      source: "unresolved",
      pendingClips: 0,
      reason: "no authored duration and no clip with a length",
    });
    expect(
      resolveCompositionDuration({ authoredDurationSeconds: null, clipEndsSeconds: [null] }).reason,
    ).toBe("every clip's length is still pending");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not treat %s as an authored duration or a clip end",
    (bad) => {
      expect(
        resolveCompositionDuration({ authoredDurationSeconds: bad, clipEndsSeconds: [bad] }).source,
      ).toBe("unresolved");
    },
  );
});
