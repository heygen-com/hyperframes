// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveDomEditSelection, buildDomEditPatchTarget, readHfId } from "./domEditingLayers";

const opts = { activeCompositionPath: "index.html", isMasterView: true, skipSourceProbe: true };

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
