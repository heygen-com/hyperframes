/**
 * Variable read APIs: getVariableDeclarations / getVariableValues /
 * validateVariableValues. Semantics contract: declarations use the strict
 * canonical parser; values mirror the runtime's loose defaults + overrides
 * merge; validation matches --strict-variables.
 */

import { describe, it, expect } from "vitest";
import { openComposition } from "./session.js";

const DECLS = [
  { id: "title", type: "string", label: "Title", default: "Hello" },
  { id: "accent", type: "color", label: "Accent", default: "#00C3FF" },
  { id: "count", type: "number", label: "Count", default: 3, min: 0, max: 10 },
  { id: "dark", type: "boolean", label: "Dark mode", default: false },
  {
    id: "layout",
    type: "enum",
    label: "Layout",
    default: "wide",
    options: [
      { value: "wide", label: "Wide" },
      { value: "tall", label: "Tall" },
    ],
  },
];

function htmlWithVariables(attr: string): string {
  return `<!DOCTYPE html>
<html data-composition-variables='${attr}'>
<body>
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px" data-duration="5">
  <h1 data-hf-id="hf-title" data-start="0" data-end="3">Hello</h1>
</div>
</body>
</html>`;
}

const BASE_HTML = htmlWithVariables(JSON.stringify(DECLS));

describe("getVariableDeclarations", () => {
  it("returns the declared schema with per-type metadata intact", async () => {
    const comp = await openComposition(BASE_HTML);
    const decls = comp.getVariableDeclarations();
    expect(decls.map((d) => d.id)).toEqual(["title", "accent", "count", "dark", "layout"]);
    const count = decls.find((d) => d.id === "count");
    expect(count).toMatchObject({ type: "number", min: 0, max: 10, default: 3 });
    const layout = decls.find((d) => d.id === "layout");
    expect(layout).toMatchObject({ type: "enum", default: "wide" });
  });

  it("returns [] when the attribute is absent", async () => {
    const comp = await openComposition(
      `<div data-hf-id="hf-stage" data-hf-root data-duration="5"><p data-hf-id="hf-p">x</p></div>`,
    );
    expect(comp.getVariableDeclarations()).toEqual([]);
  });

  it("returns [] for invalid JSON and drops malformed entries", async () => {
    const invalid = await openComposition(htmlWithVariables("{not json"));
    expect(invalid.getVariableDeclarations()).toEqual([]);

    const mixed = JSON.stringify([
      { id: "ok", type: "string", label: "Ok", default: "yes" },
      { id: "bad-type", type: "gradient", label: "Nope", default: "x" },
      { id: "bad-default", type: "number", label: "Nope", default: "not-a-number" },
      "not-an-object",
    ]);
    const mixedComp = await openComposition(htmlWithVariables(mixed));
    const decls = mixedComp.getVariableDeclarations();
    expect(decls.map((d) => d.id)).toEqual(["ok"]);
  });
});

describe("getVariableValues", () => {
  it("returns declared defaults when no overrides given", async () => {
    const comp = await openComposition(BASE_HTML);
    expect(comp.getVariableValues()).toEqual({
      title: "Hello",
      accent: "#00C3FF",
      count: 3,
      dark: false,
      layout: "wide",
    });
  });

  it("overrides win and undeclared override keys pass through (runtime parity)", async () => {
    const comp = await openComposition(BASE_HTML);
    const values = comp.getVariableValues({ title: "Custom", extra: 42 });
    expect(values.title).toBe("Custom");
    expect(values.accent).toBe("#00C3FF");
    expect(values.extra).toBe(42);
  });

  it("uses the loose runtime defaults filter, not the strict declaration parser", async () => {
    // A number variable with a string default is dropped by the strict parser
    // but its default still flows through the runtime's readDeclaredDefaults —
    // getVariableValues must match what a composition script actually reads.
    const attr = JSON.stringify([
      { id: "loose", type: "number", label: "Loose", default: "not-a-number" },
    ]);
    const comp = await openComposition(htmlWithVariables(attr));
    expect(comp.getVariableDeclarations()).toEqual([]);
    expect(comp.getVariableValues()).toEqual({ loose: "not-a-number" });
  });

  it("returns {} for a composition with no declarations", async () => {
    const comp = await openComposition(
      `<div data-hf-id="hf-stage" data-hf-root data-duration="5"><p data-hf-id="hf-p">x</p></div>`,
    );
    expect(comp.getVariableValues()).toEqual({});
    expect(comp.getVariableValues({ a: 1 })).toEqual({ a: 1 });
  });
});

describe("validateVariableValues", () => {
  it("returns [] for values conforming to the schema", async () => {
    const comp = await openComposition(BASE_HTML);
    expect(comp.validateVariableValues({ title: "x", count: 5, dark: true })).toEqual([]);
  });

  it("flags undeclared keys, type mismatches, and enum violations", async () => {
    const comp = await openComposition(BASE_HTML);
    const issues = comp.validateVariableValues({
      ghost: "boo",
      count: "five",
      layout: "diagonal",
    });
    const kinds = issues.map((i) => `${i.kind}:${i.variableId}`).sort();
    expect(kinds).toEqual(["enum-out-of-range:layout", "type-mismatch:count", "undeclared:ghost"]);
  });

  it("stays consistent after setVariableValue edits the default", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setVariableValue("title", "Edited");
    expect(comp.getVariableValues().title).toBe("Edited");
    expect(comp.getVariableDeclarations().find((d) => d.id === "title")?.default).toBe("Edited");
    expect(comp.validateVariableValues({ title: "still-a-string" })).toEqual([]);
  });
});

describe("getVariableValue base defaults", () => {
  it("returns the pre-override declared default with { base: true }", async () => {
    // openComposition({overrides}) folds var.<id> into the declaration —
    // the live default becomes the override. base:true must still see
    // the authored value.
    const comp = await openComposition(BASE_HTML, {
      overrides: { "var.accent": "#FF0000" },
    });
    expect(comp.getVariableValue("accent")).toBe("#FF0000");
    expect(comp.getVariableValue("accent", { base: true })).toBe("#00C3FF");
  });

  it("keeps the base default stable across live setVariableValue dispatches", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setVariableValue("accent", "#123456");
    expect(comp.getVariableValue("accent")).toBe("#123456");
    expect(comp.getVariableValue("accent", { base: true })).toBe("#00C3FF");
  });

  it("returns undefined for an undeclared id with { base: true }", async () => {
    const comp = await openComposition(BASE_HTML);
    expect(comp.getVariableValue("never-declared", { base: true })).toBeUndefined();
  });

  it("falls back to the live default for a variable declared mid-session", async () => {
    // A variable that did not exist at open has no pre-override snapshot —
    // its current declaration IS its base.
    const comp = await openComposition(BASE_HTML);
    comp.declareVariable({ id: "brand-title", type: "string", label: "Title", default: "Hi" });
    expect(comp.getVariableValue("brand-title", { base: true })).toBe("Hi");
  });
});
