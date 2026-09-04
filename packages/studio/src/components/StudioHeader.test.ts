import { describe, expect, it } from "vitest";
import { historyTooltipLabel, shouldOpenInspector } from "./StudioHeader";

describe("historyTooltipLabel", () => {
  // A disabled control gets no pointer events, so its tooltip cannot be opened
  // to read. The wording is checked here instead of through the DOM.
  it("names the action that would be undone", () => {
    expect(historyTooltipLabel("undo", "Move layer")).toMatch(/^Undo Move layer \(.+\)$/);
  });

  it("names the action that would be redone", () => {
    expect(historyTooltipLabel("redo", "Move layer")).toMatch(/^Redo Move layer \(.+\)$/);
  });

  it("keeps the shortcut when the history is empty", () => {
    expect(historyTooltipLabel("undo", undefined)).toMatch(/^Undo \(.+\)$/);
    expect(historyTooltipLabel("redo", null)).toMatch(/^Redo \(.+\)$/);
  });
});

describe("shouldOpenInspector", () => {
  it("opens when the panel is hidden", () => {
    expect(shouldOpenInspector(true, false)).toBe(true);
  });

  it("opens when a non-inspector tab is showing", () => {
    expect(shouldOpenInspector(false, false)).toBe(true);
  });

  it("closes when the inspector is genuinely on screen", () => {
    expect(shouldOpenInspector(false, true)).toBe(false);
  });

  it("opens when the window railed the panel away", () => {
    // The regression this guards: the button used to branch on the raw
    // rightCollapsed intent, which is still `false` while the window has the
    // panel railed. That took the close branch, wrote rightCollapsed=true, and
    // since that value is synced into the shareable Studio URL, a click that
    // did nothing visible rewrote the link.
    const userIntentIsOpen = false;
    const windowRailedItAway = true;
    expect(shouldOpenInspector(windowRailedItAway, true)).toBe(true);
    expect(shouldOpenInspector(userIntentIsOpen, true)).toBe(false);
  });
});
