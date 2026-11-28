import { afterEach, describe, expect, it, vi } from "vitest";
import { installEditingAgent } from "../editingAgent";
import { connectFrom } from "../editingAgent.test-helpers";
import { STUDIO_PREVIEW_MARK_META } from "../../studioPreviewMark";
import {
  locateStageKey,
  MAX_STAGE_ITEMS,
  measureStageDocument,
  parseStageMeasureParams,
} from "./stageMeasure";

// jsdom has no CSS.escape; browsers do (capturedMediaIdleRoute.test.ts stubs it the same way).
(globalThis as typeof globalThis & { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
globalThis.CSS.escape ??= (v: string) => v.replace(/["\\]/g, "\\$&");

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("parseStageMeasureParams", () => {
  it("accepts empty params or an integer maxItems in range and rejects anything else", () => {
    expect(parseStageMeasureParams(undefined)).toEqual({});
    expect(parseStageMeasureParams({})).toEqual({});
    expect(parseStageMeasureParams({ maxItems: 1 })).toEqual({ maxItems: 1 });
    expect(parseStageMeasureParams({ maxItems: MAX_STAGE_ITEMS })).toEqual({
      maxItems: MAX_STAGE_ITEMS,
    });
    for (const bad of [
      null,
      [],
      "1",
      { maxItems: 0 },
      { maxItems: -1 },
      { maxItems: 1.5 },
      { maxItems: MAX_STAGE_ITEMS + 1 },
      { maxItems: "10" },
      { extra: true },
      { maxItems: 10, extra: true },
    ]) {
      expect(parseStageMeasureParams(bad)).toBeNull();
    }
  });
});

describe("measureStageDocument", () => {
  it("walks body in document order, skips non-visual tags, and captures keys, own text, styles, and clip keys", () => {
    document.body.innerHTML = `
      <script>window.__ignored = 1;</script>
      <style>.x { color: red; }</style>
      <div data-composition-id="scene-1" data-composition-file="scenes/intro.html">
        <div class="clip" id="hero" data-hf-id="hf-hero" style="position: absolute; font-size: 32px; color: rgb(10, 20, 30); background-color: rgb(255, 255, 255); background-image: linear-gradient(red, blue)">
          Outer   words
          <span id="sub">Inner text</span>
        </div>
      </div>
    `;
    const hero = document.getElementById("hero")!;
    const sub = document.getElementById("sub")!;
    vi.spyOn(hero, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      width: 300,
      height: 80,
      top: 20,
      left: 10,
      right: 310,
      bottom: 100,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(sub, "getBoundingClientRect").mockReturnValue({
      x: 12,
      y: 24,
      width: 100,
      height: 20,
      top: 24,
      left: 12,
      right: 112,
      bottom: 44,
      toJSON: () => ({}),
    } as DOMRect);

    const { items, truncated } = measureStageDocument(document);
    expect(truncated).toBe(false);
    expect(items.map((item) => item.key)).toEqual(["2", "#hf-hero", "#hf-hero>0"]);

    const heroItem = items[1]!;
    expect(heroItem).toMatchObject({
      key: "#hf-hero",
      hfId: "hf-hero",
      id: "hero",
      tag: "div",
      parent: "2",
      text: "Outer words",
      box: { x: 10, y: 20, width: 300, height: 80 },
      fontSize: "32px",
      placed: true,
      visible: true,
      clipKeys: ["scenes/intro.html#hero", "scenes/intro.html#hf-hero"],
      hasElementChildren: true,
      hasBackgroundImage: true,
    });

    const subItem = items[2]!;
    expect(subItem).toMatchObject({
      key: "#hf-hero>0",
      hfId: null,
      id: "sub",
      tag: "span",
      parent: "#hf-hero",
      text: "Inner text",
      box: { x: 12, y: 24, width: 100, height: 20 },
      placed: false,
      visible: true,
      clipKeys: ["scenes/intro.html#hero", "scenes/intro.html#hf-hero"],
      hasElementChildren: false,
      hasBackgroundImage: false,
    });
  });

  it("caps output at maxItems, ignores trailing skipped tags, and clamps non-finite limits", () => {
    document.body.innerHTML = `<p>A</p><p>B</p><script>1</script>`;
    const exact = measureStageDocument(document, 2);
    expect(exact.items.map((item) => item.text)).toEqual(["A", "B"]);
    expect(exact.truncated).toBe(false);

    document.body.innerHTML = `<p>A</p><p>B</p><p>C</p>`;
    const result = measureStageDocument(document, 2);
    expect(result.items.map((item) => item.text)).toEqual(["A", "B"]);
    expect(result.truncated).toBe(true);

    const fallback = measureStageDocument(document, Number.NaN);
    expect(fallback.items).toHaveLength(3);
    expect(fallback.truncated).toBe(false);
  });

  it("reports hidden or zero-width elements as not visible", () => {
    document.body.innerHTML = `<div id="off" style="visibility: hidden">Off</div><div id="zero">Zero</div>`;
    vi.spyOn(document.getElementById("off")!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 50,
      height: 20,
      top: 0,
      left: 0,
      right: 50,
      bottom: 20,
      toJSON: () => ({}),
    } as DOMRect);
    const { items } = measureStageDocument(document);
    expect(items.map((item) => [item.id, item.visible])).toEqual([
      ["off", false],
      ["zero", false],
    ]);
  });

  it("is not exposed when the document has no Studio preview mark (render pages)", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const parent = iframe.contentWindow!;
    const agent = installEditingAgent(parent);
    const answers = (port: MessagePort) =>
      new Promise<boolean>((resolve) => {
        port.onmessage = () => resolve(true);
        port.postMessage({ v: 2, id: 1, kind: "hello", params: {} });
        setTimeout(() => resolve(false), 50);
      }).finally(() => port.close());
    try {
      expect(await answers(connectFrom(parent))).toBe(false);

      const mark = document.createElement("meta");
      mark.name = STUDIO_PREVIEW_MARK_META;
      document.head.append(mark);
      expect(await answers(connectFrom(parent))).toBe(true);
    } finally {
      agent.dispose();
    }
  });
});

describe("stage keys", () => {
  const keyOf = (element: Element) => {
    const { items } = measureStageDocument(document);
    const index = [...document.body.querySelectorAll("*")].indexOf(element);
    return items[index]!.key;
  };

  it.each([
    ["all digits, the index of another body child", "12"],
    ["with a path separator in it", "a>1"],
    ["with a backslash in it", "a\\>0"],
  ])("never reads an hf id %s as a path: it and its children resolve to themselves", (_, hfId) => {
    const others = Array.from(
      { length: 13 },
      (_, i) => `<section><b>other ${i}</b></section>`,
    ).join("");
    document.body.innerHTML = `<div><i>child</i></div>${others}`;
    const owner = document.body.firstElementChild!;
    owner.setAttribute("data-hf-id", hfId);
    const child = owner.firstElementChild!;
    expect(locateStageKey(document, { key: keyOf(owner), hfId: null })).toBe(owner);
    expect(locateStageKey(document, { key: keyOf(child), hfId: null })).toBe(child);
  });

  it("resolves an index path from the body when no ancestor has an hf id", () => {
    document.body.innerHTML = `<div></div><div><p><i>deep</i></p></div>`;
    const deep = document.querySelector("i")!;
    expect(keyOf(deep)).toBe("1>0>0");
    expect(locateStageKey(document, { key: "1>0>0", hfId: null })).toBe(deep);
    expect(locateStageKey(document, { key: "1>x", hfId: null })).toBeNull();
  });
});
