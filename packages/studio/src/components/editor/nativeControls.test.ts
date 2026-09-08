/**
 * R13: a hand-rolled range input or a native `<select>` under the inspector is
 * a duplicate of a shared primitive that already exists.
 *
 * A ratchet rather than a flat ban, because the inspector sweep is cut by
 * section family and the later families have not moved yet. The allowlist is
 * the set of files that still carry one; a new offender fails the test because
 * it is not in the list, and a converted file fails it until it is removed, so
 * the list can only shrink. U12 generalises this into the lint rule.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EDITOR_DIR = __dirname;

/** Still native. Delete an entry when its section family moves to the shared primitive. */
const NATIVE_SELECT_ALLOWED = [
  "AnimationCardParts.tsx",
  "BlockParamsPanel.tsx",
  "EaseParamFields.tsx",
  "KeyframeEaseList.tsx",
  "propertyPanelColorGradingControls.tsx",
  "propertyPanelColorGradingSection.tsx",
  "propertyPanelFill.tsx",
  "propertyPanelFlatColorGradingSection.tsx",
  "propertyPanelFlatTextSection.tsx",
  "propertyPanelFxControls.tsx",
  "propertyPanelSections.tsx",
];

const RANGE_INPUT_ALLOWED = [
  "BlockParamsPanel.tsx",
  "propertyPanelColorGradingSlider.tsx",
  "propertyPanelColorWheels.tsx",
  "propertyPanelFxControls.tsx",
  "propertyPanelFxEqModule.tsx",
];

function sourceFiles() {
  return readdirSync(EDITOR_DIR)
    .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
    .sort();
}

/** Only real markup counts: a prose mention of `<select>` in a comment is not a control. */
function filesMatching(pattern: RegExp): string[] {
  return sourceFiles().filter((name) => {
    const source = readFileSync(path.join(EDITOR_DIR, name), "utf8");
    return source
      .split("\n")
      .some((line) => pattern.test(line) && !line.trimStart().startsWith("*"));
  });
}

describe("duplicate controls under components/editor (R13)", () => {
  it("leaves no native <select> outside the ratchet", () => {
    expect(filesMatching(/<select\b/)).toEqual(NATIVE_SELECT_ALLOWED);
  });

  it("leaves no hand-rolled range input outside the ratchet", () => {
    expect(filesMatching(/type="range"/)).toEqual(RANGE_INPUT_ALLOWED);
  });

  it("finds files at all, so the two checks above are not vacuous", () => {
    expect(sourceFiles().length).toBeGreaterThan(20);
    expect(filesMatching(/<select\b/).length).toBeGreaterThan(0);
  });
});
