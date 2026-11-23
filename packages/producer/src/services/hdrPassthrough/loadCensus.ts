/**
 * HDR passthrough: what an overlay page holds once it has loaded, counted
 * from outside the page, so the capture page can be compared with the
 * analysis page.
 *
 * The analysis page's registration watch pauses the page as it loads and
 * sees every observer, worker, custom element definition and timer the page
 * registers, with its caller (`registrationWatch.ts`). The capture page is
 * never paused (`unpausedWatch.ts`), so a page that behaves differently when
 * paused could register something there that the analysis page never did.
 * What such a registration leaves behind is counted on both pages at the
 * same point, once each is ready and before its first seek, and a count
 * the capture page holds above the analysis page's declines
 * (`compareLoadCensus`):
 *
 * - live objects of each registration type, by `Runtime.queryObjects` on the
 *   prototypes the capture took before any page script ran: observers,
 *   workers, offscreen canvases, view transitions (the runtime's own
 *   observers count on both pages alike);
 * - defined custom elements and customized built-ins in the document and its
 *   open shadow roots, and the service worker registrations, read in the
 *   isolated world;
 * - the virtual-time shim's pending animation-frame callbacks and film-time
 *   timers whose callback is the page's script or no script (a builtin, a
 *   bound function), read from its closure over DevTools;
 * - other targets the page opened (`window.open`, workers DevTools lists).
 */

import { type CaptureSession, getCdpSession } from "@hyperframes/engine";
import { evaluateIsolated } from "./isolatedWorld.js";
import type { MainWorld } from "./mainWorld.js";
import type { RemoteObjectLike } from "./nativeCallbacks.js";
import type { ScriptOriginRecord } from "./scriptOrigins.js";

type Page = CaptureSession["page"];

/** Counts by what was counted; equal censuses mean the page loaded the same way. */
export type LoadCensus = ReadonlyMap<string, number>;

/** The capture's `refs` whose live instances are counted. */
const COUNTED_INSTANCES: readonly string[] = [
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "PerformanceObserver",
  "ReportingObserver",
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

/** The census of an overlay page that is ready and has not been seeked (see the module comment). */
export async function readLoadCensus(
  page: Page,
  world: MainWorld,
  origins: ScriptOriginRecord,
): Promise<LoadCensus> {
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
  return counts;
}

/**
 * The first count on the capture page above the analysis page's, as a log
 * detail, or null when there is none. The capture page may hold fewer: the
 * runtime makes some of its observers only once a wall-clock wait it runs
 * finishes, and one an earlier wait left without a reference is collected
 * or not (5 or 7 MutationObservers on the same page, load to load). A
 * registration the analysis page did not see holds one more.
 */
export function compareLoadCensus(analysis: LoadCensus, capture: LoadCensus): string | null {
  for (const key of [...capture.keys()].sort()) {
    const before = analysis.get(key) ?? 0;
    const after = capture.get(key) ?? 0;
    if (after > before) {
      return `the capture page loaded differently from the analysis page (${key}: ${after} against ${before})`;
    }
  }
  return null;
}

/** A census as a plain object, for the render log. */
export function censusForLog(census: LoadCensus | undefined): Record<string, number> | undefined {
  return census ? Object.fromEntries(census) : undefined;
}
