import { describe, expect, it } from "vitest";
import { isAdditiveSelectionEvent } from "./selectionModifiers";

describe("isAdditiveSelectionEvent", () => {
  it("uses Shift as the additive selection modifier", () => {
    expect(isAdditiveSelectionEvent({ shiftKey: true })).toBe(true);
    expect(isAdditiveSelectionEvent({ shiftKey: false })).toBe(false);
  });

  it("does not treat Cmd or Ctrl as additive without Shift", () => {
    const event = { shiftKey: false, metaKey: true, ctrlKey: true };
    expect(isAdditiveSelectionEvent(event)).toBe(false);
  });
});
