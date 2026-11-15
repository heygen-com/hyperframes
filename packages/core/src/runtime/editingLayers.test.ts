import { afterEach, describe, expect, it } from "vitest";
import { MAX_QUERY_MATCHES } from "./editingElement";
import { elementForHandle } from "./editingHandles";
import { layersOf } from "./editingLayers";

afterEach(() => {
  document.body.innerHTML = "";
});

const named = (handle: string) =>
  elementForHandle(handle)?.id || elementForHandle(handle)?.className;

describe("layers", () => {
  it("walks layers in document order with their depth, child count, z-index and kind", () => {
    document.body.innerHTML = `<main data-composition-id="m">
      <div id="card" style="z-index: 3"><p id="title">Hi <b>there</b></p><img id="pic"></div>
      <div id="pair" data-hf-group="g"><i id="a"></i></div>
      <div id="parked" data-hf-clip-hidden style="visibility: hidden"><p id="inside" style="visibility: visible">x</p></div>
      <div><span class="loose"></span></div>
      <script id="code"></script></main>`;
    const { layers, truncated } = layersOf();
    expect(truncated).toBe(false);
    expect(layers.map((layer) => [named(layer.handle), layer.depth, layer.childCount])).toEqual([
      ["card", 0, 2],
      ["title", 1, 0],
      ["pic", 1, 0],
      ["pair", 0, 1],
      ["a", 1, 0],
      ["loose", 0, 0],
    ]);
    expect(layers.map((layer) => layer.kind)).toEqual([
      "group",
      "text",
      "image",
      "group",
      "shape",
      "shape",
    ]);
    expect(layers[0]!.zIndex).toBe(3);
  });

  it("scopes to a drilled-into group, and caps the walk", () => {
    const tiles = Array.from({ length: MAX_QUERY_MATCHES + 3 }, (_, i) => `<i id="t${i}"></i>`);
    document.body.innerHTML = `<main data-composition-id="m"><div id="pair" data-hf-group="g">
      <i id="a"></i><i id="b"></i></div>${tiles.join("")}</main>`;
    const all = layersOf();
    expect(all).toMatchObject({ truncated: true });
    expect(all.layers).toHaveLength(MAX_QUERY_MATCHES);
    const pair = all.layers[0]!.handle;
    expect(layersOf(pair).layers.map((layer) => [named(layer.handle), layer.depth])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
    expect(layersOf(pair).missingGroup).toBe(false);
  });

  it("pages past the cap from an offset, so a caller can read every layer", () => {
    const tiles = Array.from({ length: MAX_QUERY_MATCHES + 3 }, (_, i) => `<i id="t${i}"></i>`);
    document.body.innerHTML = `<main data-composition-id="m">${tiles.join("")}</main>`;
    const rest = layersOf(undefined, MAX_QUERY_MATCHES);
    expect(rest).toMatchObject({ truncated: false, missingGroup: false });
    expect(rest.layers.map((layer) => named(layer.handle))).toEqual([
      `t${MAX_QUERY_MATCHES}`,
      `t${MAX_QUERY_MATCHES + 1}`,
      `t${MAX_QUERY_MATCHES + 2}`,
    ]);
    const last = layersOf(undefined, MAX_QUERY_MATCHES + 2).layers;
    expect(last.map((layer) => named(layer.handle))).toEqual([`t${MAX_QUERY_MATCHES + 2}`]);
  }, 20_000);

  it("lists nothing for a group this page no longer has, and says so", () => {
    document.body.innerHTML = `<main data-composition-id="m"><div id="pair" data-hf-group="g"><i id="a"></i></div></main>`;
    const pair = layersOf().layers[0]!.handle;
    document.getElementById("pair")!.remove();
    expect(layersOf(pair)).toEqual({ layers: [], truncated: false, missingGroup: true });
    expect(layersOf("0123456789abcdef:1")).toMatchObject({ layers: [], missingGroup: true });
  });
});
