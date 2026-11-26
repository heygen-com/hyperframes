// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DESCRIBE_HANDLES,
  MAX_EDIT_ENTRIES,
  MAX_ELEMENT_ENTRIES,
  MAX_ELEMENT_TEXT,
  MAX_ELEMENT_VALUE,
  MAX_POINT_STACK,
  MAX_QUERY_MATCHES,
  type EditingElementDescription,
  isStableSelector,
} from "@hyperframes/core/runtime/editing-port";
import { buildStableSelector } from "../../../../core/src/runtime/editingElement";
import { gestureStart } from "../../../../core/src/runtime/editingGestureStart";
import { handleFor } from "../../../../core/src/runtime/editingHandles";
import {
  describePreviewElements,
  previewGestureBase,
  previewGeometry,
  editPreviewElement,
  previewElementSelectorIndex,
  previewElementSourceFile,
  previewAncestors,
  previewElementsAtPoint,
  previewGestureStart,
  previewLayers,
  previewPointerTargets,
  previewStackingSiblings,
  queryPreviewElements,
  readPreviewElement,
  type PreviewElement,
} from "./previewElements";
import { AGENT_PROBE_MS, previewComputedStyles } from "./previewChannel";
import {
  getSelectorIndex,
  getSourceFileForElement,
  setCompositionSourceMap,
} from "../../components/editor/domEditingDom";
import { detachedFakeIframe, serveEditingRequests } from "../hooks/timelinePlayerTestHarness";
import { previewStackingFamily } from "../../components/editor/previewLayers";

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  setCompositionSourceMap(new Map());
  document.body.innerHTML = "";
});

/** A frame Studio cannot read; `answer` is its runtime, or it has none. */
function opaqueFrame(answer?: (kind: string, params: unknown) => unknown) {
  const frame: Record<string, unknown> = { postMessage: () => {} };
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const handed = vi.fn(answer ?? (() => null));
  if (answer) closers.push(serveEditingRequests(frame, handed));
  return { iframe, handed };
}

const NO_SOURCE = { file: null, compositionId: null, originalCompositionId: null };

const LOAD = "0123456789abcdef";
const h = (n: number) => `${LOAD}:${n}`;

function described(n: number, extra: Partial<EditingElementDescription> = {}) {
  return {
    handle: h(n),
    parent: null,
    tag: "div",
    label: "Text",
    id: null,
    selector: null,
    matchesBefore: null,
    source: NO_SOURCE,
    locked: false,
    attributes: [["data-hf-id", `hf-${n}`]],
    inlineStyles: { left: "4px" },
    text: "",
    children: [{ text: "Hi" }, { handle: h(n + 1) }],
    rect: { x: 1, y: 2, width: 3, height: 4 },
    truncated: false,
    ...extra,
  } as EditingElementDescription;
}

describe("readPreviewElement", () => {
  it("takes a description with the wire shape and refuses anything off it", () => {
    expect(readPreviewElement(described(1))).toEqual(described(1));
    const { label: _label, ...fromAnOlderRuntime } = described(1);
    expect(readPreviewElement(fromAnOlderRuntime)).toEqual(fromAnOlderRuntime);
    for (const bad of [
      null,
      [],
      described(1, { handle: 1 as never }),
      described(1, { handle: "1" }),
      described(1, { handle: `${LOAD}:0` }),
      described(1, { handle: `${LOAD.toUpperCase()}:1` }),
      described(1, { parent: "x" }),
      described(1, { tag: 1 as never }),
      described(1, { label: 1 as never }),
      described(1, { source: { file: 1 } as never }),
      described(1, { locked: "yes" as never }),
      described(1, { textMarkup: "yes" as never }),
      described(1, { attributes: [["a"]] as never }),
      described(1, { inlineStyles: { left: 4 } as never }),
      described(1, { children: [{ node: {} }] as never }),
      described(1, { matchesBefore: [{ source: NO_SOURCE, count: -1 }] }),
      described(1, { rect: { x: Number.NaN, y: 0, width: 0, height: 0 } }),
      described(1, { truncated: undefined as never }),
    ]) {
      expect(readPreviewElement(bad)).toBeNull();
    }
  });

  it("refuses a description longer anywhere than the runtime ever sends one", () => {
    const value = "x".repeat(MAX_ELEMENT_VALUE);
    const atLimit = described(1, {
      selector: `.${value.slice(1)}`,
      attributes: [["src", value]],
    });
    expect(readPreviewElement(atLimit)).toEqual(atLimit);
    const idAtLimit = described(1, { selector: `#${value.slice(1)}`, id: value.slice(1) });
    expect(readPreviewElement(idAtLimit)).toEqual(idAtLimit);
    const over = `${value}x`;
    const text = "y".repeat(MAX_ELEMENT_TEXT + 1);
    const many = Array.from({ length: MAX_ELEMENT_ENTRIES + 1 }, (_, i) => [`data-${i}`, ""]);
    for (const bad of [
      described(1, { selector: `.${value}` }),
      described(1, { id: over }),
      described(1, { tag: over }),
      described(1, { label: over }),
      described(1, { attributes: [["src", over]] }),
      described(1, { attributes: [[`data-${over}`, "1"]] }),
      described(1, { attributes: many as never }),
      described(1, { inlineStyles: { left: over } }),
      described(1, { inlineStyles: { [`--${over}`]: "1" } }),
      described(1, { source: { ...NO_SOURCE, file: over } }),
      described(1, { source: { ...NO_SOURCE, compositionId: over } }),
      described(1, { source: { ...NO_SOURCE, originalCompositionId: over } }),
      described(1, { matchesBefore: [{ source: { ...NO_SOURCE, file: over }, count: 1 }] }),
      described(1, { text }),
      described(1, { children: [{ text }] }),
    ]) {
      expect(readPreviewElement(bad)).toBeNull();
    }
  });
});

describe("element requests over an opaque frame's port", () => {
  it("asks for the stack under a point and keeps only well-formed entries", async () => {
    const hit = { handle: h(1), tag: "p", rect: { x: 1, y: 2, width: 3, height: 4 } };
    const bad = [
      { ...hit, handle: "x" },
      { ...hit, tag: 1 },
      { ...hit, rect: { x: 1 } },
    ];
    const { iframe, handed } = opaqueFrame(() => ({ elements: [hit, ...bad] }));
    expect(await previewElementsAtPoint(iframe, 10, 20)).toEqual([hit]);
    expect(handed).toHaveBeenCalledWith("elements-at-point", { x: 10, y: 20 });
  });

  it("describes handles in order, with null for a gone element or a mismatched entry", async () => {
    let reply: unknown = { elements: [described(2), null, described(9)] };
    const { iframe, handed } = opaqueFrame(() => reply);
    const asked = [h(2), h(3), h(4)];
    expect(await describePreviewElements(iframe, asked)).toEqual([described(2), null, null]);
    expect(handed).toHaveBeenCalledWith("describe", { handles: asked });
    reply = { elements: [described(2)] };
    expect(await describePreviewElements(iframe, [h(2), h(3)])).toBeNull();
    handed.mockClear();
    expect(await describePreviewElements(iframe, [])).toBeNull();
    expect(await describePreviewElements(iframe, Array(257).fill(h(1)))).toBeNull();
    expect(handed).not.toHaveBeenCalled();
  });

  // fails without the fix: the frame's reading of a CSS turn never reached Studio, and its text goes into the source.
  it("takes a frame's CSS turn only with plain transform text", async () => {
    document.body.innerHTML = `<div data-composition-id="main"><div id="card" style="rotate: 30deg"></div></div>`;
    const [start] = gestureStart([handleFor(document.getElementById("card")!)]).elements;
    let after = "scale(2)";
    const { iframe } = opaqueFrame(() => ({
      elements: [
        {
          ...start,
          cssRotation: { ...start!.cssRotation!, target: { ...start!.cssRotation!.target, after } },
        },
      ],
      snap: [],
    }));
    const read = async () => (await previewGestureStart(iframe, [h(1)]))!.elements[0]!.cssRotation;
    expect(await read()).toMatchObject({ target: { after: "scale(2)" } });
    for (after of [
      "url(https://example.com/x)",
      "translate(1px",
      "scale(2) /* x",
      "scale(2));color:red",
    ])
      expect(await read()).toBeUndefined();
    after = "translateX(calc(10px + var(--a))) rotate(1deg)";
    expect(await read()).toMatchObject({ target: { after } });
  });

  it("reads an element's stacking family, and refuses one that is not a family of it", async () => {
    const family = [
      { handle: h(1), zIndex: 1 },
      { handle: h(2), zIndex: 2 },
    ];
    let reply: unknown = { family, locked: false };
    const { iframe, handed } = opaqueFrame(() => reply);
    expect(await previewStackingSiblings(iframe, h(1))).toEqual({ family, locked: false });
    expect(handed).toHaveBeenCalledWith("stacking-family", { handle: h(1) });
    for (const bad of [
      { family: {}, locked: false },
      { family, locked: "no" },
      { family: [family[0], { handle: h(2), zIndex: Number.NaN }], locked: false },
      { family: [family[0], { handle: h(2), zIndex: 1.5 }], locked: false },
      { family: [family[0], { handle: "x", zIndex: 2 }], locked: false },
      { family: [family[0], family[0]], locked: false },
      { family: [family[1]], locked: false },
      { family: Array(2049).fill(family[0]), locked: false },
    ]) {
      reply = bad;
      expect(await previewStackingSiblings(iframe, h(1))).toBeNull();
    }
  });

  it("restacks nothing from a malformed family, before describing any sibling", async () => {
    let reply: unknown = { family: {}, locked: false };
    const { iframe, handed } = opaqueFrame((kind, params) =>
      kind === "describe"
        ? {
            elements: (params as { handles: string[] }).handles.map((handle) =>
              described(1, { handle }),
            ),
          }
        : reply,
    );
    await expect(previewStackingFamily(iframe, h(1), null)).resolves.toBeNull();
    reply = {
      family: [
        { handle: h(1), zIndex: 1 },
        { handle: h(2), zIndex: Number.NaN },
      ],
      locked: false,
    };
    await expect(previewStackingFamily(iframe, h(1), null)).resolves.toBeNull();
    expect(handed).not.toHaveBeenCalledWith("describe", expect.anything());
  });

  it("gives up after the agent probe when the frame's runtime has no editing agent", async () => {
    const { iframe } = opaqueFrame();
    const started = Date.now();
    const answers = await Promise.all([
      previewComputedStyles(iframe, "#a", ["color"]),
      previewElementsAtPoint(iframe, 1, 1),
      describePreviewElements(iframe, [h(1)]),
    ]);
    expect(answers).toEqual([null, null, null]);
    expect(Date.now() - started).toBeLessThan(AGENT_PROBE_MS + 500);
  });
});

describe("the selector a description may carry", () => {
  it("keeps the forms Studio builds for an element itself", () => {
    for (const kept of [
      described(1, { selector: "#title", id: "title" }),
      described(1, { selector: "#\\31 st\\.hero", id: "1st.hero" }),
      described(1, { selector: ".tile" }),
      described(1, { selector: ".md\\:w-1\\/2" }),
      described(1, { selector: '[data-composition-id="card__hf2"]' }),
      described(1, { selector: '[data-hf-group="a \\"b\\" c"]' }),
    ]) {
      expect(readPreviewElement(kept)).toEqual(kept);
    }
  });

  it("drops a description whose selector Studio would not have built", () => {
    for (const forged of [
      described(1, { selector: "script" }),
      described(1, { selector: "body > script:nth-of-type(2)" }),
      described(1, { selector: ".tile script" }),
      described(1, { selector: ".tile, script" }),
      described(1, { selector: ".tile.other" }),
      described(1, { selector: '[data-composition-id="card"] script' }),
      described(1, { selector: '[data-composition-id="card"], script' }),
      described(1, { selector: '[src="app.js"]' }),
      described(1, { selector: "*" }),
      described(1, { selector: "" }),
      described(1, { selector: ".1st" }),
      described(1, { selector: ".-" }),
      described(1, { selector: '[data-hf-group=""]' }),
    ]) {
      expect(readPreviewElement(forged)).toBeNull();
    }
  });

  it("drops an id selector that names another element than the described id", () => {
    expect(readPreviewElement(described(1, { selector: "#boot", id: "title" }))).toBeNull();
    expect(readPreviewElement(described(1, { selector: "#boot" }))).toBeNull();
    expect(readPreviewElement(described(1, { selector: "#title script", id: "title" }))).toBeNull();
    expect(readPreviewElement(described(1, { selector: ".tile", id: "title" }))).toBeNull();
  });
});

describe("the selector the runtime builds for an element", () => {
  it("is always one a description may carry", () => {
    document.body.innerHTML = `
      <div id="1st.hero"></div><div id="-"></div><div class="md:w-1/2 clip"></div>
      <div class="-1x"></div><div class="clip"></div><div data-composition-id='a "b"'></div>
      <div data-hf-group="g\\1"></div><form class="signup"><input name="id" /></form>`;
    for (const el of Array.from(document.body.querySelectorAll("div, form"))) {
      const id = typeof el.id === "string" && el.id ? el.id : null;
      expect(isStableSelector(buildStableSelector(el) ?? "", id), el.outerHTML).toBe(true);
    }
  });
});

describe("source file and selector index from a description", () => {
  it("answers what Studio reads off the frame's own element", () => {
    setCompositionSourceMap(new Map([["card", "cards.html"]]));
    document.body.innerHTML = `
      <div class="tile"></div>
      <div data-composition-file="cards.html"><div class="tile"></div></div>
      <div data-composition-id="card__hf2" data-hf-original-composition-id="card">
        <div class="tile"></div><div class="tile"></div>
      </div>`;
    const target = document.querySelectorAll<HTMLElement>(".tile")[3]!;
    const element = readPreviewElement(
      described(7, {
        selector: ".tile",
        source: { file: null, compositionId: "card__hf2", originalCompositionId: "card" },
        // As the runtime counts the matches before it: one per distinct source.
        matchesBefore: [
          { source: NO_SOURCE, count: 1 },
          { source: { ...NO_SOURCE, file: "cards.html" }, count: 1 },
          {
            source: { file: null, compositionId: "card__hf2", originalCompositionId: "card" },
            count: 1,
          },
        ],
      }),
    ) as PreviewElement;
    const { sourceFile } = getSourceFileForElement(target, "index.html");
    expect(previewElementSourceFile(element, "index.html")).toBe(sourceFile);
    expect(sourceFile).toBe("cards.html");
    const index = getSelectorIndex(document, target, ".tile", sourceFile, "index.html");
    expect(previewElementSelectorIndex(element, "index.html")).toBe(index);
    expect(index).toBe(2);
    expect(previewElementSelectorIndex({ ...element, matchesBefore: null }, null)).toBeUndefined();
  });
});

describe("a list in a frame's reply", () => {
  const hit = { handle: h(1), tag: "p", rect: { x: 1, y: 2, width: 3, height: 4 } };
  const layer = { handle: h(1), depth: 0, childCount: 0, zIndex: 0, kind: "text" };
  const readers = [
    {
      name: "the stack under a point",
      cap: MAX_POINT_STACK,
      entry: hit,
      reply: (list: unknown[]) => ({ elements: list }),
      read: (iframe: HTMLIFrameElement) => previewElementsAtPoint(iframe, 1, 1),
      refused: null,
    },
    {
      name: "the stack a press cycles",
      cap: MAX_POINT_STACK,
      entry: hit,
      reply: (list: unknown[]) => ({ target: hit, stack: list }),
      read: (iframe: HTMLIFrameElement) => previewPointerTargets(iframe, 0.5, 0.5),
      refused: null,
    },
    {
      name: "an element's ancestors",
      cap: MAX_DESCRIBE_HANDLES,
      entry: h(2),
      reply: (list: unknown[]) => ({ ancestors: [list] }),
      read: (iframe: HTMLIFrameElement) => previewAncestors(iframe, [h(1)]),
      refused: [null],
    },
    {
      name: "a selector's matches",
      cap: MAX_QUERY_MATCHES,
      entry: { handle: h(1), source: NO_SOURCE },
      reply: (list: unknown[]) => ({ matches: list, truncated: false }),
      read: (iframe: HTMLIFrameElement) => queryPreviewElements(iframe, "p"),
      refused: null,
    },
    {
      name: "a page of layers",
      cap: MAX_QUERY_MATCHES,
      entry: layer,
      reply: (list: unknown[]) => ({ layers: list, truncated: false, missingGroup: false }),
      read: (iframe: HTMLIFrameElement) => previewLayers(iframe),
      refused: null,
    },
  ];

  it.each(readers)("for $name is read up to the frame's own cap", async (r) => {
    const { iframe } = opaqueFrame(() => r.reply(Array(r.cap).fill(r.entry)));
    expect(await r.read(iframe)).not.toEqual(r.refused);
  });

  it.each(readers)("for $name is refused past the frame's cap or with a gap", async (r) => {
    let list: unknown[] = Array(r.cap + 1).fill(r.entry);
    const { iframe } = opaqueFrame(() => r.reply(list));
    expect(await r.read(iframe)).toEqual(r.refused);
    list = Array(r.cap).fill(r.entry);
    delete list[1];
    expect(await r.read(iframe)).toEqual(r.refused);
  });

  it.each(readers)("for $name is refused at once when its length has no entries", async (r) => {
    const { iframe } = opaqueFrame(() => r.reply(new Array(2 ** 32 - 1)));
    const started = performance.now();
    expect(await r.read(iframe)).toEqual(r.refused);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("of an edit's held values is put back only up to the edit cap, with no gap", async () => {
    let held: unknown[] = [];
    const { iframe, handed } = opaqueFrame(() => ({ applied: true, styles: held, attributes: [] }));
    const putBacks = async (list: unknown[]) => {
      held = list;
      handed.mockClear();
      const edit = editPreviewElement(iframe, h(1), { styles: [["color", "red"]] });
      await edit.drawn;
      edit.restore();
      await edit.drawn;
      await previewElementsAtPoint(iframe, 0, 0); // the port answers in order: any put-back is in
      return handed.mock.calls.filter(([kind]) => kind === "edit-element").length - 1;
    };
    const entry = ["color", null];
    expect(await putBacks(Array(MAX_EDIT_ENTRIES).fill(entry))).toBe(1);
    expect(await putBacks(Array(MAX_EDIT_ENTRIES + 1).fill(entry))).toBe(0);
    const gap = Array(MAX_EDIT_ENTRIES).fill(entry);
    delete gap[1];
    expect(await putBacks(gap)).toBe(0);
  });

  it.each([
    ["describe", (list: unknown[]) => ({ elements: list }), describePreviewElements],
    ["ancestors", (list: unknown[]) => ({ ancestors: list }), previewAncestors],
    ["geometry", (list: unknown[]) => ({ elements: list, children: null }), previewGeometry],
    ["gesture-start", (list: unknown[]) => ({ elements: list, snap: [] }), previewGestureStart],
    ["gesture-base", (list: unknown[]) => ({ elements: list }), previewGestureBase],
  ] as const)("one entry per handle, for %s, is refused with a gap", async (_kind, reply, read) => {
    const list: unknown[] = [null, null, null];
    delete list[1];
    const { iframe } = opaqueFrame(() => reply(list));
    expect(await read(iframe, [h(1), h(2), h(3)])).toBeNull();
  });
});
