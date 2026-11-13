import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installEditingAgent } from "./editingAgent";
import { trackedHandleCount } from "./editingHandles";
import {
  EDITING_ELEMENT_HANDLE,
  MAX_DESCRIBE_HANDLES,
  MAX_ELEMENT_TEXT,
  MAX_ELEMENT_VALUE,
  MAX_QUERY_MATCHES,
  type EditingElementDescription,
  type EditingElementHit,
} from "./editingPort";

const CONNECT = { source: "hf-parent", type: "editing-connect", v: 1 };

type Reply<T> = { ok: boolean; result?: { elements: T[] }; error?: { code: string } };

describe("element handles over the editing port", () => {
  let port: MessagePort;
  let agent: { dispose: () => void };
  let lastId = 0;

  const ask = <T>(kind: string, params: unknown): Promise<Reply<T>> =>
    new Promise((resolve) => {
      port.onmessage = (event) => resolve(event.data);
      port.postMessage({ v: 1, id: ++lastId, kind, params });
    });
  const describeHandles = async (handles: string[]) =>
    (await ask<EditingElementDescription | null>("describe", { handles })).result!.elements;
  const atPoint = async () =>
    (await ask<EditingElementHit>("elements-at-point", { x: 5, y: 6 })).result!.elements;
  const describeOne = async (element: Element) => {
    stackAtPoint(element);
    const [hit] = await atPoint();
    return (await describeHandles([hit!.handle]))[0]!;
  };
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

  it("answers a point with handle, tag and rect only, and describes a kept handle in plain data", async () => {
    document.body.innerHTML = `
      <div data-composition-id="card__hf1" data-hf-original-composition-id="card" data-timeline-locked>
        <p class="clip title" data-hf-id="hf-1" data-start="2" style="color: red; left: 4px">Hi <b>there</b></p>
      </div>`;
    const title = document.querySelector("p")!;
    stackAtPoint(title, title.parentElement!);
    const [top, below] = await atPoint();
    expect(document.elementsFromPoint).toHaveBeenCalledWith(5, 6);
    expect(top).toEqual({
      handle: expect.stringMatching(EDITING_ELEMENT_HANDLE),
      tag: "p",
      rect: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(below).toEqual({ handle: expect.any(String), tag: "div", rect: expect.any(Object) });

    const [described, root] = await describeHandles([top!.handle, below!.handle]);
    expect(described).toEqual({
      handle: top!.handle,
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
      children: [{ text: "Hi " }, { handle: expect.stringMatching(EDITING_ELEMENT_HANDLE) }],
      rect: { x: 0, y: 0, width: 0, height: 0 },
      truncated: false,
    });
    expect(root).toMatchObject({ tag: "div", selector: '[data-composition-id="card__hf1"]' });
    expect(root!.matchesBefore).toBeNull();
    expect(JSON.parse(JSON.stringify(described))).toEqual(described);
  });

  it("keeps an element's handle for the page load, answering null only while it is detached", async () => {
    document.body.innerHTML = `<p id="a">A</p><p id="b">B</p>`;
    const [a, b] = Array.from(document.querySelectorAll("p"));
    stackAtPoint(a!, b!);
    const [first, second] = await atPoint();
    expect(first!.handle).not.toBe(second!.handle);
    const again = await describeHandles([second!.handle, first!.handle]);
    expect(again.map((entry) => entry?.id)).toEqual(["b", "a"]);

    // The preview parks a scene with replaceWith and later puts the same nodes back.
    const placeholder = document.createElement("template");
    a!.replaceWith(placeholder);
    const tracked = trackedHandleCount();
    const unknown = first!.handle.replace(/:\d+$/, ":999999");
    expect(await describeHandles([first!.handle, unknown, second!.handle])).toEqual([
      null,
      null,
      expect.objectContaining({ id: "b" }),
    ]);
    expect(trackedHandleCount()).toBe(tracked);
    placeholder.replaceWith(a!);
    expect(await describeHandles([first!.handle])).toEqual([expect.objectContaining({ id: "a" })]);
  });

  it("answers null for a handle from an earlier load, even one with the same number", async () => {
    document.body.innerHTML = `<p id="a">A</p>`;
    const element = document.querySelector("p")!;
    stackAtPoint(element);
    const [current] = await atPoint();
    // A fresh module instance is a fresh page load: a new load id, numbering from 1 again.
    vi.resetModules();
    const earlierLoad = await import("./editingHandles");
    const [earlier] = earlierLoad.elementsAtPoint(0, 0);
    expect(earlier!.handle).not.toBe(current!.handle);
    expect(await describeHandles([earlier!.handle])).toEqual([null]);
    const sameNumber = `${earlier!.handle.split(":")[0]}:${current!.handle.split(":")[1]}`;
    expect(await describeHandles([sameNumber, current!.handle])).toEqual([
      null,
      expect.objectContaining({ id: "a" }),
    ]);
    expect(earlierLoad.describeHandles([current!.handle])).toEqual([null]);
  });

  it("draws its load id on first use, so loading the runtime leaves a seeded RNG alone", async () => {
    vi.resetModules();
    const draw = vi.spyOn(crypto, "getRandomValues");
    try {
      const fresh = await import("./editingHandles");
      expect(draw).not.toHaveBeenCalled();
      document.body.innerHTML = `<p>A</p>`;
      stackAtPoint(document.querySelector("p")!);
      fresh.elementsAtPoint(0, 0);
      fresh.elementsAtPoint(0, 0);
      expect(draw).toHaveBeenCalledOnce();
    } finally {
      draw.mockRestore();
    }
  });

  it("cuts long values, keeps only a long data: value's header, and leaves script and style text out", async () => {
    const long = "x".repeat(MAX_ELEMENT_VALUE + 50);
    document.body.innerHTML = `<div class="card" title="${long}" style="--note: ${long}">
      <img src="data:image/png;base64,${"A".repeat(5000)}"><style>.a{color:red}</style>
      <script>window.secretish = 1</script><span>Shown</span></div><style>.b{}</style>`;
    const card = document.querySelector("div")!;
    const described = await describeOne(card);
    expect(described.truncated).toBe(true);
    expect(described.attributes[1]).toEqual(["title", long.slice(0, MAX_ELEMENT_VALUE)]);
    expect(described.inlineStyles["--note"]!.length).toBeLessThanOrEqual(MAX_ELEMENT_VALUE);
    expect(described.text.replace(/\s+/g, " ").trim()).toBe("Shown");

    const img = await describeOne(card.querySelector("img")!);
    expect(img.attributes).toEqual([["src", "data:image/png;base64,"]]);
    expect(img.truncated).toBe(true);

    const style = await describeOne(card.querySelector("style")!);
    expect(style).toMatchObject({ text: "", children: [], truncated: false });

    const icon = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
    document.body.innerHTML = `<img>`;
    const iconImg = document.querySelector("img")!;
    iconImg.setAttribute("src", icon);
    iconImg.style.setProperty("background", `url('${icon}')`);
    const small = await describeOne(iconImg);
    expect(small.attributes).toEqual([["src", icon]]);
    expect(small.inlineStyles.background).toContain("data:image/svg+xml,");
    expect(small.truncated).toBe(false);

    document.body.innerHTML = `<p>data: 42 users, up 3%</p>`;
    const dataText = await describeOne(document.querySelector("p")!);
    expect(dataText).toMatchObject({ text: "data: 42 users, up 3%", truncated: false });

    document.body.innerHTML = `<p>${"y".repeat(MAX_ELEMENT_TEXT + 10)}</p>`;
    const text = await describeOne(document.querySelector("p")!);
    expect(text.text).toHaveLength(MAX_ELEMENT_TEXT);
    expect(text.children).toEqual([{ text: "y".repeat(MAX_ELEMENT_TEXT) }]);
    expect(text.truncated).toBe(true);
  });

  it("counts a class selector's earlier matches per source", async () => {
    document.body.innerHTML = `
      <div class="tile"></div>
      <div data-composition-file="cards.html"><div class="tile"></div><div class="tile"></div></div>
      <div data-composition-src="cards.html"><div class="tile" id="t"></div></div>
      <div data-composition-file="cards.html"><div class="tile"></div></div>`;
    const last = await describeOne(document.querySelectorAll(".tile")[4]!);
    expect(last.source.file).toBe("cards.html");
    expect(last.matchesBefore).toEqual([
      { source: { file: null, compositionId: null, originalCompositionId: null }, count: 1 },
      {
        source: { file: "cards.html", compositionId: null, originalCompositionId: null },
        count: 3,
      },
    ]);
  });

  it("names a handle's ancestors parent first, up to the document element, and null once removed", async () => {
    document.body.innerHTML = `<section id="s"><div class="g"><p id="p">A</p></div></section>`;
    const p = document.querySelector("p")!;
    const { handle } = await describeOne(p);
    const reply = await ask<never>("ancestors", { handles: [handle, handle] });
    const [chain, again] = (reply.result as unknown as { ancestors: string[][] }).ancestors;
    expect(again).toEqual(chain);
    const tags = (await describeHandles(chain!)).map((entry) => entry?.tag);
    expect(tags).toEqual(["div", "section", "body", "html"]);

    p.remove();
    const gone = await ask<never>("ancestors", { handles: [handle] });
    expect(gone.result).toEqual({ ancestors: [null] });
  });

  it("stops an ancestor chain at what one describe takes", async () => {
    document.body.innerHTML = "<div>".repeat(MAX_DESCRIBE_HANDLES + 5) + "<p>deep</p>";
    const { handle } = await describeOne(document.querySelector("p")!);
    const reply = await ask<never>("ancestors", { handles: [handle] });
    const [chain] = (reply.result as unknown as { ancestors: string[][] }).ancestors;
    expect(chain).toHaveLength(MAX_DESCRIBE_HANDLES);
    const [top] = await describeHandles([chain!.at(-1)!]);
    expect(top!.parent).not.toBeNull();
  });

  it("answers a query with each match's handle and source, in document order", async () => {
    document.body.innerHTML = `<p class="t" id="a"></p>
      <div data-composition-file="cards.html"><p class="t" id="b"></p></div>`;
    const reply = await ask<never>("query", { selector: ".t" });
    const { matches, truncated } = reply.result as unknown as {
      matches: Array<{ handle: string; source: { file: string | null } }>;
      truncated: boolean;
    };
    expect(truncated).toBe(false);
    expect(matches.map((match) => match.source.file)).toEqual([null, "cards.html"]);
    const described = await describeHandles(matches.map((match) => match.handle));
    expect(described.map((entry) => entry?.id)).toEqual(["a", "b"]);
    expect((await ask<never>("query", { selector: "p[" })).error).toMatchObject({ code: "failed" });
  });

  it("caps a query's matches and says so", async () => {
    document.body.innerHTML = "<i></i>".repeat(MAX_QUERY_MATCHES + 1);
    const { result } = await ask<never>("query", { selector: "i" });
    const { matches, truncated } = result as unknown as { matches: unknown[]; truncated: boolean };
    expect(matches).toHaveLength(MAX_QUERY_MATCHES);
    expect(truncated).toBe(true);
  });

  it("reads computed styles for the element a handle names, and null once it is removed", async () => {
    document.body.innerHTML = `<p class="t" style="color: rgb(1, 2, 3)"></p><p class="t" style="color: rgb(4, 5, 6)"></p>`;
    const second = document.querySelectorAll("p")[1]!;
    const { handle } = await describeOne(second);
    const styles = (properties: string[]) =>
      ask<never>("computed-styles", { handle, properties }).then((reply) => reply.result);
    expect(await styles(["color"])).toEqual({ styles: { color: "rgb(4, 5, 6)" } });
    second.remove();
    expect(await styles(["color"])).toEqual({ styles: null });
  });
});
