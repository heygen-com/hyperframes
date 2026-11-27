import { afterEach, describe, expect, it, vi } from "vitest";
import { drawDrafts } from "../editingDraft";
import { handleFor, queryElements } from "../editingHandles";
import { parseEditingRequest, EDITING_PROTOCOL_VERSION } from "../editingPort";
import { documentMarkup } from "./documentMarkup";
import {
  clearDragChrome,
  MAX_DRAG_CHROME_BYTES,
  MAX_DRAG_CHROME_NODES,
  type EditingDragChromeNode,
} from "./dragChrome";

afterEach(() => {
  clearDragChrome();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The closed root the frame attaches, which a test can only get by watching the attach. */
function watchRoot(): () => ShadowRoot {
  const attach = Element.prototype.attachShadow;
  let root: ShadowRoot | null = null;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, init) {
    root = attach.call(this, init);
    return root;
  });
  return () => root!;
}

const host = () => document.querySelector("html > [data-hf-ignore]") as HTMLElement | null;
const box: EditingDragChromeNode = {
  tag: "div",
  look: { position: "absolute", border: "1px solid rgb(60, 230, 172)", "border-radius": "6px" },
  children: [
    {
      tag: "svg",
      look: {},
      attrs: { viewBox: "0 0 24 24" },
      children: [{ tag: "path", look: {}, attrs: { d: "M3 12h18" } }],
    },
  ],
};
const place = (left: number) => [
  { left: `${left}px`, top: "20px", width: "40px", height: "30px" },
  {},
  {},
];
const chromeAt = (left: number, nodes?: EditingDragChromeNode[]) => ({
  origin: { x: 100, y: 50 },
  scale: { x: 2, y: 2 },
  place: place(left),
  ...(nodes && { nodes }),
});

function card() {
  document.body.innerHTML = `<div id="card" style="width: 50px"></div>`;
  const element = document.getElementById("card")!;
  return { element, handle: handleFor(element) };
}

// fails without the fix: the sealed frame painted no chrome, so Studio's outline and the layer reached the
// screen in different compositor frames.
describe("drag chrome", () => {
  it("is drawn in the same call as the draft it rides, at the step's place, mapped into frame px", () => {
    const root = watchRoot();
    const { element, handle } = card();
    drawDrafts([{ handle, translate: { x: 5, y: 0 }, size: null }], chromeAt(140, [box]));
    expect(element.style.translate).not.toBe("");
    expect(host()?.parentElement).toBe(document.documentElement);
    drawDrafts([{ handle, translate: { x: 9, y: 0 }, size: null }], chromeAt(148));
    const plane = root().firstElementChild as HTMLElement;
    const drawn = plane.firstElementChild as HTMLElement;
    expect(plane.style.transform).toBe("scale(0.5, 0.5) translate(-100px, -50px)");
    expect([drawn.style.left, drawn.style.width, drawn.style.borderRadius]).toEqual([
      "148px",
      "40px",
      "6px",
    ]);
    expect(drawn.querySelector("path")?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    drawDrafts([], { ...chromeAt(150), place: [{ "pointer-events": "auto" }, {}, {}] });
    expect(drawn.style.getPropertyValue("pointer-events")).toBe("none");
  });

  it("goes with a null chrome, and with the last draft's end when Studio sends none", () => {
    const { handle } = card();
    drawDrafts([{ handle, translate: { x: 5, y: 0 }, size: null }], chromeAt(140, [box]));
    drawDrafts([{ handle, translate: { x: 6, y: 0 }, size: null }], null);
    expect(host()).toBeNull();
    drawDrafts([{ handle, translate: { x: 7, y: 0 }, size: null }], chromeAt(140, [box]));
    drawDrafts([{ handle, end: "restore" }]);
    expect(host()).toBeNull();
  });

  it("is in no document markup or query a drag answers", () => {
    const { handle } = card();
    const without = documentMarkup().html;
    drawDrafts([{ handle, translate: null, size: null }], chromeAt(140, [box]));
    expect(documentMarkup().html).toBe(without);
    expect(host()?.parentElement).toBe(document.documentElement);
    expect(queryElements("div").matches).toHaveLength(1);
  });

  it("keeps its place out of the host the document's observers see", () => {
    const { handle } = card();
    drawDrafts([{ handle, translate: null, size: null }], chromeAt(140, [box]));
    const seen: MutationRecord[] = [];
    const observer = new MutationObserver((records) => seen.push(...records));
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    drawDrafts([{ handle, translate: null, size: null }], chromeAt(150));
    seen.push(...observer.takeRecords());
    observer.disconnect();
    expect(
      seen.filter((record) => record.target === host() || host()?.contains(record.target)),
    ).toEqual([]);
  });
});

describe("drag chrome on the wire", () => {
  const request = (chrome: unknown) =>
    parseEditingRequest({
      v: EDITING_PROTOCOL_VERSION,
      id: 1,
      kind: "draft",
      params: { drafts: [{ handle: "0123456789abcdef:1", end: "keep" }], chrome },
    }).ok;
  const flat = (n: number, look: Record<string, string> = {}) =>
    Array.from({ length: n }, () => ({ tag: "div", look }));

  it("takes a copy of Studio's chrome and its place, or null", () => {
    expect(request(chromeAt(1, [box]))).toBe(true);
    expect(request(null)).toBe(true);
    const alone = (params: unknown) =>
      parseEditingRequest({ v: EDITING_PROTOCOL_VERSION, id: 1, kind: "draft", params }).ok;
    expect(alone({ drafts: [], chrome: null })).toBe(true);
    expect(alone({ drafts: [] })).toBe(false);
  });

  it("refuses a copy over the node or byte caps, and anything but paint", () => {
    expect(request({ ...chromeAt(1), nodes: flat(MAX_DRAG_CHROME_NODES) })).toBe(true);
    expect(request({ ...chromeAt(1), nodes: flat(MAX_DRAG_CHROME_NODES + 1) })).toBe(false);
    const big = { "box-shadow": "x".repeat(500) };
    const nodes = flat(Math.ceil(MAX_DRAG_CHROME_BYTES / 500), big).slice(0, MAX_DRAG_CHROME_NODES);
    expect(request({ ...chromeAt(1), nodes })).toBe(false);
    expect(request({ ...chromeAt(1), nodes: [{ tag: "img", look: {} }] })).toBe(false);
    expect(
      request({ ...chromeAt(1), nodes: [{ tag: "div", look: {}, attrs: { onclick: "x" } }] }),
    ).toBe(false);
    expect(
      request({ ...chromeAt(1), nodes: [{ tag: "div", look: { background: "url(x)" } }] }),
    ).toBe(false);
    for (const escaped of ["u\\72l(https://x)", "\\75rl(https://x)"])
      expect(
        request({ ...chromeAt(1), nodes: [{ tag: "div", look: { background: escaped } }] }),
      ).toBe(false);
    expect(request({ ...chromeAt(1), scale: { x: 0, y: 1 } })).toBe(false);
  });
});
