/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getVariables, readDeclaredDefaults } from "./getVariables";

const VARIABLES_ATTR = "data-composition-variables";

function setDeclared(json: string | null) {
  if (json == null) {
    document.documentElement.removeAttribute(VARIABLES_ATTR);
  } else {
    document.documentElement.setAttribute(VARIABLES_ATTR, json);
  }
}

function setOverrides(value: unknown) {
  (window as Window & { __hfVariables?: unknown }).__hfVariables = value;
}

describe("getVariables", () => {
  beforeEach(() => {
    setDeclared(null);
    setOverrides(undefined);
  });

  afterEach(() => {
    setDeclared(null);
    setOverrides(undefined);
  });

  it("returns {} when nothing is declared and no overrides", () => {
    expect(getVariables()).toEqual({});
  });

  it("returns declared defaults when no overrides", () => {
    setDeclared(
      JSON.stringify([
        { id: "title", type: "string", label: "Title", default: "Hello" },
        { id: "count", type: "number", label: "Count", default: 3 },
        { id: "active", type: "boolean", label: "Active", default: true },
      ]),
    );
    expect(getVariables()).toEqual({ title: "Hello", count: 3, active: true });
  });

  it("merges overrides over declared defaults (overrides win)", () => {
    setDeclared(
      JSON.stringify([
        { id: "title", type: "string", label: "Title", default: "Hello" },
        { id: "theme", type: "string", label: "Theme", default: "light" },
      ]),
    );
    setOverrides({ title: "Custom Title" });
    expect(getVariables()).toEqual({ title: "Custom Title", theme: "light" });
  });

  it("includes override keys not declared in the schema", () => {
    setDeclared(JSON.stringify([{ id: "title", type: "string", label: "Title", default: "x" }]));
    setOverrides({ extra: 42 });
    expect(getVariables()).toEqual({ title: "x", extra: 42 });
  });

  it("returns {} when the declared JSON is invalid", () => {
    setDeclared("{not-json");
    expect(getVariables()).toEqual({});
  });

  it("ignores declared entries without an id or default", () => {
    setDeclared(
      JSON.stringify([
        { id: "ok", type: "string", label: "Ok", default: "yes" },
        { type: "string", label: "no-id", default: "nope" },
        { id: "no-default", type: "string", label: "No default" },
        "not-an-object",
        null,
      ]),
    );
    expect(getVariables()).toEqual({ ok: "yes" });
  });

  it("ignores non-array declared payloads", () => {
    setDeclared(JSON.stringify({ title: "Hello" }));
    expect(getVariables()).toEqual({});
  });

  it("ignores non-object overrides (string, array, null)", () => {
    setDeclared(JSON.stringify([{ id: "title", type: "string", label: "Title", default: "x" }]));
    setOverrides("not-an-object");
    expect(getVariables()).toEqual({ title: "x" });
    setOverrides([1, 2, 3]);
    expect(getVariables()).toEqual({ title: "x" });
    setOverrides(null);
    expect(getVariables()).toEqual({ title: "x" });
  });

  it("supports the typed generic for editor ergonomics", () => {
    setDeclared(
      JSON.stringify([{ id: "title", type: "string", label: "Title", default: "Hello" }]),
    );
    type Vars = { title: string; missing?: number };
    const vars = getVariables<Vars>();
    expect(vars.title).toBe("Hello");
    expect(vars.missing).toBeUndefined();
  });
});

describe("T8 — override-set merge semantics (flat-merge, current behaviour)", () => {
  beforeEach(() => {
    setDeclared(null);
    setOverrides(undefined);
  });

  afterEach(() => {
    setDeclared(null);
    setOverrides(undefined);
  });

  it("last override write wins when called twice (flat-merge)", () => {
    setDeclared(JSON.stringify([{ id: "color", type: "string", label: "Color", default: "red" }]));
    setOverrides({ color: "blue" });
    setOverrides({ color: "green" });
    expect(getVariables()).toEqual({ color: "green" });
  });

  it("sparse override leaves unmentioned declared defaults intact", () => {
    setDeclared(
      JSON.stringify([
        { id: "title", type: "string", label: "Title", default: "Hello" },
        { id: "theme", type: "string", label: "Theme", default: "light" },
        { id: "count", type: "number", label: "Count", default: 3 },
      ]),
    );
    setOverrides({ theme: "dark" });
    const result = getVariables();
    expect(result).toEqual({ title: "Hello", theme: "dark", count: 3 });
  });

  it("batch override (brand kit) applies all keys at once", () => {
    setDeclared(
      JSON.stringify([
        { id: "primary", type: "string", label: "Primary", default: "#fff" },
        { id: "secondary", type: "string", label: "Secondary", default: "#000" },
        { id: "font", type: "string", label: "Font", default: "Inter" },
      ]),
    );
    setOverrides({ primary: "#0f0f0f", secondary: "#e5e5e5", font: "Roboto" });
    expect(getVariables()).toEqual({
      primary: "#0f0f0f",
      secondary: "#e5e5e5",
      font: "Roboto",
    });
  });

  it("second override replaces the first — uncovered keys fall back to declared defaults, not prior override values", () => {
    setDeclared(
      JSON.stringify([
        { id: "primary", type: "string", label: "Primary", default: "#fff" },
        { id: "secondary", type: "string", label: "Secondary", default: "#000" },
      ]),
    );
    // Apply a full brand-kit batch override covering both keys.
    setOverrides({ primary: "#brand-primary", secondary: "#brand-secondary" });
    // setOverrides replaces entirely, not patches — secondary drops back to declared default, not "#brand-secondary".
    setOverrides({ primary: "#manual" });
    expect(getVariables()).toEqual({ primary: "#manual", secondary: "#000" });
  });

  it("setOverrides(undefined) clears overrides — declared defaults are returned", () => {
    setDeclared(
      JSON.stringify([{ id: "title", type: "string", label: "Title", default: "Hello" }]),
    );
    setOverrides({ title: "Custom" });
    expect(getVariables()).toEqual({ title: "Custom" });
    setOverrides(undefined);
    expect(getVariables()).toEqual({ title: "Hello" });
  });
});

describe("readDeclaredDefaults", () => {
  it("returns {} for a null root", () => {
    expect(readDeclaredDefaults(null)).toEqual({});
  });

  it("extracts {id: default} from an arbitrary element with the attribute", () => {
    const el = document.createElement("html");
    el.setAttribute(
      "data-composition-variables",
      JSON.stringify([
        { id: "title", type: "string", label: "Title", default: "Hello" },
        { id: "count", type: "number", label: "Count", default: 3 },
      ]),
    );
    expect(readDeclaredDefaults(el)).toEqual({ title: "Hello", count: 3 });
  });

  it("returns {} when the attribute is invalid JSON or non-array", () => {
    const a = document.createElement("html");
    a.setAttribute("data-composition-variables", "{not json");
    expect(readDeclaredDefaults(a)).toEqual({});
    const b = document.createElement("html");
    b.setAttribute("data-composition-variables", JSON.stringify({ title: "x" }));
    expect(readDeclaredDefaults(b)).toEqual({});
  });
});

describe("css variable injection (figma brand-token chain)", () => {
  afterEach(() => {
    document.documentElement.removeAttribute(VARIABLES_ATTR);
    document.documentElement.removeAttribute("data-hf-css-vars");
    document.documentElement.style.cssText = "";
    document.body.innerHTML = "";
    delete (window as Window & { __hfVariables?: unknown }).__hfVariables;
  });

  it("slug stays byte-compatible with the figma importer", async () => {
    const { slugify } = await import("../figma/nodeToHtml");
    const { cssVariableName } = await import("../tokenSlug");
    for (const id of [
      "figma:sds-color-background-brand-default",
      "figma:Brand/Primary 500",
      "figma:Acme/Semantic/Blue-500",
      "!!!",
    ]) {
      expect(cssVariableName(id)).toBe(`--${slugify(id)}`);
    }
  });

  it("defines declared variables on the DECLARING element, not globally", async () => {
    const { injectCompositionCssVariables } = await import("./getVariables");
    document.body.innerHTML = `<div id="root" ${VARIABLES_ATTR}='[{"id":"figma:brand/primary","type":"color","label":"p","default":"#112233"}]'></div>`;
    injectCompositionCssVariables(document);
    const root = document.getElementById("root") as HTMLElement;
    expect(root.style.getPropertyValue("--figma-brand-primary")).toBe("#112233");
    expect(document.documentElement.style.getPropertyValue("--figma-brand-primary")).toBe("");
  });

  it("two compositions on one page keep their own same-id values", async () => {
    const { injectCompositionCssVariables } = await import("./getVariables");
    document.body.innerHTML =
      `<div id="a" ${VARIABLES_ATTR}='[{"id":"figma:brand","type":"color","label":"b","default":"#aa0000"}]'></div>` +
      `<div id="b" ${VARIABLES_ATTR}='[{"id":"figma:brand","type":"color","label":"b","default":"#0000bb"}]'></div>`;
    injectCompositionCssVariables(document);
    expect(
      (document.getElementById("a") as HTMLElement).style.getPropertyValue("--figma-brand"),
    ).toBe("#aa0000");
    expect(
      (document.getElementById("b") as HTMLElement).style.getPropertyValue("--figma-brand"),
    ).toBe("#0000bb");
  });

  it("declared defaults do NOT clobber an authored inline definition (define-if-absent)", async () => {
    const { injectCompositionCssVariables } = await import("./getVariables");
    document.body.innerHTML = `<div id="root" style="--accent: #3b82f6" ${VARIABLES_ATTR}='[{"id":"accent","type":"color","label":"a","default":"#ff5722"}]'></div>`;
    injectCompositionCssVariables(document);
    expect(
      (document.getElementById("root") as HTMLElement).style.getPropertyValue("--accent"),
    ).toBe("#3b82f6");
  });

  it("render-time overrides win over declared defaults AND authored values", async () => {
    const { injectCompositionCssVariables } = await import("./getVariables");
    document.body.innerHTML = `<div id="root" style="--figma-brand: #000000" ${VARIABLES_ATTR}='[{"id":"figma:brand","type":"color","label":"b","default":"#2c2c2c"}]'></div>`;
    (window as Window & { __hfVariables?: Record<string, unknown> }).__hfVariables = {
      "figma:brand": "#00ff99",
    };
    injectCompositionCssVariables(document);
    expect(
      (document.getElementById("root") as HTMLElement).style.getPropertyValue("--figma-brand"),
    ).toBe("#00ff99");
  });

  it("skips empty-string values (setProperty would remove, not define)", async () => {
    const { applyCssVariables } = await import("./getVariables");
    const el = document.createElement("div");
    applyCssVariables(el, { blank: "", real: "#123456" });
    expect(el.style.getPropertyValue("--blank")).toBe("");
    expect(el.style.getPropertyValue("--real")).toBe("#123456");
    expect(el.getAttribute("data-hf-css-vars")).toBe("--real");
  });

  it("clearAppliedCssVariables removes exactly what was applied", async () => {
    const { applyCssVariables, clearAppliedCssVariables } = await import("./getVariables");
    const el = document.createElement("div");
    el.style.setProperty("--authored", "keep");
    applyCssVariables(el, { "figma:brand": "#111111" });
    clearAppliedCssVariables(el);
    expect(el.style.getPropertyValue("--figma-brand")).toBe("");
    expect(el.style.getPropertyValue("--authored")).toBe("keep");
    expect(el.hasAttribute("data-hf-css-vars")).toBe(false);
  });

  it("getVariables() honors element-declared variables like the injection does", async () => {
    const { getVariables } = await import("./getVariables");
    document.body.innerHTML = `<div ${VARIABLES_ATTR}='[{"id":"figma:brand","type":"color","label":"b","default":"#445566"}]'></div>`;
    expect(getVariables()["figma:brand"]).toBe("#445566");
  });
});
