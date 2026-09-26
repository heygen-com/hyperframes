import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dockCss = readFileSync(path.join(import.meta.dirname, "dock.css"), "utf8");
const themeCss = readFileSync(path.join(import.meta.dirname, "../../styles/theme.css"), "utf8");

describe("panel tab contract", () => {
  it("paints selection, hover and focus from the panel-tab tokens", () => {
    expect(dockCss).toContain(
      "--dv-activegroup-visiblepanel-tab-background-color: var(--panel-tab-bg-active)",
    );
    expect(dockCss).toContain("background-color: var(--panel-tab-bg-hover)");
    expect(dockCss).toContain("outline: 1.5px solid var(--panel-tab-ring)");
    expect(dockCss).toContain("background-size: 16px 2px");
    expect(dockCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  });

  it("keeps one dark value per tab token and documents the paper host override", () => {
    expect(themeCss).toContain("--panel-tab-bg-active: rgba(255, 255, 255, 0.08)");
    expect(themeCss).toContain("--panel-tab-bg-active-muted: rgba(255, 255, 255, 0.04)");
    expect(themeCss).toContain("active rgba(0, 0, 0, 0.06)");
    expect(themeCss).toContain("hover rgba(0, 0, 0, 0.035)");
    expect(themeCss).not.toContain("[data-theme");
    expect(themeCss).not.toContain("[data-chrome");
  });
});
