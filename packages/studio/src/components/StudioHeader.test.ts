import { describe, expect, it, vi } from "vitest";
import { openRenderPanel, shouldOpenInspector } from "./StudioHeader";

describe("openRenderPanel", () => {
  it("opens render settings without starting a render", () => {
    const setRightPanelTab = vi.fn();
    const setRightCollapsed = vi.fn();

    openRenderPanel(setRightPanelTab, setRightCollapsed);

    expect(setRightPanelTab).toHaveBeenCalledWith("renders");
    expect(setRightCollapsed).toHaveBeenCalledWith(false);
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
