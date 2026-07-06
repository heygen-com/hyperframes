/**
 * Template-based sub-comp support — SDK must model elements inside <template>.
 *
 * The studio preview unwraps <template data-composition-id> content into the
 * served body, so the timeline hands edits hf-ids that live inside the
 * template in the raw file. Before this support, buildElement excluded the
 * whole template subtree: getElements() returned [] for template comps and
 * every edit produced a false element_not_found resolver divergence.
 */

import { describe, it, expect } from "vitest";
import { openComposition } from "./session.js";

const TEMPLATE_HTML = `
<template data-composition-id="test-minimal">
  <div data-hf-id="hf-a" class="clip" data-start="0" data-end="3">Hello</div>
  <div data-hf-id="hf-b" class="clip" data-start="3" data-end="6">World</div>
</template>
`.trim();

const TEMPLATE_UNSTAMPED_HTML = `
<template data-composition-id="test-minimal">
  <div class="clip" data-start="0" data-end="3">Hello</div>
</template>
`.trim();

describe("template-based sub-comp compositions", () => {
  it("getElements() models the template's inner elements (template itself absent)", async () => {
    const comp = await openComposition(TEMPLATE_HTML);
    const els = comp.getElements();
    expect(els.map((e) => e.id)).toEqual(["hf-a", "hf-b"]);
    expect(els.every((e) => e.tag !== "template")).toBe(true);
  });

  it("mints ids for unstamped template-inner elements on open", async () => {
    const comp = await openComposition(TEMPLATE_UNSTAMPED_HTML);
    expect(comp.getElements()).toHaveLength(1);
    expect(comp.getElements()[0]?.id).toMatch(/^hf-/);
  });

  it("getElement resolves a template-inner id", async () => {
    const comp = await openComposition(TEMPLATE_HTML);
    expect(comp.getElement("hf-a")?.text).toBe("Hello");
  });

  it("setTiming on a template-inner element mutates and serializes inside the template", async () => {
    const comp = await openComposition(TEMPLATE_HTML);
    comp.setTiming("hf-a", { start: 1.5 });
    const out = comp.serialize();
    expect(out).toContain("<template");
    // the mutated start must be INSIDE the template wrapper
    const tpl = out.slice(out.indexOf("<template"), out.indexOf("</template>"));
    expect(tpl).toContain('data-start="1.5"');
    expect(comp.getElement("hf-a")?.start).toBe(1.5);
  });

  it("timed template-inner elements carry start/duration snapshots", async () => {
    const comp = await openComposition(TEMPLATE_HTML);
    const a = comp.getElement("hf-a");
    expect(a?.start).toBe(0);
    expect(a?.duration).toBe(3);
  });

  it("plain <template> (runtime clone-source) stays fully excluded", async () => {
    const comp = await openComposition(
      `<div data-hf-id="hf-stage" data-hf-root>x</div><template><li data-hf-id="hf-clone">item</li></template>`,
    );
    expect(comp.getElements().map((e) => e.id)).toEqual(["hf-stage"]);
    expect(comp.getElement("hf-clone")).toBeNull();
  });

  it("duplicate hf-id resolves in true document order (template-inner first when it comes first)", async () => {
    // A comp-template-inner element EARLIER in the document and a top-level
    // element LATER share an id (copy-paste drift). The preview's unwrapped
    // DOM resolves the first-in-document copy; the SDK must agree.
    const comp = await openComposition(
      `<template data-composition-id="t"><div data-hf-id="hf-dup" data-start="1" data-end="2">tpl</div></template><div data-hf-id="hf-dup" data-start="5" data-end="6">top</div>`,
    );
    expect(comp.getElement("hf-dup")?.text).toBe("tpl");
  });
});
