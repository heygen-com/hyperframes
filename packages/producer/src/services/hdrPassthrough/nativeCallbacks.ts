/**
 * HDR passthrough: telling page script from callables that run none.
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
 * This module classifies a DevTools remote object without calling anything
 * on the page (`nonScriptCallable`, `nonScriptListener`). Where the
 * passthrough looks for such callables: `seekReachable.ts` (listeners, what
 * the renderer and GSAP call on a seek), `registrationWatch.ts` (observers,
 * custom elements, timers and animation frames the page registers) and
 * `mainWorld.ts` (builtins the page replaced).
 */

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
