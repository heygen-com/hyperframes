/**
 * HDR passthrough: page callbacks that run no page script.
 *
 * The page code watch (`pageCodeWatch.ts`) declines the passthrough when a
 * page function runs after load, because such a function can change what
 * paints where the fingerprint cannot read it (`:popover-open`, the
 * selection) or keep state across seeks. V8's call counts see only functions
 * compiled from page script. A builtin, a bound function, a callable Proxy
 * or a WebAssembly export runs none, yet the page can hand one to the
 * browser or the renderer to call on every seek:
 * `new MutationObserver(HTMLElement.prototype.showPopover.bind(pop))` shows
 * a popover the first time a seek writes what it observes, and nothing on
 * any later probe can tell that it was not open from the start.
 *
 * This module finds those through the DevTools protocol, which reads them
 * without calling anything on the page:
 *
 * - event listeners (including `on*` handlers) on every node of the
 *   composed tree, shadow trees and frames included, and on every other
 *   event target the page holds (window, workers, message ports, font sets,
 *   media query lists, animations), found with `Runtime.queryObjects`;
 * - what the renderer and GSAP call on the page's objects on a seek: the
 *   registered timelines and `window.__timelines`, accessors the page put
 *   on the runtime's `window.__hf*` globals, the function values in GSAP
 *   tween vars, the tweens' targets, and the accessors those targets have
 *   for the keys the tweens write.
 *
 * Any of those that is not page script (a callable whose code V8 did not
 * compile from source, or a listener object, whose `handleEvent` is read at
 * dispatch) declines the passthrough, as does a Proxy among them whose
 * traps are not page script. Observer callbacks and custom element
 * definitions are counted by the shim's callback record instead
 * (`fileServer.ts`): nothing reads them back once they are registered.
 */

import { type CaptureSession, getCdpSession } from "@hyperframes/engine";

type Client = Awaited<ReturnType<typeof getCdpSession>>;

/** CDP object group the lookup releases when it is done. */
const OBJECT_GROUP = "hf-hdr-passthrough-native-callbacks";

/** How deep a bound function or Proxy chain is followed before it counts as unreadable. */
const MAX_CHAIN = 8;

/** Proxy handler entries the engine calls. */
const PROXY_TRAPS: ReadonlySet<string> = new Set([
  "apply",
  "construct",
  "defineProperty",
  "deleteProperty",
  "get",
  "getOwnPropertyDescriptor",
  "getPrototypeOf",
  "has",
  "isExtensible",
  "ownKeys",
  "preventExtensions",
  "set",
  "setPrototypeOf",
]);

/** The fields of a CDP `Runtime.RemoteObject` this module reads. */
export interface RemoteObjectLike {
  type: string;
  subtype?: string;
  className?: string;
  description?: string;
  objectId?: string;
  value?: unknown;
}

/** The fields of a CDP `Runtime.getProperties` result this module reads. */
export interface PropertiesLike {
  result: Array<{
    name: string;
    value?: RemoteObjectLike;
    get?: RemoteObjectLike;
    set?: RemoteObjectLike;
  }>;
  internalProperties?: Array<{ name: string; value?: RemoteObjectLike }>;
}

/** Reads an object's own and internal properties. */
export type ReadProperties = (objectId: string) => Promise<PropertiesLike>;

/** The tail of a native function's source text, as `Function.prototype.toString` prints it. */
const NATIVE_CODE = "{ [native code] }";

function nameOf(remote: RemoteObjectLike): string {
  const description = remote.description ?? "";
  const match = /^function\s*([^(\s]*)\(/.exec(description);
  if (match?.[1]) return match[1];
  return remote.subtype === "proxy" ? "a Proxy" : remote.className || remote.type;
}

/**
 * Why calling `remote` (or using it as a Proxy) can run something other than
 * page script, or `null` when it is a function compiled from source.
 *
 * A function compiled from source has a `[[FunctionLocation]]` and source
 * text; a WebAssembly export has a location in its module but prints as
 * native code; a bound function is followed to its target; a Proxy's traps
 * are each followed, along the handler's prototype chain too, since the
 * engine looks traps up with an ordinary get.
 */
export async function nonScriptCallable(
  remote: RemoteObjectLike,
  readProperties: ReadProperties,
  depth = 0,
): Promise<string | null> {
  if (depth > MAX_CHAIN) return "a bound function or Proxy chain too deep to read";
  if (!remote.objectId) return `an unreadable ${remote.type}`;
  const props = await readProperties(remote.objectId);
  const internal = new Map((props.internalProperties ?? []).map((p) => [p.name, p.value]));
  if (remote.subtype === "proxy") return proxyFinding(internal, readProperties, depth);
  if (remote.type !== "function") return null;
  const target = internal.get("[[TargetFunction]]");
  if (target) return nonScriptCallable(target, readProperties, depth + 1);
  const located = internal.has("[[FunctionLocation]]");
  if (located && !(remote.description ?? "").endsWith(NATIVE_CODE)) return null;
  return `native function ${nameOf(remote)}`;
}

async function proxyFinding(
  internal: Map<string, RemoteObjectLike | undefined>,
  readProperties: ReadProperties,
  depth: number,
): Promise<string | null> {
  const target = await proxyTargetFinding(internal.get("[[Target]]"), readProperties, depth);
  if (target) return target;
  let handler = internal.get("[[Handler]]");
  for (let level = 0; isObjectRemote(handler); level++) {
    if (level > MAX_CHAIN) return "a Proxy handler chain too deep to read";
    const read = await handlerTraps(handler, readProperties, depth);
    if (typeof read === "string") return read;
    handler = read.prototype;
  }
  return null;
}

function isObjectRemote(remote: RemoteObjectLike | undefined): remote is RemoteObjectLike {
  return !!remote && remote.type === "object" && remote.subtype !== "null";
}

/** A Proxy of a function or of another Proxy calls through to it. */
async function proxyTargetFinding(
  target: RemoteObjectLike | undefined,
  readProperties: ReadProperties,
  depth: number,
): Promise<string | null> {
  if (!target || (target.type !== "function" && target.subtype !== "proxy")) return null;
  const finding = await nonScriptCallable(target, readProperties, depth + 1);
  return finding ? `a Proxy of ${finding}` : null;
}

/** One object on a Proxy handler's prototype chain: a finding for its traps, or the next object. */
async function handlerTraps(
  handler: RemoteObjectLike,
  readProperties: ReadProperties,
  depth: number,
): Promise<string | { prototype: RemoteObjectLike | undefined }> {
  if (handler.subtype === "proxy") return "a Proxy whose handler is a Proxy";
  if (!handler.objectId) return "a Proxy with an unreadable handler";
  const props = await readProperties(handler.objectId);
  for (const entry of props.result) {
    const finding = await trapFinding(entry, readProperties, depth);
    if (finding) return finding;
  }
  return {
    prototype: (props.internalProperties ?? []).find((p) => p.name === "[[Prototype]]")?.value,
  };
}

/** A handler property the engine calls as a trap, unless it is page script. */
async function trapFinding(
  entry: PropertiesLike["result"][number],
  readProperties: ReadProperties,
  depth: number,
): Promise<string | null> {
  if (!PROXY_TRAPS.has(entry.name)) return null;
  if (entry.get || entry.set) return `a Proxy whose ${entry.name} trap is an accessor`;
  if (!isCallableRemote(entry.value)) return null;
  const finding = await nonScriptCallable(entry.value, readProperties, depth + 1);
  return finding ? `a Proxy whose ${entry.name} trap is ${finding}` : null;
}

/** Anything but an absent trap (`undefined` or `null`, which the engine skips). */
function isCallableRemote(remote: RemoteObjectLike | undefined): remote is RemoteObjectLike {
  return !!remote && remote.type !== "undefined" && remote.subtype !== "null";
}

/** The part of a CDP `DOMDebugger.EventListener` this module reads. */
export interface EventListenerLike {
  type: string;
  scriptId: string;
  handler?: RemoteObjectLike;
}

/**
 * Why a listener runs something other than page script when its event
 * fires, or `null`. For a listener object (`{ handleEvent }`) CDP reports
 * its `handleEvent` function; one it cannot report counts.
 */
export async function nonScriptListener(
  listener: EventListenerLike,
  readProperties: ReadProperties,
): Promise<string | null> {
  const { handler } = listener;
  if (!handler) return "an unreadable handler";
  if (handler.type !== "function" && handler.subtype !== "proxy") return "a listener object";
  return nonScriptCallable(handler, readProperties);
}

/**
 * Runs in the page; must stay self-contained. Reads only: no getter or
 * page function is called (property descriptors are read instead of values
 * wherever the page could have put an accessor). A Proxy among the tween
 * targets or on their prototype chains does have its traps called here: it
 * is listed, and declines the passthrough unless its traps are page script.
 *
 * Returns `[label, value, label, value, ...]`: everything the renderer or
 * GSAP calls, or reads through, on a seek that the page provided.
 */
// fallow-ignore-next-line complexity
function collectSeekReachableCallables(): unknown[] {
  type Node = {
    getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => Node[];
    targets?: () => unknown[];
    vars?: Record<string, unknown>;
    __hfReal?: Node;
  };
  const w = window as unknown as {
    __timelines?: Record<string, Node>;
    gsap?: { globalTimeline?: Node };
  };
  const out: unknown[] = [];
  const isObject = (value: unknown): value is object =>
    (typeof value === "object" && value !== null) || typeof value === "function";
  const add = (label: string, value: unknown) => {
    if (isObject(value)) out.push(label, value);
  };
  const addAccessor = (label: string, descriptor: PropertyDescriptor | undefined) => {
    if (!descriptor) return;
    add(`getter ${label}`, descriptor.get);
    add(`setter ${label}`, descriptor.set);
  };
  // The page's own `__hf*` accessors on window: the runtime assigns some of them on every seek.
  for (const name of Object.getOwnPropertyNames(window)) {
    if (name.startsWith("__hf"))
      addAccessor(`window.${name}`, Object.getOwnPropertyDescriptor(window, name));
  }
  const registry = Object.getOwnPropertyDescriptor(window, "__timelines");
  addAccessor("window.__timelines", registry);
  add("window.__timelines", registry?.value);

  // Function values in tween vars (callbacks, function-based values, eases, modifiers): data only.
  const seenVars = new Set<object>();
  // Every own property of a vars object: accessors as their functions, data as its value.
  const visitVarsEntry = (label: string, descriptor: PropertyDescriptor, depth: number) => {
    if (descriptor.get || descriptor.set) return addAccessor(label, descriptor);
    const v = descriptor.value;
    if (!isObject(v)) return;
    add(label, v);
    if (isPlainData(v)) visitVars(label, v, depth + 1);
  };
  // Only plain objects and arrays are the page's data: a tween's vars also hold GSAP's own objects
  // (`parent`, the timeline) and DOM nodes, which are walked as timelines and targets instead.
  const isPlainData = (value: object) => {
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype || prototype === Array.prototype;
  };
  const visitVars = (label: string, value: object, depth: number) => {
    if (seenVars.has(value) || depth > 4) return;
    seenVars.add(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      visitVarsEntry(`${label}.${key}`, descriptor, depth);
    }
  };
  // The accessor GSAP writes `key` through on `target`, wherever on its prototype chain it is. A
  // Proxy on the chain has its traps called here; every object on it is listed, and any Proxy
  // with a trap that is not page script declines the passthrough, whatever its traps did here.
  const listedPrototypes = new Set<object>();
  const accessorFor = (target: object, key: string) => {
    for (let o: object | null = target, i = 0; o && i < 64; o = Object.getPrototypeOf(o), i++) {
      if (o !== target && !listedPrototypes.has(o)) {
        listedPrototypes.add(o);
        add("tween target prototype", o);
      }
      const descriptor = Object.getOwnPropertyDescriptor(o, key);
      if (descriptor) return descriptor.get || descriptor.set ? descriptor : undefined;
    }
    return undefined;
  };

  const nodes: Node[] = [];
  const seenNodes = new Set<Node>();
  const pushNode = (node: unknown) => {
    if (isObject(node) && !seenNodes.has(node as Node)) {
      seenNodes.add(node as Node);
      nodes.push(node as Node);
    }
  };
  for (const [key, entry] of Object.entries(registry?.value ?? {})) {
    add(`timeline "${key}"`, entry);
    pushNode((entry as Node | undefined)?.__hfReal ?? entry);
  }
  pushNode(w.gsap?.globalTimeline);
  for (let i = 0; i < nodes.length && i < 100000; i++) {
    const node = nodes[i] as Node;
    if (typeof node.getChildren === "function") {
      for (const child of node.getChildren(false, true, true)) pushNode(child);
    }
    const vars = node.vars;
    if (isObject(vars)) visitVars("tween vars", vars, 0);
    const targets = typeof node.targets === "function" ? node.targets() : [];
    const keys = isObject(vars) ? Object.keys(vars) : [];
    for (const target of targets) {
      if (!isObject(target)) continue;
      add("tween target", target);
      for (const key of keys) {
        addAccessor(`tween target .${key}`, accessorFor(target, key));
      }
    }
  }
  return out;
}

/**
 * Whether a native accessor is the platform's own for `key` (`scrollTop` on
 * an element): it prints as `function get scrollTop() { [native code] }`.
 */
function isPlatformAccessor(label: string, remote: RemoteObjectLike): boolean {
  const match = /^(getter|setter) tween target \.(.+)$/.exec(label);
  if (!match) return false;
  const kind = match[1] === "getter" ? "get" : "set";
  return remote.description === `function ${kind} ${match[2]}() ${NATIVE_CODE}`;
}

async function readFlatArray(client: Client, objectId: string): Promise<RemoteObjectLike[]> {
  const { result } = (await client.send("Runtime.getProperties", {
    objectId,
    ownProperties: true,
  })) as PropertiesLike;
  return result
    .filter((entry) => /^\d+$/.test(entry.name) && entry.value)
    .sort((a, b) => Number(a.name) - Number(b.name))
    .map((entry) => entry.value as RemoteObjectLike);
}

async function evaluateHandle(client: Client, expression: string): Promise<RemoteObjectLike> {
  const { result, exceptionDetails } = await client.send("Runtime.evaluate", {
    // Named as a DevTools evaluation, which the page code watch trusts (scriptOrigins.ts).
    expression: `${expression}\n//# sourceURL=pptr:findNativeCallbacks`,
    objectGroup: OBJECT_GROUP,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text || "evaluation failed");
  return result as RemoteObjectLike;
}

// Handlers come back in the object group of the target they were read from: OBJECT_GROUP.
async function listenerFindings(client: Client, readProperties: ReadProperties): Promise<string[]> {
  const findings: string[] = [];
  const check = async (where: string, listeners: EventListenerLike[]) => {
    for (const listener of listeners) {
      const finding = await nonScriptListener(listener, readProperties);
      if (finding) findings.push(`a "${listener.type}" listener on ${where} that is ${finding}`);
    }
  };
  const documentHandle = await evaluateHandle(client, "document");
  const inTree = await client.send("DOMDebugger.getEventListeners", {
    objectId: documentHandle.objectId as string,
    depth: -1,
    pierce: true,
  });
  await check("the page", inTree.listeners as EventListenerLike[]);
  // Event targets outside the tree. Nodes are the tree's (a detached one fires nothing a seek causes).
  const prototype = await evaluateHandle(client, "EventTarget.prototype");
  const { objects } = await client.send("Runtime.queryObjects", {
    prototypeObjectId: prototype.objectId as string,
    objectGroup: OBJECT_GROUP,
  });
  for (const target of await readFlatArray(client, objects.objectId as string)) {
    if (target.subtype === "node" || !target.objectId) continue;
    const { listeners } = await client.send("DOMDebugger.getEventListeners", {
      objectId: target.objectId,
    });
    await check(target.className || "an event target", listeners as EventListenerLike[]);
  }
  return findings;
}

async function reachableFindings(
  client: Client,
  readProperties: ReadProperties,
): Promise<string[]> {
  const findings: string[] = [];
  const handle = await evaluateHandle(client, `(${collectSeekReachableCallables.toString()})()`);
  const flat = handle.objectId ? await readFlatArray(client, handle.objectId) : [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const label = String((flat[i] as RemoteObjectLike).value);
    const value = flat[i + 1] as RemoteObjectLike;
    if (value.type !== "function" && value.subtype !== "proxy") continue;
    const finding = await nonScriptCallable(value, readProperties);
    if (finding && !isPlatformAccessor(label, value)) findings.push(`${label}: ${finding}`);
  }
  return findings;
}

/**
 * `seek_callback` finding for page callbacks that run no page script (see
 * the module comment), or `null`. A lookup that fails is a finding too: an
 * unread listener set is not an empty one. Uses the page's cached engine CDP
 * session and never detaches it (see `findSeekHookListeners`).
 *
 * `Runtime.queryObjects` collects garbage first, which only a page that
 * watches its own garbage collection (`FinalizationRegistry`, `WeakRef`)
 * could notice.
 */
export async function findNativeCallbacks(page: CaptureSession["page"]): Promise<string | null> {
  try {
    const client = await getCdpSession(page);
    const readProperties: ReadProperties = async (objectId) =>
      (await client.send("Runtime.getProperties", {
        objectId,
        ownProperties: true,
      })) as PropertiesLike;
    try {
      const findings = [
        ...(await listenerFindings(client, readProperties)),
        ...(await reachableFindings(client, readProperties)),
      ];
      if (findings.length === 0) return null;
      return `${findings.length} page callback(s) that run no page script, first ${findings[0]}`;
    } finally {
      await client
        .send("Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP })
        .catch(() => undefined);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `page callbacks unreadable (${detail})`;
  }
}
