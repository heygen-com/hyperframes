// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditingElementDescription } from "@hyperframes/core/runtime/editing-port";
import {
  describePreviewElements,
  previewElementSelectorIndex,
  previewElementSourceFile,
  previewElementsAtPoint,
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
    for (const bad of [
      null,
      [],
      described(1, { handle: 1 as never }),
      described(1, { handle: "1" }),
      described(1, { handle: `${LOAD}:0` }),
      described(1, { handle: `${LOAD.toUpperCase()}:1` }),
      described(1, { parent: "x" }),
      described(1, { tag: 1 as never }),
      described(1, { source: { file: 1 } as never }),
      described(1, { locked: "yes" as never }),
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
