import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installEditingAgent } from "./editingAgent";
import {
  MAX_ELEMENT_VALUE,
  MAX_GEOMETRY_CHILDREN,
  type EditingElementBox,
  type EditingElementGeometry,
  type EditingElementHit,
} from "./editingPort";

const CONNECT = { source: "hf-parent", type: "editing-connect", v: 1 };

// jsdom has neither; the 2D slice of each is all the geometry reads.
class FakeDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor(init?: string) {
    const m = init ? /matrix\(([^)]+)\)/.exec(init) : null;
    if (m) [this.a, this.b, this.c, this.d, this.e, this.f] = m[1]!.split(",").map(Number);
  }
  multiply(o: FakeDOMMatrix) {
    const out = new FakeDOMMatrix();
    out.a = this.a * o.a + this.c * o.b;
    out.b = this.b * o.a + this.d * o.b;
    out.c = this.a * o.c + this.c * o.d;
    out.d = this.b * o.c + this.d * o.d;
    out.e = this.a * o.e + this.c * o.f + this.e;
    out.f = this.b * o.e + this.d * o.f + this.f;
    return out;
  }
  rotateSelf() {
    return this;
  }
  transformPoint(p: { x: number; y: number }) {
    return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f };
  }
}
class FakeDOMPoint {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
const QUARTER_TURN = "matrix(0, 1, -1, 0, 0, 0)";

type Geometry = {
  elements: Array<EditingElementGeometry | null>;
  children: EditingElementBox[] | null;
};

describe("overlay geometry over the editing port", () => {
  let port: MessagePort;
  let agent: { dispose: () => void };
  let lastId = 0;

  const ask = (kind: string, params: unknown): Promise<{ ok: boolean; result?: unknown }> =>
    new Promise((resolve) => {
      port.onmessage = (event) => resolve(event.data);
      port.postMessage({ v: 1, id: ++lastId, kind, params });
    });
  const handleOf = async (element: Element) => {
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [element],
    });
    const reply = await ask("elements-at-point", { x: 0, y: 0 });
    return (reply.result as { elements: EditingElementHit[] }).elements[0]!.handle;
  };
  const geometry = async (params: unknown) => (await ask("geometry", params)).result as Geometry;
  const box = (element: Element, [x, y, width, height]: number[], offset = true) => {
    element.getBoundingClientRect = () =>
      ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
    if (!offset) return;
    Object.defineProperty(element, "offsetWidth", { value: width, configurable: true });
    Object.defineProperty(element, "offsetHeight", { value: height, configurable: true });
  };

  beforeEach(() => {
    Object.assign(window, { DOMMatrix: FakeDOMMatrix, DOMPoint: FakeDOMPoint });
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const parent = iframe.contentWindow!;
    const handoff = vi.fn();
    parent.postMessage = handoff as unknown as Window["postMessage"];
    agent = installEditingAgent(parent);
    window.dispatchEvent(new MessageEvent("message", { source: parent, data: CONNECT }));
    port = (handoff.mock.calls[0]![2] as MessagePort[])[0]!;
  });
  afterEach(() => {
    agent.dispose();
    document.body.innerHTML = "";
  });

  it("measures rect, painted corners, visibility, crop and source boundary per handle", async () => {
    document.body.innerHTML = `
      <div data-composition-src="a.html" data-width="960" data-height="540" id="host">
        <p id="turned" style="clip-path: inset(1px 2px 3px 4px)">T</p>
      </div>
      <div style="display: none"><span id="hidden"></span></div>`;
    const host = document.querySelector("#host")!;
    const turned = document.querySelector<HTMLElement>("#turned")!;
    box(host, [0, 0, 480, 270]);
    box(turned, [10, 20, 100, 200]);
    turned.style.transform = QUARTER_TURN;
    const handles = [await handleOf(turned), await handleOf(document.querySelector("#hidden")!)];
    const { elements, children } = await geometry({ handles });
    expect(children).toBeNull();
    const [measured, hidden] = elements;
    expect(measured).toMatchObject({
      rect: { x: 10, y: 20, width: 100, height: 200 },
      angle: 90,
      visible: true,
      members: null,
      clipPath: "inset(1px 2px 3px 4px)",
      source: { width: 480, height: 270, declaredWidth: 960, declaredHeight: 540 },
    });
    // A 100x200 box turned a quarter: its painted corners span 200 across and 100 down.
    const { nw, ne, se, sw } = measured!.corners!;
    expect([nw, ne, se, sw].map((p) => [p.x, p.y])).toEqual([
      [210, 20],
      [210, 120],
      [10, 120],
      [10, 20],
    ]);
    expect(hidden).toMatchObject({ visible: false, angle: 0, corners: null, source: null });
    expect(JSON.parse(JSON.stringify(elements))).toEqual(elements);
  });

  it("answers null for a removed element and leaves out a clip-path too long to send", async () => {
    document.body.innerHTML = `<p id="a"></p><p id="b"></p>`;
    const a = document.querySelector<HTMLElement>("#a")!;
    a.style.setProperty("clip-path", `path("M0 0${" L1 1".repeat(MAX_ELEMENT_VALUE)}")`);
    const b = document.querySelector("#b")!;
    const handles = [await handleOf(a), await handleOf(b)];
    b.remove();
    const { elements } = await geometry({ handles });
    expect(elements[0]!.clipPath).toBeNull();
    expect(elements[1]).toBeNull();
  });

  it("gives a group wrapper its members' rects", async () => {
    document.body.innerHTML = `<div data-hf-group="g"><i></i><b></b></div>`;
    const group = document.querySelector("div")!;
    box(group.children[0]!, [1, 2, 3, 4]);
    box(group.children[1]!, [5, 6, 7, 8]);
    const { elements } = await geometry({ handles: [await handleOf(group)] });
    expect(elements[0]!.members).toEqual([
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 5, y: 6, width: 7, height: 8 },
    ]);
  });

  it("adds the named element's descendant boxes, none past MAX_GEOMETRY_CHILDREN", async () => {
    document.body.innerHTML = `<section><div><i></i></div></section>`;
    const section = document.querySelector("section")!;
    box(section.querySelector("i")!, [7, 8, 9, 10], false);
    const handle = await handleOf(section);
    const { children } = await geometry({ handles: [handle], children: handle });
    expect(children).toHaveLength(2);
    expect(children![1]).toMatchObject({ rect: { x: 7, y: 8, width: 9, height: 10 }, angle: 0 });

    section.innerHTML = "<i></i>".repeat(MAX_GEOMETRY_CHILDREN + 1);
    expect((await geometry({ handles: [handle], children: handle })).children).toEqual([]);
    section.remove();
    expect((await geometry({ handles: [handle], children: handle })).children).toBeNull();
  });
});
