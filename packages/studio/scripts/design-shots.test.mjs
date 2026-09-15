import { describe, expect, it } from "vitest";
import { DESIGN_SHOT_SELECTORS, formatTable } from "./design-shots.mjs";

describe("design-shots selector list", () => {
  it("covers the five controls the sweep is judged on", () => {
    expect(DESIGN_SHOT_SELECTORS.map((entry) => entry.key)).toEqual([
      "header-export",
      "renders-export",
      "inspector-input",
      "timeline-toolbar-button",
      "menu-item",
    ]);
  });
});

describe("formatTable", () => {
  it("emits one row per selector plus a header and a rule", () => {
    const lines = formatTable({}).split("\n");
    expect(lines).toHaveLength(DESIGN_SHOT_SELECTORS.length + 2);
    expect(lines[0]).toContain("Height");
    expect(lines[1]).toBe("| --- | --- | --- | --- | --- | --- |");
  });

  it("puts each measured value in its own column", () => {
    const table = formatTable({
      "header-export": {
        height: "28px",
        radius: "6px",
        fontSize: "11px",
        background: "rgb(0, 0, 0)",
      },
    });
    const row = table.split("\n").find((line) => line.startsWith("| Header Export"));
    expect(row).toBe(
      '| Header Export | `[data-testid="header-export"]` | 28px | 6px | 11px | rgb(0, 0, 0) |',
    );
  });

  it("reports an unresolved selector rather than dropping its row", () => {
    const row = formatTable({})
      .split("\n")
      .find((line) => line.startsWith("| Menu item"));
    expect(row).toContain("not found");
  });
});
