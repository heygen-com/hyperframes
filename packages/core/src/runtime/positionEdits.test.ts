import { describe, expect, it, vi } from "vitest";
import {
  EDIT_BASE_X_ATTR,
  EDIT_BASE_Y_ATTR,
  EDIT_ORIGINAL_TRANSLATE_ATTR,
  applyPositionEditToElement,
  applyPositionEdits,
  composeTranslate,
  installPositionEditsSeekReapply,
} from "./positionEdits";

function makeElement(attrs: Record<string, string>, style = ""): HTMLElement {
  const el = document.createElement("div");
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (style) el.setAttribute("style", style);
  document.body.appendChild(el);
  return el;
}

describe("composeTranslate", () => {
  it("returns the delta alone when there is no original", () => {
    expect(composeTranslate("", "10px", "20px")).toBe("10px 20px");
    expect(composeTranslate("none", "10px", "20px")).toBe("10px 20px");
  });

  it("adds px values numerically", () => {
    expect(composeTranslate("5px 6px", "10px", "20px")).toBe("15px 26px");
    expect(composeTranslate("-5.5px 6px", "10px", "-20px")).toBe("4.5px -14px");
  });

  it("treats a single-part original as x-only", () => {
    expect(composeTranslate("5px", "10px", "20px")).toBe("15px 20px");
  });

  it("falls back to calc() for non-px units and preserves z", () => {
    expect(composeTranslate("10% 6px", "10px", "20px")).toBe("calc(10% + 10px) 26px");
    expect(composeTranslate("1px 2px 3px", "10px", "20px")).toBe("11px 22px 3px");
  });
});

describe("applyPositionEdits", () => {
  it("ignores unmarked elements", () => {
    const el = makeElement({ "data-x": "100", "data-y": "50" });
    expect(applyPositionEdits(document)).toBe(0);
    expect(el.style.getPropertyValue("translate")).toBe("");
    el.remove();
  });

  it("applies the delta between data-x/y and the captured baseline", () => {
    const el = makeElement({
      "data-x": "150",
      "data-y": "-30",
      [EDIT_BASE_X_ATTR]: "100",
      [EDIT_BASE_Y_ATTR]: "20",
    });
    expect(applyPositionEdits(document)).toBe(1);
    expect(el.style.getPropertyValue("translate")).toBe("50px -50px");
    expect(el.getAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR)).toBe("");
    el.remove();
  });

  it("applies the delta to an SVG element (e.g. an authored <text> label), not just HTML", () => {
    // SVG graphics are positioned via the same CSS `translate` longhand; the old HTML-only guard
    // silently dropped SVG moves. Regression guard: an SVG <text> must be counted AND translated.
    const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
    el.setAttribute("data-x", "145");
    el.setAttribute("data-y", "1");
    el.setAttribute(EDIT_BASE_X_ATTR, "0");
    el.setAttribute(EDIT_BASE_Y_ATTR, "0");
    document.body.appendChild(el);
    expect(applyPositionEdits(document)).toBe(1);
    expect(el.style.getPropertyValue("translate")).toBe("145px 1px");
    el.remove();
  });

  it("treats missing data-x/y or baseline attributes as 0", () => {
    const el = makeElement({ "data-x": "40", [EDIT_BASE_X_ATTR]: "0" });
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("40px 0px");
    el.remove();
  });

  it("composes with a pre-existing inline translate and stays idempotent", () => {
    const el = makeElement(
      { "data-x": "10", "data-y": "20", [EDIT_BASE_X_ATTR]: "0", [EDIT_BASE_Y_ATTR]: "0" },
      "translate: 5px 6px",
    );
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("15px 26px");
    expect(el.getAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR)).toBe("5px 6px");
    // Second application must not compound.
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("15px 26px");
    el.remove();
  });

  it("recomputes from the same baseline after data-x changes", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "0",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
    });
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("10px 0px");
    el.setAttribute("data-x", "70");
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("70px 0px");
    el.remove();
  });

  it("never re-captures the original translate once set", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "0",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
      [EDIT_ORIGINAL_TRANSLATE_ATTR]: "3px 4px",
    });
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("13px 4px");
    el.remove();
  });

  it("counts and applies multiple marked elements", () => {
    const a = makeElement({ "data-x": "1", [EDIT_BASE_X_ATTR]: "0" });
    const b = makeElement({ "data-y": "2", [EDIT_BASE_Y_ATTR]: "0" });
    expect(applyPositionEdits(document)).toBe(2);
    a.remove();
    b.remove();
  });

  it("applies edits to elements from a DIFFERENT realm (an iframe's document)", () => {
    // Regression test: a module-scope `instanceof HTMLElement` check fails for
    // elements from another window's realm even though they're genuine,
    // stylable HTMLElements — exactly the case for any iframe-hosted editor
    // (the SDK's edit preview, a host embedding a composition).
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc) throw new Error("iframe.contentDocument unavailable in this test env");

    // Sanity check the premise: the iframe's HTMLElement is NOT this realm's.
    const iframeWindow = iframe.contentWindow as (Window & typeof globalThis) | null;
    expect(iframeWindow?.HTMLElement).not.toBe(globalThis.HTMLElement);

    const el = iframeDoc.createElement("div");
    el.setAttribute("data-x", "50");
    el.setAttribute("data-y", "-10");
    el.setAttribute(EDIT_BASE_X_ATTR, "0");
    el.setAttribute(EDIT_BASE_Y_ATTR, "0");
    iframeDoc.body.appendChild(el);

    expect(applyPositionEdits(iframeDoc)).toBe(1);
    expect(el.style.getPropertyValue("translate")).toBe("50px -10px");
    iframe.remove();
  });

  it("skips re-apply when the written translate was consumed externally (GSAP fold)", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "20",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
    });
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("10px 20px");
    // GSAP folding the translate into its cached transform writes "none".
    el.style.setProperty("translate", "none");
    applyPositionEdits(document);
    // Re-setting would double the offset on non-animated axes — must skip.
    expect(el.style.getPropertyValue("translate")).toBe("none");
    el.remove();
  });

  it("force re-applies over a clobbered translate (editor commit path)", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "20",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
    });
    applyPositionEditToElement(el);
    // A drag draft overwrites the translate; the commit must recompute.
    el.style.setProperty("translate", "999px 999px");
    el.setAttribute("data-x", "30");
    applyPositionEditToElement(el, { force: true });
    expect(el.style.getPropertyValue("translate")).toBe("30px 20px");
    el.remove();
  });
});

describe("installPositionEditsSeekReapply", () => {
  it("wraps __player.renderSeek so each call reapplies position edits", () => {
    const el = makeElement({ "data-x": "10", "data-y": "0", "data-hf-edit-base-x": "0" });
    const calls: number[] = [];
    // @ts-expect-error test global
    window.__player = { renderSeek: (time: number) => calls.push(time) };

    installPositionEditsSeekReapply(window as Window & typeof globalThis);
    // @ts-expect-error test global
    window.__player.renderSeek(1.5);

    expect(calls).toEqual([1.5]);
    expect(el.style.getPropertyValue("translate")).toBe("10px 0px");
    // @ts-expect-error test global
    delete window.__player;
    el.remove();
  });

  it("is idempotent when installed twice", () => {
    const el = makeElement({ "data-x": "5", "data-y": "0", "data-hf-edit-base-x": "0" });
    const calls: number[] = [];
    // @ts-expect-error test global
    window.__player = { renderSeek: (time: number) => calls.push(time) };

    installPositionEditsSeekReapply(window as Window & typeof globalThis);
    installPositionEditsSeekReapply(window as Window & typeof globalThis);
    // @ts-expect-error test global
    window.__player.renderSeek(2);

    expect(calls).toEqual([2]);
    // @ts-expect-error test global
    delete window.__player;
    el.remove();
  });

  it("wraps __hf.seek and a seek function assigned after installation", () => {
    vi.useFakeTimers();
    const el = makeElement({ "data-x": "8", "data-y": "0", "data-hf-edit-base-x": "0" });
    const calls: number[] = [];
    // @ts-expect-error test global
    window.__hf = {};

    installPositionEditsSeekReapply(window as Window & typeof globalThis);
    // @ts-expect-error test global
    window.__hf.seek = (time: number) => calls.push(time);
    vi.advanceTimersByTime(50);
    // @ts-expect-error test global
    window.__hf.seek(3);

    expect(calls).toEqual([3]);
    expect(el.style.getPropertyValue("translate")).toBe("8px 0px");
    // @ts-expect-error test global
    delete window.__hf;
    el.remove();
    vi.useRealTimers();
  });

  it("does not throw when neither seek global exists", () => {
    expect(() =>
      installPositionEditsSeekReapply(window as Window & typeof globalThis),
    ).not.toThrow();
  });
});

describe("applyPositionEdits — force option", () => {
  it("skips a clobbered translate non-forced, re-applies with force", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "0",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
    });
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("10px 0px");

    // External clobber (GSAP folding it into a cached transform, a draft
    // write, …) — the non-forced fold-guard must skip, force must overwrite.
    el.style.setProperty("translate", "999px 0px");
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("999px 0px");

    applyPositionEdits(document, { force: true });
    expect(el.style.getPropertyValue("translate")).toBe("10px 0px");
    el.remove();
  });
});

describe("applyPositionEdits — reset path", () => {
  it("restores the captured pre-edit translate when base attrs were removed (undo)", () => {
    const el = makeElement(
      {
        "data-x": "10",
        "data-y": "5",
        [EDIT_BASE_X_ATTR]: "0",
        [EDIT_BASE_Y_ATTR]: "0",
      },
      "translate: 3px 4px",
    );
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("13px 9px");
    expect(el.getAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR)).toBe("3px 4px");

    // Undo: the host removes the whole edit channel.
    el.removeAttribute("data-x");
    el.removeAttribute("data-y");
    el.removeAttribute(EDIT_BASE_X_ATTR);
    el.removeAttribute(EDIT_BASE_Y_ATTR);
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("3px 4px");
    expect(el.hasAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR)).toBe(false);
    el.remove();
  });

  it("removes the inline translate entirely when the captured original was none", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "0",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
    });
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("10px 0px");

    el.removeAttribute("data-x");
    el.removeAttribute("data-y");
    el.removeAttribute(EDIT_BASE_X_ATTR);
    el.removeAttribute(EDIT_BASE_Y_ATTR);
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("");
    expect(el.hasAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR)).toBe(false);
    el.remove();
  });

  it("a redo after reset re-captures a clean baseline", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "0",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
    });
    applyPositionEdits(document);
    el.removeAttribute("data-x");
    el.removeAttribute("data-y");
    el.removeAttribute(EDIT_BASE_X_ATTR);
    el.removeAttribute(EDIT_BASE_Y_ATTR);
    applyPositionEdits(document); // reset

    // Redo: the host restores the edit channel with a new position.
    el.setAttribute("data-x", "20");
    el.setAttribute("data-y", "0");
    el.setAttribute(EDIT_BASE_X_ATTR, "0");
    el.setAttribute(EDIT_BASE_Y_ATTR, "0");
    applyPositionEdits(document, { force: true });
    expect(el.style.getPropertyValue("translate")).toBe("20px 0px");
    el.remove();
  });
});
