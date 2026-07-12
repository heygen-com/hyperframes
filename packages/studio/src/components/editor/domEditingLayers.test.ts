// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  collectDomEditLayerItems,
  resolveDomEditSelection,
  buildDomEditPatchTarget,
  buildTextFieldChildLocator,
  readHfId,
} from "./domEditingLayers";
import type { DomEditTextField } from "./domEditingTypes";

const opts = { activeCompositionPath: "index.html", isMasterView: true, skipSourceProbe: true };

function textField(overrides: Partial<DomEditTextField> = {}): DomEditTextField {
  return {
    key: "child:0:span",
    label: "Text 1",
    value: "Hello",
    tagName: "span",
    attributes: [],
    inlineStyles: {},
    computedStyles: {},
    source: "child",
    ...overrides,
  };
}

describe("buildDomEditPatchTarget", () => {
  it("includes hfId when selection has hfId", () => {
    const target = buildDomEditPatchTarget({
      id: undefined,
      hfId: "hf-abc",
      selector: ".foo",
      selectorIndex: 0,
    });
    expect(target.hfId).toBe("hf-abc");
  });

  it("includes id and selector when hfId absent", () => {
    const target = buildDomEditPatchTarget({
      id: "hero",
      hfId: undefined,
      selector: "#hero",
      selectorIndex: undefined,
    });
    expect(target.id).toBe("hero");
    expect(target.hfId).toBeUndefined();
  });
});

describe("readHfId", () => {
  it("returns the attribute value when present", () => {
    const el = document.createElement("div");
    el.setAttribute("data-hf-id", "hf-abc");
    expect(readHfId(el)).toBe("hf-abc");
  });

  it("returns undefined when attribute is absent", () => {
    const el = document.createElement("div");
    expect(readHfId(el)).toBeUndefined();
  });

  it("returns undefined when attribute is empty string", () => {
    const el = document.createElement("div");
    el.setAttribute("data-hf-id", "");
    expect(readHfId(el)).toBeUndefined();
  });

  it("returns undefined when attribute is whitespace-only", () => {
    const el = document.createElement("div");
    el.setAttribute("data-hf-id", "  ");
    expect(readHfId(el)).toBeUndefined();
  });
});

describe("resolveDomEditSelection — hfId from data-hf-id", () => {
  it("populates hfId from the element data-hf-id attribute", async () => {
    const el = document.createElement("div");
    el.id = "hero";
    el.setAttribute("data-hf-id", "hf-x7k2");
    document.body.appendChild(el);

    const selection = await resolveDomEditSelection(el, opts);
    document.body.removeChild(el);

    expect(selection?.hfId).toBe("hf-x7k2");
  });

  it("leaves hfId undefined when element has no data-hf-id", async () => {
    const el = document.createElement("div");
    el.id = "no-hfid-el";
    document.body.appendChild(el);

    const selection = await resolveDomEditSelection(el, opts);
    document.body.removeChild(el);

    expect(selection?.hfId).toBeUndefined();
  });
});

describe("resolveDomEditSelection — data-hf-group capture", () => {
  // <div id="parent"><div data-hf-group="Group 1"><div data-hf-group="Group 2">
  //   <span id="child"/></div></div></div>
  function buildNestedGroups() {
    const parent = document.createElement("div");
    parent.id = "parent";
    const outer = document.createElement("div");
    outer.setAttribute("data-hf-group", "Group 1");
    const inner = document.createElement("div");
    inner.setAttribute("data-hf-group", "Group 2");
    const child = document.createElement("span");
    child.id = "child";
    inner.appendChild(child);
    outer.appendChild(inner);
    parent.appendChild(outer);
    document.body.appendChild(parent);
    return { parent, outer, inner, child };
  }

  it("selects the outermost group as a unit when clicking a child (not drilled in)", async () => {
    const { parent, outer, child } = buildNestedGroups();
    const selection = await resolveDomEditSelection(child, opts);
    document.body.removeChild(parent);

    expect(selection?.element).toBe(outer);
    expect(selection?.selector).toBe('[data-hf-group="Group 1"]');
  });

  it("selects the next nested group when drilled into the outer group", async () => {
    const { parent, outer, inner, child } = buildNestedGroups();
    const selection = await resolveDomEditSelection(child, { ...opts, activeGroupElement: outer });
    document.body.removeChild(parent);

    expect(selection?.element).toBe(inner);
    expect(selection?.selector).toBe('[data-hf-group="Group 2"]');
  });

  it("selects the child when drilled all the way into the innermost group", async () => {
    const { parent, inner, child } = buildNestedGroups();
    const selection = await resolveDomEditSelection(child, { ...opts, activeGroupElement: inner });
    document.body.removeChild(parent);

    expect(selection?.element).toBe(child);
    expect(selection?.id).toBe("child");
  });

  it("layer tree is scoped to the group's members when drilled in", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    const group = document.createElement("div");
    group.setAttribute("data-hf-group", "Group 1");
    const inside = document.createElement("div");
    inside.id = "inside";
    const outside = document.createElement("div");
    outside.id = "outside";
    group.appendChild(inside);
    root.appendChild(group);
    root.appendChild(outside);
    document.body.appendChild(root);

    const opts2 = { activeCompositionPath: "index.html", isMasterView: true };
    const full = collectDomEditLayerItems(root, opts2).map((i) => i.id);
    const scoped = collectDomEditLayerItems(root, { ...opts2, activeGroupElement: group }).map(
      (i) => i.id,
    );
    document.body.removeChild(root);

    expect(full).toContain("outside");
    expect(scoped).toContain("inside");
    expect(scoped).not.toContain("outside");
  });

  it("exits the drilled-into group and selects the outside element (non-sticky drill)", async () => {
    const { parent, inner } = buildNestedGroups();
    const outside = document.createElement("div");
    outside.id = "outside";
    document.body.appendChild(outside);

    const selection = await resolveDomEditSelection(outside, {
      ...opts,
      activeGroupElement: inner,
    });
    document.body.removeChild(parent);
    document.body.removeChild(outside);

    // Drill-in is non-sticky: clicking outside the active group exits it and
    // resolves the clicked element normally (rather than selecting nothing).
    expect(selection?.id).toBe("outside");
  });
});

describe("buildTextFieldChildLocator", () => {
  it("locates a child field using its DOM-derived sourceChildIndex", () => {
    const fields = [textField({ key: "child:0:span", sourceChildIndex: 0 })];

    expect(buildTextFieldChildLocator(fields, "child:0:span")).toEqual({
      childSelector: ":scope > span",
      childIndex: 0,
    });
  });

  it("fails closed for a synthetic child field with no sourceChildIndex", () => {
    // A field built by buildDefaultDomEditTextField (e.g. "add text field")
    // has never been read back from the live DOM, so its true position among
    // same-tag siblings is unknown. Guessing it by counting same-tag "child"
    // fields elsewhere in the array can silently point at the wrong element.
    const fields = [
      textField({ key: "child:0:span", sourceChildIndex: 0 }),
      textField({ key: "child:new:1", tagName: "span" }),
    ];

    expect(buildTextFieldChildLocator(fields, "child:new:1")).toBeNull();
  });

  it("returns null for a self-sourced field", () => {
    const fields = [textField({ key: "self:0:div", source: "self", sourceChildIndex: 0 })];

    expect(buildTextFieldChildLocator(fields, "self:0:div")).toBeNull();
  });

  it("returns null for an unknown field key", () => {
    const fields = [textField({ key: "child:0:span", sourceChildIndex: 0 })];

    expect(buildTextFieldChildLocator(fields, "missing")).toBeNull();
  });
});
