/**
 * HDR passthrough: every live observer on an overlay page and the function
 * its callback runs, read from a V8 heap snapshot.
 *
 * Nothing in the page can read an observer's callback back, and the capture
 * page is never paused, so its registrations cannot be watched as they
 * happen (`unpausedWatch.ts`). A heap snapshot holds Blink's side of every
 * observer, whether or not any script still references it: a native
 * `MutationObserver` (or `ResizeObserver`, `IntersectionObserver`,
 * `PerformanceObserver`, `ReportingObserver`) node, which holds its
 * `V8MutationCallback` (or `V8ResizeObserverCallback`, ...), directly or
 * through its delegate, which holds the callback closure. A closure compiled
 * from script has a location (script id, line, column); a builtin, a bound
 * function or a WebAssembly export has none. Blink's own observers (media
 * controls, lazy loading, anchor tracking) hold a C++ delegate and no
 * `V8...Callback`, and have no JS wrapper. A `FinalizationRegistry` is read
 * the same way (`FINALIZATION_REGISTRY`).
 *
 * Taking the snapshot collects garbage first, as `Runtime.queryObjects`
 * does; it runs no page code and leaves nothing in the page.
 */

import type { getCdpSession } from "@hyperframes/engine";

type Client = Awaited<ReturnType<typeof getCdpSession>>;

/** The observer kinds whose callbacks are read; Blink's native class names. */
export const OBSERVER_TYPES: readonly string[] = [
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "PerformanceObserver",
  "ReportingObserver",
];

/**
 * V8's own registration whose callback runs with no page script on the
 * stack: a `FinalizationRegistry`'s cleanup runs once the garbage
 * collector has taken one of its targets, and the census's own reads
 * collect garbage. Read like an observer, from its JS object, which holds
 * the cleanup callback.
 */
export const FINALIZATION_REGISTRY = "FinalizationRegistry";

/** The parts of V8's heap snapshot format this module reads. */
export interface HeapSnapshot {
  snapshot: {
    meta: {
      node_fields: string[];
      node_types: unknown[];
      edge_fields: string[];
      edge_types: unknown[];
      location_fields?: string[];
    };
  };
  nodes: number[];
  edges: number[];
  strings: string[];
  locations?: number[];
}

/** Where a callback's function was compiled; absent when it runs no script. */
export interface CallbackLocation {
  scriptId: string;
  line: number;
  column: number;
}

/** One live observer made by script: its kind and each callback closure it holds (one). */
export interface ObserverCallbacks {
  type: string;
  callbacks: Array<CallbackLocation | null>;
}

/** The observers in a snapshot: those made by script, and how many of each kind Blink made itself. */
export interface SnapshotObservers {
  scripted: ObserverCallbacks[];
  /** Blink's own (media controls, lazy loading), whose delegate is C++ and runs no script. */
  internal: ReadonlyMap<string, number>;
}

const CALLBACK_HOLDER = /^V8\w*Callback$/;

/** Column of `field` in a snapshot's record layout; throws when the format lacks it. */
function column(fields: readonly string[], field: string): number {
  const at = fields.indexOf(field);
  if (at < 0) throw new Error(`heap snapshot has no ${field} field`);
  return at;
}

/** Closure locations by node offset, from the snapshot's `locations` table. */
function readLocations(snapshot: HeapSnapshot): Map<number, CallbackLocation> {
  const locations = new Map<number, CallbackLocation>();
  const fields = snapshot.snapshot.meta.location_fields ?? [];
  const list = snapshot.locations;
  if (fields.length === 0 || !list) return locations;
  const objectAt = column(fields, "object_index");
  const scriptAt = column(fields, "script_id");
  const lineAt = column(fields, "line");
  const columnAt = column(fields, "column");
  for (let at = 0; at < list.length; at += fields.length) {
    locations.set(list[at + objectAt] ?? -1, {
      scriptId: String(list[at + scriptAt]),
      line: list[at + lineAt] ?? 0,
      column: list[at + columnAt] ?? 0,
    });
  }
  return locations;
}

/**
 * Every live observer in `snapshot` (see the module comment). An observer
 * made by script holds a `V8...Callback`, directly or through its
 * delegate; its JS wrapper and its C++ object can be separate nodes that
 * both hold it, so script-made observers are told apart by that holder.
 */
// fallow-ignore-next-line complexity
export function findObserverCallbacks(snapshot: HeapSnapshot): SnapshotObservers {
  const { meta } = snapshot.snapshot;
  const nodeTypes = meta.node_types[0] as string[];
  const edgeTypes = meta.edge_types[0] as string[];
  const nodeFields = meta.node_fields.length;
  const edgeFields = meta.edge_fields.length;
  const nodeType = column(meta.node_fields, "type");
  const nodeName = column(meta.node_fields, "name");
  const edgeCount = column(meta.node_fields, "edge_count");
  const edgeType = column(meta.edge_fields, "type");
  const edgeName = column(meta.edge_fields, "name_or_index");
  const edgeTo = column(meta.edge_fields, "to_node");
  const { nodes, edges, strings } = snapshot;

  const firstEdge = new Map<number, number>();
  for (let node = 0, edge = 0; node < nodes.length; node += nodeFields) {
    firstEdge.set(node, edge);
    edge += (nodes[node + edgeCount] ?? 0) * edgeFields;
  }
  const typeOf = (node: number) => nodeTypes[nodes[node + nodeType] ?? -1];
  const nameOf = (node: number) => strings[nodes[node + nodeName] ?? -1] ?? "";
  /** The nodes `node` holds strongly (weak edges left out). */
  const held = (node: number): number[] => {
    const out: number[] = [];
    const start = firstEdge.get(node) ?? 0;
    const count = nodes[node + edgeCount] ?? 0;
    for (let at = start; at < start + count * edgeFields; at += edgeFields) {
      if (edgeTypes[edges[at + edgeType] ?? -1] === "weak") continue;
      const to = edges[at + edgeTo];
      if (to !== undefined) out.push(to);
    }
    return out;
  };
  const isHolder = (node: number) =>
    typeOf(node) === "native" && CALLBACK_HOLDER.test(nameOf(node));
  /** The `V8...Callback` an observer node holds, directly or through its delegate. */
  const holderOf = (observer: number): number | undefined => {
    for (const to of held(observer)) {
      if (isHolder(to)) return to;
      if (typeOf(to) === "native" && nameOf(to).endsWith("Delegate")) {
        const inner = held(to).find(isHolder);
        if (inner !== undefined) return inner;
      }
    }
    return undefined;
  };

  const locations = readLocations(snapshot);
  const types = new Set(OBSERVER_TYPES);
  const scripted = new Map<number, ObserverCallbacks>();
  const internal = new Map<string, number>();
  for (let node = 0; node < nodes.length; node += nodeFields) {
    const type = nameOf(node);
    if (typeOf(node) !== "native" || !types.has(type)) continue;
    const holder = holderOf(node);
    if (holder === undefined) {
      internal.set(type, (internal.get(type) ?? 0) + 1);
    } else if (!scripted.has(holder)) {
      const callbacks = held(holder)
        .filter((to) => typeOf(to) === "closure")
        .map((to) => locations.get(to) ?? null);
      scripted.set(holder, { type, callbacks });
    }
  }
  // A registry is a JS object named for its constructor that holds its cleanup closure; its
  // prototype, of the same name, holds `constructor` instead.
  const propertyNamed = (node: number, name: string) => {
    const start = firstEdge.get(node) ?? 0;
    const count = nodes[node + edgeCount] ?? 0;
    for (let at = start; at < start + count * edgeFields; at += edgeFields) {
      const type = edgeTypes[edges[at + edgeType] ?? -1];
      if (type === "property" && strings[edges[at + edgeName] ?? -1] === name) return true;
    }
    return false;
  };
  for (let node = 0; node < nodes.length; node += nodeFields) {
    if (typeOf(node) !== "object" || nameOf(node) !== FINALIZATION_REGISTRY) continue;
    if (propertyNamed(node, "constructor")) continue;
    const callbacks = held(node)
      .filter((to) => typeOf(to) === "closure")
      .map((to) => locations.get(to) ?? null);
    scripted.set(node, { type: FINALIZATION_REGISTRY, callbacks });
  }
  return { scripted: [...scripted.values()], internal };
}

/** A heap snapshot of the page `client` is attached to (collects garbage first). */
export async function takeHeapSnapshot(client: Client): Promise<HeapSnapshot> {
  const chunks: string[] = [];
  const onChunk = (event: { chunk: string }) => {
    chunks.push(event.chunk);
  };
  client.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  try {
    await client.send("HeapProfiler.takeHeapSnapshot", {
      reportProgress: false,
      captureNumericValue: false,
      exposeInternals: false,
    });
  } finally {
    client.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  }
  return JSON.parse(chunks.join("")) as HeapSnapshot;
}
