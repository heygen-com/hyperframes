/**
 * Variable declaration edit ops: declareVariable / updateVariableDeclaration /
 * removeVariableDeclaration. Covers dispatch semantics, can() validation,
 * CSS compat sync, patch grammar, and undo round-trips.
 */

import { describe, it, expect } from "vitest";
import { openComposition } from "./session.js";
import { variableDeclPath, pathToKey, keyToPath } from "./engine/patches.js";
import type { CompositionVariable } from "@hyperframes/core/variables";

const TITLE_DECL: CompositionVariable = {
  id: "title",
  type: "string",
  label: "Title",
  default: "Hello",
};

const COUNT_DECL: CompositionVariable = {
  id: "count",
  type: "number",
  label: "Count",
  default: 3,
  min: 0,
  max: 10,
};

const BARE_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px" data-duration="5">
  <h1 data-hf-id="hf-title" data-start="0" data-end="3">Hello</h1>
</div>
`.trim();

const DECLARED_HTML = `<!DOCTYPE html>
<html data-composition-variables='${JSON.stringify([TITLE_DECL, COUNT_DECL])}'>
<body>${BARE_HTML}</body>
</html>`;

const UNDECLARED_HTML = `<!DOCTYPE html>
<html>
<body>${BARE_HTML}</body>
</html>`;

describe("declareVariable", () => {
  it("creates the attribute on a composition with no declarations", async () => {
    const comp = await openComposition(UNDECLARED_HTML);
    expect(comp.getVariableDeclarations()).toEqual([]);
    comp.declareVariable(TITLE_DECL);
    expect(comp.getVariableDeclarations()).toEqual([TITLE_DECL]);
    expect(comp.serialize()).toContain("data-composition-variables");
  });

  it("appends to existing declarations and survives serialize round-trip", async () => {
    const comp = await openComposition(DECLARED_HTML);
    comp.declareVariable({ id: "dark", type: "boolean", label: "Dark", default: false });
    expect(comp.getVariableDeclarations().map((d) => d.id)).toEqual(["title", "count", "dark"]);

    const reopened = await openComposition(comp.serialize());
    expect(reopened.getVariableDeclarations().map((d) => d.id)).toEqual(["title", "count", "dark"]);
  });

  it("no-ops on duplicate ids and can() reports E_DUPLICATE_VARIABLE", async () => {
    const comp = await openComposition(DECLARED_HTML);
    const dup = comp.can({ type: "declareVariable", declaration: TITLE_DECL });
    expect(dup).toMatchObject({ ok: false, code: "E_DUPLICATE_VARIABLE" });
    comp.declareVariable({ ...TITLE_DECL, default: "clobbered" });
    expect(comp.getVariableDeclarations().find((d) => d.id === "title")?.default).toBe("Hello");
  });

  it("rejects structurally invalid declarations", async () => {
    const comp = await openComposition(UNDECLARED_HTML);
    const invalid = {
      id: "broken",
      type: "number",
      label: "Broken",
      default: "not-a-number",
    } as unknown as CompositionVariable;
    expect(comp.can({ type: "declareVariable", declaration: invalid })).toMatchObject({
      ok: false,
      code: "E_INVALID_ARGS",
    });
    comp.declareVariable(invalid);
    expect(comp.getVariableDeclarations()).toEqual([]);
  });

  it("rejects ids that are not valid CSS/attribute identifiers", async () => {
    const comp = await openComposition(UNDECLARED_HTML);
    for (const id of ["", " ", "has space", "1leading", "dot.id", "sla/sh", 'quo"te']) {
      expect(
        comp.can({ type: "declareVariable", declaration: { ...TITLE_DECL, id } }),
      ).toMatchObject({ ok: false, code: "E_INVALID_VARIABLE_ID" });
      comp.declareVariable({ ...TITLE_DECL, id });
    }
    expect(comp.getVariableDeclarations()).toEqual([]);
    // Sanity: a valid id with the allowed charset still declares.
    comp.declareVariable({ ...TITLE_DECL, id: "brand_color-2" });
    expect(comp.getVariableDeclarations().map((d) => d.id)).toEqual(["brand_color-2"]);
  });

  it("undo removes the declaration again", async () => {
    const comp = await openComposition(UNDECLARED_HTML);
    comp.declareVariable(TITLE_DECL);
    comp.undo();
    expect(comp.getVariableDeclarations()).toEqual([]);
    expect(comp.serialize()).not.toContain("data-composition-variables");
    comp.redo();
    expect(comp.getVariableDeclarations()).toEqual([TITLE_DECL]);
  });

  // fallow-ignore-next-line code-duplication
  it("supports fragment compositions with a root element (schema on the root div)", async () => {
    // A fragment (no <html>) still has a composition root; declarations live on
    // that root div, which survives serialize — so template/sub-comp files are
    // first-class editable, not refused.
    const comp = await openComposition(BARE_HTML);
    expect(comp.can({ type: "declareVariable", declaration: TITLE_DECL })).toMatchObject({
      ok: true,
    });
    comp.declareVariable(TITLE_DECL);
    expect(comp.getVariableDeclarations()).toEqual([TITLE_DECL]);
    expect(comp.serialize()).toContain("data-composition-variables");
  });

  it("refuses a fragment with no root element (nowhere durable to write)", async () => {
    const comp = await openComposition("just text, no element");
    expect(comp.can({ type: "declareVariable", declaration: TITLE_DECL })).toMatchObject({
      ok: false,
      code: "E_FRAGMENT_COMPOSITION",
    });
    comp.declareVariable(TITLE_DECL);
    expect(comp.getVariableDeclarations()).toEqual([]);
    expect(comp.serialize()).not.toContain("data-composition-variables");
  });
});

describe("updateVariableDeclaration", () => {
  it("replaces the declaration wholesale", async () => {
    const comp = await openComposition(DECLARED_HTML);
    comp.updateVariableDeclaration("count", { ...COUNT_DECL, label: "Item count", max: 20 });
    const decl = comp.getVariableDeclarations().find((d) => d.id === "count");
    expect(decl).toMatchObject({ label: "Item count", max: 20, default: 3 });
  });

  it("syncs the CSS compat prop when a scalar default changes", async () => {
    const comp = await openComposition(DECLARED_HTML);
    comp.updateVariableDeclaration("count", { ...COUNT_DECL, default: 7 });
    const root = comp.getElements().find((e) => e.id === "hf-stage");
    expect(root?.inlineStyles["--count"]).toBe("7");
  });

  it("keeps CSS untouched when the default is unchanged", async () => {
    const comp = await openComposition(DECLARED_HTML);
    comp.updateVariableDeclaration("count", { ...COUNT_DECL, label: "Renamed only" });
    const root = comp.getElements().find((e) => e.id === "hf-stage");
    expect(root?.inlineStyles["--count"]).toBeUndefined();
  });

  it("validates id immutability and existence via can()", async () => {
    const comp = await openComposition(DECLARED_HTML);
    expect(
      comp.can({ type: "updateVariableDeclaration", id: "count", declaration: TITLE_DECL }),
    ).toMatchObject({ ok: false, code: "E_INVALID_ARGS" });
    expect(
      comp.can({
        type: "updateVariableDeclaration",
        id: "ghost",
        declaration: { ...TITLE_DECL, id: "ghost" },
      }),
    ).toMatchObject({ ok: false, code: "E_VARIABLE_NOT_FOUND" });
  });

  it("undo restores the previous declaration", async () => {
    const comp = await openComposition(DECLARED_HTML);
    comp.updateVariableDeclaration("title", { ...TITLE_DECL, label: "Headline" });
    comp.undo();
    expect(comp.getVariableDeclarations().find((d) => d.id === "title")?.label).toBe("Title");
  });
});

describe("removeVariableDeclaration", () => {
  it("removes the entry and drops the attribute with the last one", async () => {
    const comp = await openComposition(DECLARED_HTML);
    comp.removeVariableDeclaration("count");
    expect(comp.getVariableDeclarations().map((d) => d.id)).toEqual(["title"]);
    comp.removeVariableDeclaration("title");
    expect(comp.getVariableDeclarations()).toEqual([]);
    expect(comp.serialize()).not.toContain("data-composition-variables");
  });

  it("clears the CSS compat prop and undo restores declaration + CSS", async () => {
    const comp = await openComposition(DECLARED_HTML);
    comp.setVariableValue("count", 5);
    const rootBefore = comp.getElements().find((e) => e.id === "hf-stage");
    expect(rootBefore?.inlineStyles["--count"]).toBe("5");

    comp.removeVariableDeclaration("count");
    const rootAfter = comp.getElements().find((e) => e.id === "hf-stage");
    expect(rootAfter?.inlineStyles["--count"]).toBeUndefined();
    expect(comp.getVariableDeclarations().map((d) => d.id)).toEqual(["title"]);

    comp.undo();
    const rootRestored = comp.getElements().find((e) => e.id === "hf-stage");
    expect(rootRestored?.inlineStyles["--count"]).toBe("5");
    expect(comp.getVariableDeclarations().find((d) => d.id === "count")?.default).toBe(5);
  });

  it("no-ops on unknown ids and can() reports E_VARIABLE_NOT_FOUND", async () => {
    const comp = await openComposition(DECLARED_HTML);
    expect(comp.can({ type: "removeVariableDeclaration", id: "ghost" })).toMatchObject({
      ok: false,
      code: "E_VARIABLE_NOT_FOUND",
    });
    comp.removeVariableDeclaration("ghost");
    expect(comp.getVariableDeclarations().map((d) => d.id)).toEqual(["title", "count"]);
  });
});

describe("patch grammar", () => {
  it("maps /variableDeclarations/{id} ↔ varDecl.{id} without colliding with /variables/", () => {
    const path = variableDeclPath("brand-color");
    expect(path).toBe("/variableDeclarations/brand-color");
    expect(pathToKey(path)).toBe("varDecl.brand-color");
    expect(keyToPath("varDecl.brand-color")).toBe(path);
    // The value path family must stay untouched.
    expect(pathToKey("/variables/brand-color")).toBe("var.brand-color");
    expect(keyToPath("var.brand-color")).toBe("/variables/brand-color");
  });

  it("emits declaration patches on dispatch", async () => {
    const comp = await openComposition(UNDECLARED_HTML);
    const events: string[] = [];
    comp.on("patch", (e) => {
      for (const p of e.patches) events.push(`${p.op} ${p.path}`);
    });
    comp.declareVariable(TITLE_DECL);
    comp.removeVariableDeclaration("title");
    // Declaration ops also maintain the --{id} CSS compat prop (scalar defaults).
    expect(events).toEqual([
      "add /variableDeclarations/title",
      "add /elements/hf-stage/inlineStyles/--title",
      "remove /variableDeclarations/title",
      "remove /elements/hf-stage/inlineStyles/--title",
    ]);
  });
});
