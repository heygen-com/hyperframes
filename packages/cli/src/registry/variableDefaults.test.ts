import { describe, expect, it } from "vitest";

import { applyVariableDefaults } from "./variableDefaults.js";

/** The shape the registry actually ships: single-quoted attribute, JSON inside. */
const COMPONENT = `<div
  data-hf-ui-root
  data-composition-variables='[
    { "id": "size", "type": "number", "role": "style", "label": "Size", "default": 52, "min": 24, "max": 120 },
    { "id": "tone", "type": "enum", "role": "style", "label": "Tone", "default": "strong", "options": [{ "value": "strong", "label": "Strong" }, { "value": "muted", "label": "Muted" }, { "value": "accent", "label": "Accent" }] }
  ]'
>
  <span>Design</span>
</div>`;

function defaultOf(html: string, id: string): unknown {
  const raw = html.match(/data-composition-variables='([\s\S]*?)'/)![1]!;
  const decl = JSON.parse(raw.replace(/&#39;/g, "'")) as { id: string; default: unknown }[];
  return decl.find((d) => d.id === id)!.default;
}

describe("applyVariableDefaults", () => {
  it("rewrites the declared default so a pasted component carries the chosen value", () => {
    // The whole point: a component has no mount element, so this is the only
    // place a value picked on the catalog page can survive being pasted.
    const r = applyVariableDefaults(COMPONENT, { size: 76, tone: "accent" });

    expect(r.applied.sort()).toEqual(["size", "tone"]);
    expect(defaultOf(r.html, "size")).toBe(76);
    expect(defaultOf(r.html, "tone")).toBe("accent");
  });

  it("leaves untouched variables at their shipped defaults", () => {
    const r = applyVariableDefaults(COMPONENT, { size: 76 });

    expect(defaultOf(r.html, "tone")).toBe("strong");
  });

  it("reports an id the item does not declare instead of silently dropping it", () => {
    const r = applyVariableDefaults(COMPONENT, { nope: 1 });

    expect(r.unknown).toEqual(["nope"]);
    expect(r.applied).toEqual([]);
    expect(r.html).toBe(COMPONENT);
  });

  it("refuses an enum value outside the declared options", () => {
    // Writing it would produce a file that renders as if the value were
    // ignored, because the composition's own guard falls back to the default.
    const r = applyVariableDefaults(COMPONENT, { tone: "chartreuse" });

    expect(r.invalid).toEqual([{ id: "tone", reason: "not one of strong, muted, accent" }]);
    expect(defaultOf(r.html, "tone")).toBe("strong");
  });

  it("refuses a number outside its declared range", () => {
    expect(applyVariableDefaults(COMPONENT, { size: 9999 }).invalid).toEqual([
      { id: "size", reason: "above max 120" },
    ]);
    expect(applyVariableDefaults(COMPONENT, { size: 1 }).invalid).toEqual([
      { id: "size", reason: "below min 24" },
    ]);
  });

  it("coerces a numeric string, because a URL and a form both produce one", () => {
    // The catalog page puts values in the query string, where every value is a
    // string. Writing "76" where the composition expects a number would make
    // the guard fall back and look like the value was ignored.
    const r = applyVariableDefaults(COMPONENT, { size: "76" });

    expect(r.applied).toEqual(["size"]);
    expect(defaultOf(r.html, "size")).toBe(76);
  });

  it("escapes a value containing the attribute's own delimiter", () => {
    const withText = COMPONENT.replace(
      '{ "id": "size", "type": "number", "role": "style", "label": "Size", "default": 52, "min": 24, "max": 120 }',
      '{ "id": "label", "type": "string", "label": "Label", "default": "hi" }',
    );
    const r = applyVariableDefaults(withText, { label: "it's fine" });

    expect(r.applied).toEqual(["label"]);
    // A raw apostrophe would close the attribute early and break the markup.
    expect(r.html).not.toMatch(/data-composition-variables='[^']*it's/);
    expect(defaultOf(r.html, "label")).toBe("it's fine");
  });

  it("does nothing when the item declares no variables at all", () => {
    const plain = "<div>no declaration here</div>";

    expect(applyVariableDefaults(plain, { size: 1 })).toEqual({
      html: plain,
      applied: [],
      unknown: ["size"],
      invalid: [],
    });
  });

  it("refuses to rewrite a declaration it cannot parse", () => {
    const broken = `<div data-composition-variables='[ {"id": '>x</div>`;

    expect(applyVariableDefaults(broken, { id: 1 }).html).toBe(broken);
  });

  it("is a no-op for an empty value set", () => {
    expect(applyVariableDefaults(COMPONENT, {}).html).toBe(COMPONENT);
  });
});
