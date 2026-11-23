/**
 * HDR passthrough: what runs on a seek that the page provided, read over
 * DevTools.
 *
 * On every seek the renderer calls into the page's objects (the registered
 * timelines, the runtime globals it assigns) and GSAP calls the tweens'
 * callbacks and function-based values and writes their targets, through any
 * accessor the target has for a key. The browser calls event listeners. A
 * callable among those that is not page script runs where V8's call counts
 * cannot see it (`nativeCallbacks.ts`), and declines the passthrough.
 *
 * Everything is read with `Runtime.getProperties`, which never calls a
 * getter or a Proxy trap, starting from references taken before any page
 * script ran (`mainWorld.ts`), so the page cannot hide anything from the
 * walk by replacing a builtin or a global. Object identity (the global
 * timeline's children against the registered timelines' roots) comes from
 * the capture's `identify`.
 *
 * The walk also enforces what the passthrough accepts on GSAP's side:
 * - every tween target is an element (anything else declines: a plain
 *   object, a text node, a stylesheet rule, the window, a Proxy);
 * - every GSAP ticker listener is GSAP's or the renderer's;
 * - `window.gsap` is a published build (`gsapBuilds.ts`) when timelines
 *   are registered;
 * - nothing plays on GSAP's global timeline outside the registered
 *   timelines, and nothing paused there holds a callback (a `delayedCall`):
 *   it would run on GSAP's own clock, which capture's out-of-order seeks do
 *   not share with the layered path.
 * It returns the element targets and the keys their tweens write, for the
 * fingerprint to read back (`overlayFingerprint.ts`).
 */

import type { MainWorld } from "./mainWorld.js";
import {
  type EventListenerLike,
  nonScriptCallable,
  nonScriptListener,
  type PropertiesLike,
  type RemoteObjectLike,
} from "./nativeCallbacks.js";
import type { ScriptOriginRecord } from "./scriptOrigins.js";

/** Tween vars keys GSAP calls when they hold a function. */
const CALLBACKS: readonly string[] = [
  "onStart",
  "onUpdate",
  "onComplete",
  "onRepeat",
  "onReverseComplete",
  "onInterrupt",
];

/**
 * Tween vars keys GSAP reads as settings and never writes to a target. A
 * tween whose vars hold nothing else writes nothing (the runtime's filler
 * tweens of `{}` that only set a duration).
 */
const SETTINGS: ReadonlySet<string> = new Set([
  "duration",
  "delay",
  "ease",
  "data",
  "id",
  "repeat",
  "repeatDelay",
  "yoyo",
  "paused",
  "reversed",
  "immediateRender",
  "lazy",
  "overwrite",
  "inherit",
  "callbackScope",
  "parent",
  "smoothChildTiming",
  "autoRemoveChildren",
  ...CALLBACKS,
  ...CALLBACKS.map((key) => `${key}Params`),
]);

/** Nodes and objects walked before the walk gives up (and declines). */
const MAX_NODES = 20000;
/** How deep tween vars are followed. */
const MAX_VARS_DEPTH = 4;

/** An element a tween writes, as a main-world handle, with the vars keys of its tweens. */
export interface ElementTarget {
  objectId: string;
  keys: string[];
}

export interface SeekReachable {
  /** Why the passthrough must decline, first finding first; empty when nothing does. */
  findings: string[];
  /** Every element a registered tween targets. */
  elementTargets: ElementTarget[];
}

type Entry = PropertiesLike["result"][number];

const isObject = (remote: RemoteObjectLike | undefined): remote is RemoteObjectLike =>
  !!remote?.objectId && (remote.type === "object" || remote.type === "function");

const isCallable = (remote: RemoteObjectLike | undefined): boolean =>
  !!remote && (remote.type === "function" || remote.subtype === "proxy");

const isElement = (remote: RemoteObjectLike) =>
  remote.subtype === "node" && /Element$/.test(remote.className ?? "");

/** Whether a native accessor is the platform's own for `key` (`scrollTop` on an element). */
function isPlatformAccessor(kind: "get" | "set", key: string, remote: RemoteObjectLike): boolean {
  return remote.description === `function ${kind} ${key}() { [native code] }`;
}

class Walk {
  readonly findings: string[] = [];
  private visited = 0;

  constructor(
    private readonly world: MainWorld,
    private readonly origins: ScriptOriginRecord,
  ) {}

  note(finding: string) {
    if (this.findings.length < 32) this.findings.push(finding);
  }

  budget(): boolean {
    this.visited++;
    if (this.visited === MAX_NODES) this.note("too much GSAP state to read");
    return this.visited < MAX_NODES;
  }

  props(remote: RemoteObjectLike): Promise<PropertiesLike> {
    return this.world.props(remote.objectId as string);
  }

  async own(remote: RemoteObjectLike | undefined, name: string): Promise<Entry | undefined> {
    if (!isObject(remote)) return undefined;
    return (await this.props(remote)).result.find((entry) => entry.name === name);
  }

  /** An own data property's value; an accessor there is a finding (it would run on the read). */
  async data(
    remote: RemoteObjectLike | undefined,
    name: string,
    label: string,
  ): Promise<RemoteObjectLike | undefined> {
    const entry = await this.own(remote, name);
    if (!entry) return undefined;
    if (entry.get || entry.set) {
      await this.accessor(label, entry);
      return undefined;
    }
    return entry.value;
  }

  async callable(label: string, remote: RemoteObjectLike | undefined): Promise<void> {
    if (!remote || !isCallable(remote)) return;
    const finding = await nonScriptCallable(remote, this.world.props);
    if (finding) this.note(`${label}: ${finding}`);
  }

  async accessor(label: string, entry: Entry, key?: string): Promise<void> {
    for (const kind of ["get", "set"] as const) {
      const fn = entry[kind];
      if (!fn || !isCallable(fn)) continue;
      if (key !== undefined && isPlatformAccessor(kind, key, fn)) continue;
      await this.callable(`${kind === "get" ? "getter" : "setter"} ${label}`, fn);
    }
  }

  async scriptOrigin(remote: RemoteObjectLike): Promise<string | undefined> {
    const location = await this.world.internal(remote.objectId as string, "[[FunctionLocation]]");
    const scriptId = (location?.value as { scriptId?: string } | undefined)?.scriptId;
    return scriptId ? this.origins.originOf(scriptId) : undefined;
  }

  /** Function values and accessors in tween vars, through plain objects and arrays. */
  // fallow-ignore-next-line complexity
  async vars(remote: RemoteObjectLike, label: string, depth: number): Promise<void> {
    if (depth > MAX_VARS_DEPTH || !this.budget()) return;
    for (const entry of (await this.props(remote)).result) {
      const at = `${label}.${entry.name}`;
      if (entry.get || entry.set) {
        await this.accessor(at, entry);
        continue;
      }
      const value = entry.value;
      if (isCallable(value)) await this.callable(at, value);
      else if (
        isObject(value) &&
        (value.subtype === "array" || (value.className === "Object" && !value.subtype))
      ) {
        await this.vars(value, at, depth + 1);
      }
    }
  }

  /** Own function values and accessors of an object GSAP or the renderer calls into. */
  async methods(remote: RemoteObjectLike, label: string): Promise<void> {
    for (const entry of (await this.props(remote)).result) {
      if (entry.get || entry.set) await this.accessor(`${label}.${entry.name}`, entry);
      else if (entry.name !== "vars" && entry.name !== "_targets") {
        await this.callable(`${label}.${entry.name}`, entry.value);
      }
    }
  }

  /**
   * Each distinct object on the prototype chains of `objects`, up to
   * `Object.prototype` (which the builtin comparison covers), with what
   * `visit` finds on it. A Proxy on a chain is followed no further and
   * reported.
   */
  // fallow-ignore-next-line complexity
  async prototypes(
    objects: readonly RemoteObjectLike[],
    stop: number | undefined,
    visit: (prototype: RemoteObjectLike, from: number[]) => Promise<void>,
  ): Promise<void> {
    const seen = new Set<number>(stop === undefined ? [] : [stop]);
    let level: Array<{ remote: RemoteObjectLike; from: number[] }> = objects.map((remote, i) => ({
      remote,
      from: [i],
    }));
    for (let depth = 0; level.length > 0 && depth < 64; depth++) {
      const next: RemoteObjectLike[] = [];
      const from: number[][] = [];
      for (const { remote, from: owners } of level) {
        const proto = await this.world.internal(remote.objectId as string, "[[Prototype]]");
        if (!isObject(proto)) continue;
        next.push(proto);
        from.push(owners);
      }
      const ids = await this.world.identify(next.map((remote) => remote.objectId as string));
      const byId = new Map<number, { remote: RemoteObjectLike; from: number[] }>();
      next.forEach((remote, i) => {
        const id = ids[i] as number;
        if (seen.has(id)) return;
        const merged = byId.get(id);
        if (merged) merged.from.push(...(from[i] as number[]));
        else byId.set(id, { remote, from: [...(from[i] as number[])] });
      });
      level = [];
      for (const [id, entry] of byId) {
        seen.add(id);
        if (!this.budget()) return;
        if (entry.remote.subtype === "proxy") {
          await this.callable("a Proxy on a prototype chain", entry.remote);
          this.note("a Proxy on the prototype chain of an object GSAP writes or calls");
          continue;
        }
        await visit(entry.remote, entry.from);
        level.push(entry);
      }
    }
  }
}

/** A timeline or tween node with what the walk needs from it. */
interface GsapNode {
  remote: RemoteObjectLike;
  label: string;
}

async function nodeChildren(walk: Walk, node: GsapNode): Promise<GsapNode[]> {
  const out: GsapNode[] = [];
  let child = await walk.data(node.remote, "_first", `${node.label}._first`);
  for (let i = 0; isObject(child) && i < MAX_NODES; i++) {
    if (!walk.budget()) break;
    out.push({ remote: child, label: `${node.label} child ${i}` });
    child = await walk.data(child, "_next", `${node.label} child ${i}._next`);
  }
  return out;
}

/** Whether a node or anything under it calls back (a callback in its vars, a function target). */
// fallow-ignore-next-line complexity
async function callsBack(walk: Walk, node: GsapNode, depth = 0): Promise<boolean> {
  if (depth > 32 || !walk.budget()) return true;
  const vars = await walk.data(node.remote, "vars", `${node.label}.vars`);
  for (const key of CALLBACKS) {
    if (isCallable(await walk.data(vars, key, `${node.label}.vars.${key}`))) return true;
  }
  const targets = await walk.data(node.remote, "_targets", `${node.label}._targets`);
  if (isObject(targets)) {
    for (const entry of (await walk.props(targets)).result) {
      if (/^\d+$/.test(entry.name) && isCallable(entry.value)) return true;
    }
  }
  for (const child of await nodeChildren(walk, node)) {
    if (await callsBack(walk, child, depth + 1)) return true;
  }
  return false;
}

/** The registered timelines (`window.__timelines`, behind the runtime's stand-ins). */
async function registeredTimelines(walk: Walk, global: RemoteObjectLike): Promise<GsapNode[]> {
  const registry = await walk.data(global, "__timelines", "window.__timelines");
  if (!isObject(registry)) return [];
  await walk.callable("window.__timelines", registry);
  const out: GsapNode[] = [];
  for (const entry of (await walk.props(registry)).result) {
    const label = `timeline "${entry.name}"`;
    if (entry.get || entry.set) {
      await walk.accessor(label, entry);
      continue;
    }
    if (!isObject(entry.value)) continue;
    await walk.callable(label, entry.value);
    const real = await walk.data(entry.value, "__hfReal", `${label}.__hfReal`);
    out.push({ remote: isObject(real) ? real : entry.value, label });
  }
  return out;
}

/** The runtime's `window.__hf*` globals the page made accessors of: the runtime assigns some on every seek. */
async function runtimeGlobals(walk: Walk, global: RemoteObjectLike): Promise<void> {
  for (const entry of (await walk.props(global)).result) {
    if (entry.name.startsWith("__hf") && (entry.get || entry.set)) {
      await walk.accessor(`window.${entry.name}`, entry);
    }
  }
}

/**
 * `window.gsap`, through the runtime's own accessor when it has put one
 * there (the early stub keeps GSAP behind a getter until GSAP loads): a
 * getter in a renderer script is the renderer's code and is called; any
 * other accessor declines.
 */
async function windowGsap(walk: Walk, world: MainWorld, global: RemoteObjectLike) {
  const entry = await walk.own(global, "gsap");
  if (!entry) return undefined;
  if (!entry.get && !entry.set) return entry.value;
  const getter = entry.get;
  if (!getter?.objectId || (await walk.scriptOrigin(getter)) !== "renderer") {
    await walk.accessor("window.gsap", entry);
    walk.note("window.gsap is an accessor that is not the renderer's");
    return undefined;
  }
  const apply = await world.value(world.captureId, "apply");
  const { result, exceptionDetails } = (await world.client.send("Runtime.callFunctionOn", {
    functionDeclaration: "function (apply, receiver) { return apply(this, receiver, []); }",
    objectId: getter.objectId,
    arguments: [{ objectId: apply?.objectId }, { objectId: global.objectId }],
    objectGroup: world.objectGroup,
  })) as { result: RemoteObjectLike; exceptionDetails?: unknown };
  if (exceptionDetails) {
    walk.note("window.gsap unreadable");
    return undefined;
  }
  return result;
}

/** GSAP's ticker: a published build's, with no listener but GSAP's and the renderer's. False when it is not GSAP's. */
// fallow-ignore-next-line complexity
async function tickerFindings(walk: Walk, gsap: RemoteObjectLike): Promise<boolean> {
  const ticker = await walk.data(gsap, "ticker", "gsap.ticker");
  const add = await walk.data(ticker, "add", "gsap.ticker.add");
  if (!add || !isCallable(add) || (await walk.scriptOrigin(add)) !== "gsap") {
    walk.note("window.gsap's ticker is not a published GSAP build's");
    return false;
  }
  const listeners = await walk.data(ticker, "_listeners", "gsap.ticker._listeners");
  if (!isObject(listeners)) {
    walk.note("GSAP ticker listeners unreadable");
    return true;
  }
  for (const entry of (await walk.props(listeners)).result) {
    const listener = entry.value;
    if (!/^\d+$/.test(entry.name)) continue;
    const origin = listener && isCallable(listener) ? await walk.scriptOrigin(listener) : undefined;
    if (origin !== "gsap" && origin !== "renderer") {
      walk.note(`a GSAP ticker listener that is ${origin ? `${origin} script` : "not script"}`);
    }
  }
  return true;
}

/** Each registered timeline's root must be `globalTimeline`. */
async function rootFindings(
  walk: Walk,
  world: MainWorld,
  globalTimeline: RemoteObjectLike,
  registered: readonly GsapNode[],
): Promise<void> {
  const roots: RemoteObjectLike[] = [];
  for (const node of registered) {
    let at: RemoteObjectLike = node.remote;
    for (let depth = 0; depth < 64; depth++) {
      const parent = await walk.data(at, "parent", `${node.label} ancestor`);
      if (!isObject(parent)) break;
      at = parent;
    }
    roots.push(at);
  }
  const ids = await world.identify(
    [globalTimeline, ...roots].map((remote) => remote.objectId as string),
  );
  if (ids.slice(1).some((id) => id !== ids[0])) {
    walk.note("a registered timeline is not on window.gsap's global timeline");
  }
}

/**
 * GSAP's global timeline and ticker, checked: the ticker is a published
 * build's, it has no listener but GSAP's and the renderer's, and the
 * registered timelines hang from that GSAP's global timeline.
 */
async function gsapGlobals(
  walk: Walk,
  world: MainWorld,
  global: RemoteObjectLike,
  registered: readonly GsapNode[],
): Promise<GsapNode | undefined> {
  const gsap = await windowGsap(walk, world, global);
  if (!isObject(gsap)) {
    if (registered.length > 0) walk.note("timelines are registered but window.gsap is not GSAP");
    return undefined;
  }
  if (!(await tickerFindings(walk, gsap))) return undefined;
  const globalTimeline = await walk.data(gsap, "globalTimeline", "gsap.globalTimeline");
  if (!isObject(globalTimeline)) {
    walk.note("GSAP's global timeline unreadable");
    return undefined;
  }
  await rootFindings(walk, world, globalTimeline, registered);
  return { remote: globalTimeline, label: "GSAP's global timeline" };
}

/**
 * Children of the global timeline that play on GSAP's clock: any not on a
 * registered timeline's chain that is playing, or holds a callback.
 */
// fallow-ignore-next-line complexity
async function globalTimelineFindings(
  walk: Walk,
  world: MainWorld,
  globalTimeline: GsapNode,
  registered: readonly GsapNode[],
): Promise<void> {
  // Registered timelines and their ancestors, which the runtime seeks to film time.
  const chain: RemoteObjectLike[] = [];
  for (const node of registered) {
    let at: RemoteObjectLike | undefined = node.remote;
    for (let depth = 0; isObject(at) && depth < 64; depth++) {
      chain.push(at);
      at = await walk.data(at, "parent", `${node.label} ancestor`);
    }
  }
  const children = await nodeChildren(walk, globalTimeline);
  const ids = await world.identify(
    [...chain, ...children.map((c) => c.remote)].map((r) => r.objectId as string),
  );
  const seeked = new Set(ids.slice(0, chain.length));
  let found = 0;
  let first = "";
  for (let i = 0; i < children.length; i++) {
    if (seeked.has(ids[chain.length + i] as number)) continue;
    const child = children[i] as GsapNode;
    const paused = (await walk.data(child.remote, "_ps", `${child.label}._ps`))?.value === true;
    if (paused && !(await callsBack(walk, child))) continue;
    found++;
    if (!first) {
      const start = (await walk.data(child.remote, "_start", `${child.label}._start`))?.value;
      first = typeof start === "number" ? ` at ${start.toFixed(3)}s` : "";
    }
  }
  if (found > 0) {
    walk.note(
      `${found} GSAP animation(s) on the global timeline outside the registered timelines${first}`,
    );
  }
}

/** Every timeline and tween under the registered timelines, each once. */
async function registeredNodes(
  walk: Walk,
  world: MainWorld,
  registered: readonly GsapNode[],
): Promise<GsapNode[]> {
  const nodes: GsapNode[] = [];
  let level = [...registered];
  const seen = new Set<number>();
  while (level.length > 0) {
    const ids = await world.identify(level.map((n) => n.remote.objectId as string));
    const fresh = level.filter((_, i) => !seen.has(ids[i] as number) && seen.add(ids[i] as number));
    nodes.push(...fresh);
    level = [];
    for (const node of fresh) level.push(...(await nodeChildren(walk, node)));
  }
  return nodes;
}

/** A tween target with the keys its tweens write. */
interface WrittenTarget {
  remote: RemoteObjectLike;
  keys: Set<string>;
}

/** The vars keys a node writes (its settings left out), after checking every callable in its vars. */
async function writtenKeys(walk: Walk, node: GsapNode): Promise<string[]> {
  const vars = await walk.data(node.remote, "vars", `${node.label}.vars`);
  if (!isObject(vars)) return [];
  await walk.vars(vars, `${node.label} vars`, 0);
  return (await walk.props(vars)).result
    .map((entry) => entry.name)
    .filter((key) => !SETTINGS.has(key));
}

/**
 * One node's own methods, vars and targets: element targets are returned
 * with the keys written; a callable target must be script; anything else
 * written to is a finding.
 */
// fallow-ignore-next-line complexity
async function nodeTargets(walk: Walk, node: GsapNode): Promise<WrittenTarget[]> {
  await walk.methods(node.remote, node.label);
  const keys = await writtenKeys(walk, node);
  const list = await walk.data(node.remote, "_targets", `${node.label}._targets`);
  if (!isObject(list)) return [];
  const out: WrittenTarget[] = [];
  for (const entry of (await walk.props(list)).result) {
    const target = entry.value;
    if (!/^\d+$/.test(entry.name) || !target) continue;
    if (isCallable(target)) await walk.callable(`${node.label} target`, target);
    else if (isObject(target) && isElement(target))
      out.push({ remote: target, keys: new Set(keys) });
    else if (keys.length > 0) {
      walk.note(
        `a GSAP tween writes ${keys.slice(0, 3).join(", ")} on ${target.className ?? target.type}, not an element`,
      );
    }
  }
  return out;
}

/** Targets merged by identity, their keys combined. */
async function mergeTargets(
  world: MainWorld,
  targets: readonly WrittenTarget[],
): Promise<WrittenTarget[]> {
  const ids = await world.identify(targets.map((t) => t.remote.objectId as string));
  const merged = new Map<number, WrittenTarget>();
  targets.forEach((target, i) => {
    const known = merged.get(ids[i] as number);
    if (!known) merged.set(ids[i] as number, { remote: target.remote, keys: new Set(target.keys) });
    else for (const key of target.keys) known.keys.add(key);
  });
  return [...merged.values()];
}

/** Accessors for the written keys on each target and along its prototype chain. */
async function targetAccessors(
  walk: Walk,
  targets: readonly WrittenTarget[],
  stop: number | undefined,
): Promise<void> {
  const check = async (owner: RemoteObjectLike, keys: ReadonlySet<string>) => {
    for (const entry of (await walk.props(owner)).result) {
      if ((entry.get || entry.set) && keys.has(entry.name)) {
        await walk.accessor(`tween target .${entry.name}`, entry, entry.name);
      }
    }
  };
  for (const target of targets) await check(target.remote, target.keys);
  await walk.prototypes(
    targets.map((t) => t.remote),
    stop,
    (prototype, from) =>
      check(prototype, new Set(from.flatMap((i) => [...(targets[i] as WrittenTarget).keys]))),
  );
}

/**
 * The registered timelines' tweens: their vars, own methods and prototypes,
 * and their targets, which must be elements, with any accessor those have
 * for the keys the tweens write.
 */
async function tweenFindings(
  walk: Walk,
  world: MainWorld,
  registered: readonly GsapNode[],
): Promise<ElementTarget[]> {
  const nodes = await registeredNodes(walk, world, registered);
  const objectPrototype = await world.ref("ObjectPrototype");
  const stop = objectPrototype?.objectId
    ? (await world.identify([objectPrototype.objectId]))[0]
    : undefined;
  const written: WrittenTarget[] = [];
  for (const node of nodes) {
    if (!walk.budget()) break;
    written.push(...(await nodeTargets(walk, node)));
  }
  const targets = await mergeTargets(world, written);
  await targetAccessors(walk, targets, stop);
  // GSAP's own prototypes: the methods the runtime calls on a timeline.
  await walk.prototypes(
    nodes.map((n) => n.remote),
    stop,
    (prototype) => walk.methods(prototype, "a GSAP prototype"),
  );
  return targets.map(({ remote, keys }) => ({
    objectId: remote.objectId as string,
    keys: [...keys],
  }));
}

/** Listeners on the composed tree and on every other event target, read through DevTools. */
// fallow-ignore-next-line complexity
async function listenerFindings(walk: Walk, world: MainWorld): Promise<void> {
  const check = async (where: string, listeners: EventListenerLike[]) => {
    for (const listener of listeners) {
      const finding = await nonScriptListener(listener, world.props);
      if (finding) walk.note(`a "${listener.type}" listener on ${where} that is ${finding}`);
    }
  };
  const document = await world.ref("document");
  const prototype = await world.ref("EventTargetPrototype");
  if (!document?.objectId || !prototype?.objectId) {
    walk.note("event targets unreadable");
    return;
  }
  const inTree = (await world.client.send("DOMDebugger.getEventListeners", {
    objectId: document.objectId,
    depth: -1,
    pierce: true,
  })) as { listeners: EventListenerLike[] };
  await check("the page", inTree.listeners);
  const { objects } = (await world.client.send("Runtime.queryObjects", {
    prototypeObjectId: prototype.objectId,
    objectGroup: world.objectGroup,
  })) as { objects: RemoteObjectLike };
  if (!objects.objectId) return;
  for (const entry of (await world.props(objects.objectId)).result) {
    const target = entry.value;
    // Nodes are the tree's (a detached one fires nothing a seek causes).
    if (!/^\d+$/.test(entry.name) || !target?.objectId || target.subtype === "node") continue;
    const { listeners } = (await world.client.send("DOMDebugger.getEventListeners", {
      objectId: target.objectId,
    })) as { listeners: EventListenerLike[] };
    await check(target.className || "an event target", listeners);
  }
}

/**
 * Everything on the overlay page that a seek runs and the page provided,
 * and the elements GSAP writes. See the module comment. A read that fails
 * is a finding: unread is not empty.
 */
export async function readSeekReachable(
  world: MainWorld,
  origins: ScriptOriginRecord,
): Promise<SeekReachable> {
  const walk = new Walk(world, origins);
  let elementTargets: ElementTarget[] = [];
  try {
    const global = await world.ref("global");
    if (!isObject(global)) throw new Error("no global object");
    await listenerFindings(walk, world);
    await runtimeGlobals(walk, global);
    const registered = await registeredTimelines(walk, global);
    const globalTimeline = await gsapGlobals(walk, world, global, registered);
    if (globalTimeline) await globalTimelineFindings(walk, world, globalTimeline, registered);
    elementTargets = await tweenFindings(walk, world, registered);
  } catch (error) {
    walk.note(`page state unreadable (${error instanceof Error ? error.message : String(error)})`);
  }
  return { findings: walk.findings, elementTargets };
}
