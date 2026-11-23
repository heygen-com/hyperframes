/**
 * HDR passthrough: reading the overlay page's main world without running
 * anything the page can replace.
 *
 * The passthrough's checks need some of the page's own state: the GSAP
 * timelines, their tweens' targets and vars, the runtime's globals. Code
 * that reads it in the page calls builtins the page can replace before it
 * runs (`Array.from`, `JSON.stringify`, `Object.getOwnPropertyNames`) and
 * goes through getters the page can define, so a page can make such a check
 * see anything it likes. So:
 *
 * - every object is read over DevTools (`Runtime.getProperties`), which
 *   returns descriptors and internal slots and never calls a getter or a
 *   Proxy trap;
 * - the few things DevTools cannot do (tell two references to one object
 *   apart, list what changed since load) run in the page through
 *   intrinsics captured before any page script ran (`CAPTURE_SOURCE`, taken
 *   by `registrationWatch.ts` at the first statement of the document's
 *   first script), on objects with no prototype, reading own descriptors
 *   only;
 * - and before any of the passthrough's in-page probes runs, every builtin
 *   of the main world is compared with what it was at that point
 *   (`findChangedIntrinsics`): a builtin, getter or prototype the page
 *   replaced with anything but script declines, so the probes that still
 *   run in the page (the engine's own, the planner's timing analysis) call
 *   the browser's builtins or page script, which the page code watch
 *   counts.
 */

import type { getCdpSession } from "@hyperframes/engine";
import {
  nonScriptCallable,
  type PropertiesLike,
  type ReadProperties,
  type RemoteObjectLike,
} from "./nativeCallbacks.js";

type Client = Awaited<ReturnType<typeof getCdpSession>>;

/** CDP object group the capture lives in, for the page's lifetime. */
export const CAPTURE_OBJECT_GROUP = "hf-hdr-passthrough-capture";

/**
 * Evaluated at the first statement of the document's first script, before
 * any page script: every own property of the global object and of each
 * global constructor, its prototype and the namespaces the probes use, and
 * the references the passthrough's other checks start from. Plain ES5 text,
 * never transpiled.
 */
export const CAPTURE_SOURCE = String.raw`(function () {
  "use strict";
  var g = globalThis;
  var gOPD = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys, getProto = Object.getPrototypeOf;
  var hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  var apply = Reflect.apply, MapCtor = Map, mapGet = Map.prototype.get, mapSet = Map.prototype.set;
  var setHas = Set.prototype.has, SetCtor = Set;
  var owners = { __proto__: null }, labels = { __proto__: null }, count = 0;
  var seen = new MapCtor();
  function own(label, o) {
    if (o === null || (typeof o !== "object" && typeof o !== "function")) return;
    if (apply(mapGet, seen, [o]) !== undefined) return;
    apply(mapSet, seen, [o, count]);
    owners[count] = o; labels[count] = label; count++;
  }
  own("globalThis", g);
  var NAMESPACES = { __proto__: null, Math: 1, JSON: 1, Reflect: 1, Atomics: 1, Intl: 1, CSS: 1, console: 1 };
  var keys = ownKeys(g);
  for (var i = 0; i < keys.length; i++) {
    var d = gOPD(g, keys[i]);
    if (!d || !hasOwn(d, "value")) continue;
    var v = d.value;
    if (typeof v === "function") {
      own(String(keys[i]), v);
      var p = gOPD(v, "prototype");
      if (p && hasOwn(p, "value")) own(String(keys[i]) + ".prototype", p.value);
    } else if (typeof keys[i] === "string" && NAMESPACES[keys[i]] === 1) {
      own(keys[i], v);
    }
  }
  var arrayIterator = getProto([][Symbol.iterator]());
  own("%ArrayIteratorPrototype%", arrayIterator);
  own("%IteratorPrototype%", getProto(arrayIterator));
  own("%MapIteratorPrototype%", getProto(new MapCtor()[Symbol.iterator]()));
  own("%SetIteratorPrototype%", getProto(new SetCtor()[Symbol.iterator]()));
  own("%StringIteratorPrototype%", getProto(""[Symbol.iterator]()));
  own("%TypedArray%", getProto(Uint8Array));
  own("%TypedArray%.prototype", getProto(Uint8Array.prototype));
  var slots = { __proto__: null }, slotCount = 0, protos = { __proto__: null }, keySets = { __proto__: null };
  var valueSets = { __proto__: null }, setAdd = Set.prototype.add;
  for (var o = 0; o < count; o++) {
    var ks = ownKeys(owners[o]);
    var set = new SetCtor(ks);
    var values = new SetCtor();
    valueSets[o] = values;
    for (var k = 0; k < ks.length; k++) {
      var desc = gOPD(owners[o], ks[k]);
      if (!desc) continue;
      slots[slotCount] = o; slots[slotCount + 1] = ks[k]; slots[slotCount + 2] = hasOwn(desc, "value");
      slots[slotCount + 3] = desc.value; slots[slotCount + 4] = desc.get; slots[slotCount + 5] = desc.set;
      slotCount += 6;
      if (typeof desc.value === "function") apply(setAdd, values, [desc.value]);
    }
    keySets[o] = set;
    protos[o] = getProto(owners[o]);
  }
  var ids = new MapCtor(), nextId = 1;
  // A number per object, the same for every reference to it (DevTools gives each reference its own id).
  function identify(args) {
    var out = { __proto__: null };
    for (var a = 0; a < args.length; a++) {
      var id = apply(mapGet, ids, [args[a]]);
      if (id === undefined) { id = nextId++; apply(mapSet, ids, [args[a], id]); }
      out[a] = id;
    }
    return out;
  }
  function ref(path) {
    var at = g;
    for (var r = 0; r < path.length; r++) {
      if (at === null || at === undefined) return undefined;
      var rd = gOPD(at, path[r]);
      if (!rd || !hasOwn(rd, "value")) return undefined;
      at = rd.value;
    }
    return at;
  }
  var refs = {
    __proto__: null,
    global: g,
    document: g.document,
    EventTargetPrototype: ref(["EventTarget", "prototype"]),
    ObjectPrototype: ref(["Object", "prototype"]),
    MutationObserver: ref(["MutationObserver"]),
    ResizeObserver: ref(["ResizeObserver"]),
    IntersectionObserver: ref(["IntersectionObserver"]),
    PerformanceObserver: ref(["PerformanceObserver"]),
    ReportingObserver: ref(["ReportingObserver"]),
    define: ref(["CustomElementRegistry", "prototype", "define"]),
    Worker: ref(["Worker"]),
    SharedWorker: ref(["SharedWorker"]),
    registerServiceWorker: ref(["ServiceWorkerContainer", "prototype", "register"]),
    addWorkletModule: ref(["Worklet", "prototype", "addModule"]),
    transferControlToOffscreen: ref(["HTMLCanvasElement", "prototype", "transferControlToOffscreen"]),
    OffscreenCanvas: ref(["OffscreenCanvas"]),
    startViewTransition: ref(["Document", "prototype", "startViewTransition"]),
    open: ref(["open"])
  };
  return {
    __proto__: null,
    gOPD: gOPD, ownKeys: ownKeys, getProto: getProto, hasOwn: hasOwn, apply: apply, setHas: setHas,
    owners: owners, labels: labels, count: count, slots: slots, slotCount: slotCount, protos: protos,
    keySets: keySets, valueSets: valueSets, identify: identify, refs: refs
  };
})()`;

/**
 * Called on the capture (`this`): every builtin slot that is not what it was
 * at capture, as `[label, key, what, value, ...]` in an object with no
 * prototype. Reads own descriptors through the captured intrinsics only, so
 * it runs nothing the page can replace. On the global object only replaced
 * builtins and new accessors count; elsewhere new functions count too,
 * except one of the same object's own builtins under another name (the
 * runtime keeps `Element.prototype.animate` as `__hfOriginalAnimate`).
 */
const VERIFY_DECLARATION = String.raw`function () {
  "use strict";
  var c = this, gOPD = c.gOPD, ownKeys = c.ownKeys, getProto = c.getProto, hasOwn = c.hasOwn;
  var apply = c.apply, setHas = c.setHas, owners = c.owners, labels = c.labels, slots = c.slots;
  var out = { __proto__: null }, n = 0;
  function note(label, key, what, value) {
    out[n] = label; out[n + 1] = key; out[n + 2] = what; out[n + 3] = value; n += 4;
  }
  function same(a, b) { return a === b || (a !== a && b !== b); }
  for (var i = 0; i < c.slotCount; i += 6) {
    var owner = owners[slots[i]], label = labels[slots[i]], key = slots[i + 1];
    var d = gOPD(owner, key);
    if (d === undefined) { note(label, key, "removed", undefined); continue; }
    var isData = hasOwn(d, "value");
    if (isData !== slots[i + 2]) {
      if (isData) note(label, key, "value", d.value);
      else { note(label, key, "getter", d.get); note(label, key, "setter", d.set); }
      continue;
    }
    if (isData) { if (!same(d.value, slots[i + 3])) note(label, key, "value", d.value); continue; }
    if (!same(d.get, slots[i + 4])) note(label, key, "getter", d.get);
    if (!same(d.set, slots[i + 5])) note(label, key, "setter", d.set);
  }
  for (var j = 0; j < c.count; j++) {
    var o = owners[j];
    var proto = getProto(o);
    if (proto !== c.protos[j]) note(labels[j], "[[Prototype]]", "prototype", proto);
    var ks = ownKeys(o);
    for (var k = 0; k < ks.length; k++) {
      if (apply(setHas, c.keySets[j], [ks[k]])) continue;
      var added = gOPD(o, ks[k]);
      if (added === undefined) continue;
      if (!hasOwn(added, "value")) { note(labels[j], ks[k], "getter", added.get); note(labels[j], ks[k], "setter", added.set); }
      // A builtin of the same object under another name (a saved original) calls what it always did.
      else if (j !== 0 && typeof added.value === "function" && !apply(setHas, c.valueSets[j], [added.value])) {
        note(labels[j], ks[k], "value", added.value);
      }
    }
  }
  out.length = n;
  return out;
}`;

/** `this(arguments)` on the capture's `identify`: one number per argument. */
const IDENTIFY_DECLARATION = "function () { return this(arguments); }";

/** Reads the overlay page's main world through DevTools and the capture. */
export class MainWorld {
  private readonly cache = new Map<string, Promise<PropertiesLike>>();

  constructor(
    readonly client: Client,
    /** The capture's object id (`CAPTURE_SOURCE`'s result). */
    readonly captureId: string,
    readonly objectGroup: string,
  ) {}

  /** Own and internal properties; never calls a getter or a trap. Cached per object id. */
  readonly props: ReadProperties = (objectId) => {
    let entry = this.cache.get(objectId);
    if (!entry) {
      entry = this.client.send("Runtime.getProperties", {
        objectId,
        ownProperties: true,
      }) as Promise<PropertiesLike>;
      this.cache.set(objectId, entry);
    }
    return entry;
  };

  /** One own data property's value, or undefined (absent, or an accessor). */
  async value(objectId: string, name: string): Promise<RemoteObjectLike | undefined> {
    const { result } = await this.props(objectId);
    return result.find((entry) => entry.name === name)?.value;
  }

  /** An internal slot (`[[Prototype]]`, `[[FunctionLocation]]`, ...). */
  async internal(objectId: string, name: string): Promise<RemoteObjectLike | undefined> {
    const { internalProperties } = await this.props(objectId);
    return internalProperties?.find((entry) => entry.name === name)?.value;
  }

  /** A reference the capture took before any page script ran (`refs` in `CAPTURE_SOURCE`). */
  async ref(name: string): Promise<RemoteObjectLike | undefined> {
    const refs = await this.value(this.captureId, "refs");
    if (!refs?.objectId) return undefined;
    const found = await this.value(refs.objectId, name);
    return found && found.type !== "undefined" ? found : undefined;
  }

  /** One number per object: equal numbers are the same object. */
  async identify(objectIds: readonly string[]): Promise<number[]> {
    if (objectIds.length === 0) return [];
    const identify = await this.value(this.captureId, "identify");
    if (!identify?.objectId) throw new Error("main world capture has no identify");
    const { result, exceptionDetails } = (await this.client.send("Runtime.callFunctionOn", {
      functionDeclaration: IDENTIFY_DECLARATION,
      objectId: identify.objectId,
      arguments: objectIds.map((objectId) => ({ objectId })),
      returnByValue: true,
    })) as { result: { value?: Record<string, number> }; exceptionDetails?: { text?: string } };
    if (exceptionDetails || !result.value) throw new Error("main world identify failed");
    const ids = result.value;
    return objectIds.map((_, i) => ids[i] as number);
  }

  /** The builtins changed since the capture, as `[label, key, what, value]` entries. */
  async changedIntrinsics(): Promise<IntrinsicChange[]> {
    const { result, exceptionDetails } = (await this.client.send("Runtime.callFunctionOn", {
      functionDeclaration: VERIFY_DECLARATION,
      objectId: this.captureId,
      objectGroup: this.objectGroup,
    })) as { result: RemoteObjectLike; exceptionDetails?: { text?: string } };
    if (exceptionDetails || !result.objectId) {
      throw new Error(`builtin comparison failed (${exceptionDetails?.text ?? "no result"})`);
    }
    const { result: entries } = (await this.client.send("Runtime.getProperties", {
      objectId: result.objectId,
      ownProperties: true,
    })) as PropertiesLike;
    const changes = readChanges(new Map(entries.map((entry) => [entry.name, entry.value])));
    return changes;
  }
}

/** One changed slot, as `changedIntrinsics` reports it. */
interface IntrinsicChange {
  label: string;
  key: string;
  what: string;
  value: RemoteObjectLike;
}

/** The `[label, key, what, value, ...]` entries of the verify result, by index. */
// fallow-ignore-next-line complexity
function readChanges(
  byIndex: ReadonlyMap<string, RemoteObjectLike | undefined>,
): IntrinsicChange[] {
  const at = (i: number) => byIndex.get(String(i));
  const changes: IntrinsicChange[] = [];
  const length = Number(byIndex.get("length")?.value ?? 0);
  for (let i = 0; i + 3 < length; i += 4) {
    const key = at(i + 1);
    changes.push({
      label: String(at(i)?.value ?? "?"),
      key: key?.type === "symbol" ? (key.description ?? "a symbol") : String(key?.value ?? "?"),
      what: String(at(i + 2)?.value ?? "?"),
      value: at(i + 3) ?? { type: "undefined" },
    });
  }
  return changes;
}

/**
 * Whether a changed builtin slot declines the passthrough: anything but
 * script (page script, which the page code watch counts when it runs, or
 * the renderer's own, such as the virtual-time shim's timers), and any
 * non-function value or prototype change outside the global object.
 */
export async function intrinsicChangeFinding(
  change: IntrinsicChange,
  readProperties: ReadProperties,
): Promise<string | null> {
  const where = `${change.label}.${change.key}`;
  if (change.what === "removed") return `${where} was removed`;
  if (change.what === "prototype") return `the prototype of ${change.label} was replaced`;
  const { value } = change;
  if (value.type === "undefined" && change.what !== "value") return null;
  if (value.type === "function" || value.subtype === "proxy") {
    const finding = await nonScriptCallable(value, readProperties);
    return finding ? `${where} was replaced by ${finding}` : null;
  }
  return change.label === "globalThis" ? null : `${where} was replaced by a ${value.type}`;
}

/** The first builtin the page replaced with something other than script, or null. */
export async function findChangedIntrinsics(world: MainWorld): Promise<string | null> {
  const findings: string[] = [];
  for (const change of await world.changedIntrinsics()) {
    const finding = await intrinsicChangeFinding(change, world.props);
    if (finding) findings.push(finding);
  }
  if (findings.length === 0) return null;
  return `${findings.length} builtin(s) the page replaced, first ${findings[0]}`;
}
