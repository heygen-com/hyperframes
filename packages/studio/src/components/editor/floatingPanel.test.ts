import { describe, expect, it } from "vitest";
import { resolveFloatingPanelPosition } from "./floatingPanel";

describe("resolveFloatingPanelPosition", () => {
  it("places the panel below the anchor when there is space", () => {
    expect(
      resolveFloatingPanelPosition(
        { left: 100, top: 100, right: 220, bottom: 140, width: 120, height: 40 },
        { width: 800, height: 600 },
        { width: 280, height: 220 },
      ),
    ).toMatchObject({ top: 148, placement: "bottom" });
  });

  it("places the panel above the anchor when the bottom would be clipped", () => {
    expect(
      resolveFloatingPanelPosition(
        { left: 100, top: 500, right: 220, bottom: 540, width: 120, height: 40 },
        { width: 800, height: 600 },
        { width: 280, height: 220 },
      ),
    ).toMatchObject({ top: 272, placement: "top" });
  });

  it("clamps the panel horizontally inside the viewport", () => {
    expect(
      resolveFloatingPanelPosition(
        { left: 760, top: 100, right: 800, bottom: 140, width: 40, height: 40 },
        { width: 800, height: 600 },
        { width: 280, height: 220 },
      ).left,
    ).toBe(508);
  });
});
