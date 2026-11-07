import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOTION_BLUR_FINGERPRINT_FIELDS } from "../../motionBlurFingerprint";
import { compositionFingerprint, coverageSampler } from "./fingerprint";

type Style = Record<string, string>;
type Rect = [number, number, number, number];

const DEFAULTS: Style = {
  clipPath: "none",
  maskImage: "none",
  mask: "none",
  overflowX: "visible",
  overflowY: "visible",
  transformStyle: "flat",
  perspective: "none",
  mixBlendMode: "normal",
  backdropFilter: "none",
  pointerEvents: "auto",
  position: "static",
  content: "none",
};

const styles = new WeakMap<Element, Style>();
const pseudos = new WeakMap<Element, Record<string, Style>>();

function computed(el: Element, pseudo?: string | null): CSSStyleDeclaration {
  const own = pseudo ? (pseudos.get(el)?.[pseudo] ?? {}) : (styles.get(el) ?? {});
  const all = { ...DEFAULTS, ...(pseudo ? { position: "static" } : {}), ...own };
  return { ...all, getPropertyValue: (name: string) => all[name] ?? "" } as never;
}

function rectOf([left, top, right, bottom]: Rect): DOMRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect;
}

function put(parent: Element, tag: string, style: Style = {}): HTMLElement {
  const el = document.createElement(tag);
  parent.append(el);
  styles.set(el, style);
  return el;
}

function lay(el: HTMLElement, layout: { box?: Rect; offset?: [number, number]; scroll?: Rect }) {
  const def = (key: string, value: number) =>
    Object.defineProperty(el, key, { value, configurable: true });
  if (layout.box) el.getBoundingClientRect = () => rectOf(layout.box as Rect);
  if (layout.offset) {
    def("offsetWidth", layout.offset[0]);
    def("offsetHeight", layout.offset[1]);
  }
  if (layout.scroll) {
    const [sw, sh, cw, ch] = layout.scroll;
    def("scrollWidth", sw);
    def("scrollHeight", sh);
    def("clientWidth", cw);
    def("clientHeight", ch);
  }
}

const RANGE_KEYS = ["selectNodeContents", "getBoundingClientRect"] as const;
const realRange = RANGE_KEYS.map((k) => (Range.prototype as unknown as Record<string, unknown>)[k]);
const doc = document as unknown as { elementsFromPoint?: unknown };
const realElementsFromPoint = doc.elementsFromPoint;

function fingerprintOf(
  root: HTMLElement,
  movers: HTMLElement[] = [],
  covered: ReadonlySet<HTMLElement> = new Set(),
) {
  return compositionFingerprint(root, movers, covered);
}

describe("compositionFingerprint", () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(((el: Element, p?: string | null) =>
      computed(el, p)) as never);
    const range = Range.prototype as unknown as Record<string, unknown>;
    range.selectNodeContents = () => {};
    range.getBoundingClientRect = () => rectOf([0, 0, 0, 0]);
    root = document.createElement("div");
    document.body.append(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    RANGE_KEYS.forEach((k, i) => {
      (Range.prototype as unknown as Record<string, unknown>)[k] = realRange[i];
    });
    doc.elementsFromPoint = realElementsFromPoint;
    Reflect.deleteProperty(window, "__hfAcceleratedCanvases");
    document.body.innerHTML = "";
  });

  it("counts nothing for a plain composition", () => {
    put(root, "div");
    put(root, "span");
    const fp = fingerprintOf(root);
    expect(Object.values(fp).every((n) => n === 0)).toBe(true);
    expect(Object.keys(fp)).toEqual([...MOTION_BLUR_FINGERPRINT_FIELDS]);
  });

  it("splits canvases into 2d and WebGL, anywhere in the document", () => {
    put(root, "canvas");
    const gl = put(root, "canvas");
    const overlay = put(document.body, "canvas");
    Object.defineProperty(window, "__hfAcceleratedCanvases", {
      value: new WeakSet([gl, overlay]),
      configurable: true,
    });
    expect(fingerprintOf(root)).toMatchObject({ canvas2d: 1, webgl: 2 });
  });

  it("counts videos, frames and custom elements", () => {
    put(root, "video");
    put(root, "video");
    put(root, "iframe");
    put(root, "x-card");
    put(root, "my-widget");
    put(root, "section");
    expect(fingerprintOf(root)).toMatchObject({ video: 2, iframe: 1, customElement: 2 });
  });

  it("counts elements clipped by an SVG clip-path, not by a shape", () => {
    put(root, "div", { clipPath: "url(#c)" });
    put(root, "div", { clipPath: "circle(40%)" });
    put(root, "div");
    expect(fingerprintOf(root).svgClip).toBe(1);
  });

  it("counts an element once for mask-image or the mask shorthand", () => {
    put(root, "div", { maskImage: "url(a.png)" });
    put(root, "div", { mask: "url(b.svg) center / cover" });
    put(root, "div", { maskImage: "url(c.png)", mask: "url(c.png)" });
    put(root, "div", { maskImage: "none" });
    expect(fingerprintOf(root).mask).toBe(3);
  });

  it("counts a scroll container only when its content overflows", () => {
    lay(put(root, "div", { overflowY: "auto" }), { scroll: [100, 400, 100, 200] });
    lay(put(root, "div", { overflowX: "scroll" }), { scroll: [500, 50, 100, 50] });
    lay(put(root, "div", { overflowY: "auto" }), { scroll: [100, 200, 100, 200] });
    lay(put(root, "div", { overflowY: "hidden" }), { scroll: [100, 400, 100, 200] });
    lay(put(root, "div"), { scroll: [100, 400, 100, 200] });
    expect(fingerprintOf(root).scrollContainer).toBe(2);
  });

  it("counts 3D contexts: preserve-3d and perspective", () => {
    put(root, "div", { transformStyle: "preserve-3d" });
    put(root, "div", { perspective: "800px" });
    put(root, "div", { perspective: "none" });
    expect(fingerprintOf(root).threeD).toBe(2);
  });

  it("counts blend modes, and a mover's backdrop-filter once", () => {
    put(root, "div", { mixBlendMode: "multiply" });
    const glass = put(root, "div", { backdropFilter: "blur(8px)" });
    const both = put(root, "div", { backdropFilter: "blur(8px)", mixBlendMode: "screen" });
    put(root, "div", { backdropFilter: "blur(8px)" });
    expect(fingerprintOf(root, [glass, both]).blendMode).toBe(3);
  });

  it("counts movers whose content reaches past their box", () => {
    const wide = put(root, "div");
    lay(wide, { box: [0, 0, 100, 20], offset: [100, 20], scroll: [300, 20, 100, 20] });
    const spilling = put(root, "div");
    lay(spilling, { box: [0, 0, 100, 20], offset: [100, 20] });
    lay(put(spilling, "span"), { box: [90, 0, 200, 20] });
    const clipped = put(root, "div", { overflowX: "hidden", overflowY: "hidden" });
    lay(clipped, { box: [0, 0, 100, 20], offset: [100, 20], scroll: [300, 20, 100, 20] });
    const tidy = put(root, "div");
    lay(tidy, { box: [0, 0, 100, 20], offset: [100, 20] });
    lay(put(tidy, "span"), { box: [10, 0, 60, 20] });
    expect(fingerprintOf(root, [wide, spilling, clipped, tidy]).overflowingMover).toBe(2);
  });

  it("counts a mover whose text range runs past its box", () => {
    const label = put(root, "div");
    lay(label, { box: [0, 0, 100, 20], offset: [100, 20] });
    (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect = () =>
      rectOf([0, 0, 260, 20]);
    expect(fingerprintOf(root, [label]).overflowingMover).toBe(1);
  });

  describe("frontOfMover", () => {
    function scene() {
      const mover = put(root, "div");
      lay(mover, { box: [100, 50, 300, 150] });
      const child = put(mover, "span");
      const cover = put(root, "div");
      const sampler = coverageSampler(root);
      const fast = new Set([mover]);
      const count = () => fingerprintOf(root, [mover], sampler.covered).frontOfMover;
      return { mover, child, cover, sampler, fast, count };
    }
    const stack = (...els: Element[]) => vi.fn(() => els);

    it("asks what is stacked at the mover's centre, in client coordinates, every tenth step", () => {
      const { mover, cover, sampler, fast, count } = scene();
      const spy = stack(cover, mover, root);
      doc.elementsFromPoint = spy;
      sampler.sample(5, 240, fast);
      expect(spy).not.toHaveBeenCalled();
      sampler.sample(10, 240, fast);
      expect(spy).toHaveBeenCalledWith(200, 100);
      expect(count()).toBe(1);
    });

    it("samples a short scan every other step, so a 30-step scan is tested at 16 steps", () => {
      const { mover, sampler, fast } = scene();
      const spy = stack(mover, root);
      doc.elementsFromPoint = spy;
      for (let step = 0; step <= 30; step++) sampler.sample(step, 30, fast);
      expect(spy).toHaveBeenCalledTimes(16);
    });

    it("counts a mover that is covered only at a later step, not where the scan ends", () => {
      const { mover, cover, sampler, fast, count } = scene();
      let step = 0;
      doc.elementsFromPoint = vi.fn(() => (step === 30 ? [cover, mover, root] : [mover, root]));
      for (step = 0; step <= 60; step += 10) sampler.sample(step, 240, fast);
      expect(count()).toBe(1);
    });

    it("does not count a mover that is covered at no step", () => {
      const { mover, child, sampler, fast, count } = scene();
      doc.elementsFromPoint = stack(child, mover, root);
      for (let step = 0; step <= 60; step += 10) sampler.sample(step, 240, fast);
      expect(count()).toBe(0);
    });

    it("does not count what lies beneath the mover, nor the tier's own canvases", () => {
      const { mover, sampler, fast, count } = scene();
      const own = put(document.body, "canvas");
      own.setAttribute("data-hf-motion-blur", "out");
      doc.elementsFromPoint = stack(own, mover, root, document.body);
      sampler.sample(0, 240, fast);
      expect(count()).toBe(0);
    });

    it("does not count a mover that cannot be located in the stack, or a click-through mover", () => {
      const { mover, cover, sampler, fast, count } = scene();
      doc.elementsFromPoint = stack(cover, root);
      sampler.sample(0, 240, fast);
      expect(count()).toBe(0);
      styles.set(mover, { pointerEvents: "none" });
      doc.elementsFromPoint = stack(cover, mover, root);
      sampler.sample(0, 240, fast);
      expect(count()).toBe(0);
    });

    it("stops testing a mover once it is counted", () => {
      const { mover, cover, sampler, fast } = scene();
      const spy = stack(cover, mover, root);
      doc.elementsFromPoint = spy;
      for (let step = 0; step <= 60; step += 10) sampler.sample(step, 240, fast);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("counts nothing where the browser has no hit testing", () => {
      const { sampler, fast, count } = scene();
      doc.elementsFromPoint = undefined;
      sampler.sample(0, 240, fast);
      expect(count()).toBe(0);
    });
  });

  it("counts movers holding a fixed-position descendant", () => {
    const holder = put(root, "div");
    put(put(holder, "div"), "div", { position: "fixed" });
    const plain = put(root, "div");
    put(plain, "div", { position: "absolute" });
    expect(fingerprintOf(root, [holder, plain]).fixedInMover).toBe(1);
  });

  it("counts movers whose ::before or ::after box leaves their own", () => {
    const pseudo = (left: string) => ({
      content: '""',
      position: "absolute",
      left,
      top: "0px",
      width: "10px",
      height: "10px",
    });
    const out = put(root, "div");
    lay(out, { offset: [100, 20] });
    pseudos.set(out, { "::before": pseudo("-20px") });
    const trailing = put(root, "div");
    lay(trailing, { offset: [100, 20] });
    pseudos.set(trailing, { "::after": pseudo("95px") });
    const inside = put(root, "div");
    lay(inside, { offset: [100, 20] });
    pseudos.set(inside, { "::before": pseudo("10px") });
    expect(fingerprintOf(root, [out, trailing, inside]).pseudoOutside).toBe(2);
  });

  it("stops walking after a few thousand elements", () => {
    for (let i = 0; i < 4200; i++) put(root, "div", { maskImage: "url(a.png)" });
    expect(fingerprintOf(root).mask).toBe(4096);
  });

  it("carries no names", () => {
    root.id = "secret-root";
    root.className = "secret-class";
    const card = put(root, "div", { maskImage: "url(https://example.test/secret.png)" });
    card.id = "secret-card";
    card.className = "secret-card-class";
    card.textContent = "secret headline text";
    card.setAttribute("data-label", "secret-attribute");
    const canvas = put(root, "canvas");
    canvas.id = "secret-canvas";
    lay(card, { box: [0, 0, 10, 10] });
    const json = JSON.stringify(fingerprintOf(root, [card]));
    for (const secret of ["secret", "example", "headline", "https"]) {
      expect(json).not.toContain(secret);
    }
    const parsed: unknown = JSON.parse(json);
    expect(Object.keys(parsed as object)).toEqual([...MOTION_BLUR_FINGERPRINT_FIELDS]);
    expect(Object.values(parsed as object).every((n) => typeof n === "number")).toBe(true);
  });
});
