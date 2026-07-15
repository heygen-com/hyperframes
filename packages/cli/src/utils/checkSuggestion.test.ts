import { describe, expect, it } from "vitest";
import { registrySuggestionForFinding } from "./checkSuggestion.js";

describe("registrySuggestionForFinding", () => {
  it.each([
    ["motion_frozen", "a static hold can carry motion via 'hyperframes add drift-hold'"],
    [
      "text_box_overflow",
      "oversized copy can reuse the fit pattern from 'hyperframes add headline-slam'",
    ],
    [
      "flat_background",
      "a flat background can gain ambient depth via 'hyperframes add aurora-drift' or 'hyperframes add grain-field'",
    ],
    [
      "abrupt_scene_change",
      "an abrupt scene change can use matched motion via 'hyperframes add cut-the-curve' or a crossfade",
    ],
    ["contrast_aa_failure", "low contrast should be corrected with the composition theme tokens"],
  ])("maps %s to its shelf suggestion", (code, expected) => {
    expect(registrySuggestionForFinding(code)).toBe(expected);
  });

  it("does not suggest a component for unrelated findings", () => {
    expect(registrySuggestionForFinding("connector_detached")).toBeUndefined();
  });
});
