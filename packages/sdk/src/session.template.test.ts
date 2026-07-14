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

  it("models GSAP animations declared inside a composition template", async () => {
    const comp = await openComposition(`
      <template data-composition-id="document-card">
        <div data-hf-id="hf-line" class="line">line</div>
        <script>
          var tl = gsap.timeline({ paused: true });
          tl.to("[data-hf-id=\\"hf-line\\"]", { x: 100, duration: 1 }, 0);
        </script>
      </template>
    `);

    const animationIds = comp.getElement("hf-line")?.animationIds ?? [];
    expect(animationIds).toHaveLength(1);
    expect(comp.getAllAnimationIds()).toEqual(new Set(animationIds));
  });
});

// The authored sub-comp form `hyperframes add` scaffolds: the composition id is
// on the wrapped root div, and the <template> is keyed by `id="X-template"`.
const AUTHORED_TEMPLATE_HTML = `
<template id="card-template">
  <div data-composition-id="card" data-width="1280" data-height="720" data-duration="5">
    <h1 class="title" style="color: rgb(255, 0, 0)">Headline</h1>
  </div>
</template>
`.trim();

describe("authored template sub-comps (id on the wrapped root div)", () => {
  it("enumerates and resolves inner elements", async () => {
    const comp = await openComposition(AUTHORED_TEMPLATE_HTML);
    const title = comp.getElements().find((e) => e.classNames.includes("title"));
    expect(title).toBeTruthy();
    expect(comp.getElement(title!.id)?.text).toBe("Headline");
  });

  it("declares a variable on the root div and round-trips through serialize", async () => {
    const comp = await openComposition(AUTHORED_TEMPLATE_HTML);
    comp.declareVariable({
      id: "title-color",
      type: "color",
      label: "Title color",
      default: "#ff0000",
    });
    expect(comp.getVariableDeclarations().map((d) => d.id)).toEqual(["title-color"]);
    const serialized = comp.serialize();
    expect(serialized).toContain("data-composition-variables");
    // Survives a re-open (declaration is on the root div, not a stripped <html>).
    const reopened = await openComposition(serialized);
    expect(reopened.getVariableDeclarations().map((d) => d.id)).toEqual(["title-color"]);
  });

  it("does not treat a plain clone-source template as a composition", async () => {
    const comp = await openComposition(
      `<div data-composition-id="c" data-width="100" data-height="100" data-duration="1" data-start="0">` +
        `<template id="particle"><span class="dot">·</span></template></div>`,
    );
    // The particle template's inner <span> must NOT be enumerated (it is cloned
    // N times at runtime; a persisted inner id would duplicate across clones).
    expect(comp.getElements().some((e) => e.classNames.includes("dot"))).toBe(false);
  });
});
