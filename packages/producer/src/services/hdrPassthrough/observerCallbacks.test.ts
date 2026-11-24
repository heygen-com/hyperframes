import { describe, expect, it } from "bun:test";
import { findObserverCallbacks, type HeapSnapshot } from "./observerCallbacks.js";

const NODE_TYPES = ["hidden", "object", "closure", "native", "string"];
const EDGE_TYPES = ["context", "element", "property", "internal", "hidden", "shortcut", "weak"];

interface Spec {
  type: string;
  name: string;
  edges?: Array<[edge: string, to: string, name?: string]>;
  location?: [scriptId: number, line: number, column: number];
}

/** A heap snapshot in V8's format from nodes named by key. */
function snapshot(specs: Record<string, Spec>): HeapSnapshot {
  const keys = Object.keys(specs);
  const strings: string[] = [];
  const string = (text: string) => {
    const at = strings.indexOf(text);
    return at >= 0 ? at : strings.push(text) - 1;
  };
  const NODE_FIELDS = 3;
  const offset = (key: string) => keys.indexOf(key) * NODE_FIELDS;
  const nodes: number[] = [];
  const edges: number[] = [];
  const locations: number[] = [];
  for (const key of keys) {
    const spec = specs[key] as Spec;
    const list = spec.edges ?? [];
    nodes.push(NODE_TYPES.indexOf(spec.type), string(spec.name), list.length);
    list.forEach(([edge, to, name], index) => {
      const named = edge === "property" || edge === "internal";
      edges.push(
        EDGE_TYPES.indexOf(edge),
        named ? string(name ?? `p${index}`) : index + 1,
        offset(to),
      );
    });
    if (spec.location) locations.push(offset(key), spec.location[0], 0, ...spec.location.slice(1));
  }
  return {
    snapshot: {
      meta: {
        node_fields: ["type", "name", "edge_count"],
        node_types: [NODE_TYPES],
        edge_fields: ["type", "name_or_index", "to_node"],
        edge_types: [EDGE_TYPES],
        location_fields: ["object_index", "script_id", "script_object_index", "line", "column"],
      },
    },
    nodes,
    edges,
    strings,
    locations,
  };
}

describe("findObserverCallbacks", () => {
  it("reads each script-made observer's callback once, through its delegate or directly", () => {
    const found = findObserverCallbacks(
      snapshot({
        // A MutationObserver's JS wrapper and its C++ object both hold its delegate.
        wrapper: {
          type: "native",
          name: "MutationObserver",
          edges: [
            ["property", "proto"],
            ["element", "delegate"],
            ["element", "cpp"],
          ],
        },
        cpp: { type: "native", name: "MutationObserver", edges: [["element", "delegate"]] },
        proto: { type: "object", name: "MutationObserver (prototype)" },
        delegate: {
          type: "native",
          name: "MutationObserver::Delegate",
          edges: [["element", "v8cb"]],
        },
        v8cb: { type: "native", name: "V8MutationCallback", edges: [["element", "fn"]] },
        fn: { type: "closure", name: "onMutations", location: [13, 451, 36994] },
        // A ResizeObserver holds its V8 callback directly; a bound builtin has no location.
        ro: { type: "native", name: "ResizeObserver", edges: [["element", "rocb"]] },
        rocb: { type: "native", name: "V8ResizeObserverCallback", edges: [["element", "bound"]] },
        bound: { type: "closure", name: "native_bind" },
      }),
    );
    expect(found.scripted).toEqual([
      { type: "MutationObserver", callbacks: [{ scriptId: "13", line: 451, column: 36994 }] },
      { type: "ResizeObserver", callbacks: [null] },
    ]);
    expect([...found.internal]).toEqual([]);
  });

  it("counts Blink's own observers, whose delegate is C++, apart", () => {
    const found = findObserverCallbacks(
      snapshot({
        controls: {
          type: "native",
          name: "ResizeObserver",
          edges: [["element", "controlsDelegate"]],
        },
        controlsDelegate: {
          type: "native",
          name: "blink::MediaControlsImpl::MediaControlsResizeObserverDelegate",
        },
        anchors: {
          type: "native",
          name: "IntersectionObserver",
          edges: [["element", "ioDelegate"]],
        },
        ioDelegate: { type: "native", name: "IntersectionObserverDelegate" },
        // Reaching a V8 callback only through a weak edge does not make an observer script-made.
        weakly: { type: "native", name: "MutationObserver", edges: [["weak", "v8cb"]] },
        v8cb: { type: "native", name: "V8MutationCallback", edges: [["element", "fn"]] },
        fn: { type: "closure", name: "f", location: [3, 1, 1] },
        // Only native nodes count: a constructor or a string of the same name is not an observer.
        ctor: { type: "closure", name: "MutationObserver" },
        text: { type: "string", name: "ResizeObserver" },
      }),
    );
    expect(found.scripted).toEqual([]);
    expect([...found.internal].sort()).toEqual([
      ["IntersectionObserver", 1],
      ["MutationObserver", 1],
      ["ResizeObserver", 1],
    ]);
  });

  it("throws on a snapshot whose layout lacks a field it reads", () => {
    const bad = snapshot({});
    bad.snapshot.meta.node_fields = ["type", "name"];
    expect(() => findObserverCallbacks(bad)).toThrow("heap snapshot has no edge_count field");
  });

  it("reads a FinalizationRegistry's cleanup from its JS object, not from its prototype", () => {
    const found = findObserverCallbacks(
      snapshot({
        bound: {
          type: "object",
          name: "FinalizationRegistry",
          edges: [
            ["property", "proto"],
            ["hidden", "removeBound"],
          ],
        },
        removeBound: { type: "closure", name: "native_bind" },
        renderer: { type: "object", name: "FinalizationRegistry", edges: [["hidden", "cleanup"]] },
        cleanup: { type: "closure", name: "forget", location: [13, 30, 2] },
        proto: {
          type: "object",
          name: "FinalizationRegistry",
          edges: [
            ["property", "ctor", "constructor"],
            ["property", "register", "register"],
          ],
        },
        ctor: { type: "closure", name: "FinalizationRegistry" },
        register: { type: "closure", name: "register" },
      }),
    );
    expect(found.scripted).toEqual([
      { type: "FinalizationRegistry", callbacks: [null] },
      { type: "FinalizationRegistry", callbacks: [{ scriptId: "13", line: 30, column: 2 }] },
    ]);
  });
});
