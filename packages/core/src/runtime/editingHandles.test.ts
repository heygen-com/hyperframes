import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installEditingAgent } from "./editingAgent";
import type { EditingElementDescription } from "./editingPort";

const CONNECT = { source: "hf-parent", type: "editing-connect", v: 1 };

type Reply = { ok: boolean; result?: { elements: Array<EditingElementDescription | null> } };

describe("element handles over the editing port", () => {
  let port: MessagePort;
  let agent: { dispose: () => void };
  let lastId = 0;

  const ask = (kind: string, params: unknown): Promise<Reply> =>
    new Promise((resolve) => {
      port.onmessage = (event) => resolve(event.data);
      port.postMessage({ v: 1, id: ++lastId, kind, params });
    });
  const describeHandles = async (handles: number[]) =>
    (await ask("describe", { handles })).result!.elements;
  const atPoint = async () => (await ask("elements-at-point", { x: 5, y: 6 })).result!.elements;
  const stackAtPoint = (...elements: Element[]) =>
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => elements),
    });

  beforeEach(() => {
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
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  });

  it("describes the stack under a point in plain data, topmost first", async () => {
    document.body.innerHTML = `
      <div data-composition-id="card__hf1" data-hf-original-composition-id="card" data-timeline-locked>
        <p class="clip title" data-hf-id="hf-1" data-start="2" style="color: red; left: 4px">Hi <b>there</b></p>
      </div>`;
    const title = document.querySelector("p")!;
    const root = title.parentElement!;
    stackAtPoint(title, root);
    const [top, below] = await atPoint();
    expect(document.elementsFromPoint).toHaveBeenCalledWith(5, 6);
    expect(top).toEqual({
      handle: expect.any(Number),
      parent: below!.handle,
      tag: "p",
      id: null,
      selector: ".title",
      matchesBefore: [],
      source: { file: null, compositionId: "card__hf1", originalCompositionId: "card" },
      locked: true,
      attributes: [
        ["class", "clip title"],
        ["data-hf-id", "hf-1"],
        ["data-start", "2"],
      ],
      inlineStyles: { color: "red", left: "4px" },
      text: "Hi there",
      children: [{ text: "Hi " }, { handle: expect.any(Number) }],
      rect: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(below).toMatchObject({ tag: "div", selector: '[data-composition-id="card__hf1"]' });
    expect(below!.matchesBefore).toBeNull();
    // Nothing on the wire is a node: the reply survived a structured clone as plain data.
    expect(JSON.parse(JSON.stringify(top))).toEqual(top);
  });

  it("keeps an element's handle for the page load and answers null once it is gone", async () => {
    document.body.innerHTML = `<p id="a">A</p><p id="b">B</p>`;
    const [a, b] = Array.from(document.querySelectorAll("p"));
    stackAtPoint(a!, b!);
    const [first, second] = await atPoint();
    expect(first!.handle).not.toBe(second!.handle);
    const again = await describeHandles([second!.handle, first!.handle]);
    expect(again.map((entry) => entry?.id)).toEqual(["b", "a"]);
    expect(again[0]!.handle).toBe(second!.handle);

    a!.remove();
    expect(await describeHandles([first!.handle, 999_999, second!.handle])).toEqual([
      null,
      null,
      expect.objectContaining({ id: "b" }),
    ]);
  });

  it("counts a class selector's earlier matches per source", async () => {
    document.body.innerHTML = `
      <div class="tile"></div>
      <div data-composition-file="cards.html"><div class="tile"></div><div class="tile"></div></div>
      <div data-composition-src="cards.html"><div class="tile" id="t"></div></div>
      <div data-composition-file="cards.html"><div class="tile"></div></div>`;
    const tiles = document.querySelectorAll(".tile");
    stackAtPoint(tiles[4]!);
    const [last] = await atPoint();
    expect(last!.source.file).toBe("cards.html");
    expect(last!.matchesBefore).toEqual([
      { source: { file: null, compositionId: null, originalCompositionId: null }, count: 1 },
      {
        source: { file: "cards.html", compositionId: null, originalCompositionId: null },
        count: 3,
      },
    ]);
  });
});
