import { describe, expect, it, beforeEach } from "vitest";
import { Window } from "happy-dom";
import { resolveElementAffordances } from "./affordances";

let doc: Document;

beforeEach(() => {
  const win = new Window();
  doc = win.document as unknown as Document;
});

function el(html: string): HTMLElement {
  doc.body.innerHTML = html;
  const node = doc.body.firstElementChild;
  const view = doc.defaultView;
  if (!view) throw new Error("no defaultView");
  if (!(node instanceof view.HTMLElement)) throw new Error("expected HTMLElement");
  return node as unknown as HTMLElement;
}

describe("resolveElementAffordances (live DOM)", () => {
  it("video element with model => media + colorGrading, existsInSource", () => {
    const v = el(`<video data-hf-id="hf-v" style="position:absolute;left:10px;top:20px"></video>`);
    const a = resolveElementAffordances(v, { text: null, animationIds: [], start: null });
    expect(a.sections).toMatchObject({ media: true, colorGrading: true });
    expect(a.capabilities.canSelect).toBe(true);
  });

  it("absolutely-positioned div with inline left/top => canMove", () => {
    const d = el(`<div style="position:absolute;left:5px;top:5px"></div>`);
    const a = resolveElementAffordances(d, { text: null, animationIds: [], start: null });
    expect(a.capabilities.canMove).toBe(true);
  });

  it("model text => text section; model animationIds => timing+animation", () => {
    const d = el(`<div></div>`);
    const a = resolveElementAffordances(d, { text: "hello", animationIds: ["t1", "t2"], start: 0 });
    expect(a.sections).toMatchObject({ text: true, timing: true, animation: true });
  });

  it("null model => existsInSource false (not in model)", () => {
    const d = el(`<div></div>`);
    const a = resolveElementAffordances(d, null);
    expect(a.capabilities.canEditStyles).toBe(false);
  });
});
