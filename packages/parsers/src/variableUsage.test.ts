import { describe, it, expect } from "vitest";
import { scanVariableUsage } from "./variableUsage.js";

describe("scanVariableUsage", () => {
  it("collects ids from direct destructuring with defaults", () => {
    const scan = scanVariableUsage(`
      const { title = "Untitled", accent } = __hyperframes.getVariables();
      document.querySelector("h1").textContent = title;
    `);
    expect(scan.usedIds).toEqual(["title", "accent"]);
    expect(scan.scanIncomplete).toBe(false);
  });

  it("handles bare getVariables (sub-comp scoped shadow) and window-qualified calls", () => {
    expect(scanVariableUsage(`const { a } = getVariables();`).usedIds).toEqual(["a"]);
    expect(scanVariableUsage(`const { b } = window.__hyperframes.getVariables();`).usedIds).toEqual(
      ["b"],
    );
  });

  it("collects ids from member access on the call and on an alias", () => {
    const scan = scanVariableUsage(`
      const x = __hyperframes.getVariables().headline;
      const vars = __hyperframes.getVariables();
      el.style.color = vars.accent;
      const size = vars["font-size"];
      const { title } = vars;
    `);
    expect(scan.usedIds).toEqual(["headline", "accent", "font-size", "title"]);
    expect(scan.scanIncomplete).toBe(false);
  });

  it("collects string-literal destructuring keys", () => {
    const scan = scanVariableUsage(`const { "kebab-id": kebab } = getVariables();`);
    expect(scan.usedIds).toEqual(["kebab-id"]);
    expect(scan.scanIncomplete).toBe(false);
  });

  it("flags dynamic access as incomplete without losing static ids", () => {
    const scan = scanVariableUsage(`
      const vars = getVariables();
      const known = vars.known;
      const dynamic = vars[someKey];
    `);
    expect(scan.usedIds).toEqual(["known"]);
    expect(scan.scanIncomplete).toBe(true);
  });

  it("flags rest spreads, escaping values, and chained aliases", () => {
    expect(scanVariableUsage(`const { a, ...rest } = getVariables();`).scanIncomplete).toBe(true);
    expect(scanVariableUsage(`render(getVariables());`).scanIncomplete).toBe(true);
    expect(
      scanVariableUsage(`const vars = getVariables(); const v2 = vars; use(v2.x);`).scanIncomplete,
    ).toBe(true);
  });

  it("flags unparseable scripts as incomplete", () => {
    const scan = scanVariableUsage(`const { = broken`);
    expect(scan.usedIds).toEqual([]);
    expect(scan.scanIncomplete).toBe(true);
  });

  it("ignores unrelated code and same-named object keys", () => {
    const scan = scanVariableUsage(`
      const vars = getVariables();
      const config = { vars: 1, other: vars.real };
      gsap.timeline({ paused: true });
    `);
    expect(scan.usedIds).toEqual(["real"]);
    expect(scan.scanIncomplete).toBe(false);
  });

  it("returns empty for scripts that never touch variables", () => {
    const scan = scanVariableUsage(`gsap.timeline({ paused: true }).to(".x", { opacity: 1 });`);
    expect(scan.usedIds).toEqual([]);
    expect(scan.scanIncomplete).toBe(false);
  });
});
