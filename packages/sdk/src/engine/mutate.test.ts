/**
 * T4 — Op contract tests for the Phase 3a dispatch boundary.
 *
 * Tests verify: correct DOM mutation, correct RFC 6902 forward patches,
 * correct inverse patches (applying them restores the original state),
 * and override-set key mapping.
 */

import { describe, it, expect } from "vitest";
import { parseMutable, getElementStyles, setElementStyles } from "./model.js";
import { applyOp, validateOp } from "./mutate.js";
import { applyPatchesToDocument } from "./apply-patches.js";
import { pathToKey } from "./patches.js";
import { serializeDocument } from "./serialize.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

// No trailing semicolons in style attrs — serializeStyleAttr never adds them.
const BASE_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px; background: #000" data-duration="5">
  <h1 data-hf-id="hf-title" data-start="0" data-end="3" data-track-index="0"
      style="color: #fff; font-size: 64px">Hello World</h1>
  <img data-hf-id="hf-logo" src="/logo.png" alt="Logo" />
  <div data-hf-id="hf-sub">
    <span data-hf-id="hf-span" style="opacity: 0.5">sub text</span>
  </div>
</div>
`.trim();

function fresh() {
  return parseMutable(BASE_HTML);
}

// ─── setStyle ────────────────────────────────────────────────────────────────

describe("setStyle", () => {
  it("mutates existing style prop and emits replace patches", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: "hf-title",
      styles: { fontSize: "96px" },
    });
    expect(result.forward).toHaveLength(1);
    expect(result.forward[0]).toEqual({
      op: "replace",
      path: "/elements/hf-title/inlineStyles/fontSize",
      value: "96px",
    });
    expect(result.inverse[0]).toEqual({
      op: "replace",
      path: "/elements/hf-title/inlineStyles/fontSize",
      value: "64px",
    });
    // DOM mutated
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    expect(el?.getAttribute("style")).toContain("font-size: 96px");
  });

  it("adds new style prop and emits add patch", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: "hf-logo",
      styles: { opacity: "0.8" },
    });
    expect(result.forward[0]?.op).toBe("add");
    expect(result.inverse[0]?.op).toBe("remove");
  });

  it("removes style prop when value is null", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: "hf-title",
      styles: { color: null },
    });
    expect(result.forward[0]?.op).toBe("remove");
    expect(result.inverse[0]?.op).toBe("add");
    expect(result.inverse[0]?.value).toBe("#fff");
  });

  it("inverse patches restore original state", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "setStyle",
      target: "hf-title",
      styles: { fontSize: "96px", color: "#f00" },
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });

  it("applies to multiple targets", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: ["hf-title", "hf-span"],
      styles: { opacity: "1" },
    });
    expect(result.forward).toHaveLength(2);
  });

  it("override-set key maps correctly", () => {
    const key = pathToKey("/elements/hf-title/inlineStyles/fontSize");
    expect(key).toBe("hf-title.style.fontSize");
  });

  // Regression: a HYPHENATED (kebab) style key must derive its inverse against
  // the camelCase-keyed store, or oldValue is null → undo deletes the prior
  // value instead of restoring it, and a removal skips the inverse entirely.
  it("derives correct inverse for a kebab style key (change)", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: "hf-title",
      styles: { "font-size": "96px" },
    });
    // inverse restores the prior 64px (replace), not a remove
    expect(result.inverse[0]).toEqual({
      op: "replace",
      path: "/elements/hf-title/inlineStyles/fontSize",
      value: "64px",
    });
  });

  it("emits the inverse for a kebab style removal (no DOM/patch desync)", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: "hf-title",
      styles: { "font-size": null },
    });
    // removal must be recorded (forward remove + inverse add restoring 64px)
    expect(result.forward[0]?.op).toBe("remove");
    expect(result.inverse[0]).toEqual({
      op: "add",
      path: "/elements/hf-title/inlineStyles/fontSize",
      value: "64px",
    });
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    expect(el?.getAttribute("style") ?? "").not.toContain("font-size");
  });
});

// ─── setText ─────────────────────────────────────────────────────────────────

describe("setText", () => {
  it("updates text content and emits replace patch", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setText",
      target: "hf-title",
      value: "Goodbye World",
    });
    expect(result.forward[0]).toEqual({
      op: "replace",
      path: "/elements/hf-title/text",
      value: "Goodbye World",
    });
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    // text node should contain new value
    expect(el?.textContent).toContain("Goodbye World");
  });

  it("inverse patches restore original text", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "setText",
      target: "hf-title",
      value: "Changed",
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });

  it("creates text node when element has no existing text node", () => {
    const parsed = parseMutable(
      '<div data-hf-id="hf-s" data-hf-root><span data-hf-id="hf-empty"></span></div>',
    );
    const result = applyOp(parsed, { type: "setText", target: "hf-empty", value: "Added" });
    const el = parsed.document.querySelector('[data-hf-id="hf-empty"]');
    expect(el?.textContent).toBe("Added");
    expect(result.forward[0]?.op).toBe("replace");
    expect(result.forward[0]?.value).toBe("Added");
  });

  it("override-set key maps correctly", () => {
    expect(pathToKey("/elements/hf-title/text")).toBe("hf-title.text");
  });
});

// ─── setAttribute ─────────────────────────────────────────────────────────────

describe("setAttribute", () => {
  it("sets a new attribute and emits add patch", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setAttribute",
      target: "hf-logo",
      name: "src",
      value: "/new-logo.png",
    });
    expect(result.forward[0]).toEqual({
      op: "replace",
      path: "/elements/hf-logo/attributes/src",
      value: "/new-logo.png",
    });
  });

  it("removes attribute when value is null", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setAttribute",
      target: "hf-logo",
      name: "alt",
      value: null,
    });
    expect(result.forward[0]?.op).toBe("remove");
    expect(result.inverse[0]?.value).toBe("Logo");
  });

  it("inverse patches restore original attribute", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "setAttribute",
      target: "hf-logo",
      name: "src",
      value: "/changed.png",
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });
});

// ─── setTiming ────────────────────────────────────────────────────────────────

describe("setTiming", () => {
  it("updates start and recalculates end", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setTiming",
      target: "hf-title",
      start: 1,
    });
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    expect(el?.getAttribute("data-start")).toBe("1");
    // duration was 3 (0→3), so end = 1+3 = 4
    expect(el?.getAttribute("data-end")).toBe("4");
    const startPatch = result.forward.find((p) => p.path.endsWith("/start"));
    expect(startPatch?.value).toBe(1);
  });

  it("updates duration and recalculates end", () => {
    const parsed = fresh();
    applyOp(parsed, { type: "setTiming", target: "hf-title", duration: 2 });
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    expect(el?.getAttribute("data-end")).toBe("2"); // start=0, duration=2 → end=2
  });

  it("inverse patches restore original timing", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "setTiming",
      target: "hf-title",
      start: 1,
      duration: 2,
      trackIndex: 1,
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });
});

// ─── removeElement ───────────────────────────────────────────────────────────

describe("removeElement", () => {
  it("removes element from DOM and emits remove patch", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "removeElement",
      target: "hf-span",
    });
    expect(result.forward[0]?.op).toBe("remove");
    expect(result.forward[0]?.path).toBe("/elements/hf-span");
    expect(parsed.document.querySelector('[data-hf-id="hf-span"]')).toBeNull();
  });

  it("inverse patch carries html and restore position", () => {
    const parsed = fresh();
    const { inverse } = applyOp(parsed, {
      type: "removeElement",
      target: "hf-span",
    });
    expect(inverse[0]?.op).toBe("add");
    const val = inverse[0]?.value as {
      html: string;
      parentId: string | null;
      siblingIndex: number;
    };
    expect(val.html).toContain("hf-span");
    expect(val.parentId).toBe("hf-sub");
    expect(val.siblingIndex).toBe(0);
  });

  it("applying inverse patch restores the element in correct parent", () => {
    const parsed = fresh();
    const { inverse } = applyOp(parsed, {
      type: "removeElement",
      target: "hf-span",
    });
    applyPatchesToDocument(parsed, inverse);
    const restored = parsed.document.querySelector('[data-hf-id="hf-span"]');
    expect(restored).not.toBeNull();
    expect(restored?.parentElement?.getAttribute("data-hf-id")).toBe("hf-sub");
    expect(restored?.getAttribute("style")).toBe("opacity: 0.5");
    expect(restored?.textContent).toBe("sub text");
  });
});

// ─── setElementStyles (model helper) ──────────────────────────────────────────

describe("setElementStyles key normalization", () => {
  function elWith(style: string): Element {
    const parsed = parseMutable(`<div data-hf-id="hf-x" data-hf-root style="${style}"></div>`);
    const el = parsed.document.querySelector('[data-hf-id="hf-x"]');
    if (!el) throw new Error("fixture element missing");
    return el;
  }

  it("removes a hyphenated property when value is null", () => {
    const el = elWith("transform-origin: center center; opacity: 0.5");
    setElementStyles(el, { "transform-origin": null });
    const styles = getElementStyles(el);
    expect(styles.transformOrigin).toBeUndefined();
    expect(el.getAttribute("style")).not.toContain("transform-origin");
    // sibling prop untouched
    expect(styles.opacity).toBe("0.5");
  });

  it("removes a CSS custom property when value is null", () => {
    const el = elWith("--brand-color: #f00; opacity: 0.5");
    setElementStyles(el, { "--brand-color": null });
    const styles = getElementStyles(el);
    expect(styles["--brand-color"]).toBeUndefined();
    expect(el.getAttribute("style")).not.toContain("--brand-color");
    expect(styles.opacity).toBe("0.5");
  });

  it("sets a camelCase property and keeps existing props", () => {
    const el = elWith("color: #fff");
    setElementStyles(el, { fontSize: "96px" });
    const styles = getElementStyles(el);
    expect(styles.fontSize).toBe("96px");
    expect(styles.color).toBe("#fff");
  });

  it("sets a hyphenated property under its camelCase key", () => {
    const el = elWith("");
    setElementStyles(el, { "transform-origin": "top left" });
    expect(getElementStyles(el).transformOrigin).toBe("top left");
  });
});

// ─── setVariableValue ─────────────────────────────────────────────────────────

describe("setVariableValue", () => {
  it("sets CSS custom property on root element", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setVariableValue",
      id: "brand-color-primary",
      value: "#ff0000",
    });
    expect(result.forward[0]?.path).toBe("/variables/brand-color-primary");
    expect(result.forward[0]?.value).toBe("#ff0000");
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.getAttribute("style")).toContain("--brand-color-primary: #ff0000");
  });

  it("override-set key maps correctly", () => {
    expect(pathToKey("/variables/brand-color-primary")).toBe("var.brand-color-primary");
  });
});

// ─── setCompositionMetadata ───────────────────────────────────────────────────

describe("setCompositionMetadata", () => {
  it("updates width, height, duration on root element", () => {
    const parsed = fresh();
    applyOp(parsed, {
      type: "setCompositionMetadata",
      width: 1920,
      height: 1080,
      duration: 10,
    });
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.getAttribute("style")).toContain("width: 1920px");
    expect(root?.getAttribute("style")).toContain("height: 1080px");
    expect(root?.getAttribute("data-duration")).toBe("10");
  });

  it("inverse patches restore original metadata", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "setCompositionMetadata",
      width: 1920,
      height: 1080,
      duration: 10,
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });
});

// ─── moveElement ─────────────────────────────────────────────────────────────

describe("moveElement", () => {
  it("sets data-x and data-y attributes (HF positioning convention)", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "moveElement",
      target: "hf-title",
      x: 100,
      y: 200,
    });
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    expect(el?.getAttribute("data-x")).toBe("100");
    expect(el?.getAttribute("data-y")).toBe("200");
    expect(result.forward.some((p) => p.path.endsWith("/data-x"))).toBe(true);
    expect(result.forward.some((p) => p.path.endsWith("/data-y"))).toBe(true);
  });

  it("inverse restores prior data-x/data-y", () => {
    const parsed = fresh();
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]') as Element;
    el.setAttribute("data-x", "50");
    el.setAttribute("data-y", "75");
    const result = applyOp(parsed, { type: "moveElement", target: "hf-title", x: 100, y: 200 });
    applyPatchesToDocument(parsed, result.inverse);
    expect(el.getAttribute("data-x")).toBe("50");
    expect(el.getAttribute("data-y")).toBe("75");
  });
});

// ─── validateOp (can()) ───────────────────────────────────────────────────────

describe("validateOp", () => {
  it("returns ok:true for existing element", () => {
    expect(validateOp(fresh(), { type: "setStyle", target: "hf-title", styles: {} }).ok).toBe(true);
  });

  it("returns ok:false / E_TARGET_NOT_FOUND for unknown element id", () => {
    const r = validateOp(fresh(), { type: "setStyle", target: "hf-unknown", styles: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_TARGET_NOT_FOUND");
  });

  it("returns ok:true for setCompositionMetadata (no target)", () => {
    expect(validateOp(fresh(), { type: "setCompositionMetadata", width: 100 }).ok).toBe(true);
  });
});

// ─── Phase 3b ops — graceful when no GSAP script, feature-detectable ────────

describe("Phase 3b ops", () => {
  it("applyOp throws when no GSAP script is present", () => {
    expect(() =>
      applyOp(fresh(), {
        type: "addGsapTween",
        target: "hf-title",
        tween: { method: "from", properties: { opacity: 0 } },
      }),
    ).toThrow();
  });

  it("validateOp returns ok:false / E_NO_GSAP_SCRIPT when no GSAP script present", () => {
    const r1 = validateOp(fresh(), { type: "removeGsapTween", animationId: "tw-1" });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe("E_NO_GSAP_SCRIPT");
    const r2 = validateOp(fresh(), {
      type: "addGsapTween",
      target: "hf-title",
      tween: { method: "from", properties: { opacity: 0 } },
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("E_NO_GSAP_SCRIPT");
  });

  it("unrollDynamicAnimations rejects an empty element list (would delete the animation)", () => {
    const parsed = parseMutable(
      `<div data-hf-id="hf-r" data-hf-root></div>` +
        `<script>var tl = gsap.timeline({ paused: true }); tl.to("#x", { x: 1 }, 0);</script>`,
    );
    const r = validateOp(parsed, {
      type: "unrollDynamicAnimations",
      animationId: "#x-to-0-position",
      elements: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_INVALID_ARGS");
  });

  it("materializeKeyframes rejects an empty keyframe list (would empty the animation)", () => {
    const parsed = parseMutable(
      `<div data-hf-id="hf-r" data-hf-root></div>` +
        `<script>var tl = gsap.timeline({ paused: true }); tl.to("#x", { x: 1 }, 0);</script>`,
    );
    const r = validateOp(parsed, {
      type: "materializeKeyframes",
      animationId: "#x-to-0-position",
      keyframes: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_INVALID_ARGS");
  });

  it("setClassStyle no longer throws — implemented in Phase 3b", () => {
    expect(() =>
      applyOp(fresh(), {
        type: "setClassStyle",
        selector: ".box",
        styles: { color: "red" },
      }),
    ).not.toThrow();
  });
});

// ─── setCompositionMetadata — data-width/data-height forced override ─────────

describe("setCompositionMetadata data-* channel", () => {
  const ATTR_HTML = `
<div data-hf-id="hf-stage" data-hf-root data-width="1280" data-height="720" style="width: 1280px; height: 720px">
  <h1 data-hf-id="hf-title">Hi</h1>
</div>
`.trim();

  it("updates data-width/data-height when the composition carries them", () => {
    const parsed = parseMutable(ATTR_HTML);
    applyOp(parsed, { type: "setCompositionMetadata", width: 1920, height: 1080 });
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.getAttribute("data-width")).toBe("1920");
    expect(root?.getAttribute("data-height")).toBe("1080");
    expect(root?.getAttribute("style")).toContain("width: 1920px");
  });

  it("inverse restores both channels", () => {
    const parsed = parseMutable(ATTR_HTML);
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, { type: "setCompositionMetadata", width: 1920 });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });

  it("does not mint data-* attributes on compositions without them", () => {
    const parsed = fresh();
    applyOp(parsed, { type: "setCompositionMetadata", width: 1920 });
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.hasAttribute("data-width")).toBe(false);
    expect(root?.getAttribute("style")).toContain("width: 1920px");
  });
});
