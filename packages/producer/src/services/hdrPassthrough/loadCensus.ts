/**
 * HDR passthrough: what an overlay page holds once it has loaded, read from
 * outside the page, so the capture page can be compared with the analysis
 * page.
 *
 * The analysis page's registration watch pauses the page as it loads and
 * sees every observer, worker, custom element definition and timer the page
 * registers, with its caller (`registrationWatch.ts`). The capture page is
 * never paused (`unpausedWatch.ts`), so a page that behaves differently when
 * paused could register something there that the analysis page never did.
 * What such a registration leaves behind is read on both pages at the same
 * point, once each is ready and before its first seek, and anything on the
 * capture page the analysis page did not hold declines
 * (`compareLoadCensus`):
 *
 * - every live observer, by the function its callback runs, from a heap
 *   snapshot (`observerCallbacks.ts`): on either page each must run the
 *   renderer's script, and on the capture page each must run a function
 *   that one of the analysis page's observers of the same kind runs
 *   (renderer observers made only once a wall-clock wait finishes vary in
 *   number from load to load, so they are matched by function, not counted),
 *   and every live `FinalizationRegistry` by its cleanup the same way (the
 *   census's own reads collect garbage, which runs cleanups);
 * - counts that must be equal on both pages: live workers, offscreen
 *   canvases and view transitions (`Runtime.queryObjects` on the prototypes
 *   the capture took before any page script ran); defined custom elements and
 *   customized built-ins in the document and its open shadow roots, and the
 *   service worker registrations, read in the isolated world; the
 *   virtual-time shim's pending animation-frame callbacks and film-time
 *   timers whose callback is the page's script or no script (a builtin, a
 *   bound function), read from its closure over DevTools; other targets the
 *   page opened (`window.open`).
 *
 * The census's reads collect garbage, and a `FinalizationRegistry` whose
 * target that frees runs its cleanup: a builtin bound to an element (its
 * `remove`) changes the page with no page script on the stack, and once
 * the cleanup has dropped the element that held it the registry itself is
 * garbage, gone before a later read could see it. So the heap snapshot is
 * the census's first read: every registry that can still run a cleanup is
 * live in it (its cleanup runs as a task, after the snapshot), and is
 * matched by its cleanup like any other. And the page itself (its DOM and
 * open shadow roots, attributes and text, form values, scroll offsets and
 * style sheet rules) is digested before the census and again after it,
 * once the tasks it queued have run: any change declines
 * (`LoadCensus.changed`).
 */

import { type CaptureSession, getCdpSession } from "@hyperframes/engine";
import { evaluateIsolated } from "./isolatedWorld.js";
import type { MainWorld } from "./mainWorld.js";
import type { RemoteObjectLike } from "./nativeCallbacks.js";
import {
  FINALIZATION_REGISTRY,
  findObserverCallbacks,
  type HeapSnapshot,
  OBSERVER_TYPES,
  type ObserverCallbacks,
  takeHeapSnapshot,
} from "./observerCallbacks.js";
import type { ScriptOrigin, ScriptOriginRecord } from "./scriptOrigins.js";

type Page = CaptureSession["page"];

/** A live observer's callback: whose script it runs and, for script, which function (text hash, line, column). */
export interface ObserverCallback {
  type: string;
  origin: ScriptOrigin | "no script";
  /** `<script sha256>:<line>:<column>`, the same function on any page; empty for no script. */
  function: string;
}

/** What an overlay page held once it had loaded (see the module comment). */
export interface LoadCensus {
  /** Counts that must be equal on both pages. */
  counts: ReadonlyMap<string, number>;
  /** Every live observer by its callback. */
  observers: readonly ObserverCallback[];
  /** How the page changed while its census was read (garbage collection ran page-visible work), or null. */
  changed: string | null;
}

/** The capture's `refs` whose live instances are counted exactly. */
const COUNTED_INSTANCES: readonly string[] = [
  "Worker",
  "SharedWorker",
  "OffscreenCanvas",
  "ViewTransition",
];

const isIndex = (name: string) => /^\d+$/.test(name);

/** Elements and registrations the isolated world can count; runs in the page's isolated world. */
async function countInDocument(): Promise<{ customElements: number; serviceWorkers: number }> {
  let customElements = 0;
  const roots: Array<Document | ShadowRoot> = [document];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    if (!root) continue;
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      const autonomous = element.localName.includes("-") && element.matches(":defined");
      if (autonomous || element.hasAttribute("is")) customElements++;
    }
  }
  const container = navigator.serviceWorker;
  const serviceWorkers = container ? (await container.getRegistrations()).length : -1;
  return { customElements, serviceWorkers };
}

/**
 * A digest of what the page shows and holds that a builtin could change
 * with no page script (see the module comment); runs in the page's
 * isolated world, after `yields` task turns.
 */
// fallow-ignore-next-line complexity
export async function digestPage(yields: number): Promise<string> {
  for (let i = 0; i < yields; i++) {
    await new Promise<void>((done) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => done();
      channel.port2.postMessage(0);
    });
  }
  let hash = 0x811c9dc5;
  let parts = 0;
  const add = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
    }
    hash = Math.imul(hash ^ 0x1f, 16777619) >>> 0;
    parts++;
  };
  const sheets = (root: Document | ShadowRoot) => {
    for (const sheet of [...Array.from(root.styleSheets), ...root.adoptedStyleSheets]) {
      try {
        for (const rule of Array.from(sheet.cssRules)) add(rule.cssText);
      } catch {
        add("unreadable sheet");
      }
      add(`sheet ${sheet.disabled}`);
    }
  };
  const roots: Array<Document | ShadowRoot> = [document];
  for (let r = 0; r < roots.length; r++) {
    const root = roots[r] as Document | ShadowRoot;
    add(`root ${r}`);
    sheets(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
    for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
      add(node.nodeName);
      if (node instanceof CharacterData) add(node.data);
      if (!(node instanceof Element)) continue;
      for (const attribute of Array.from(node.attributes))
        add(`${attribute.name}=${attribute.value}`);
      if (node.scrollTop || node.scrollLeft) add(`scroll ${node.scrollTop} ${node.scrollLeft}`);
      if (node instanceof HTMLInputElement) add(`value ${node.value} ${node.checked}`);
      if (node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
        add(`value ${node.value}`);
      }
      if (node.shadowRoot) roots.push(node.shadowRoot);
    }
  }
  add(`window scroll ${scrollX} ${scrollY}`);
  return `${parts}:${hash.toString(16)}`;
}

/** Task turns the page gets after the census, so cleanups its garbage collection queued have run. */
const SETTLE_TURNS = 4;

/** Live instances of the constructor the capture holds as `ref`; -1 when the browser has none. */
async function instancesOf(world: MainWorld, ref: string): Promise<number> {
  const ctor = await world.ref(ref);
  if (!ctor?.objectId) return -1;
  const prototype = await world.value(ctor.objectId, "prototype");
  if (!prototype?.objectId) throw new Error(`${ref} has no prototype`);
  const { objects } = (await world.client.send("Runtime.queryObjects", {
    prototypeObjectId: prototype.objectId,
    objectGroup: world.objectGroup,
  })) as { objects: RemoteObjectLike };
  if (!objects.objectId) throw new Error(`${ref} instances unreadable`);
  const { result } = (await world.client.send("Runtime.getProperties", {
    objectId: objects.objectId,
    ownProperties: true,
  })) as { result: Array<{ name: string }> };
  return result.filter((entry) => isIndex(entry.name)).length;
}

/** Whose script a callable is: `renderer`, `gsap`, `page`, or `no script` (a builtin, a bound function). */
async function callbackOrigin(
  world: MainWorld,
  origins: ScriptOriginRecord,
  callback: RemoteObjectLike | undefined,
): Promise<string> {
  if (!callback?.objectId || callback.type !== "function") return "no script";
  const location = await world.internal(callback.objectId, "[[FunctionLocation]]");
  const scriptId = (location?.value as { scriptId?: string } | undefined)?.scriptId;
  if (!scriptId) return "no script";
  return origins.originOf(scriptId);
}

/** The virtual-time shim's `seekToTime`, checked to be the renderer's script. */
async function shimSeek(world: MainWorld, origins: ScriptOriginRecord): Promise<string> {
  const global = await world.ref("global");
  if (!global?.objectId) throw new Error("no global object");
  const shim = await world.value(global.objectId, "__HF_VIRTUAL_TIME__");
  const seek = shim?.objectId ? await world.value(shim.objectId, "seekToTime") : undefined;
  const isShim = seek?.objectId && (await callbackOrigin(world, origins, seek)) === "renderer";
  if (!isShim || !seek.objectId) throw new Error("the virtual-time shim is not the renderer's");
  return seek.objectId;
}

type ShimQueues = { rafQueue: RemoteObjectLike; timerQueue: RemoteObjectLike };

/** Both shim queues in one closure scope object, or undefined. */
async function queuesIn(world: MainWorld, scope: string): Promise<ShimQueues | undefined> {
  const rafQueue = await world.value(scope, "rafQueue");
  const timerQueue = await world.value(scope, "timerQueue");
  return rafQueue?.objectId && timerQueue?.objectId ? { rafQueue, timerQueue } : undefined;
}

/** The shim's closure variables (`rafQueue`, `timerQueue`), read through `seekToTime`'s scopes. */
async function shimQueues(world: MainWorld, origins: ScriptOriginRecord): Promise<ShimQueues> {
  const scopes = await world.internal(await shimSeek(world, origins), "[[Scopes]]");
  if (!scopes?.objectId) throw new Error("the virtual-time shim's scopes are unreadable");
  const entries = (await world.props(scopes.objectId)).result;
  for (const entry of entries.filter((e) => isIndex(e.name))) {
    const found = entry.value?.objectId ? await queuesIn(world, entry.value.objectId) : undefined;
    if (found) return found;
  }
  throw new Error("the virtual-time shim's queues are unreadable");
}

/**
 * Pending (not cancelled) entries of a shim queue whose callback is page
 * script or no script, by which. The renderer's and GSAP's own are left out:
 * the runtime asks for animation frames on the wall clock while it settles
 * (two or three on the same page, load to load), and the analysis page's
 * watch lets them through too.
 */
async function countQueue(
  world: MainWorld,
  origins: ScriptOriginRecord,
  queue: RemoteObjectLike,
  label: string,
  counts: Map<string, number>,
): Promise<void> {
  if (!queue.objectId) return;
  const entries = (await world.props(queue.objectId)).result.filter((e) => isIndex(e.name));
  for (const entry of entries) {
    const origin = entry.value?.objectId
      ? await pendingCallbackOrigin(world, origins, entry.value.objectId)
      : undefined;
    if (origin !== "page" && origin !== "no script") continue;
    const key = `${label} by ${origin}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

/** Whose script a shim queue entry's callback is, or undefined when the entry was cancelled. */
async function pendingCallbackOrigin(
  world: MainWorld,
  origins: ScriptOriginRecord,
  entry: string,
): Promise<string | undefined> {
  const cancelled = await world.value(entry, "cancelled");
  if (cancelled?.value === true) return undefined;
  return callbackOrigin(world, origins, await world.value(entry, "callback"));
}

/** Targets the page opened: windows with it as opener. */
async function openedTargets(page: Page): Promise<number> {
  const client = await getCdpSession(page);
  const { targetInfo } = (await client.send("Target.getTargetInfo")) as {
    targetInfo: { targetId: string };
  };
  const { targetInfos } = (await client.send("Target.getTargets")) as {
    targetInfos: Array<{ openerId?: string; type: string }>;
  };
  return targetInfos.filter((info) => info.openerId === targetInfo.targetId).length;
}

/**
 * Each live observer made by script, by its callback, from a heap snapshot;
 * throws when the snapshot holds fewer script-made observers of a kind
 * than there are JS objects of it (a snapshot it cannot read). Blink's own
 * observers run no script and are left out.
 */
async function readObservers(
  snapshot: HeapSnapshot,
  world: MainWorld,
  origins: ScriptOriginRecord,
): Promise<ObserverCallback[]> {
  const { scripted } = findObserverCallbacks(snapshot);
  for (const type of [...OBSERVER_TYPES, FINALIZATION_REGISTRY]) {
    const wrappers = await instancesOf(world, type);
    const found = scripted.filter((observer) => observer.type === type).length;
    if (wrappers > found) {
      throw new Error(`${wrappers} ${type} object(s) but ${found} in the heap snapshot`);
    }
  }
  const observers: ObserverCallback[] = [];
  for (const observer of scripted) observers.push(await describeObserver(observer, origins));
  return observers;
}

/** One observer's callback by origin and function; anything but exactly one callback is `no script`. */
async function describeObserver(
  { type, callbacks }: ObserverCallbacks,
  origins: ScriptOriginRecord,
): Promise<ObserverCallback> {
  const [callback] = callbacks;
  if (callbacks.length !== 1 || !callback) return { type, origin: "no script", function: "" };
  const hash = await origins.hashOf(callback.scriptId);
  return {
    type,
    origin: await origins.originOf(callback.scriptId),
    function: `${hash ?? `unreadable script ${callback.scriptId}`}:${callback.line}:${callback.column}`,
  };
}

/** The census of an overlay page that is ready and has not been seeked (see the module comment). */
export async function readLoadCensus(
  page: Page,
  world: MainWorld,
  origins: ScriptOriginRecord,
): Promise<LoadCensus> {
  const before = await evaluateIsolated(page, digestPage, 0);
  // First: the census's first garbage collection, so every live registry is in it (module comment).
  const snapshot = await takeHeapSnapshot(await getCdpSession(page));
  const counts = new Map<string, number>();
  for (const ref of COUNTED_INSTANCES)
    counts.set(`${ref} instances`, await instancesOf(world, ref));
  const inDocument = await evaluateIsolated(page, countInDocument);
  counts.set("custom elements in the document", inDocument.customElements);
  counts.set("service worker registrations", inDocument.serviceWorkers);
  const { rafQueue, timerQueue } = await shimQueues(world, origins);
  await countQueue(world, origins, rafQueue, "animation-frame callbacks", counts);
  await countQueue(world, origins, timerQueue, "film-time timers", counts);
  counts.set("targets the page opened", await openedTargets(page));
  const observers = await readObservers(snapshot, world, origins);
  const after = await evaluateIsolated(page, digestPage, SETTLE_TURNS);
  const changed =
    after === before
      ? null
      : "the page changed while its load census was read (garbage collection ran a cleanup that changed it)";
  return { counts, observers, changed };
}

/** `a MutationObserver`, `an IntersectionObserver`. */
const withArticle = (type: string) => `${/^[AEIOU]/.test(type) ? "an" : "a"} ${type}`;

/** An observer on `census`'s page whose callback is not the renderer's script, as a log detail, or null. */
export function findForeignObserver(census: LoadCensus): string | null {
  const foreign = census.observers.find((observer) => observer.origin !== "renderer");
  if (!foreign) return null;
  const runs = foreign.origin === "no script" ? "runs no script" : `is ${foreign.origin} script`;
  return `${withArticle(foreign.type)} whose callback ${runs}`;
}

/**
 * Whatever the capture page holds that the analysis page did not, as a log
 * detail, or null when there is nothing: any count that differs, either
 * way, and any observer whose callback no analysis-page observer of the
 * same kind runs. A registration the analysis page did not see is one of
 * those, whatever else the page made the runtime register or drop.
 */
export function compareLoadCensus(analysis: LoadCensus, capture: LoadCensus): string | null {
  const keys = new Set([...analysis.counts.keys(), ...capture.counts.keys()]);
  for (const key of [...keys].sort()) {
    const before = analysis.counts.get(key) ?? 0;
    const after = capture.counts.get(key) ?? 0;
    if (after !== before) {
      return `the capture page loaded differently from the analysis page (${key}: ${after} against ${before})`;
    }
  }
  const known = new Set(analysis.observers.map((o) => `${o.type} ${o.origin} ${o.function}`));
  const unknown = capture.observers.find((o) => !known.has(`${o.type} ${o.origin} ${o.function}`));
  if (unknown) {
    const runs = unknown.origin === "no script" ? "no script" : `${unknown.origin} script`;
    return `the capture page loaded differently from the analysis page (${withArticle(unknown.type)} whose callback, ${runs}, no analysis-page observer runs)`;
  }
  return null;
}

/** A census as a plain object, for the render log. */
export function censusForLog(census: LoadCensus | undefined): Record<string, number> | undefined {
  if (!census) return undefined;
  const log: Record<string, number> = Object.fromEntries(census.counts);
  for (const { type, origin, function: fn } of census.observers) {
    // A short name for the function: its script's hash prefix, line and column.
    const key = `${type} by ${origin}${fn ? ` ${fn.slice(0, 8)}${fn.slice(fn.indexOf(":"))}` : ""}`;
    log[key] = (log[key] ?? 0) + 1;
  }
  return log;
}
